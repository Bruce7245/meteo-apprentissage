const {
  validateRomeDomainReference,
} = require('./rome-open-data.cjs');

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function buildRomeDomainPublication(input = {}, options = {}) {
  const domainEntries = Array.isArray(input.domainEntries)
    ? input.domainEntries
    : [];
  const occupationEntries = Array.isArray(input.occupationEntries)
    ? input.occupationEntries
    : [];

  const runId = cleanText(input.runId);
  const sourceVersion = cleanText(input.sourceVersion);
  const occupationRunId = cleanText(input.occupationRunId);
  const occupationSourceVersion = cleanText(
    input.occupationSourceVersion
  );

  if (!runId) {
    throw new Error('DOMAIN_RUN_ID_REQUIRED');
  }

  if (!sourceVersion) {
    throw new Error('DOMAIN_SOURCE_VERSION_REQUIRED');
  }

  if (!occupationRunId || !occupationSourceVersion) {
    throw new Error('DOMAIN_OCCUPATION_REFERENCE_REQUIRED');
  }

  for (const entry of domainEntries) {
    const entrySourceVersion = cleanText(entry?.sourceVersion);
    const entryOccupationSourceVersion = cleanText(
      entry?.occupationSourceVersion
    );

    if (
      entrySourceVersion &&
      entrySourceVersion !== sourceVersion
    ) {
      throw new Error(
        `DOMAIN_SOURCE_VERSION_MISMATCH:${entry?.domainCode || 'unknown'}`
      );
    }

    if (
      entryOccupationSourceVersion &&
      entryOccupationSourceVersion !== occupationSourceVersion
    ) {
      throw new Error(
        `DOMAIN_OCCUPATION_SOURCE_VERSION_MISMATCH:${entry?.domainCode || 'unknown'}`
      );
    }
  }

  const validation = validateRomeDomainReference(
    domainEntries,
    occupationEntries,
    options
  );

  if (!validation.ok) {
    throw new Error(
      `ROME_DOMAIN_REFERENCE_INVALID:${validation.error || 'unknown'}`
    );
  }

  const documents = [...domainEntries]
    .sort((a, b) =>
      String(a?.domainCode || '').localeCompare(
        String(b?.domainCode || ''),
        'fr'
      )
    )
    .map((entry) => ({
      domainCode: cleanText(entry.domainCode),
      domainLabel: cleanText(entry.domainLabel),
      majorDomainCode: cleanText(entry.majorDomainCode),
      majorDomainLabel: cleanText(entry.majorDomainLabel),
      normalizedLabel: cleanText(entry.normalizedLabel),
      romeCodes: Array.isArray(entry.romeCodes)
        ? [...entry.romeCodes]
        : [],
      source: cleanText(entry.source) || null,
      sourceVersion,
      occupationSourceVersion,
      importRunId: runId,
      occupationRunId,
      sourceUrl: cleanText(input.sourceUrl) || null,
      schemaVersion: 'occupationDomainReference.v1',
    }));

  const source =
    cleanText(input.source) ||
    cleanText(documents[0]?.source) ||
    null;
  const sourceName = cleanText(input.sourceName) || null;
  const sourceUrl = cleanText(input.sourceUrl) || null;

  return {
    documents,
    validation,
    run: {
      runId,
      status: 'building',
      source,
      sourceName,
      sourceUrl,
      sourceVersion,
      occupationRunId,
      occupationSourceVersion,
      expectedEntries: documents.length,
      schemaVersion: 'occupationDomainReferenceRun.v1',
    },
    meta: {
      runId,
      source,
      sourceName,
      sourceUrl,
      sourceVersion,
      occupationRunId,
      occupationSourceVersion,
      entriesCount: documents.length,
      schemaVersion: 'occupationDomainReferenceMeta.v1',
    },
  };
}

module.exports = {
  buildRomeDomainPublication,
};
