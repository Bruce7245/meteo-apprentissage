import test from 'node:test';
import assert from 'node:assert/strict';
import { auditHostingAssets, extractProductionAssets } from './check-hosting-assets.mjs';
import { verifyBuiltAssets } from './verify-hosting-build.mjs';
import { readFile } from 'node:fs/promises';

const html = '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-456.css"></head><body><div id="root"></div><script type="module" crossorigin src="/assets/index-123.js"></script></body></html>';

function fakeResponse(status, type, body) {
  return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } });
}

function requestWith({ js = 'ok', css = 'ok', htmlBody = html } = {}) {
  return async target => {
    const path = new URL(target).pathname;
    if (path.includes('__apprentifr_missing_module_probe__')) return fakeResponse(200, 'text/html', html);
    if (path === '/assets/index-123.js') {
      if (js === 'html') return fakeResponse(200, 'text/html; charset=utf-8', html);
      if (js === '404') return fakeResponse(404, 'text/plain', 'Not found');
      return fakeResponse(200, 'text/javascript', 'console.log("ready")');
    }
    if (path === '/assets/index-456.css') {
      if (css === 'html') return fakeResponse(200, 'text/html', html);
      return fakeResponse(200, 'text/css', '#root{display:block}');
    }
    return fakeResponse(200, 'text/html; charset=utf-8', htmlBody);
  };
}

test('extract Vite module scripts and CSS even when attribute order varies', () => {
  assert.deepEqual(extractProductionAssets(html), [
    { path: '/assets/index-456.css', kind: 'css' },
    { path: '/assets/index-123.js', kind: 'js' },
  ]);
});

test('an intact deployed bundle passes including SPA deep links', async () => {
  const report = await auditHostingAssets({ site: 'https://example.test', routes: ['/', '/admin/stats/metiers'], request: requestWith() });
  assert.equal(report.ok, true);
  assert.equal(report.assets.length, 2);
  assert.equal(report.missingModule.status, 200); // diagnostic only until SPA rewrite is narrowed
});

test('detect 200 HTML in place of a JavaScript bundle', async () => {
  const report = await auditHostingAssets({ site: 'https://example.test', routes: ['/'], request: requestWith({ js: 'html' }) });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(message => message.includes('HTML a la place du module')));
  assert.equal(report.assets.find(item => item.kind === 'js').contentType, 'text/html; charset=utf-8');
});

test('detect broken CSS and disappeared hashed files', async () => {
  const brokenCss = await auditHostingAssets({ site: 'https://example.test', routes: ['/'], request: requestWith({ css: 'html' }) });
  assert.equal(brokenCss.ok, false);
  const missingJs = await auditHostingAssets({ site: 'https://example.test', routes: ['/'], request: requestWith({ js: '404' }) });
  assert.equal(missingJs.ok, false);
});

test('reject dev entrypoints and HTML without a production module', async () => {
  const development = html.replace('/assets/index-123.js', '/src/main.jsx');
  const report = await auditHostingAssets({ site: 'https://example.test', routes: ['/'], request: requestWith({ htmlBody: development }) });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(message => message.includes('Chemin de build Vite suspect')));
});

test('pre-deploy build manifest references real nonempty hashed JS/CSS', async () => {
  const checked = await verifyBuiltAssets({
    dist: '/opt/example/dist',
    read: async () => html,
    fileStat: async () => ({ isFile: () => true, size: 512 }),
  });
  assert.deepEqual(checked.assets, ['/assets/index-456.css', '/assets/index-123.js']);
});

test('pre-deploy verification stops when a bundle is absent', async () => {
  await assert.rejects(verifyBuiltAssets({
    dist: '/opt/example/dist',
    read: async () => html,
    fileStat: async path => {
      if (path.endsWith('.js')) throw new Error('ENOENT');
      return { isFile: () => true, size: 512 };
    },
  }));
});

test('firebase.json never rewrites absent /assets JS to the HTML SPA', async () => {
  const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.equal(config.hosting.public, 'dist');
  assert.deepEqual(config.hosting.rewrites, [
    { source: '/metiers', destination: '/metiers.html' },
    { source: '/departement/**', destination: '/departement-unpublished.html' },
    { source: '!/@(assets|src)/**', destination: '/index.html' },
  ]);
  const policies = config.hosting.headers || [];
  const all = policies.find(item => item.source === '**');
  const assets = policies.find(item => item.source === '/assets/**');
  assert.match(all?.headers?.find(item => item.key === 'Cache-Control')?.value || '', /no-store/);
  assert.match(assets?.headers?.find(item => item.key === 'Cache-Control')?.value || '', /immutable/);
  assert.ok(policies.indexOf(all) < policies.indexOf(assets));
});

test('post-deployment strict audit rejects stale HTML cache and fallback assets', async () => {
  const report = await auditHostingAssets({
    site: 'https://example.test',
    routes: ['/'],
    request: requestWith(),
    strictHostingConfig: true,
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(line => line.includes('HTML encore cache')));
  assert.ok(report.errors.some(line => line.includes('au lieu de 404')));
});

test('post-deployment strict audit accepts no-store HTML and 404 for absent assets', async () => {
  const good = requestWith();
  const request = async url => {
    if (new URL(url).pathname.includes('__apprentifr_missing_module_probe__')) {
      return fakeResponse(404, 'text/html', 'Not found');
    }
    const response = await good(url);
    response.headers.set('Cache-Control', new URL(url).pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-store');
    return response;
  };
  const report = await auditHostingAssets({
    site: 'https://example.test', routes: ['/admin/stats/metiers'],
    request, strictHostingConfig: true,
  });
  assert.equal(report.ok, true);
});
