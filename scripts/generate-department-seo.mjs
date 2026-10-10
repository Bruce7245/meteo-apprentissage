import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isValidDepartmentCode, normalizeDepartmentCode } from '../src/utils/departmentUtils.js';

const CANONICAL_ORIGIN = 'https://apprentifr.fr';
const ALLOWED_LEVELS = Object.freeze({
  yellow: 'jaune',
  orange: 'orange',
  red: 'rouge',
});
export const MAX_PUBLICATION_AGE_DAYS = 14;
export const MIN_CONFIDENCE_SCORE = 40;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanText(value, maxLength = 500) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function publishedAgeDays(date, now) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (today - Date.parse(date + 'T00:00:00.000Z')) / 86_400_000;
}

/**
 * Never use the departments reference collection or its default-green fallback.
 * An SEO-eligible page requires BOTH an entry in the public publication index and
 * the real daily bulletin, with matching date, level and positive publication flag.
 */
export function selectSeoDepartments(index, dailyDocuments, now = new Date()) {
  if (!index || index.sourceCollection !== 'departmentVigilanceDaily') return [];
  if (!validDate(index.latestDate) || !Array.isArray(index.departments)) return [];
  if (!Array.isArray(dailyDocuments)) return [];
  const age = publishedAgeDays(index.latestDate, now);
  if (age < 0 || age > MAX_PUBLICATION_AGE_DAYS) return [];

  const indexed = new Map();
  for (const item of index.departments) {
    const code = normalizeDepartmentCode(item?.departmentCode || item?.code);
    if (!isValidDepartmentCode(code) || !ALLOWED_LEVELS[item?.publishedLevel]) continue;
    if (indexed.has(code)) {
      // Duplicate code in the index is ambiguous: do not index either entry.
      indexed.set(code, null);
    } else {
      indexed.set(code, item);
    }
  }

  const eligible = [];
  const seen = new Set();
  for (const raw of dailyDocuments) {
    const code = normalizeDepartmentCode(raw?.departmentCode);
    const item = indexed.get(code);
    if (!item || seen.has(code) || !isValidDepartmentCode(code)) continue;
    if (raw.id !== index.latestDate + '_' + code) continue;
    if (raw.date !== index.latestDate || raw.isPublished !== true) continue;
    if (!ALLOWED_LEVELS[raw.publishedLevel] || raw.publishedLevel !== item.publishedLevel) continue;
    if (item.departmentName && raw.departmentName !== item.departmentName) continue;
    const name = cleanText(raw.departmentName, 100);
    const title = cleanText(raw.publicTitle, 220);
    const summary = cleanText(raw.publicSummary, 1_000);
    const advice = cleanText(raw.publicAdvice, 500);
    const confidence = Number(raw.confidenceScore);
    const activeOffers = Number(raw.metrics?.activeOffers);
    const reasons = Array.isArray(raw.reasons)
      ? raw.reasons.map(reason => cleanText(reason, 260)).filter(Boolean)
      : [];

    // Real, non-green publication is necessary but not sufficient for SEO:
    // exclude thin/low-confidence pages while keeping them accessible in the app.
    if (!name || name === 'Département ' + code || title.length < 15) continue;
    if (summary.length < 45 || reasons.length === 0) continue;
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE_SCORE) continue;
    if (raw.metrics?.activeOffers == null || !Number.isFinite(activeOffers) || activeOffers < 0) continue;

    eligible.push({
      code,
      name,
      date: index.latestDate,
      level: raw.publishedLevel,
      title,
      summary,
      advice,
      reasons: reasons.slice(0, 5),
      confidence,
      activeOffers,
    });
    seen.add(code);
  }

  return eligible.sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
}

function formatPublicDate(iso) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(iso + 'T12:00:00.000Z'));
}

export function renderDepartmentHtml(fallbackHtml, item) {
  if (!isValidDepartmentCode(item?.code) || !ALLOWED_LEVELS[item.level] || !validDate(item.date)) {
    throw new Error('Invalid department SEO page data');
  }
  const url = CANONICAL_ORIGIN + '/departement/' + item.code;
  const dateText = formatPublicDate(item.date);
  const heading = 'Apprentissage en ' + item.name + ' (' + item.code + ') : vigilance ' + ALLOWED_LEVELS[item.level];
  const description = item.name + ' : vigilance ' + ALLOWED_LEVELS[item.level] +
    ' publiée le ' + dateText + '. Consultez le bulletin et les indicateurs territoriaux sur ApprentiFR.';
  const htmlTitle = heading + ' — ApprentiFR';
  const extraHead = [
    '<link rel="canonical" href="' + escapeHtml(url) + '" />',
    '<meta property="og:url" content="' + escapeHtml(url) + '" />',
    '<meta property="og:title" content="' + escapeHtml(htmlTitle) + '" />',
    '<meta property="og:description" content="' + escapeHtml(description) + '" />',
    '<meta name="twitter:card" content="summary" />',
    '<meta name="twitter:title" content="' + escapeHtml(htmlTitle) + '" />',
    '<meta name="twitter:description" content="' + escapeHtml(description) + '" />',
  ].join('\n    ');
  const paragraphs = [
    '<div class="site-shell public-shell">',
    '<main class="site-main public-main">',
    '<section class="panel">',
    '<p class="eyebrow">Observatoire territorial de l’apprentissage</p>',
    '<h1>' + escapeHtml(heading) + '</h1>',
    '<p>Bulletin publié le ' + escapeHtml(dateText) + '. Cet indicateur décrit une situation observée, pas une garantie d’obtenir un contrat.</p>',
    '<h2>' + escapeHtml(item.title) + '</h2>',
    '<p>' + escapeHtml(item.summary) + '</p>',
    item.advice ? '<p><strong>Conseil de recherche :</strong> ' + escapeHtml(item.advice) + '</p>' : '',
    '<dl><dt>Offres actives observées</dt><dd>' + escapeHtml(item.activeOffers.toLocaleString('fr-FR')) + '</dd>' +
    '<dt>Indice de confiance</dt><dd>' + escapeHtml(item.confidence.toLocaleString('fr-FR')) + '</dd></dl>',
    '<h2>Éléments observés</h2><ul>',
    ...item.reasons.map(reason => '<li>' + escapeHtml(reason) + '</li>'),
    '</ul>',
    '<p>Les indicateurs ApprentiFR ne constituent pas une information officielle de l’État.</p>',
    '<nav><a href="/">Carte nationale</a> · <a href="/metiers">Métiers et formations</a></nav>',
    '</section></main></div>',
  ].join('\n');
  const replacements = [
    [/<title>[^<]*<\/title>/, '<title>' + escapeHtml(htmlTitle) + '</title>'],
    [/<meta name="robots" content="noindex,follow" \/>/, '<meta name="robots" content="index,follow" />'],
    [/<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="' + escapeHtml(description) + '" />'],
    [/<div id="root"><\/div>/, '<div id="root">' + paragraphs + '</div>'],
    [/<\/head>/, '    ' + extraHead + '\n  </head>'],
  ];
  let page = fallbackHtml;
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(page)) throw new Error('Missing expected HTML template marker: ' + pattern);
    page = page.replace(pattern, () => replacement);
  }
  return page;
}

export function renderSitemapXml(baselineXml, departments) {
  if (!baselineXml.includes('</urlset>')) throw new Error('Missing </urlset> in sitemap.xml');
  const baseline = [...baselineXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  if (baseline.length !== 2 ||
      baseline[0] !== CANONICAL_ORIGIN + '/' ||
      baseline[1] !== CANONICAL_ORIGIN + '/metiers') {
    throw new Error('Unexpected baseline sitemap: refusing to publish duplicate or untrusted URLs');
  }
  const entries = departments.map(item =>
    '  <url><loc>' + CANONICAL_ORIGIN + '/departement/' + item.code +
    '</loc><lastmod>' + item.date + '</lastmod></url>'
  ).join('\n');
  return baselineXml.replace('</urlset>', (entries ? entries + '\n' : '') + '</urlset>');
}

export async function generateDepartmentSeo({ distDir = 'dist', index, documents, now = new Date() }) {
  const dist = resolve(distDir);
  const [fallbackHtml, baselineSitemap] = await Promise.all([
    readFile(join(dist, 'departement-unpublished.html'), 'utf8'),
    readFile(join(dist, 'sitemap.xml'), 'utf8'),
  ]);
  if (!fallbackHtml.includes('<meta name="robots" content="noindex,follow" />')) {
    throw new Error('Missing default noindex on unpublished department HTML');
  }
  const pages = selectSeoDepartments(index, documents, now);
  const outputDir = join(dist, 'departement');
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const page of pages) {
    await writeFile(join(outputDir, page.code + '.html'), renderDepartmentHtml(fallbackHtml, page), 'utf8');
  }
  await writeFile(join(dist, 'sitemap.xml'), renderSitemapXml(baselineSitemap, pages), 'utf8');
  const manifest = {
    schemaVersion: 'seo-departments.v1',
    date: validDate(index?.latestDate) ? index.latestDate : null,
    publishedPages: pages.map(page => page.code),
    eligibleCount: pages.length,
    generatedAt: now.toISOString(),
  };
  await writeFile(join(dist, 'seo-departments.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

export async function loadPublicVigilanceDocuments() {
  // Uses existing PUBLIC Firestore read rules; no deployment service account
  // privileges or admin credentials are needed to inspect published bulletins.
  const [{ initializeApp, deleteApp }, { getFirestore, doc, getDoc, collection, getDocs, query, where, terminate }] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
  ]);
  const app = initializeApp({
    projectId: 'meteo-apprentissage',
    apiKey: 'AIzaSyATDU6HDbc6kIc3VVBaEU1hit2uBS7Ybr8',
    appId: '1:506565850175:web:6865dd67e50c16c2e7b48a',
  }, 'apprentifr-seo-generator');
  const db = getFirestore(app);
  try {
    const latest = await getDoc(doc(db, 'vigilancePublicIndex', 'latest'));
    if (!latest.exists()) throw new Error('Public vigilance index does not exist');
    const index = latest.data();
    if (!validDate(index.latestDate) || index.sourceCollection !== 'departmentVigilanceDaily') {
      throw new Error('Public vigilance index is incomplete or not a publication');
    }
    const snapshots = await getDocs(query(
      collection(db, 'departmentVigilanceDaily'),
      where('date', '==', index.latestDate),
    ));
    return {
      index,
      documents: snapshots.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id })),
    };
  } finally {
    await terminate(db);
    await deleteApp(app);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== '--live') {
    console.error('Usage: node scripts/generate-department-seo.mjs --live');
    process.exitCode = 2;
  } else {
    loadPublicVigilanceDocuments()
      .then(({ index, documents }) => generateDepartmentSeo({ index, documents }))
      .then(result => {
        console.log('SEO territorial:', result.eligibleCount, 'publication(s) eligibles, date', result.date);
        console.log('Departements indexables:', result.publishedPages.join(', ') || 'aucun');
      })
      .catch(error => {
        console.error('SEO territorial refuse: aucune publication si les sources sont indisponibles.', error.message);
        process.exitCode = 1;
      });
  }
}
