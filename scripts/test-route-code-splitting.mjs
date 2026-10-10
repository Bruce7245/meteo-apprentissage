import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { extractProductionAssets } from './check-hosting-assets.mjs';

const dist = resolve('dist');
const assetDir = join(dist, 'assets');

test('The public homepage does not preload administration and heavy optional pages', async () => {
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const assets = extractProductionAssets(html);
  const mainScript = assets.find(item => item.kind === 'js');
  assert.ok(mainScript, 'Missing production entry JavaScript on homepage');

  const files = await readdir(assetDir);
  for (const component of ['AdminRoutes', 'PublicDepartmentPage', 'PublicOccupationMapPage']) {
    assert.ok(files.some(name => name.startsWith(component + '-') && name.endsWith('.js')),
      'Missing lazily loaded Vite chunk for ' + component);
  }

  const mainJsPath = join(dist, mainScript.path.slice(1));
  const mainJsBytes = (await stat(mainJsPath)).size;
  // Previous Vite build served a monolithic ~1,558,000-byte entry to everyone.
  // This generous regression budget protects the main public route from an
  // accidental reintroduction of admin functionality into the entry bundle.
  assert.ok(mainJsBytes < 1_350_000,
    'Public entry is too heavy: ' + mainJsBytes + ' bytes; split optional routes');

  for (const cssAsset of assets.filter(item => item.kind === 'css')) {
    const css = await readFile(join(dist, cssAsset.path.slice(1)), 'utf8');
    // App.css includes a small shared disabled-control selector mentioning
    // admin-session-bar; the actual admin console layout must remain deferred.
    assert.ok(!css.includes('.admin-console-sidebar'),
      'Administration console stylesheet is still included in the public HTML entrypoint');
  }

  const adminCssFiles = files.filter(name => /^AdminRoutes-.*\.css$/.test(name));
  assert.ok(adminCssFiles.length > 0, 'No CSS asset associated with the deferred administration module');
  const adminCss = await Promise.all(adminCssFiles.map(name => readFile(join(assetDir, name), 'utf8')));
  assert.ok(adminCss.some(css => css.includes('.admin-session-bar')),
    'Essential admin CSS was omitted from the deferred admin route');

  console.log('Public entry JS:', mainJsBytes, 'bytes; deferred chunks:',
    ['AdminRoutes', 'PublicDepartmentPage', 'PublicOccupationMapPage'].join(', '));
});

test('Every public SEO page still references working Vite entrypoint', async () => {
  for (const path of ['index.html', 'metiers.html', 'departement-unpublished.html']) {
    const html = await readFile(join(dist, path), 'utf8');
    const assets = extractProductionAssets(html);
    assert.ok(assets.some(item => item.kind === 'js'));
    for (const asset of assets) {
      const file = join(dist, asset.path.slice(1));
      assert.ok((await stat(file)).size > 0, 'Missing asset for ' + path + ': ' + asset.path);
    }
  }
});

test('CSS for the administration is only imported by the deferred admin group', async () => {
  const [main, routes, admin] = await Promise.all([
    readFile(resolve('src/main.jsx'), 'utf8'),
    readFile(resolve('src/App.jsx'), 'utf8'),
    readFile(resolve('src/AdminRoutes.jsx'), 'utf8'),
  ]);
  assert.ok(!main.includes("import './admin-console.css'"));
  assert.match(routes, /lazy\(\(\) => import\('\.\/AdminRoutes\.jsx'\)\)/);
  assert.match(routes, /if \(path === '\/'\) return <PublicMapPage \/>/);
  for (const name of ['admin-console.css', 'admin-console-mobile.css', 'admin-console-pages.css']) {
    assert.ok(admin.includes("import './" + name + "';"), 'Missing admin CSS: ' + name);
  }
});
