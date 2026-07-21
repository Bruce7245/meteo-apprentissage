import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';

const PAGE_PATH = 'src/AdminCompanyContextMapPage.jsx';

const SOURCES = [
  {
    name: 'data.gouv JSON ROME',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/1c893376-8476-4262-9a0e-8df519883e1e',
  },
  {
    name: 'France Travail JSON ROME',
    url: 'https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/json',
  },
  {
    name: 'data.gouv CSV ROME',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/8cf674b6-ef21-446a-8190-178e2defd6fc',
  },
  {
    name: 'France Travail CSV ROME',
    url: 'https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/csv',
  },
];

const MANUAL_OVERRIDES = {
  D1108: 'Vente en alimentation',
  D1401: 'Assistanat commercial',
  I1623: 'Conseil clientèle en après-vente de véhicules',
  G1204: 'Éducation en activités sportives',
  M1607: 'Secrétariat',
  K1303: 'Assistance auprès d’enfants',
};

function cleanText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeRomeCode(value) {
  const raw = cleanText(value).toUpperCase();
  const match = raw.match(/\b[A-Z][0-9]{4}\b/);
  return match ? match[0] : '';
}

function isUsefulLabel(value) {
  const text = cleanText(value);

  if (!text) return false;
  if (/^[A-Z][0-9]{4}$/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (text.length < 4) return false;
  if (text.length > 120) return false;

  return true;
}

function chooseDelimiter(line) {
  const candidates = [';', '\t', ','];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: line.split(delimiter).length - 1,
    }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || '';
  const delimiter = chooseDelimiter(firstLine);
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

      if (row.some((cell) => cleanText(cell))) {
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
      object[header || `col_${index}`] = cells[index] ?? '';
    });

    return object;
  });
}

function findCodesInObject(object) {
  const codes = new Set();

  for (const [key, value] of Object.entries(object)) {
    const normalizedKey = normalizeKey(key);
    const text = cleanText(value);
    const code = normalizeRomeCode(text);

    if (!code) continue;

    if (
      normalizedKey.includes('rome') ||
      normalizedKey.includes('metier') ||
      normalizedKey.includes('code') ||
      /^[A-Z][0-9]{4}$/.test(text.toUpperCase())
    ) {
      codes.add(code);
    }
  }

  return Array.from(codes);
}

function scoreLabelKey(key, value) {
  const normalizedKey = normalizeKey(key);
  const text = cleanText(value);

  if (!isUsefulLabel(text)) return -999;

  let score = 0;

  if (normalizedKey.includes('libelle')) score += 40;
  if (normalizedKey.includes('intitule')) score += 40;
  if (normalizedKey.includes('label')) score += 30;
  if (normalizedKey.includes('rome')) score += 80;
  if (normalizedKey.includes('fiche')) score += 60;
  if (normalizedKey.includes('metier')) score += 50;
  if (normalizedKey === 'libelle') score += 20;
  if (normalizedKey === 'intitule') score += 20;

  if (text.includes('/')) score -= 5;
  if (text.length > 60) score -= 5;

  return score;
}

function findLabelCandidates(object) {
  const candidates = [];

  for (const [key, value] of Object.entries(object)) {
    const label = cleanText(value);
    const score = scoreLabelKey(key, label);

    if (score > 0) {
      candidates.push({
        label,
        score,
        key,
      });
    }
  }

  return candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.label.length - b.label.length;
  });
}

function collectFromObject(value, labels, sourceName, depth = 0) {
  if (!value || depth > 30) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFromObject(item, labels, sourceName, depth + 1);
    }

    return;
  }

  if (typeof value !== 'object') return;

  const codes = findCodesInObject(value);
  const labelCandidates = findLabelCandidates(value);

  if (codes.length && labelCandidates.length) {
    for (const code of codes) {
      const best = labelCandidates[0];
      const previous = labels.get(code);

      if (
        !previous ||
        best.score > previous.score ||
        (best.score === previous.score && best.label.length < previous.label.length)
      ) {
        labels.set(code, {
          label: best.label,
          score: best.score,
          source: sourceName,
          key: best.key,
        });
      }
    }
  }

  for (const child of Object.values(value)) {
    collectFromObject(child, labels, sourceName, depth + 1);
  }
}

async function fetchBuffer(source) {
  const response = await fetch(source.url, {
    headers: {
      accept: '*/*',
      'user-agent': 'ApprentiFR ROME open data extractor',
    },
  });

  if (!response.ok) {
    throw new Error(`${source.name} HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function bufferLooksLikeZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function bufferToText(buffer) {
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function collectFromCsvText(text, labels, sourceName) {
  const rows = parseCsv(text);

  for (const row of rows) {
    collectFromObject(row, labels, sourceName);
  }

  return rows.length;
}

function collectFromJsonText(text, labels, sourceName) {
  const json = JSON.parse(text);
  collectFromObject(json, labels, sourceName);
}

async function collectFromSource(source, labels) {
  const buffer = await fetchBuffer(source);

  console.log(`${source.name} : ${buffer.length} octets`);

  if (bufferLooksLikeZip(buffer)) {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    console.log(`${source.name} : zip avec ${entries.length} fichier(s)`);

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName.toLowerCase();

      if (!entryName.endsWith('.json') && !entryName.endsWith('.csv') && !entryName.endsWith('.txt')) {
        continue;
      }

      const entryText = bufferToText(entry.getData());

      try {
        if (entryName.endsWith('.json')) {
          collectFromJsonText(entryText, labels, `${source.name} / ${entry.entryName}`);
          console.log(`  JSON lu : ${entry.entryName}`);
        } else {
          const rows = collectFromCsvText(entryText, labels, `${source.name} / ${entry.entryName}`);
          console.log(`  CSV lu : ${entry.entryName} (${rows} lignes)`);
        }
      } catch (error) {
        console.log(`  Ignore ${entry.entryName} : ${error.message}`);
      }
    }

    return;
  }

  const text = bufferToText(buffer);
  const trimmed = text.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    collectFromJsonText(text, labels, source.name);
    console.log(`${source.name} : JSON lu`);
    return;
  }

  const rows = collectFromCsvText(text, labels, source.name);
  console.log(`${source.name} : CSV lu (${rows} lignes)`);
}

async function patchPage(finalLabels) {
  const page = await fs.readFile(PAGE_PATH, 'utf8');

  const replacement = `const LOCAL_ROME_LABELS = ${JSON.stringify(finalLabels, null, 2)};`;

  const patched = page.replace(
    /const LOCAL_ROME_LABELS = \{[\s\S]*?\n\};/,
    replacement
  );

  if (patched === page) {
    throw new Error('LOCAL_ROME_LABELS introuvable dans AdminCompanyContextMapPage.jsx');
  }

  await fs.writeFile(PAGE_PATH, patched);
}

const labels = new Map();

for (const source of SOURCES) {
  try {
    await collectFromSource(source, labels);
    console.log(`Total provisoire : ${labels.size} codes ROME`);
  } catch (error) {
    console.log(`${source.name} ignore : ${error.message}`);
  }
}

for (const [code, label] of Object.entries(MANUAL_OVERRIDES)) {
  labels.set(code, {
    label,
    score: 999,
    source: 'manual override',
    key: 'manual',
  });
}

const finalLabels = Object.fromEntries(
  Array.from(labels.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([code, item]) => [code, item.label])
);

console.log('===== RESULTAT =====');
console.log(`Codes ROME extraits : ${Object.keys(finalLabels).length}`);

for (const code of ['D1401', 'I1623', 'D1108', 'G1204', 'M1607', 'K1303']) {
  console.log(`${code} => ${finalLabels[code] || 'ABSENT'}`);
}

if (Object.keys(finalLabels).length < 1000) {
  throw new Error('Moins de 1000 codes ROME extraits. Stop : on ne patch pas avec une table incomplète.');
}

await patchPage(finalLabels);

console.log('OK : LOCAL_ROME_LABELS remplace par un vrai dictionnaire ROME.');
