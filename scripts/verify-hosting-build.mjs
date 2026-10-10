import { readFile, stat } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractProductionAssets } from './check-hosting-assets.mjs';

export async function verifyBuiltAssets({
  dist = 'dist',
  read = readFile,
  fileStat = stat,
} = {}) {
  const root = resolve(dist);
  const index = await read(join(root, 'index.html'), 'utf8');
  const assets = extractProductionAssets(index);
  if (!assets.some(item => item.kind === 'js')) throw new Error('Build absent: aucun module JavaScript dans dist/index.html');
  for (const asset of assets) {
    const path = new URL(asset.path, 'https://localhost/').pathname;
    const resolved = resolve(root, '.' + path);
    if (!resolved.startsWith(root + sep)) throw new Error('Chemin de bundle interdit: ' + path);
    if (!/^\/assets\/[^/]+\.(?:js|mjs|css)$/.test(path)) throw new Error('Chemin Vite incorrect: ' + path);
    const info = await fileStat(resolved);
    if (!info.isFile() || info.size === 0) throw new Error('Bundle manquant ou vide: ' + path);
  }
  return { count: assets.length, assets: assets.map(item => item.path) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  verifyBuiltAssets().then(report => {
    console.log('Build assets OK:', report.assets.join(', '));
  }).catch(error => {
    console.error('Build assets invalides:', error.message);
    process.exitCode = 1;
  });
}
