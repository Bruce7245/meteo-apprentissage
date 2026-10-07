const crypto = require('node:crypto');

const RUN_STATES = Object.freeze([
  'building',
  'validating',
  'ready',
  'published',
  'failed',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  __start__: new Set(['building']),
  building: new Set(['validating', 'failed']),
  validating: new Set(['ready', 'failed']),
  ready: new Set(['published', 'failed']),
  published: new Set(),
  failed: new Set(),
});

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }

  return value;
}

function sha256Hex(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function buildSourceFingerprint(sourceVersions = {}) {
  return `sha256:${sha256Hex(sourceVersions)}`;
}

function buildOccupationRunId({
  date,
  calculationVersion,
  configVersion,
  sourceFingerprint,
} = {}) {
  const cleanDate = String(date || '').trim();
  const cleanCalculationVersion = String(calculationVersion || '').trim();
  const cleanConfigVersion = String(configVersion || '').trim();
  const cleanSourceFingerprint = String(sourceFingerprint || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error(`Invalid occupation vigilance date: ${date}`);
  }

  if (!cleanCalculationVersion || !cleanConfigVersion || !cleanSourceFingerprint) {
    throw new Error('Occupation vigilance run versions are required');
  }

  const suffix = sha256Hex({
    date: cleanDate,
    calculationVersion: cleanCalculationVersion,
    configVersion: cleanConfigVersion,
    sourceFingerprint: cleanSourceFingerprint,
  }).slice(0, 16);

  return `occupation_vigilance_${cleanDate}_${suffix}`;
}

function validateRunTransition(from, to) {
  const target = String(to || '').trim();
  if (!RUN_STATES.includes(target)) return false;

  const source = from === null || from === undefined
    ? '__start__'
    : String(from).trim();

  return ALLOWED_TRANSITIONS[source]?.has(target) === true;
}

module.exports = {
  RUN_STATES,
  buildSourceFingerprint,
  buildOccupationRunId,
  validateRunTransition,
};
