const crypto = require('node:crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);

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

function buildDomainSourceFingerprint(sourceVersions = {}) {
  return `sha256:${sha256Hex(sourceVersions)}`;
}

function buildOccupationDomainRunId({
  date,
  calculationVersion,
  configVersion,
  sourceFingerprint,
} = {}) {
  const cleanDate = String(date || '').trim();
  const calculation = String(calculationVersion || '').trim();
  const config = String(configVersion || '').trim();
  const fingerprint = String(sourceFingerprint || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error(
      `Invalid occupation domain vigilance date: ${date}`
    );
  }

  if (!calculation || !config || !fingerprint) {
    throw new Error(
      'Occupation domain vigilance run versions are required'
    );
  }

  const suffix = sha256Hex({
    date: cleanDate,
    calculationVersion: calculation,
    configVersion: config,
    sourceFingerprint: fingerprint,
  }).slice(0, 16);

  return `occupation_domain_vigilance_${cleanDate}_${suffix}`;
}

module.exports = {
  buildDomainSourceFingerprint,
  buildOccupationDomainRunId,
};
