const YOUTH_AGE_CODES = ['Y15T19', 'Y20T24', 'Y25T29'];
const REQUIRED_AGE_CODES = ['_T', ...YOUTH_AGE_CODES];

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeDepartmentCode(value) {
  const raw = clean(value).toUpperCase();
  if (/^(2A|2B)$/.test(raw)) return raw;
  if (/^97[1-6]$/.test(raw)) return raw;
  if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
  return null;
}

function isDepartmentGeoObject(value) {
  const normalized = clean(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
  return normalized === 'DEP' || normalized.startsWith('DEPARTEMENT');
}

function parseObservationValue(row) {
  const candidate = row?.OBS_VALUE_NIVEAU ?? row?.OBS_VALUE;
  if (candidate === null || candidate === undefined || candidate === '') {
    throw new Error('Invalid population observation: missing value');
  }
  const number = Number(String(candidate).replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid population observation: ${candidate}`);
  }
  return number;
}

function extractRowsFromMelodiPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['observations', 'data', 'results']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  throw new Error('Unsupported INSEE Melodi payload shape');
}

function buildDepartmentPopulation(rows, referenceYear) {
  const year = clean(referenceYear);
  if (!year) throw new Error('Population reference year is required');

  const groups = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isDepartmentGeoObject(row?.GEO_OBJECT)) continue;
    if (clean(row?.SEX).toUpperCase() !== '_T') continue;
    if (clean(row?.TIME_PERIOD) !== year) continue;

    const departmentCode = normalizeDepartmentCode(row?.GEO);
    const age = clean(row?.AGE).toUpperCase();
    if (!departmentCode || !REQUIRED_AGE_CODES.includes(age)) continue;

    const value = parseObservationValue(row);
    let group = groups.get(departmentCode);
    if (!group) {
      group = new Map();
      groups.set(departmentCode, group);
    }

    if (group.has(age)) {
      const previous = group.get(age);
      if (previous !== value) {
        throw new Error(
          `Conflicting population observations for ${departmentCode}/${age}: ${previous} vs ${value}`
        );
      }
    } else {
      group.set(age, value);
    }
  }

  const output = new Map();
  for (const [departmentCode, values] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true }))) {
    const missing = REQUIRED_AGE_CODES.filter((age) => !values.has(age));
    if (missing.length) {
      throw new Error(
        `Incomplete population observations for ${departmentCode}: missing ${missing.join(', ')}`
      );
    }

    output.set(departmentCode, {
      departmentCode,
      populationTotal: values.get('_T'),
      population15To29: YOUTH_AGE_CODES.reduce((sum, age) => sum + values.get(age), 0),
      referenceYear: year,
    });
  }

  if (output.size === 0) {
    throw new Error(`No complete department population observations for ${year}`);
  }

  return output;
}

module.exports = {
  YOUTH_AGE_CODES,
  REQUIRED_AGE_CODES,
  normalizeDepartmentCode,
  extractRowsFromMelodiPayload,
  buildDepartmentPopulation,
};
