import crypto from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import AdmZip from 'adm-zip';
import romeOpenData from '../functions/lib/rome-open-data.cjs';

const {
  extractRomeReferenceEntries,
  validateRomeReference,
} = romeOpenData;

const SOURCES = [
  {
    name: 'data.gouv JSON ROME',
    source: 'data-gouv-rome',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/1c893376-8476-4262-9a0e-8df519883e1e',
  },
  {
    name: 'France Travail JSON ROME',
    source: 'france-travail-rome',
    url: 'https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/json',
  },
  {
    name: 'data.gouv CSV ROME',
    source: 'data-gouv-rome',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/8cf674b6-ef21-446a-8190-178e2defd6fc',
  },
  {
    name: 'France Travail CSV ROME',
    source: 'france-travail-rome',
    url: 'https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/csv',
  },
];

const MINIMUM_ENTRIES = 1000;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!DRY_RUN && getApps().length === 0) {
  initializeApp();
}

const db = DRY_RUN ? null : getFirestore();

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function chooseDelimiter(line) {
  return [';', '\t', ',']
    .map((delimiter) => ({
      delimiter,
      count: line.split(delimiter).length - 1,
    }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ';';
}

function parseCsv(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = input.split(/\r?\n/).find((line) => line.trim()) || '';
  const delimiter = chooseDelimiter(firstLine);

  const rows = [];
  let row = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;

      row.push(current);
      current = '';

      if (row.some((cell) => cleanText(cell))) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map((header, index) => {
    const normalized = cleanText(header)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized || `col_${index}`;
  });

  return rows.slice(1).map((cells) => {
    const output = {};

    headers.forEach((header, index) => {
      output[header] = cells[index] ?? '';
    });

    return output;
  });
}

function parseBufferPayloads(buffer) {
  const payloads = [];

  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b;

  if (isZip) {
    const zip = new AdmZip(buffer);

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;

      const name = entry.entryName.toLowerCase();
      if (!name.endsWith('.json') && !name.endsWith('.csv') && !name.endsWith('.txt')) {
        continue;
      }

      const text = entry.getData().toString('utf8').replace(/^\uFEFF/, '');
      const trimmed = text.trim();

      if (!trimmed) continue;

      try {
        if (name.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
          payloads.push(JSON.parse(text));
        } else {
          payloads.push(parseCsv(text));
        }
      } catch (error) {
        console.warn(`Fichier ignoré dans l'archive: ${entry.entryName}: ${error.message}`);
      }
    }

    return payloads;
  }

  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const trimmed = text.trim();

  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return [JSON.parse(text)];
  }

  return [parseCsv(text)];
}

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: {
      Accept: '*/*',
      'User-Agent': 'ApprentiFR ROME reference importer',
    },
  });

  if (!response.ok) {
    throw new Error(`${source.name}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const sourceVersion = `sha256:${hash}`;
  const payloads = parseBufferPayloads(buffer);

  const entries = extractRomeReferenceEntries(payloads, {
    source: source.source,
    sourceVersion,
  });

  const validation = validateRomeReference(entries, {
    minimumEntries: MINIMUM_ENTRIES,
  });

  if (!validation.ok) {
    throw new Error(`${source.name}: ${validation.error}`);
  }

  return {
    ...source,
    entries,
    sourceVersion,
    sourceHash: hash,
  };
}

async function commitEntryBatches(runId, sourceResult) {
  let batch = db.batch();
  let pending = 0;

  for (const entry of sourceResult.entries) {
    const docId = `${runId}_${entry.romeCode}`;
    const ref = db.collection('occupationReference').doc(docId);

    batch.set(ref, {
      ...entry,
      importRunId: runId,
      sourceUrl: sourceResult.url,
      importedAt: FieldValue.serverTimestamp(),
      schemaVersion: 'occupationReference.v1',
    });

    pending += 1;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }
}

async function publishSource(sourceResult) {
  const date = new Date().toISOString().slice(0, 10);
  const runId = `rome_${date}_${sourceResult.sourceHash.slice(0, 12)}`;

  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      runId,
      source: sourceResult.source,
      sourceVersion: sourceResult.sourceVersion,
      count: sourceResult.entries.length,
      sample: sourceResult.entries.slice(0, 10),
    }, null, 2));
    return;
  }

  const runRef = db.collection('occupationReferenceRuns').doc(runId);

  await runRef.set({
    runId,
    status: 'building',
    source: sourceResult.source,
    sourceName: sourceResult.name,
    sourceUrl: sourceResult.url,
    sourceVersion: sourceResult.sourceVersion,
    expectedEntries: sourceResult.entries.length,
    startedAt: FieldValue.serverTimestamp(),
    schemaVersion: 'occupationReferenceRun.v1',
  }, { merge: true });

  try {
    await commitEntryBatches(runId, sourceResult);

    await runRef.set({
      status: 'ready',
      writtenEntries: sourceResult.entries.length,
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('occupationReferenceMeta').doc('current').set({
      runId,
      source: sourceResult.source,
      sourceName: sourceResult.name,
      sourceUrl: sourceResult.url,
      sourceVersion: sourceResult.sourceVersion,
      entriesCount: sourceResult.entries.length,
      importedAt: FieldValue.serverTimestamp(),
      schemaVersion: 'occupationReferenceMeta.v1',
    });

    console.log(JSON.stringify({
      ok: true,
      dryRun: false,
      runId,
      source: sourceResult.source,
      sourceVersion: sourceResult.sourceVersion,
      count: sourceResult.entries.length,
    }, null, 2));
  } catch (error) {
    await runRef.set({
      status: 'failed',
      error: String(error?.message || error).slice(0, 1000),
      failedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    throw error;
  }
}

async function main() {
  const failures = [];

  for (const source of SOURCES) {
    try {
      console.log(`Lecture ROME: ${source.name}`);
      const result = await fetchSource(source);
      console.log(`${source.name}: ${result.entries.length} codes ROME valides`);
      await publishSource(result);
      return;
    } catch (error) {
      failures.push(`${source.name}: ${error.message}`);
      console.warn(failures[failures.length - 1]);
    }
  }

  throw new Error(`Aucune source ROME exploitable. ${failures.join(' | ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
