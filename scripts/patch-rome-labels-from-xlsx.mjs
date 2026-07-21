import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';

const PAGE_PATH = 'src/AdminCompanyContextMapPage.jsx';

// Ressource data.gouv : Les arborescences du ROME - Arborescence principale
const XLSX_URL = 'https://www.data.gouv.fr/api/1/datasets/r/88342be1-06b8-4ab6-8ce9-83e117d21346';

function normalizeRomeCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/[A-Z][0-9]{4}/);
  return match ? match[0] : '';
}

function cleanText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function looksLikeLabel(value) {
  const text = cleanText(value);

  if (!text) return false;
  if (/^[A-Z][0-9]{4}$/.test(text)) return false;
  if (/^[A-Z]$/.test(text)) return false;
  if (/^[A-Z][0-9]{2}$/.test(text)) return false;
  if (/^code/i.test(text)) return false;
  if (/^libell/i.test(text)) return false;
  if (/^intitul/i.test(text)) return false;
  if (text.length < 4) return false;

  return true;
}

async function downloadXlsx() {
  const response = await fetch(XLSX_URL, {
    headers: {
      accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      'user-agent': 'ApprentiFR ROME XLSX extractor',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pendant le telechargement XLSX`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function extractLabelsFromWorkbook(workbook) {
  const labels = {};
  const debugRows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    for (const row of rows) {
      const cells = row.map((cell) => cleanText(cell));
      const codeIndex = cells.findIndex((cell) => normalizeRomeCode(cell));

      if (codeIndex === -1) continue;

      const code = normalizeRomeCode(cells[codeIndex]);

      // Dans l'arborescence, le libellé est généralement juste à droite du code ROME.
      let label = '';

      for (let i = codeIndex + 1; i < Math.min(cells.length, codeIndex + 5); i += 1) {
        if (looksLikeLabel(cells[i])) {
          label = cells[i];
          break;
        }
      }

      // Fallback : parfois le libellé peut être juste avant.
      if (!label) {
        for (let i = codeIndex - 1; i >= Math.max(0, codeIndex - 3); i -= 1) {
          if (looksLikeLabel(cells[i])) {
            label = cells[i];
            break;
          }
        }
      }

      if (code && label) {
        labels[code] = label;

        if (debugRows.length < 12) {
          debugRows.push({ sheetName, code, label, row: cells });
        }
      }
    }
  }

  return {
    labels: Object.fromEntries(
      Object.entries(labels).sort(([a], [b]) => a.localeCompare(b, 'fr'))
    ),
    debugRows,
  };
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

const buffer = await downloadXlsx();
console.log(`Fichier XLSX telecharge : ${buffer.length} octets`);

const workbook = XLSX.read(buffer, { type: 'buffer' });
console.log('Feuilles :', workbook.SheetNames);

const { labels, debugRows } = extractLabelsFromWorkbook(workbook);
const count = Object.keys(labels).length;

console.log(`Codes ROME extraits : ${count}`);

console.log('Exemples extraits :');
for (const row of debugRows) {
  console.log(`${row.code} => ${row.label}`);
}

console.log('Tests :');
for (const code of ['D1401', 'I1623', 'D1108', 'G1204', 'M1607', 'K1303']) {
  console.log(`${code} => ${labels[code] || 'ABSENT'}`);
}

if (count < 1000) {
  throw new Error('Moins de 1000 codes ROME extraits. La structure XLSX a changé ou le parsing est insuffisant.');
}

await patchPage(labels);

console.log('OK : LOCAL_ROME_LABELS remplace par les libelles ROME extraits du XLSX.');
