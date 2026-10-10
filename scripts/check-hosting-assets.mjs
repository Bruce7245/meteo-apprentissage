import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DEFAULT_SITE = 'https://meteo-apprentissage.web.app';
const DEFAULT_ROUTES = ['/', '/admin/entreprises', '/admin/stats/metiers'];

function attribute(tag, key) {
  const escaped = key.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
  const match = tag.match(new RegExp('(?:^|\\s)' + escaped + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

export function extractProductionAssets(html) {
  const assets = [];
  for (const tag of String(html).match(/<(?:script|link)\b[^>]*>/gi) || []) {
    if (/^<script\b/i.test(tag)) {
      if (attribute(tag, 'type') !== 'module') continue;
      const src = attribute(tag, 'src');
      if (src) assets.push({ path: src, kind: 'js' });
    } else if (/^<link\b/i.test(tag)) {
      if (!String(attribute(tag, 'rel') || '').split(/\s+/).includes('stylesheet')) continue;
      const href = attribute(tag, 'href');
      if (href) assets.push({ path: href, kind: 'css' });
    }
  }
  return assets;
}

function pathName(url) {
  return new URL(url).pathname;
}

export async function auditHostingAssets({
  site = DEFAULT_SITE,
  routes = DEFAULT_ROUTES,
  request = fetch,
  inspectMissing = true,
} = {}) {
  const origin = new URL(site).origin;
  const errors = [];
  const pages = [];
  const assets = [];
  const assetCandidates = new Map();

  for (const route of routes) {
    const url = new URL(route, origin);
    try {
      const response = await request(url, {
        headers: { 'Cache-Control': 'no-cache', Accept: 'text/html' },
      });
      const html = await response.text();
      const type = response.headers.get('content-type') || '';
      pages.push({ path: route, status: response.status, contentType: type, cacheControl: response.headers.get('cache-control') || '' });

      if (!response.ok || !type.toLowerCase().includes('text/html') || !/<html\b/i.test(html)) {
        errors.push('Page SPA invalide: ' + route + ' (HTTP ' + response.status + ', ' + type + ')');
        continue;
      }
      const listed = extractProductionAssets(html);
      if (!listed.some(item => item.kind === 'js')) {
        errors.push('Aucun module JavaScript trouve dans ' + route);
      }
      for (const asset of listed) {
        const absolute = new URL(asset.path, url);
        if (absolute.origin !== origin) {
          errors.push('Module externe inattendu: ' + absolute.href);
          continue;
        }
        if (!assetCandidates.has(absolute.href)) assetCandidates.set(absolute.href, asset.kind);
      }
    } catch (error) {
      errors.push('Impossible de lire ' + route + ': ' + error.message);
    }
  }

  for (const [url, kind] of assetCandidates) {
    const filename = pathName(url);
    if (!/\/assets\/[^/]+\.(?:js|mjs|css)$/.test(filename)) {
      errors.push('Chemin de build Vite suspect: ' + filename);
    }
    try {
      const response = await request(url, { headers: { 'Cache-Control': 'no-cache' } });
      const type = String(response.headers.get('content-type') || '');
      const body = await response.text();
      const looksLikeHtml = /^(?:\s*<!doctype html|\s*<html\b)/i.test(body.slice(0, 400));
      assets.push({ path: filename, kind, status: response.status, contentType: type, bytes: Buffer.byteLength(body), looksLikeHtml });
      const validMime = kind === 'js' ? /(?:java|ecma)script/i.test(type) : /^text\/css\b/i.test(type);
      if (!response.ok || !validMime || looksLikeHtml || !body.length) {
        errors.push('Fichier ' + kind + ' invalide: ' + filename + ' (HTTP ' + response.status + ', ' + type + (looksLikeHtml ? ', HTML a la place du module' : '') + ')');
      }
    } catch (error) {
      errors.push('Impossible de lire le fichier ' + filename + ': ' + error.message);
    }
  }

  let missingModule = null;
  if (inspectMissing) {
    const url = new URL('/assets/__apprentifr_missing_module_probe__.js', origin);
    try {
      const response = await request(url);
      missingModule = { status: response.status, contentType: response.headers.get('content-type') || '' };
    } catch (error) {
      missingModule = { error: error.message };
    }
  }

  return { ok: errors.length === 0, site: origin, pages, assets, missingModule, errors };
}

async function main() {
  const report = await auditHostingAssets({ site: process.env.HOSTING_URL || DEFAULT_SITE });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error('Audit Hosting impossible:', error.message);
    process.exitCode = 1;
  });
}
