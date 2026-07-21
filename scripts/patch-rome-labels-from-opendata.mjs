import fs from 'node:fs/promises';

const PAGE_PATH = 'src/AdminCompanyContextMapPage.jsx';
const BASE_URL =
  'https://data.smartidf.services/api/explore/v2.1/catalog/datasets/repertoire-operationnel-des-metiers-et-des-emplois-rome/records';

const PAGE_SIZE = 100;

function normalizeRomeCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/[A-Z][0-9]{4}/);
  return match ? match[0] : '';
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function pickRomeCode(row) {
  const preferredKeys = [
    'code_rome',
    'code_rome_v4',
    'code_rome_v3',
    'rome',
    'code_fiche_rome',
    'code_fiche',
    'code',
  ];

  for (const key of preferredKeys) {
    const code = normalizeRomeCode(row[key]);
    if (code) return code;
  }

  for (const [key, value] of Object.entries(row)) {
    const cleanKey = String(key || '').toLowerCase();
    const code = normalizeRomeCode(value);

    if (code && cleanKey.includes('rome')) return code;
  }

  for (const value of Object.values(row)) {
    const code = normalizeRomeCode(value);
    if (code) return code;
  }

  return '';
}

function pickRomeLabel(row, code) {
  const preferredKeys = [
    'libelle_rome',
    'libelle_fiche_rome',
    'intitule_rome',
    'intitule_fiche_rome',
    'libelle_metier',
    'intitule_metier',
    'metier',
    'libelle',
    'label',
    'intitule',
  ];

  for (const key of preferredKeys) {
    const value = normalizeText(row[key]);

    if (value && value !== code && !/^[A-Z][0-9]{4}$/.test(value)) {
      return value;
    }
  }

  for (const [key, value] of Object.entries(row)) {
    const cleanKey = String(key || '').toLowerCase();
    const cleanValue = normalizeText(value);

    if (
      cleanValue &&
      cleanValue !== code &&
      !/^[A-Z][0-9]{4}$/.test(cleanValue) &&
      (
        cleanKey.includes('libelle') ||
        cleanKey.includes('intitule') ||
        cleanKey.includes('label')
      )
    ) {
      return cleanValue;
    }
  }

  return '';
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'ApprentiFR ROME labels generator',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }

  return response.json();
}

async function fetchAllRows() {
  const rows = [];
  let offset = 0;
  let total = null;

  while (true) {
    const url = `${BASE_URL}?limit=${PAGE_SIZE}&offset=${offset}`;
    const json = await fetchJson(url);
    const results = Array.isArray(json.results) ? json.results : [];

    if (total === null) {
      total = Number(json.total_count || results.length || 0);
      console.log(`Total annonce par API : ${total}`);
    }

    rows.push(...results);

    console.log(`Recus : ${rows.length}/${total || '?'}`);

    if (!results.length) break;
    if (total && rows.length >= total) break;

    offset += PAGE_SIZE;

    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  return rows;
}

function buildLabels(rows) {
  const labels = {};

  for (const row of rows) {
    const code = pickRomeCode(row);

    if (!code) continue;

    const label = pickRomeLabel(row, code);

    if (!label) continue;

    if (!labels[code]) {
      labels[code] = label;
    }
  }

  return Object.fromEntries(
    Object.entries(labels).sort(([a], [b]) => a.localeCompare(b, 'fr'))
  );
}

function objectToJsLiteral(object) {
  return JSON.stringify(object, null, 2);
}

async function patchPage(labels) {
  const page = await fs.readFile(PAGE_PATH, 'utf8');

  const replacement = `const LOCAL_ROME_LABELS = ${objectToJsLiteral(labels)};`;

  const patched = page.replace(
    /const LOCAL_ROME_LABELS = \{[\s\S]*?\n\};/,
    replacement
  );

  if (patched === page) {
    throw new Error('Impossible de remplacer LOCAL_ROME_LABELS dans AdminCompanyContextMapPage.jsx');
  }

  await fs.writeFile(PAGE_PATH, patched);
}

const rows = await fetchAllRows();
const labels = buildLabels(rows);

console.log(`Lignes API exploitees : ${rows.length}`);
console.log(`Codes ROME avec libelle : ${Object.keys(labels).length}`);

console.log('Tests :');
for (const code of ['D1401', 'I1623', 'D1108', 'G1204', 'M1607', 'K1303']) {
  console.log(`${code} => ${labels[code] || 'ABSENT'}`);
}

if (Object.keys(labels).length < 1000) {
  console.log('Champs disponibles sur le premier enregistrement :');
  console.log(Object.keys(rows[0] || {}).sort());
  throw new Error('Moins de 1000 codes ROME trouves. Detection des champs probablement mauvaise.');
}

await patchPage(labels);

console.log('OK : LOCAL_ROME_LABELS remplace par le referentiel ROME complet.');
