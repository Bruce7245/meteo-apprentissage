import fs from 'node:fs/promises';

const PAGE_PATH = 'src/AdminCompanyContextMapPage.jsx';
const DATASET_API =
  'https://www.data.gouv.fr/api/1/datasets/repertoire-operationnel-des-metiers-et-des-emplois-rome/';

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeRomeCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/[A-Z][0-9]{4}/);
  return match ? match[0] : '';
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parseCsv(text) {
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const rows = [];
  let row = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;

      row.push(current);
      current = '';

      if (row.some((cell) => String(cell).trim() !== '')) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeKey);

  return rows.slice(1).map((cells) => {
    const object = {};

    headers.forEach((header, index) => {
      object[header] = cells[index] ?? '';
    });

    return object;
  });
}

function pickCode(row) {
  const codeKeys = [
    'code_rome',
    'code_rome_v4',
    'code',
    'rome',
    'code_fiche_rome',
    'code_fiche',
  ];

  for (const key of codeKeys) {
    const code = normalizeRomeCode(row[key]);
    if (code) return code;
  }

  for (const [key, value] of Object.entries(row)) {
    if (key.includes('rome')) {
      const code = normalizeRomeCode(value);
      if (code) return code;
    }
  }

  return '';
}

function pickLabel(row, code) {
  const labelKeys = [
    'libelle_rome',
    'libelle_code_rome',
    'libelle_fiche_rome',
    'intitule_rome',
    'intitule_fiche_rome',
    'libelle_metier',
    'intitule_metier',
    'libelle',
    'intitule',
    'label',
  ];

  for (const key of labelKeys) {
    const value = cleanText(row[key]);

    if (value && value !== code && !/^[A-Z][0-9]{4}$/.test(value)) {
      return value;
    }
  }

  for (const [key, value] of Object.entries(row)) {
    const cleanValue = cleanText(value);

    if (
      cleanValue &&
      cleanValue !== code &&
      !/^[A-Z][0-9]{4}$/.test(cleanValue) &&
      (key.includes('libelle') || key.includes('intitule') || key.includes('label'))
    ) {
      return cleanValue;
    }
  }

  return '';
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/csv, text/plain, application/octet-stream, */*',
      'user-agent': 'ApprentiFR ROME labels generator',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('utf8');
}

function chooseResource(resources) {
  const candidates = resources.map((resource) => {
    const haystack = [
      resource.title,
      resource.description,
      resource.url,
      resource.latest,
      resource.format,
      resource.mime,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return {
      resource,
      haystack,
    };
  });

  return (
    candidates.find(({ haystack }) =>
      haystack.includes('referentiel_code_rome_v4_utf8')
    )?.resource ||
    candidates.find(({ haystack }) =>
      haystack.includes('referentiel_code_rome_v4') && haystack.includes('csv')
    )?.resource ||
    candidates.find(({ haystack }) =>
      haystack.includes('code_rome') && haystack.includes('utf8') && haystack.includes('csv')
    )?.resource ||
    null
  );
}

function buildLabels(rows) {
  const labels = {};

  for (const row of rows) {
    const code = pickCode(row);
    if (!code) continue;

    const label = pickLabel(row, code);
    if (!label) continue;

    labels[code] = label;
  }

  return Object.fromEntries(
    Object.entries(labels).sort(([a], [b]) => a.localeCompare(b, 'fr'))
  );
}

async function patchPage(labels) {
  const page = await fs.readFile(PAGE_PATH, 'utf8');
  const replacement = `const LOCAL_ROME_LABELS = ${JSON.stringify(labels, null, 2)};`;

  const patched = page.replace(
    /const LOCAL_ROME_LABELS = \{[\s\S]*?\n\};/,
    replacement
  );

  if (patched === page) {
    throw new Error('LOCAL_ROME_LABELS introuvable dans AdminCompanyContextMapPage.jsx');
  }

  await fs.writeFile(PAGE_PATH, patched);
}

const dataset = await fetchJson(DATASET_API);
const resources = Array.isArray(dataset.resources) ? dataset.resources : [];

console.log(`Ressources data.gouv trouvees : ${resources.length}`);

const chosen = chooseResource(resources);

if (!chosen) {
  console.log('Ressources disponibles :');
  for (const resource of resources) {
    console.log('-', {
      title: resource.title,
      format: resource.format,
      url: resource.url,
      latest: resource.latest,
      id: resource.id,
    });
  }

  throw new Error('Ressource referentiel_code_rome_v4_utf8.csv introuvable.');
}

const downloadUrl =
  chosen.latest ||
  chosen.url ||
  `https://www.data.gouv.fr/api/1/datasets/r/${chosen.id}`;

console.log('Ressource choisie :', chosen.title || chosen.url || chosen.id);
console.log('URL :', downloadUrl);

const text = await fetchText(downloadUrl);

if (!text.includes('\n') || !/[A-Z][0-9]{4}/.test(text)) {
  console.log(text.slice(0, 500));
  throw new Error('Le fichier telecharge ne ressemble pas a un CSV ROME.');
}

const rows = parseCsv(text);
const labels = buildLabels(rows);

console.log(`Lignes CSV : ${rows.length}`);
console.log(`Codes ROME avec libelle : ${Object.keys(labels).length}`);

for (const code of ['D1401', 'I1623', 'D1108', 'G1204', 'M1607', 'K1303']) {
  console.log(`${code} => ${labels[code] || 'ABSENT'}`);
}

if (Object.keys(labels).length < 1000) {
  console.log('Colonnes detectees :', Object.keys(rows[0] || {}));
  throw new Error('Moins de 1000 codes ROME trouves. Mauvaise ressource ou mauvais parsing.');
}

await patchPage(labels);

console.log('OK : LOCAL_ROME_LABELS remplace par le referentiel ROME complet.');
