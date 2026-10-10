import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function auditDepartmentSeoHosting({
  site = 'https://meteo-apprentissage.web.app',
  distDir = 'dist',
  request = fetch,
} = {}) {
  const dist = resolve(distDir);
  const manifest = JSON.parse(await readFile(resolve(dist, 'seo-departments.json'), 'utf8'));
  const sitemap = await readFile(resolve(dist, 'sitemap.xml'), 'utf8');
  const get = async path => {
    const response = await request(new URL(path, site), {
      signal: AbortSignal.timeout(30_000),
      headers: { 'Cache-Control': 'no-cache' },
    });
    const html = await response.text();
    if (response.status !== 200 || !/text\/html/i.test(response.headers.get('content-type') || '')) {
      throw new Error('Expected HTML 200 at ' + path + ', got HTTP ' + response.status);
    }
    return html;
  };
  const missing = await get('/departement/00');
  if (!missing.includes('<meta name="robots" content="noindex,follow"')) {
    throw new Error('Unpublished or unknown departments must be noindex');
  }
  if (missing.includes('<link rel="canonical"')) {
    throw new Error('Unpublished fallback must not canonicalize to the home page');
  }
  if (manifest.publishedPages.length > 0) {
    const code = manifest.publishedPages[0];
    const html = await get('/departement/' + code);
    const canonical = 'https://apprentifr.fr/departement/' + code;
    if (!html.includes('<link rel="canonical" href="' + canonical + '"') ||
        !html.includes('<h1>Apprentissage en ') ||
        !html.includes('<meta name="robots" content="index,follow"') ||
        html.includes('<meta name="robots" content="noindex,follow"')) {
      throw new Error('Eligible department is not serving published static HTML: ' + code);
    }
    if (!sitemap.includes('<loc>' + canonical + '</loc>')) {
      throw new Error('The eligible department is missing from sitemap: ' + code);
    }
  }
  console.log('SEO Hosting territorial OK:', manifest.publishedPages.length, 'eligible department(s).');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  auditDepartmentSeoHosting({
    site: process.env.HOSTING_URL || 'https://meteo-apprentissage.web.app',
  }).catch(error => {
    console.error('SEO Hosting territorial invalide:', error.message);
    process.exitCode = 1;
  });
}
