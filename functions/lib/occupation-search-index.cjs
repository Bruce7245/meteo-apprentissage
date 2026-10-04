const crypto = require('node:crypto');
const {
  buildSearchPrefixes,
  normalizeOccupationSearchText,
  normalizeRomeCode,
} = require('./occupation-search.cjs');

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeRncp(value) {
  const text = cleanText(value).toUpperCase().replace(/\s+/g, '');
  const match = text.match(/^(?:RNCP)?(\d{2,8})$/);
  return match ? `RNCP${match[1]}` : null;
}

const TRAINING_ACRONYM_STOPWORDS = new Set([
  'a', 'au', 'aux', 'd', 'de', 'des', 'du',
  'en', 'et', 'l', 'la', 'le', 'les', 'pour',
]);

function buildTrainingSearchAliases(label) {
  const text = cleanText(label);
  if (!text) return [];

  const tokens = text.match(/[\p{L}\p{N}]+/gu) || [];
  const significant = tokens.filter((token) => {
    const normalized = normalizeOccupationSearchText(token);
    return normalized && !TRAINING_ACRONYM_STOPWORDS.has(normalized);
  });

  if (significant.length < 2) return [];

  function acronymPart(token) {
    const normalized = normalizeOccupationSearchText(token)
      .replace(/\s+/g, '')
      .toUpperCase();

    const isExistingAcronym =
      token === token.toUpperCase() &&
      normalized.length >= 2 &&
      normalized.length <= 10;

    return isExistingAcronym ? normalized : normalized.slice(0, 1);
  }

  const aliases = new Set();
  const allParts = significant.map(acronymPart);
  const fullAcronym = allParts.join('');

  if (fullAcronym.length >= 2 && fullAcronym.length <= 20) {
    aliases.add(fullAcronym);
  }

  const firstToken = significant[0];
  const firstPart = acronymPart(firstToken);
  const firstIsAcronym =
    firstToken === firstToken.toUpperCase() &&
    firstPart.length >= 2;

  if (firstIsAcronym && significant.length > 1) {
    const restAcronym = allParts.slice(1).join('');

    if (restAcronym.length >= 2 && restAcronym.length <= 16) {
      aliases.add(restAcronym);
      aliases.add(`${firstPart} ${restAcronym}`);
    }
  }

  const normalizedLabel = normalizeOccupationSearchText(text);

  return Array.from(aliases)
    .filter((alias) => normalizeOccupationSearchText(alias) !== normalizedLabel)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

function choosePreferredLabel(current, candidate) {
  const next = cleanText(candidate);
  if (!next) return current || '';

  const previous = cleanText(current);
  if (!previous) return next;

  if (next.length !== previous.length) {
    return next.length < previous.length ? next : previous;
  }

  return next.localeCompare(previous, 'fr') < 0 ? next : previous;
}

function buildOccupationIndexEntry(reference = {}, options = {}) {
  const romeCode = normalizeRomeCode(reference.romeCode);
  const label = cleanText(reference.label);

  if (!romeCode || !label) return null;

  const normalizedLabel =
    normalizeOccupationSearchText(reference.normalizedLabel || label);

  return {
    entryId: `occupation_${romeCode}`,
    type: 'occupation',
    romeCode,
    label,
    normalizedLabel,
    searchPrefixes: buildSearchPrefixes([
      label,
      romeCode,
      ...(Array.isArray(reference.searchTerms) ? reference.searchTerms : []),
    ]),
    source: cleanText(reference.source) || null,
    sourceVersion: cleanText(reference.sourceVersion) || null,
    asOfDate: cleanText(options.asOfDate) || null,
  };
}

function buildTrainingIndexEntries(formations, options = {}) {
  const groups = new Map();

  for (const formation of Array.isArray(formations) ? formations : []) {
    const label = cleanText(
      formation?.intitule ||
      formation?.title ||
      formation?.label
    );
    const normalizedLabel = normalizeOccupationSearchText(label);

    if (!normalizedLabel) continue;

    const rncp = normalizeRncp(formation?.rncp);
    const key = rncp
      ? `rncp:${rncp}`
      : `title:${normalizedLabel}`;

    const validRomeCodes = (Array.isArray(formation?.romeCodes)
      ? formation.romeCodes
      : [])
      .map(normalizeRomeCode)
      .filter(Boolean);

    if (validRomeCodes.length === 0) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        rncp,
        label,
        normalizedLabel,
        romeCodes: new Set(),
      });
    }

    const group = groups.get(key);
    group.label = choosePreferredLabel(group.label, label);
    group.normalizedLabel = normalizeOccupationSearchText(group.label);

    for (const romeCode of validRomeCodes) {
      group.romeCodes.add(romeCode);
    }
  }

  const source = cleanText(options.source) || 'formationDetails';
  const sourceVersion = cleanText(options.sourceVersion) || null;
  const asOfDate = cleanText(options.asOfDate) || null;

  return Array.from(groups.values())
    .map((group) => {
      const romeCodes = Array.from(group.romeCodes)
        .sort((a, b) => a.localeCompare(b, 'fr'));

      const publicId = group.rncp
        ? `rncp_${group.rncp.replace(/^RNCP/, '')}`
        : `title_${crypto
          .createHash('sha256')
          .update(group.normalizedLabel)
          .digest('hex')
          .slice(0, 16)}`;

      const searchAliases = buildTrainingSearchAliases(group.label);

      return {
        entryId: `training_${publicId}`,
        type: 'training',
        publicId,
        rncp: group.rncp,
        label: group.label,
        normalizedLabel: group.normalizedLabel,
        searchPrefixes: buildSearchPrefixes([
          group.label,
          group.rncp,
          ...romeCodes,
          ...searchAliases,
        ].filter(Boolean)),
        romeCodes,
        source,
        sourceVersion,
        asOfDate,
      };
    })
    .sort((a, b) => {
      const labelDiff = a.normalizedLabel.localeCompare(b.normalizedLabel, 'fr');
      return labelDiff || a.entryId.localeCompare(b.entryId, 'fr');
    });
}

module.exports = {
  normalizeRncp,
  buildTrainingSearchAliases,
  buildOccupationIndexEntry,
  buildTrainingIndexEntries,
};
