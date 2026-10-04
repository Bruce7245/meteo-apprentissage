const {
  normalizeOccupationSearchText,
  normalizeRomeCode,
  sanitizePublicOccupationEntry,
  sanitizePublicTrainingEntry,
} = require('./occupation-search.cjs');

const PUBLIC_SEARCH_LIMIT = 12;
const PUBLIC_SEARCH_MIN_LENGTH = 2;
const PUBLIC_SEARCH_MAX_INPUT_LENGTH = 80;
const INDEX_PREFIX_MAX_LENGTH = 32;

function validatePublicOccupationQuery(value) {
  const input = value === null || value === undefined
    ? ''
    : String(value).trim();

  const normalizedQuery = normalizeOccupationSearchText(input);

  if (
    input.length > PUBLIC_SEARCH_MAX_INPUT_LENGTH ||
    normalizedQuery.length < PUBLIC_SEARCH_MIN_LENGTH
  ) {
    return {
      ok: false,
      status: 400,
      message: 'Search query must contain between 2 and 80 characters',
    };
  }

  return {
    ok: true,
    normalizedQuery,
  };
}

function searchKeysForResult(item) {
  const keys = [
    item.normalizedLabel,
    item.label,
    item.romeCode,
    item.rncp,
    item.publicId,
  ];

  return keys
    .map(normalizeOccupationSearchText)
    .filter(Boolean);
}

function scoreResult(item, normalizedQuery) {
  const keys = searchKeysForResult(item);

  if (keys.some((key) => key === normalizedQuery)) return 0;
  if (keys.some((key) => key.startsWith(normalizedQuery))) return 1;
  if (keys.some((key) => key.includes(normalizedQuery))) return 2;

  return 3;
}

function mergeOccupationSearchResults({
  normalizedQuery = '',
  occupations = [],
  trainings = [],
  limit = PUBLIC_SEARCH_LIMIT,
} = {}) {
  const query = normalizeOccupationSearchText(normalizedQuery);
  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || PUBLIC_SEARCH_LIMIT, 1),
    PUBLIC_SEARCH_LIMIT
  );

  const normalizedOccupations = occupations
    .map(sanitizePublicOccupationEntry)
    .filter(Boolean);

  const normalizedTrainings = trainings
    .map(sanitizePublicTrainingEntry)
    .filter(Boolean);

  return [...normalizedOccupations, ...normalizedTrainings]
    .map((item) => ({
      item,
      score: scoreResult(item, query),
    }))
    .filter(({ score }) => score < 3 || !query)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;

      if (a.item.type !== b.item.type) {
        return a.item.type === 'occupation' ? -1 : 1;
      }

      const labelA = normalizeOccupationSearchText(a.item.label);
      const labelB = normalizeOccupationSearchText(b.item.label);
      const labelDiff = labelA.localeCompare(labelB, 'fr');

      if (labelDiff !== 0) return labelDiff;

      const keyA = a.item.romeCode || a.item.publicId || '';
      const keyB = b.item.romeCode || b.item.publicId || '';
      return String(keyA).localeCompare(String(keyB), 'fr');
    })
    .slice(0, safeLimit)
    .map(({ item }) => item);
}

function buildPublicOccupationLookup(normalizedQuery) {
  const query = normalizeOccupationSearchText(normalizedQuery);

  return {
    normalizedQuery: query,
    prefixKey: query.slice(0, INDEX_PREFIX_MAX_LENGTH),
    exactRomeCode: normalizeRomeCode(query),
  };
}

module.exports = {
  PUBLIC_SEARCH_LIMIT,
  PUBLIC_SEARCH_MIN_LENGTH,
  PUBLIC_SEARCH_MAX_INPUT_LENGTH,
  INDEX_PREFIX_MAX_LENGTH,
  validatePublicOccupationQuery,
  mergeOccupationSearchResults,
  buildPublicOccupationLookup,
};
