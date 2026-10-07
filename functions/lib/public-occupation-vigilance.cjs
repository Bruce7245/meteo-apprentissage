const PUBLIC_LEVELS = new Set([
  'green',
  'yellow',
  'orange',
  'red',
  'insufficient_data',
]);

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).replace(/\s+/g, ' ').trim();
  return result || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizePublicRomeCode(value) {
  const code = cleanText(value)?.toUpperCase() || '';
  return /^[A-Z][0-9]{4}$/.test(code) ? code : null;
}

function normalizePublicLevel(value) {
  const level = cleanText(value);
  return PUBLIC_LEVELS.has(level) ? level : 'insufficient_data';
}

function sanitizeRecentTrend(value = {}) {
  return {
    status: cleanText(value?.status) || 'unknown',
    changeRatio: numberOrNull(value?.changeRatio),
    observations: numberOrNull(value?.observations),
  };
}

function sanitizeSeasonality(value = {}) {
  return {
    status: cleanText(value?.status) || 'unavailable',
    factor: numberOrNull(value?.factor) ?? 1,
    sampleMonths: numberOrNull(value?.sampleMonths) ?? 0,
    completeness: numberOrNull(value?.completeness) ?? 0,
  };
}

function resolvePublishedOccupationRun(pointer, run) {
  const pointerRunId = cleanText(pointer?.runId);

  if (!pointerRunId) {
    return {
      ok: false,
      error: 'NO_PUBLISHED_OCCUPATION_RUN',
    };
  }

  if (!run || run.status !== 'published') {
    return {
      ok: false,
      error: 'OCCUPATION_RUN_NOT_PUBLISHED',
    };
  }

  const runId = cleanText(run.runId);
  if (!runId || runId !== pointerRunId) {
    return {
      ok: false,
      error: 'OCCUPATION_RUN_MISMATCH',
    };
  }

  return {
    ok: true,
    runId,
    date: cleanText(pointer?.date || run?.date),
  };
}

function sanitizePublicMapDepartment(value = {}) {
  const departmentCode = cleanText(value.departmentCode);
  const publishedLevel = normalizePublicLevel(value.publishedLevel);

  if (!departmentCode) return null;

  return {
    departmentCode,
    departmentName: cleanText(value.departmentName) || departmentCode,
    publishedLevel,
    confidenceLevel: cleanText(value.confidenceLevel) || 'low',
    activeOffersCount: numberOrNull(value.activeOffersCount),
    dataAvailable:
      publishedLevel !== 'insufficient_data' &&
      booleanValue(value.dataAvailable, true),
  };
}

function sanitizePublicOccupationMap(payload = {}) {
  const romeCode = normalizePublicRomeCode(payload.romeCode);
  if (!romeCode) return null;

  const departments = (Array.isArray(payload.departments)
    ? payload.departments
    : [])
    .filter((item) => normalizePublicRomeCode(item?.romeCode || romeCode) === romeCode)
    .map(sanitizePublicMapDepartment)
    .filter(Boolean)
    .sort((a, b) =>
      String(a.departmentCode).localeCompare(
        String(b.departmentCode),
        'fr',
        { numeric: true }
      )
    );

  return {
    date: cleanText(payload.date),
    romeCode,
    romeLabel: cleanText(payload.romeLabel) || romeCode,
    departments,
  };
}

function sanitizePublicOccupationDepartment(value = {}) {
  const romeCode = normalizePublicRomeCode(value.romeCode);
  const departmentCode = cleanText(value.departmentCode);

  if (!romeCode || !departmentCode) return null;

  const publishedLevel = normalizePublicLevel(value.publishedLevel);

  return {
    date: cleanText(value.date),
    departmentCode,
    departmentName: cleanText(value.departmentName) || departmentCode,
    romeCode,
    romeLabel: cleanText(value.romeLabel) || romeCode,
    publishedLevel,
    confidenceLevel: cleanText(value.confidenceLevel) || 'low',
    activeOffersCount: numberOrNull(value.activeOffersCount),
    openingsCount: numberOrNull(value.openingsCount),
    distinctObservedEmployersCount: numberOrNull(
      value.distinctObservedEmployersCount
    ),
    distinctObservedNafCount: numberOrNull(value.distinctObservedNafCount),
    employerConcentration: numberOrNull(value.employerConcentration),
    formationsCount: numberOrNull(value.formationsCount),
    upcomingSessionsCount: numberOrNull(value.upcomingSessionsCount),
    distinctRncpCount: numberOrNull(value.distinctRncpCount),
    populationTotal: numberOrNull(value.populationTotal),
    population15To29: numberOrNull(value.population15To29),
    populationReferenceYear: numberOrNull(value.populationReferenceYear),
    recentTrend: sanitizeRecentTrend(value.recentTrend),
    seasonality: sanitizeSeasonality(value.seasonality),
    expectedOffers: numberOrNull(value.expectedOffers),
    observedVsExpectedRatio: numberOrNull(value.observedVsExpectedRatio),
    reasonCodes: Array.isArray(value.reasonCodes)
      ? value.reasonCodes.map(cleanText).filter(Boolean)
      : [],
    dataAvailable:
      publishedLevel !== 'insufficient_data' &&
      booleanValue(value.dataAvailable, true),
  };
}

module.exports = {
  PUBLIC_LEVELS,
  normalizePublicRomeCode,
  resolvePublishedOccupationRun,
  sanitizePublicOccupationMap,
  sanitizePublicOccupationDepartment,
};
