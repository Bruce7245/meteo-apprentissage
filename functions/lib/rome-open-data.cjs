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

function isUsefulSearchTerm(value) {
  const text = cleanText(value);

  if (!text || text.length < 2 || text.length > 160) return false;
  if (normalizeRomeCode(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;

  return true;
}

function collectOfficialSearchTerms(node, canonicalLabel) {
  const terms = new Map();
  const canonicalKey = normalizeOccupationSearchText(canonicalLabel);

  function add(value) {
    if (!isUsefulSearchTerm(value)) return;

    const label = cleanText(value);
    const key = normalizeOccupationSearchText(label);

    if (!key || key === canonicalKey) return;

    const previous = terms.get(key);

    if (
      !previous ||
      label.length < previous.length ||
      (
        label.length === previous.length &&
        label.localeCompare(previous, 'fr') < 0
      )
    ) {
      terms.set(key, label);
    }
  }

  function walk(value, aliasContext = false, depth = 0) {
    if (!value || depth > 12) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, aliasContext, depth + 1);
      }
      return;
    }

    if (typeof value !== 'object') return;

    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);
      const keySignalsAlias =
        normalizedKey.includes('appellation') ||
        normalizedKey === 'emploi' ||
        normalizedKey === 'emplois' ||
        normalizedKey.includes('emploi_metier') ||
        normalizedKey === 'metier' ||
        normalizedKey === 'metiers';

      if (item && typeof item === 'object') {
        walk(item, aliasContext || keySignalsAlias, depth + 1);
        continue;
      }

      const scalarAliasKey =
        normalizedKey.includes('appellation') ||
        normalizedKey === 'emploi' ||
        normalizedKey === 'metier';

      const contextualLabelKey =
        aliasContext &&
        (
          normalizedKey.includes('libelle') ||
          normalizedKey.includes('intitule') ||
          normalizedKey === 'label' ||
          normalizedKey === 'titre' ||
          normalizedKey === 'nom'
        );

      if (scalarAliasKey || contextualLabelKey) {
        add(item);
      }
    }
  }

  walk(node);

  return Array.from(terms.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([, label]) => label);
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
        searchTerms: collectOfficialSearchTerms(node, bestLabel.label),
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
    const mergedSearchTerms = new Map();

    for (const item of [
      ...(previous?.searchTerms || []),
      ...(candidate.searchTerms || []),
    ]) {
      const key = normalizeOccupationSearchText(item);
      if (key) mergedSearchTerms.set(key, cleanText(item));
    }

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

    const selected = shouldReplace
      ? { ...candidate }
      : { ...previous };

    const canonicalKey = normalizeOccupationSearchText(selected.label);

    selected.searchTerms = Array.from(mergedSearchTerms.entries())
      .filter(([key]) => key !== canonicalKey)
      .sort(([a], [b]) => a.localeCompare(b, 'fr'))
      .map(([, label]) => label);

    byCode.set(candidate.romeCode, selected);
  }

  const source = cleanText(sourceMeta.source) || null;
  const sourceVersion = cleanText(sourceMeta.sourceVersion) || null;

  return Array.from(byCode.values())
    .sort((a, b) => a.romeCode.localeCompare(b.romeCode, 'fr'))
    .map((item) => ({
      romeCode: item.romeCode,
      label: item.label,
      normalizedLabel: normalizeOccupationSearchText(item.label),
      searchTerms: Array.isArray(item.searchTerms) ? item.searchTerms : [],
      source,
      sourceVersion,
    }));
}

function normalizeRomeDomainCode(value) {
  const code = cleanText(value).toUpperCase();
  return /^[A-Z][0-9]{2}$/.test(code) ? code : null;
}

function normalizeMajorRomeDomainCode(value) {
  const code = cleanText(value).toUpperCase();
  return /^[A-Z]$/.test(code) ? code : null;
}

function findScalarByKeySignals(object, keySignals, valueNormalizer = cleanText) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null;

  const candidates = [];

  for (const [key, value] of Object.entries(object)) {
    if (value === null || value === undefined || typeof value === 'object') continue;

    const normalizedKey = normalizeKey(key);
    const matches = keySignals.every((signal) =>
      normalizedKey.includes(signal)
    );

    if (!matches) continue;

    const normalizedValue = valueNormalizer(value);
    if (!normalizedValue) continue;

    candidates.push({
      key: normalizedKey,
      value: normalizedValue,
    });
  }

  candidates.sort((a, b) => {
    if (a.key.length !== b.key.length) return a.key.length - b.key.length;
    return a.key.localeCompare(b.key, 'fr');
  });

  return candidates[0]?.value || null;
}

function findDomainRecord(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null;

  const domainCode =
    findScalarByKeySignals(
      object,
      ['domaine', 'professionnel'],
      normalizeRomeDomainCode
    ) ||
    findScalarByKeySignals(
      object,
      ['code', 'domaine'],
      normalizeRomeDomainCode
    );

  if (!domainCode) return null;

  const domainLabel =
    findScalarByKeySignals(object, ['libelle', 'domaine', 'professionnel']) ||
    findScalarByKeySignals(object, ['intitule', 'domaine', 'professionnel']) ||
    findScalarByKeySignals(object, ['label', 'domaine', 'professionnel']);

  if (!domainLabel || normalizeRomeDomainCode(domainLabel)) return null;

  const majorDomainCode =
    findScalarByKeySignals(
      object,
      ['grand', 'domaine'],
      normalizeMajorRomeDomainCode
    ) ||
    domainCode.slice(0, 1);

  const majorDomainLabel =
    findScalarByKeySignals(object, ['libelle', 'grand', 'domaine']) ||
    findScalarByKeySignals(object, ['intitule', 'grand', 'domaine']) ||
    findScalarByKeySignals(object, ['label', 'grand', 'domaine']);

  if (!majorDomainCode || !majorDomainLabel) return null;

  return {
    domainCode,
    domainLabel: cleanText(domainLabel),
    majorDomainCode,
    majorDomainLabel: cleanText(majorDomainLabel),
  };
}

function collectDomainRecords(node, output, depth = 0) {
  if (!node || depth > 30) return;

  if (Array.isArray(node)) {
    for (const child of node) {
      collectDomainRecords(child, output, depth + 1);
    }
    return;
  }

  if (typeof node !== 'object') return;

  const record = findDomainRecord(node);
  if (record) output.push(record);

  for (const child of Object.values(node)) {
    if (child && typeof child === 'object') {
      collectDomainRecords(child, output, depth + 1);
    }
  }
}

function chooseCanonicalText(values) {
  return Array.from(
    new Set(
      values
        .map(cleanText)
        .filter(Boolean)
    )
  ).sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b, 'fr');
  })[0] || null;
}

function extractRomeDomainReferenceEntries(
  payload,
  occupationEntries = [],
  sourceMeta = {}
) {
  const records = [];
  collectDomainRecords(payload, records);

  const grouped = new Map();

  for (const record of records) {
    if (!grouped.has(record.domainCode)) {
      grouped.set(record.domainCode, []);
    }

    grouped.get(record.domainCode).push(record);
  }

  const occupationCodes = Array.from(
    new Set(
      (Array.isArray(occupationEntries) ? occupationEntries : [])
        .map((entry) => normalizeRomeCode(entry?.romeCode))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'));

  const source = cleanText(sourceMeta.source) || null;
  const sourceVersion = cleanText(sourceMeta.sourceVersion) || null;
  const occupationSourceVersion =
    cleanText(sourceMeta.occupationSourceVersion) || null;

  return Array.from(grouped.keys())
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .map((domainCode) => {
      const rows = grouped.get(domainCode) || [];
      const domainLabel = chooseCanonicalText(
        rows.map((row) => row.domainLabel)
      );
      const majorDomainCode =
        normalizeMajorRomeDomainCode(
          chooseCanonicalText(
            rows.map((row) => row.majorDomainCode)
          )
        ) ||
        domainCode.slice(0, 1);
      const majorDomainLabel = chooseCanonicalText(
        rows
          .filter(
            (row) =>
              normalizeMajorRomeDomainCode(row.majorDomainCode) ===
              majorDomainCode
          )
          .map((row) => row.majorDomainLabel)
      );

      if (!domainLabel || !majorDomainCode || !majorDomainLabel) {
        return null;
      }

      return {
        domainCode,
        domainLabel,
        majorDomainCode,
        majorDomainLabel,
        normalizedLabel: normalizeOccupationSearchText(domainLabel),
        romeCodes: occupationCodes.filter((romeCode) =>
          romeCode.startsWith(domainCode)
        ),
        source,
        sourceVersion,
        occupationSourceVersion,
      };
    })
    .filter(Boolean);
}

function validateRomeDomainReference(
  domainEntries,
  occupationEntries,
  options = {}
) {
  const entries = Array.isArray(domainEntries)
    ? domainEntries
    : [];
  const occupations = Array.isArray(occupationEntries)
    ? occupationEntries
    : [];

  const minimumDomains = Number.isInteger(options.minimumDomains)
    ? options.minimumDomains
    : 80;

  const validDomains = new Map();
  const invalidDomainCodes = [];

  for (const entry of entries) {
    const domainCode = normalizeRomeDomainCode(entry?.domainCode);
    const domainLabel = cleanText(entry?.domainLabel);
    const majorDomainCode = normalizeMajorRomeDomainCode(
      entry?.majorDomainCode
    );
    const majorDomainLabel = cleanText(entry?.majorDomainLabel);

    if (
      !domainCode ||
      !domainLabel ||
      !majorDomainCode ||
      !majorDomainLabel ||
      majorDomainCode !== domainCode.slice(0, 1)
    ) {
      if (cleanText(entry?.domainCode)) {
        invalidDomainCodes.push(cleanText(entry.domainCode));
      }
      continue;
    }

    validDomains.set(domainCode, entry);
  }

  const occupationCodes = Array.from(
    new Set(
      occupations
        .map((entry) => normalizeRomeCode(entry?.romeCode))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'));

  const unmappedRomeCodes = occupationCodes.filter(
    (romeCode) => !validDomains.has(romeCode.slice(0, 3))
  );

  const invalidMemberships = [];

  for (const [domainCode, entry] of validDomains.entries()) {
    for (const romeCode of Array.isArray(entry.romeCodes)
      ? entry.romeCodes
      : []) {
      const normalizedRomeCode = normalizeRomeCode(romeCode);

      if (
        !normalizedRomeCode ||
        !normalizedRomeCode.startsWith(domainCode)
      ) {
        invalidMemberships.push({
          domainCode,
          romeCode: cleanText(romeCode),
        });
      }
    }
  }

  const domainsCount = validDomains.size;
  const ok =
    domainsCount >= minimumDomains &&
    unmappedRomeCodes.length === 0 &&
    invalidMemberships.length === 0 &&
    invalidDomainCodes.length === 0;

  return {
    ok,
    domainsCount,
    minimumDomains,
    occupationCodesCount: occupationCodes.length,
    unmappedRomeCodes,
    invalidMemberships,
    invalidDomainCodes: Array.from(
      new Set(invalidDomainCodes)
    ).sort((a, b) => a.localeCompare(b, 'fr')),
    error: ok
      ? null
      : [
          domainsCount < minimumDomains
            ? `ROME domain reference contains ${domainsCount} valid domains; minimum is ${minimumDomains}`
            : null,
          unmappedRomeCodes.length > 0
            ? `${unmappedRomeCodes.length} ROME codes have no official professional domain`
            : null,
          invalidMemberships.length > 0
            ? `${invalidMemberships.length} invalid ROME/domain memberships`
            : null,
          invalidDomainCodes.length > 0
            ? `${invalidDomainCodes.length} invalid domain records`
            : null,
        ]
          .filter(Boolean)
          .join(' | '),
  };
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
  extractRomeDomainReferenceEntries,
  validateRomeReference,
  validateRomeDomainReference,
};
