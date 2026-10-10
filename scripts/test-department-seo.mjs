import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  selectSeoDepartments,
  renderDepartmentHtml,
  renderSitemapXml,
  generateDepartmentSeo,
  escapeHtml,
} from './generate-department-seo.mjs';

const DATE = '2026-10-10';
const NOW = new Date('2026-10-11T10:00:00Z');
const sitemap = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  '<url><loc>https://apprentifr.fr/</loc></url>\n' +
  '<url><loc>https://apprentifr.fr/metiers</loc></url>\n' +
  '</urlset>\n';
const fallback = '<!doctype html><html lang="fr"><head>\n' +
  '<title>Apprentissage par département — ApprentiFR</title>\n' +
  '<meta name="robots" content="noindex,follow" />\n' +
  '<meta name="description" content="Bulletins non publiés" />\n' +
  '</head><body><div id="root"></div>' +
  '<script type="module" src="/assets/index-abc.js"></script></body></html>';

function makeIndex(codes = ['72', '69', '66']) {
  return {
    latestDate: DATE,
    sourceCollection: 'departmentVigilanceDaily',
    publishedCount: codes.length,
    departments: codes.map(code => ({
      departmentCode: code,
      departmentName: code === '72' ? 'Sarthe' : code === '69' ? 'Rhône' : 'Pyrénées-Orientales',
      publishedLevel: code === '72' ? 'yellow' : code === '69' ? 'green' : 'orange',
    })),
  };
}

function makePublished(overrides = {}) {
  return {
    id: DATE + '_72',
    date: DATE,
    departmentCode: '72',
    departmentName: 'Sarthe',
    publishedLevel: 'yellow',
    isPublished: true,
    publicTitle: 'Vigilance jaune apprentissage - Sarthe',
    publicSummary: 'Le marché de l’apprentissage dans le département montre une vigilance modérée sur les offres observées.',
    publicAdvice: 'Élargir la recherche aux communes voisines.',
    reasons: ['La tension du marché reste soutenue dans plusieurs domaines.', 'Les offres disponibles évoluent rapidement.'],
    confidenceScore: 71,
    metrics: { activeOffers: 123 },
    ...overrides,
  };
}

test('Only verified, recent and informative daily vigilance documents are eligible', () => {
  const records = [
    makePublished(),
    makePublished({ id: DATE + '_69', departmentCode: '69', departmentName: 'Rhône', publishedLevel: 'green', isPublished: false }),
    makePublished({ id: DATE + '_66', departmentCode: '66', departmentName: 'Pyrénées-Orientales', publishedLevel: 'orange', confidenceScore: 20 }),
  ];
  const chosen = selectSeoDepartments(makeIndex(), records, NOW);
  assert.deepEqual(chosen.map(item => item.code), ['72']);
  assert.equal(chosen[0].activeOffers, 123);
  assert.equal(chosen[0].confidence, 71);
});

test('No green defaults, fabricated publication or thin/uncertain content', () => {
  const index = makeIndex(['72']);
  for (const document of [
    makePublished({ isPublished: false }),
    makePublished({ date: '2026-10-09' }),
    makePublished({ id: DATE + '_73' }),
    makePublished({ confidenceScore: 39 }),
    makePublished({ metrics: { activeOffers: null } }),
    makePublished({ reasons: [] }),
    makePublished({ publicSummary: 'Trop court.' }),
    makePublished({ departmentName: 'Département 72' }),
    makePublished({ publishedLevel: 'green' }),
  ]) {
    assert.equal(selectSeoDepartments(index, [document], NOW).length, 0, String(document));
  }
  const duplicate = makeIndex(['72', '72']);
  assert.equal(selectSeoDepartments(duplicate, [makePublished()], NOW).length, 0);
  assert.equal(selectSeoDepartments({ ...index, sourceCollection: 'departments' }, [makePublished()], NOW).length, 0);
  assert.equal(selectSeoDepartments(index, [], NOW).length, 0);
});

test('Stale or future publication dates never become SEO pages', () => {
  const index = makeIndex(['72']);
  assert.equal(selectSeoDepartments(index, [makePublished()], new Date('2026-10-26T00:00:00Z')).length, 0);
  assert.equal(selectSeoDepartments(index, [makePublished()], new Date('2026-10-09T00:00:00Z')).length, 0);
});

test('Published HTML has canonical, meaningful content, and escapes untrusted publication text', () => {
  const [page] = selectSeoDepartments(makeIndex(['72']), [
    makePublished({ publicAdvice: 'Éviter <script>alert("x")</script> et demander de l’aide.' }),
  ], NOW);
  const html = renderDepartmentHtml(fallback, page);
  assert.match(html, /<title>Apprentissage en Sarthe \(72\) : vigilance jaune — ApprentiFR<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/apprentifr\.fr\/departement\/72"/);
  assert.match(html, /<h1>Apprentissage en Sarthe \(72\)/);
  assert.match(html, /Bulletin publié le 10 octobre 2026/);
  assert.match(html, /<meta name="robots" content="index,follow"/);
  assert.match(html, /<meta property="og:url" content="https:\/\/apprentifr\.fr\/departement\/72"/);
  assert.doesNotMatch(html, /<meta name="robots" content="noindex,follow"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /<script type="module" src="\/assets\/index-abc\.js"/);
  assert.equal(escapeHtml('<b>"'), '&lt;b&gt;&quot;');
});

test('Sitemap includes only original two pages and explicitly eligible department URLs', () => {
  const data = selectSeoDepartments(makeIndex(['72']), [makePublished()], NOW);
  const xml = renderSitemapXml(sitemap, data);
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1]), [
    'https://apprentifr.fr/',
    'https://apprentifr.fr/metiers',
    'https://apprentifr.fr/departement/72',
  ]);
  assert.match(xml, /<lastmod>2026-10-10<\/lastmod>/);
  assert.doesNotMatch(xml, /\/admin|\/departement\/69|\/departement\/66|\?rome=/);
  assert.throws(() => renderSitemapXml('<urlset/>', data));
});

test('Generator builds static pages, sitemap and manifest; zero-data run indexes none', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apprentifr-seo-'));
  try {
    await mkdir(join(dir, 'departement'), { recursive: true });
    await writeFile(join(dir, 'departement-unpublished.html'), fallback);
    await writeFile(join(dir, 'sitemap.xml'), sitemap);
    const manifest = await generateDepartmentSeo({
      distDir: dir, index: makeIndex(['72']), documents: [makePublished()], now: NOW,
    });
    assert.deepEqual(manifest.publishedPages, ['72']);
    assert.match(await readFile(join(dir, 'departement', '72.html'), 'utf8'), /vigilance jaune/);
    assert.match(await readFile(join(dir, 'sitemap.xml'), 'utf8'), /departement\/72/);

    // Fresh dist build, no published bulletin: not even a green fallback is indexed.
    await writeFile(join(dir, 'sitemap.xml'), sitemap);
    const emptyManifest = await generateDepartmentSeo({
      distDir: dir, index: makeIndex(['72']), documents: [], now: NOW,
    });
    assert.deepEqual(emptyManifest.publishedPages, []);
    assert.doesNotMatch(await readFile(join(dir, 'sitemap.xml'), 'utf8'), /departement\/72/);
    const published = JSON.parse(await readFile(join(dir, 'seo-departments.json'), 'utf8'));
    assert.equal(published.eligibleCount, 0);
    await assert.rejects(readFile(join(dir, 'departement', '72.html'), 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
