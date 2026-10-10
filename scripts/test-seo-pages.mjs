import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractProductionAssets } from './check-hosting-assets.mjs';

const root = new URL('../', import.meta.url);

function read(relativePath) {
  return readFile(new URL(relativePath, root), 'utf8');
}

function getMeta(html, keyAttribute, keyValue) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
  const found = tags.filter(tag => {
    const key = new RegExp('\\b' + keyAttribute + '="([^"]+)"', 'i').exec(tag);
    return key?.[1] === keyValue;
  });
  assert.equal(found.length, 1, 'One meta element expected: ' + keyValue);
  return /\bcontent="([^"]*)"/i.exec(found[0])?.[1] || '';
}

function getCanonical(html) {
  const tags = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(match => match[0])
    .filter(tag => /\brel="canonical"/i.test(tag));
  assert.equal(tags.length, 1, 'Each HTML entry must declare exactly one canonical');
  return /\bhref="([^"]+)"/i.exec(tags[0])?.[1] || '';
}

function getTitle(html) {
  return /<title>([^<]+)<\/title>/i.exec(html)?.[1] || '';
}

const pages = [
  {
    file: 'dist/index.html',
    url: 'https://apprentifr.fr/',
    title: "ApprentiFR — Observatoire de l'apprentissage en France",
  },
  {
    file: 'dist/metiers.html',
    url: 'https://apprentifr.fr/metiers',
    title: 'Métiers et formations en apprentissage — ApprentiFR',
  },
];

test('Each public page has unique server HTML SEO metadata and Vite production assets', async () => {
  const seenTitles = new Set();
  const seenDescriptions = new Set();
  for (const page of pages) {
    const html = await read(page.file);
    const title = getTitle(html);
    const description = getMeta(html, 'name', 'description');
    assert.equal(title, page.title, page.file + ' title');
    assert.equal(getCanonical(html), page.url, page.file + ' canonical');
    assert.equal(getMeta(html, 'property', 'og:url'), page.url);
    assert.equal(getMeta(html, 'property', 'og:title'), page.title);
    assert.equal(getMeta(html, 'property', 'og:description'), description);
    assert.equal(getMeta(html, 'name', 'twitter:title'), title);
    assert.equal(getMeta(html, 'name', 'twitter:description'), description);
    assert.equal(getMeta(html, 'name', 'twitter:card'), 'summary');
    assert.ok(description.length >= 75 && description.length <= 175, 'Length of ' + page.file + ' description');
    assert.ok(!seenTitles.has(title) && !seenDescriptions.has(description), 'Page SEO data must be unique');
    seenTitles.add(title);
    seenDescriptions.add(description);
    assert.match(html, /<div id="root"><\/div>/);
    assert.ok(extractProductionAssets(html).some(asset => asset.kind === 'js'), 'Vite module missing: ' + page.file);
    assert.ok(!html.includes('/src/main.jsx'), 'Development entrypoint in production ' + page.file);
  }
});

test('Sitemap and robots only advertise canonical public stable URLs', async () => {
  const [sitemap, robots] = await Promise.all([read('dist/sitemap.xml'), read('dist/robots.txt')]);
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locations, pages.map(page => page.url));
  assert.ok(!locations.some(url => url.includes('/admin') || url.includes('www.')));
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/m);
  assert.match(robots, /Sitemap: https:\/\/apprentifr\.fr\/sitemap\.xml/);
});

test('Firebase Hosting serves dedicated /metiers HTML before SPA fallback, preserves admin noindex', async () => {
  const config = JSON.parse(await read('firebase.json'));
  const rewrites = config.hosting.rewrites;
  assert.deepEqual(rewrites, [
    { source: '/metiers', destination: '/metiers.html' },
    { source: '!/@(assets|src)/**', destination: '/index.html' },
  ]);
  const redirects = config.hosting.redirects || [];
  for (const source of ['/metiers/', '/metiers.html']) {
    assert.ok(redirects.some(rule =>
      rule.source === source && rule.destination === '/metiers' && rule.type === 301
    ), 'Missing canonical redirect: ' + source);
  }
  const headers = config.hosting.headers || [];
  for (const source of ['/admin', '/admin/**']) {
    const rule = headers.find(item => item.source === source);
    assert.equal(rule?.headers?.find(item => item.key === 'X-Robots-Tag')?.value, 'noindex, nofollow');
  }
});
