'use strict';

// Lecteur de tableau JSON en flux : une entree assemblee a la fois.
// Pas de JSON.parse() sur le fichier national (591 Mo lors de l'audit).
// Le scanner suit les guillemets et les echappements; il ne traite qu'un
// tableau racine ou les chemins LBA connus, sans laisser un autre tableau
// dans l'objet racine etre pris pour des offres.
const { StringDecoder } = require('node:string_decoder');
const { Readable } = require('node:stream');
const { createGunzip } = require('node:zlib');

const ALLOWED_ARRAY_PATHS = new Set([
  '', 'jobs', 'offers', 'offres', 'items', 'results',
  'data.jobs', 'data.offers', 'data.offres',
  'data.items', 'data.results', 'export.jobs', 'export.offers',
]);
const MAX_ITEM_CHARS = 4 * 1024 * 1024;

function createOfferArrayScanner(onItem, { maxItemChars = MAX_ITEM_CHARS } = {}) {
  if (typeof onItem !== 'function') throw new TypeError('onItem callback requis');
  const stack = [];
  const decoder = new StringDecoder('utf8');
  let stringMode = false, escaped = false, readingKey = false, keyChars = '';
  let selectedDepth = -1, selected = false, completed = false;
  let collecting = false, pieces = [], start = -1, size = 0, items = 0;

  function emit() {
    const raw = pieces.join('');
    if (raw.length > maxItemChars) throw new Error('LBA_EXPORT_ITEM_TOO_LARGE');
    const item = JSON.parse(raw);
    items++;
    onItem(item);
    pieces = []; size = 0; collecting = false; start = -1;
  }

  function appendPiece(value) {
    if (!value) return;
    size += value.length;
    if (size > maxItemChars) throw new Error('LBA_EXPORT_ITEM_TOO_LARGE');
    pieces.push(value);
  }

  function writeText(chunk) {
    if (completed) return;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (stringMode) {
        if (escaped) {
          if (readingKey) keyChars += c;
          escaped = false;
          continue;
        }
        if (c === '\\') {
          if (readingKey) keyChars += c;
          escaped = true;
          continue;
        }
        if (c === '"') {
          stringMode = false;
          if (readingKey) {
            const top = stack[stack.length - 1];
            if (!top || top.type !== 'object') throw new Error('LBA_EXPORT_BAD_KEY');
            top.key = JSON.parse('"' + keyChars + '"');
            readingKey = false;
            keyChars = '';
          }
          continue;
        }
        if (readingKey) {
          if (keyChars.length > 512) throw new Error('LBA_EXPORT_KEY_TOO_LARGE');
          keyChars += c;
        }
        continue;
      }
      if (c === '"') {
        stringMode = true;
        escaped = false;
        const top = stack[stack.length - 1];
        readingKey = selectedDepth < 0 && top?.type === 'object' && top.expectKey;
        if (readingKey) keyChars = '';
        continue;
      }
      if (c === '{' || c === '[') {
        const parent = stack[stack.length - 1];
        const path = parent
          ? parent.type === 'object'
            ? [parent.path, parent.key].filter(Boolean).join('.')
            : [parent.path, 'item'].filter(Boolean).join('.')
          : '';
        if (c === '[' && selectedDepth < 0 && ALLOWED_ARRAY_PATHS.has(path)) {
          selectedDepth = stack.length + 1;
          selected = true;
        }
        if (c === '{' && selectedDepth > 0 && stack.length === selectedDepth) {
          if (collecting) throw new Error('LBA_EXPORT_NESTED_RECORD_STATE');
          collecting = true;
          start = i;
        }
        stack.push({
          type: c === '{' ? 'object' : 'array',
          path,
          expectKey: c === '{',
          key: null,
        });
        continue;
      }
      if (c === '}' || c === ']') {
        const oldDepth = stack.length;
        const frame = stack.pop();
        if (!frame || (c === '}' && frame.type !== 'object') ||
            (c === ']' && frame.type !== 'array')) {
          throw new Error('LBA_EXPORT_INVALID_JSON_STRUCTURE');
        }
        if (collecting && c === '}' && oldDepth === selectedDepth + 1) {
          appendPiece(chunk.slice(start, i + 1));
          emit();
        }
        if (c === ']' && oldDepth === selectedDepth) {
          completed = true;
          selectedDepth = -1;
          return;
        }
        continue;
      }
      const top = stack[stack.length - 1];
      if (top?.type === 'object') {
        if (c === ':') top.expectKey = false;
        if (c === ',') { top.expectKey = true; top.key = null; }
      }
    }
    if (collecting) {
      appendPiece(chunk.slice(start));
      start = 0;
    }
  }

  return {
    write(buffer) {
      writeText(decoder.write(buffer));
    },
    finish() {
      writeText(decoder.end());
      if (!selected || !completed || collecting || stringMode) {
        throw new Error('LBA_EXPORT_INCOMPLETE_ARRAY');
      }
      if (items < 1) throw new Error('LBA_EXPORT_EMPTY');
      return { items, completed: true };
    },
  };
}

async function parseOfferArrayStream(source, onItem, options = {}) {
  const scanner = createOfferArrayScanner(onItem, options);
  for await (const chunk of source) {
    scanner.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return scanner.finish();
}

async function readSignedExportStream(response, onItem, {maxBytes = 1_400_000_000} = {}) {
  if (!response?.ok || !response.body) throw new Error('LBA_EXPORT_DOWNLOAD_HTTP');
  const source = Readable.fromWeb(response.body);
  const iterator = source[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw new Error('LBA_EXPORT_EMPTY_BODY');
  const head = Buffer.isBuffer(first.value) ? first.value : Buffer.from(first.value);
  let bytes = 0;
  const chunks = Readable.from((async function*() {
    bytes += head.length;
    if (bytes > maxBytes) throw new Error('LBA_EXPORT_TOO_LARGE');
    yield head;
    for await (const entry of iterator) {
      const buf = Buffer.isBuffer(entry) ? entry : Buffer.from(entry);
      bytes += buf.length;
      if (bytes > maxBytes) throw new Error('LBA_EXPORT_TOO_LARGE');
      yield buf;
    }
  })());
  // fetch() peut decomprimer Content-Encoding automatiquement; regarder
  // les octets eux-memes plutot que l'en-tete HTTP.
  const gunzipped = head[0] === 0x1f && head[1] === 0x8b;
  const stream = gunzipped ? chunks.pipe(createGunzip()) : chunks;
  const result = await parseOfferArrayStream(stream, onItem);
  return { ...result, downloadedBytes: bytes, gzip: gunzipped };
}

module.exports = {
  createOfferArrayScanner, parseOfferArrayStream, readSignedExportStream,
  ALLOWED_ARRAY_PATHS,
};
