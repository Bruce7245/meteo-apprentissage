const {
  normalizeOccupationSearchText,
  normalizeRomeCode,
} = require('./occupation-search.cjs');

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function scoreLabelKey(key, label) {
  const normalizedKey = normalizeKey(key);
  const text = cleanText(label);

  if (!text || text.length < 2 || text.length > 180) return -1;
  if (normalizeRomeCode(text)) return -1;
  if (/^https?:\/\//i.test(text)) return -1;

  let score = 0;

  if (normalizedKey.includes('rome')) score += 80;
  if (normalizedKey.includes('fiche')) score += 40;
  if (normalizedKey.includes('libelle')) score += 40;
  if (normalizedKey.includes('intitule')) score += 35;
  if (normalizedKey.includes('label')) score += 30;
  if (normalizedKey.includes('metier')) score += 25;
  if (normalizedKey === 'libelle') score += 10;
  if (normalizedKey === 'intitule') score += 10;

  if (score === 0) return -1;
  if (text.length > 100) score -= 10;

  return score;
}

function findRomeCodes(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return [];

  const codes = new Set();

  for (const [key, value] of Object.entries(object)) {
    if (value === null || value === undefined || typeof value === 'object') continue;

    const normalizedKey = normalizeKey(key);
    const code = normalizeRomeCode(value);

    if (!code) continue;

    if (
      normalizedKey.includes('rome') ||
      normalizedKey === 'code' ||
      normalizedKey.includes('code_metier') ||
      normalizedKey.includes('code_fiche')
    ) {
      codes.add(code);
    }
  }

  return Array.from(codes);
}

function findLabelCandidates(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return [];

  return Object.entries(object)
    .map(([key, value]) => ({
      label: cleanText(value),
      score: scoreLabelKey(key, value),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.label.length !== b.label.length) return a.label.length - b.label.length;
      return a.label.localeCompare(b.label, 'fr');
    });
}

function collectCandidates(node, output, depth = 0) {
  if (!node || depth > 30) return;

  if (Array.isArray(node)) {
    for (const child of node) {
      collectCandidates(child, output, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') return;

  const codes = findRomeCodes(node);
  const labels = findLabelCandidates(node);

  if (codes.length > 0 && labels.length > 0) {
    const bestLabel = labels[0];

    for (const romeCode of codes) {
      output.push({
        romeCode,
        label: bestLabel.label,
        score: bestLabel.score,
      });
    }
  }

  for (const child of Object.values(node)) {
    if (child && typeof child === 'object') {
      collectCandidates(child, output, depth + 1);
    }
  }
}

function extractRomeReferenceEntries(payload, sourceMeta = {}) {
  const candidates = [];
  collectCandidates(payload, candidates);

  const byCode = new Map();

  for (const candidate of candidates) {
    const previous = byCode.get(candidate.romeCode);

    const shouldReplace =
      !previous ||
      candidate.score > previous.score ||
      (
        candidate.score === previous.score &&
        candidate.label.length < previous.label.length
      ) ||
      (
        candidate.score === previous.score &&
        candidate.label.length === previous.label.length &&
        candidate.label.localeCompare(previous.label, 'fr') < 0
      );

    if (shouldReplace) {
      byCode.set(candidate.romeCode, candidate);
    }
  }

  const source = cleanText(sourceMeta.source) || null;
  const sourceVersion = cleanText(sourceMeta.sourceVersion) || null;

  return Array.from(byCode.values())
    .sort((a, b) => a.romeCode.localeCompare(b.romeCode, 'fr'))
    .map((item) => ({
      romeCode: item.romeCode,
      label: item.label,
      normalizedLabel: normalizeOccupationSearchText(item.label),
      source,
      sourceVersion,
    }));
}

function validateRomeReference(entries, options = {}) {
  const minimumEntries = Number.isInteger(options.minimumEntries)
    ? options.minimumEntries
    : 1000;

  const uniqueCodes = new Set();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const code = normalizeRomeCode(entry?.romeCode);
    const label = cleanText(entry?.label);

    if (code && label) {
      uniqueCodes.add(code);
    }
  }

  const count = uniqueCodes.size;
  const ok = count >= minimumEntries;

  return {
    ok,
    count,
    minimumEntries,
    error: ok
      ? null
      : `ROME reference contains ${count} valid entries; minimum is ${minimumEntries}`,
  };
}

module.exports = {
  extractRomeReferenceEntries,
  validateRomeReference,
};
