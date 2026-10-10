import test from 'node:test';
import assert from 'node:assert/strict';
import { auditHostingAssets, extractProductionAssets } from './check-hosting-assets.mjs';

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
