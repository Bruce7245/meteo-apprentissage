const PUBLIC_LEVELS = new Set([
  'green',
  'yellow',
  'orange',
  'red',
  'insufficient_data',
]);

const LEVEL_LABELS = Object.freeze({
  green: 'Favorable',
  yellow: 'À surveiller',
  orange: 'Vigilance',
  red: 'Tension forte',
  insufficient_data: 'Données insuffisantes',
});

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

function buildPublicOccupationDomainProjection(input = {}) {
  const level =
    text(input.publishedLevel || input.level) ||
    'insufficient_data';

  return {
    date: text(input.date),
    departmentCode: text(input.departmentCode),
    departmentName: text(input.departmentName),
    domainCode: text(input.domainCode)?.toUpperCase() || null,
    domainLabel: text(input.domainLabel),
    level,
    levelLabel:
      LEVEL_LABELS[level] || LEVEL_LABELS.insufficient_data,
    confidenceLevel:
      text(input.confidenceLevel) || 'low',
    activeOffersCount:
      numberOrNull(input.activeOffersCount),
    openingsCount:
      numberOrNull(input.openingsCount),
    expectedOffers:
      numberOrNull(input.expectedOffers),
    observedVsExpectedRatio:
      numberOrNull(input.observedVsExpectedRatio),
    reasonCodes: Array.isArray(input.reasonCodes)
      ? input.reasonCodes.map(text).filter(Boolean)
      : [],
    dataAvailable:
      level !== 'insufficient_data',
  };
}

function validatePublicOccupationDomainProjection(value) {
  const errors = [];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      errors: ['projection must be an object'],
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.date || ''))) {
    errors.push('date is invalid');
  }

  if (!/^\d{2,3}$|^2[AB]$/.test(String(value.departmentCode || ''))) {
    errors.push('departmentCode is invalid');
  }

  if (!/^[A-Z][0-9]{2}$/.test(String(value.domainCode || ''))) {
    errors.push('domainCode is invalid');
  }

  if (!text(value.domainLabel)) {
    errors.push('domainLabel is required');
  }

  if (!PUBLIC_LEVELS.has(value.level)) {
    errors.push('level is invalid');
  }

  for (const key of [
    'activeOffersCount',
    'openingsCount',
    'expectedOffers',
  ]) {
    if (value[key] !== null && value[key] !== undefined) {
      const number = Number(value[key]);
      if (!Number.isFinite(number) || number < 0) {
        errors.push(`${key} must be non-negative`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  PUBLIC_LEVELS,
  LEVEL_LABELS,
  buildPublicOccupationDomainProjection,
  validatePublicOccupationDomainProjection,
};
