const {
  normalizeOccupationSearchText,
  normalizeRomeCode,
} = require('./occupation-search.cjs');

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeDomainCode(value) {
  const code = cleanText(value).toUpperCase();
  return /^[A-Z][0-9]{2}$/.test(code) ? code : null;
}

function buildOccupationDomainIndex(input = {}) {
  const asOfDate = cleanText(input.asOfDate) || null;
  const domainMeta = input.domainMeta || {};
  const occupationMeta = input.occupationMeta || {};
  const domainEntries = Array.isArray(input.domainEntries)
    ? input.domainEntries
    : [];
  const occupationEntries = Array.isArray(input.occupationEntries)
    ? input.occupationEntries
    : [];

  const domainRunId = cleanText(domainMeta.runId);
  const domainSourceVersion = cleanText(domainMeta.sourceVersion);
  const linkedOccupationRunId = cleanText(domainMeta.occupationRunId);
  const linkedOccupationSourceVersion = cleanText(
    domainMeta.occupationSourceVersion
  );
  const occupationRunId = cleanText(occupationMeta.runId);
  const occupationSourceVersion = cleanText(
    occupationMeta.sourceVersion
  );

  const blockers = [];

  if (
    linkedOccupationRunId !== occupationRunId
  ) {
    blockers.push('DOMAIN_OCCUPATION_RUN_MISMATCH');
  }

  if (
    linkedOccupationSourceVersion !== occupationSourceVersion
  ) {
    blockers.push('DOMAIN_OCCUPATION_SOURCE_VERSION_MISMATCH');
  }

  const occupationByCode = new Map();

  for (const entry of occupationEntries) {
    const romeCode = normalizeRomeCode(entry?.romeCode);
    if (!romeCode) continue;

    if (
      cleanText(entry?.importRunId) !== occupationRunId
    ) {
      blockers.push(
        `OCCUPATION_ENTRY_RUN_MISMATCH:${romeCode}`
      );
      continue;
    }

    const label = cleanText(entry?.label);
    if (!label) {
      blockers.push(
        `OCCUPATION_ENTRY_LABEL_MISSING:${romeCode}`
      );
      continue;
    }

    occupationByCode.set(romeCode, {
      romeCode,
      label,
      normalizedLabel:
        normalizeOccupationSearchText(
          entry?.normalizedLabel || label
        ),
    });
  }

  const projectedDomains = [];

  for (const entry of domainEntries) {
    const domainCode = normalizeDomainCode(entry?.domainCode);
    if (!domainCode) continue;

    if (
      cleanText(entry?.importRunId) !== domainRunId
    ) {
      blockers.push(
        `DOMAIN_ENTRY_RUN_MISMATCH:${domainCode}`
      );
      continue;
    }

    const occupations = [];

    for (const rawRomeCode of Array.isArray(entry?.romeCodes)
      ? entry.romeCodes
      : []) {
      const romeCode = normalizeRomeCode(rawRomeCode);
      if (!romeCode || !romeCode.startsWith(domainCode)) {
        blockers.push(
          `DOMAIN_MEMBER_ROME_INVALID:${domainCode}:${cleanText(rawRomeCode)}`
        );
        continue;
      }

      const occupation = occupationByCode.get(romeCode);
      if (!occupation) {
        blockers.push(
          `DOMAIN_MEMBER_ROME_MISSING:${domainCode}:${romeCode}`
        );
        continue;
      }

      occupations.push({
        romeCode,
        label: occupation.label,
        normalizedLabel: occupation.normalizedLabel,
      });
    }

    occupations.sort((a, b) => {
      const labelDiff =
        a.normalizedLabel.localeCompare(
          b.normalizedLabel,
          'fr'
        );
      return (
        labelDiff ||
        a.romeCode.localeCompare(b.romeCode, 'fr')
      );
    });

    projectedDomains.push({
      domainCode,
      domainLabel: cleanText(entry?.domainLabel),
      majorDomainCode: cleanText(entry?.majorDomainCode),
      majorDomainLabel: cleanText(entry?.majorDomainLabel),
      normalizedLabel:
        normalizeOccupationSearchText(
          entry?.normalizedLabel ||
          entry?.domainLabel
        ),
      occupationsCount: occupations.length,
      occupations: occupations.map(
        ({ romeCode, label }) => ({
          romeCode,
          label,
        })
      ),
    });
  }

  const uniqueBlockers = Array.from(
    new Set(blockers)
  ).sort((a, b) => a.localeCompare(b, 'fr'));

  if (uniqueBlockers.length > 0) {
    return {
      eligible: false,
      blockers: uniqueBlockers,
      asOfDate,
      sourceVersions: {
        domainRunId,
        domainSourceVersion,
        occupationRunId,
        occupationSourceVersion,
      },
      domains: [],
    };
  }

  projectedDomains.sort((a, b) => {
    const majorDiff =
      a.majorDomainCode.localeCompare(
        b.majorDomainCode,
        'fr'
      );
    if (majorDiff) return majorDiff;

    const labelDiff =
      a.normalizedLabel.localeCompare(
        b.normalizedLabel,
        'fr'
      );

    return (
      labelDiff ||
      a.domainCode.localeCompare(
        b.domainCode,
        'fr'
      )
    );
  });

  return {
    eligible: true,
    blockers: [],
    asOfDate,
    sourceVersions: {
      domainRunId,
      domainSourceVersion,
      occupationRunId,
      occupationSourceVersion,
    },
    domains: projectedDomains.map(
      ({
        normalizedLabel,
        ...domain
      }) => domain
    ),
  };
}

function buildOccupationDomainIndexPublication(
  index,
  options = {}
) {
  if (!index?.eligible) {
    throw new Error(
      `PUBLIC_DOMAIN_INDEX_INELIGIBLE:${(
        index?.blockers || []
      ).join('|')}`
    );
  }

  const runId = cleanText(options.runId);
  const sourceFingerprint = cleanText(
    options.sourceFingerprint
  );

  if (!runId) {
    throw new Error('PUBLIC_DOMAIN_INDEX_RUN_ID_REQUIRED');
  }

  if (!sourceFingerprint) {
    throw new Error(
      'PUBLIC_DOMAIN_INDEX_SOURCE_FINGERPRINT_REQUIRED'
    );
  }

  const domains = Array.isArray(index.domains)
    ? index.domains
    : [];
  const sourceVersions = index.sourceVersions || {};
  const asOfDate = cleanText(index.asOfDate) || null;

  const documents = domains.map((domain) => ({
    domainCode: domain.domainCode,
    domainLabel: domain.domainLabel,
    majorDomainCode: domain.majorDomainCode,
    majorDomainLabel: domain.majorDomainLabel,
    occupationsCount: domain.occupationsCount,
    occupations: Array.isArray(domain.occupations)
      ? domain.occupations.map((occupation) => ({
          romeCode: occupation.romeCode,
          label: occupation.label,
        }))
      : [],
    schemaVersion: 'publicOccupationDomainEntry.v1',
  }));

  const common = {
    runId,
    asOfDate,
    domainsCount: documents.length,
    sourceVersions: {
      domainRunId:
        cleanText(sourceVersions.domainRunId) || null,
      domainSourceVersion:
        cleanText(sourceVersions.domainSourceVersion) || null,
      occupationRunId:
        cleanText(sourceVersions.occupationRunId) || null,
      occupationSourceVersion:
        cleanText(sourceVersions.occupationSourceVersion) || null,
    },
    sourceFingerprint,
  };

  return {
    documents,
    run: {
      ...common,
      status: 'building',
      schemaVersion: 'publicOccupationDomainIndex.v1',
    },
    meta: {
      ...common,
      schemaVersion:
        'publicOccupationDomainIndexMeta.v1',
    },
  };
}

module.exports = {
  buildOccupationDomainIndex,
  buildOccupationDomainIndexPublication,
};
