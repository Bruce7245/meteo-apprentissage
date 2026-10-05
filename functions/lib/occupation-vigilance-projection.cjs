const PUBLIC_LEVELS = new Set([
  'green',
  'yellow',
  'orange',
  'red',
  'insufficient_data',
]);

const PRIVATE_KEYS = new Set([
  'runId',
  'configVersion',
  'sourceVersions',
  'siret',
  'uai',
  'raw',
  'address',
  'geopoint',
  'applyPhone',
  'applyRecipientId',
  'secretCredential',
  'factors',
  'confidenceScore',
]);

function text(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).replace(/\s+/g, ' ').trim();
  return result || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function arrayOfText(value) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function normalizeRecentTrend(value = {}) {
  return {
    status: text(value.status) || 'unknown',
    changeRatio: numberOrNull(value.changeRatio),
    observations: numberOrNull(value.observations),
  };
}

function normalizeSeasonality(value = {}) {
  return {
    status: text(value.status) || 'unavailable',
    factor: numberOrNull(value.factor) ?? 1,
    sampleMonths: numberOrNull(value.sampleMonths) ?? 0,
    completeness: numberOrNull(value.completeness) ?? 0,
  };
}

function buildInternalOccupationSnapshot(input = {}) {
  const context = input.context || {};
  const vigilance = input.vigilance || {};
  const history = input.history || {};

  return {
    runId: text(input.runId),
    date: text(input.date),
    departmentCode: text(input.departmentCode),
    departmentName: text(input.departmentName),
    romeCode: text(input.romeCode)?.toUpperCase() || null,
    romeLabel: text(input.romeLabel),

    activeOffersCount: numberOrNull(context.activeOffersCount),
    openingsCount: numberOrNull(context.openingsCount),
    distinctObservedEmployersCount: numberOrNull(context.distinctObservedEmployersCount),
    distinctObservedNafCount: numberOrNull(context.distinctObservedNafCount),
    employerConcentration: numberOrNull(context.employerConcentration),
    formationsCount: numberOrNull(context.formationsCount),
    upcomingSessionsCount: numberOrNull(context.upcomingSessionsCount),
    distinctRncpCount: numberOrNull(context.distinctRncpCount),
    populationTotal: numberOrNull(context.populationTotal),
    population15To29: numberOrNull(context.population15To29),
    populationReferenceYear: numberOrNull(context.populationReferenceYear),

    recentTrend: normalizeRecentTrend(history.recentTrend),
    seasonality: normalizeSeasonality(history.seasonality),

    publishedLevel: text(vigilance.publishedLevel) || 'insufficient_data',
    confidenceLevel: text(vigilance.confidenceLevel) || 'low',
    confidenceScore: numberOrNull(vigilance.confidenceScore),
    expectedOffers: numberOrNull(vigilance.expectedOffers),
    observedVsExpectedRatio: numberOrNull(vigilance.observedVsExpectedRatio),
    reasonCodes: arrayOfText(vigilance.reasonCodes),
    factors: vigilance.factors && typeof vigilance.factors === 'object'
      ? { ...vigilance.factors }
      : null,

    calculationVersion: text(input.calculationVersion || vigilance.calculationVersion),
    configVersion: text(input.configVersion || vigilance.configVersion),
    sourceVersions: input.sourceVersions && typeof input.sourceVersions === 'object'
      ? { ...input.sourceVersions }
      : {},
  };
}

function buildPublicOccupationMapEntry(snapshot = {}) {
  return {
    date: text(snapshot.date),
    departmentCode: text(snapshot.departmentCode),
    departmentName: text(snapshot.departmentName),
    romeCode: text(snapshot.romeCode)?.toUpperCase() || null,
    romeLabel: text(snapshot.romeLabel),
    publishedLevel: text(snapshot.publishedLevel) || 'insufficient_data',
    confidenceLevel: text(snapshot.confidenceLevel) || 'low',
    activeOffersCount: numberOrNull(snapshot.activeOffersCount),
    dataAvailable: snapshot.publishedLevel !== 'insufficient_data',
  };
}

function buildPublicOccupationDepartmentDetail(snapshot = {}) {
  return {
    date: text(snapshot.date),
    departmentCode: text(snapshot.departmentCode),
    departmentName: text(snapshot.departmentName),
    romeCode: text(snapshot.romeCode)?.toUpperCase() || null,
    romeLabel: text(snapshot.romeLabel),
    publishedLevel: text(snapshot.publishedLevel) || 'insufficient_data',
    confidenceLevel: text(snapshot.confidenceLevel) || 'low',
    activeOffersCount: numberOrNull(snapshot.activeOffersCount),
    openingsCount: numberOrNull(snapshot.openingsCount),
    distinctObservedEmployersCount: numberOrNull(snapshot.distinctObservedEmployersCount),
    distinctObservedNafCount: numberOrNull(snapshot.distinctObservedNafCount),
    employerConcentration: numberOrNull(snapshot.employerConcentration),
    formationsCount: numberOrNull(snapshot.formationsCount),
    upcomingSessionsCount: numberOrNull(snapshot.upcomingSessionsCount),
    distinctRncpCount: numberOrNull(snapshot.distinctRncpCount),
    populationTotal: numberOrNull(snapshot.populationTotal),
    population15To29: numberOrNull(snapshot.population15To29),
    populationReferenceYear: numberOrNull(snapshot.populationReferenceYear),
    recentTrend: normalizeRecentTrend(snapshot.recentTrend),
    seasonality: normalizeSeasonality(snapshot.seasonality),
    expectedOffers: numberOrNull(snapshot.expectedOffers),
    observedVsExpectedRatio: numberOrNull(snapshot.observedVsExpectedRatio),
    reasonCodes: arrayOfText(snapshot.reasonCodes),
    dataAvailable: snapshot.publishedLevel !== 'insufficient_data',
  };
}

function collectForbiddenKeys(value, path = '', errors = []) {
  if (!value || typeof value !== 'object') return errors;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (PRIVATE_KEYS.has(key)) errors.push(`private field not allowed: ${childPath}`);
    collectForbiddenKeys(child, childPath, errors);
  }

  return errors;
}

function validatePublicOccupationProjection(value) {
  const errors = [];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['projection must be an object'] };
  }

  collectForbiddenKeys(value, '', errors);

  if (!/^\d{2,3}$|^2[AB]$/.test(String(value.departmentCode || ''))) {
    errors.push('departmentCode is invalid');
  }

  if (!/^[A-Z][0-9]{4}$/.test(String(value.romeCode || ''))) {
    errors.push('romeCode is invalid');
  }

  if (!PUBLIC_LEVELS.has(value.publishedLevel)) {
    errors.push('publishedLevel is invalid');
  }

  for (const key of ['activeOffersCount', 'openingsCount', 'formationsCount']) {
    if (key in value && value[key] !== null) {
      const number = Number(value[key]);
      if (!Number.isFinite(number) || number < 0) errors.push(`${key} must be non-negative`);
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  PUBLIC_LEVELS,
  buildInternalOccupationSnapshot,
  buildPublicOccupationMapEntry,
  buildPublicOccupationDepartmentDetail,
  validatePublicOccupationProjection,
};
