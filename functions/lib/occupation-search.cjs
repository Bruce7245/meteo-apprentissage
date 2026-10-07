function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeOccupationSearchText(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRomeCode(value) {
  const code = cleanText(value).toUpperCase();
  return /^[A-Z][0-9]{4}$/.test(code) ? code : null;
}

function buildSearchPrefixes(values, options = {}) {
  const minLength = Number.isInteger(options.minLength) ? options.minLength : 2;
  const maxLength = Number.isInteger(options.maxLength) ? options.maxLength : 32;
  const prefixes = new Set();

  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = normalizeOccupationSearchText(value);
    if (!normalized) continue;

    const upperBound = Math.min(normalized.length, Math.max(minLength, maxLength));

    for (let length = Math.max(1, minLength); length <= upperBound; length += 1) {
      prefixes.add(normalized.slice(0, length));
    }
  }

  return Array.from(prefixes).sort((a, b) => a.localeCompare(b, 'fr'));
}

function compactString(value) {
  const text = cleanText(value);
  return text || null;
}

function sanitizePublicOccupationEntry(data = {}) {
  const romeCode = normalizeRomeCode(data.romeCode);
  const label = compactString(data.label);
  if (!romeCode || !label) return null;

  return {
    type: 'occupation',
    romeCode,
    label,
    normalizedLabel:
      normalizeOccupationSearchText(data.normalizedLabel || label),
    source: compactString(data.source),
    sourceVersion: compactString(data.sourceVersion),
  };
}

function sanitizePublicTrainingEntry(data = {}) {
  const label = compactString(data.label);
  const publicId = compactString(data.publicId);
  if (!label || !publicId) return null;

  const romeCodes = Array.from(
    new Set(
      (Array.isArray(data.romeCodes) ? data.romeCodes : [])
        .map(normalizeRomeCode)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'));

  return {
    type: 'training',
    publicId,
    rncp: compactString(data.rncp),
    label,
    normalizedLabel:
      normalizeOccupationSearchText(data.normalizedLabel || label),
    romeCodes,
    source: compactString(data.source),
    sourceVersion: compactString(data.sourceVersion),
  };
}

module.exports = {
  normalizeOccupationSearchText,
  normalizeRomeCode,
  buildSearchPrefixes,
  sanitizePublicOccupationEntry,
  sanitizePublicTrainingEntry,
};
