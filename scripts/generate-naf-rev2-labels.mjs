import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import XLSX from 'xlsx';

const SOURCE_URL = 'https://www.insee.fr/fr/statistiques/fichier/2120875/int_courts_naf_rev_2.xls';
const OUT_FILE = path.resolve('src/data/nafRev2Labels.js');
const TMP_FILE = path.resolve('/tmp/int_courts_naf_rev_2.xls');

function download(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);

    https.get(url, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        file.close();
        fs.unlinkSync(outputPath);
        download(response.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Téléchargement impossible : HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (error) => {
      file.close();
      reject(error);
    });
  });
}

function normalizeNafCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '');
}

function isNafSubClassCode(value) {
  const code = normalizeNafCode(value);
  return /^[0-9]{4}[A-Z]$/.test(code);
}

function cleanLabel(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:;,. ]+/, '')
    .replace(/[-–—:;,. ]+$/, '')
    .trim();
}

function scoreLabel(value) {
  const text = cleanLabel(value);

  if (!text) return -1000;
  if (/^[0-9]{2}(\.[0-9]{2})?[A-Z]?$/.test(text)) return -1000;
  if (/^NAF/i.test(text)) return -5;

  let score = text.length;

  if (text.length >= 8) score += 20;
  if (/[a-zàâçéèêëîïôûùüÿñæœ]/i.test(text)) score += 20;
  if (text.includes('Activités')) score += 8;
  if (text.includes('Commerce')) score += 8;
  if (text.includes('Restauration')) score += 8;

  return score;
}

function extractLabelsFromWorkbook(workbook) {
  const labels = {};

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    for (const row of rows) {
      const cells = row.map((cell) => String(cell || '').trim());
      const codeCell = cells.find((cell) => isNafSubClassCode(cell));

      if (!codeCell) continue;

      const code = normalizeNafCode(codeCell);

      const labelCandidates = cells
        .filter((cell) => normalizeNafCode(cell) !== code)
        .map(cleanLabel)
        .filter(Boolean)
        .sort((a, b) => scoreLabel(b) - scoreLabel(a));

      const label = labelCandidates[0];

      if (!label) continue;

      if (!labels[code] || scoreLabel(label) > scoreLabel(labels[code])) {
        labels[code] = label;
      }
    }
  }

  return labels;
}

function writeModule(labels) {
  const sortedEntries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b, 'fr'));

  const objectLines = sortedEntries.map(([code, label]) => {
    return `  ${JSON.stringify(code)}: ${JSON.stringify(label)},`;
  });

  const content = `// Fichier généré automatiquement depuis le référentiel officiel INSEE NAF rév.2.
// Source : ${SOURCE_URL}
// Ne pas modifier à la main. Relancer : node scripts/generate-naf-rev2-labels.mjs

export const NAF_REV2_LABELS = {
${objectLines.join('\n')}
};

export function normalizeNafRev2Code(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\\./g, '')
    .replace(/\\s+/g, '');
}

export function getNafRev2Label(code, fallback = '') {
  const cleanCode = normalizeNafRev2Code(code);
  const cleanFallback = String(fallback || '').trim();

  return NAF_REV2_LABELS[cleanCode] || cleanFallback || cleanCode || 'NAF non renseigné';
}
`;

  fs.writeFileSync(OUT_FILE, content);
}

console.log('Téléchargement du référentiel NAF rév.2 INSEE...');
await download(SOURCE_URL, TMP_FILE);

console.log('Lecture du fichier XLS...');
const workbook = XLSX.readFile(TMP_FILE);
const labels = extractLabelsFromWorkbook(workbook);

const count = Object.keys(labels).length;

if (count < 700) {
  console.error(`Extraction suspecte : seulement ${count} codes NAF trouvés.`);
  console.error('Le format du fichier INSEE a peut-être changé.');
  process.exit(1);
}

writeModule(labels);

console.log(`OK : ${count} libellés NAF générés dans ${OUT_FILE}`);
console.log('Exemples :');
for (const code of ['5610A', '9312Z', '8551Z', '4711D', '6201Z']) {
  console.log(`${code} = ${labels[code] || 'introuvable'}`);
}
