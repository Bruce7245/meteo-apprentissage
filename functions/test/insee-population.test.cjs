const test = require('node:test');
const assert = require('node:assert/strict');

let population = {};
try {
  population = require('../lib/insee-population.cjs');
} catch {
  population = {};
}

function row({ geo = '44', object = 'DEP', sex = '_T', age, value, year = '2023' }) {
  return {
    GEO: geo,
    GEO_OBJECT: object,
    SEX: sex,
    AGE: age,
    TIME_PERIOD: year,
    OBS_VALUE: value,
  };
}

test('buildDepartmentPopulation keeps department totals and sums ages 15 to 29', () => {
  assert.equal(typeof population.buildDepartmentPopulation, 'function');

  const result = population.buildDepartmentPopulation([
    row({ age: '_T', value: '1450000' }),
    row({ age: 'Y15T19', value: '90000' }),
    row({ age: 'Y20T24', value: '85000' }),
    row({ age: 'Y25T29', value: '87000' }),
    row({ object: 'COM', geo: '44109', age: '_T', value: '320000' }),
    row({ sex: 'M', age: 'Y15T19', value: '45000' }),
  ], '2023');

  assert.deepEqual(result.get('44'), {
    departmentCode: '44',
    populationTotal: 1450000,
    population15To29: 262000,
    referenceYear: '2023',
  });
  assert.equal(result.size, 1);
});

test('buildDepartmentPopulation preserves Corsica and DROM department codes', () => {
  const rows = [];
  for (const geo of ['2A', '2B', '971', '974']) {
    rows.push(
      row({ geo, age: '_T', value: '1000' }),
      row({ geo, age: 'Y15T19', value: '100' }),
      row({ geo, age: 'Y20T24', value: '90' }),
      row({ geo, age: 'Y25T29', value: '80' })
    );
  }

  const result = population.buildDepartmentPopulation(rows, '2023');

  assert.deepEqual([...result.keys()], ['2A', '2B', '971', '974']);
});

test('buildDepartmentPopulation rejects an invalid numeric observation instead of coercing it to zero', () => {
  assert.throws(
    () => population.buildDepartmentPopulation([
      row({ age: '_T', value: '1000' }),
      row({ age: 'Y15T19', value: 'not-a-number' }),
      row({ age: 'Y20T24', value: '90' }),
      row({ age: 'Y25T29', value: '80' }),
    ], '2023'),
    /invalid population observation/i
  );
});

test('buildDepartmentPopulation rejects incomplete department observations', () => {
  assert.throws(
    () => population.buildDepartmentPopulation([
      row({ age: '_T', value: '1000' }),
      row({ age: 'Y15T19', value: '100' }),
      row({ age: 'Y20T24', value: '90' }),
    ], '2023'),
    /incomplete population observations/i
  );
});

test('buildDepartmentPopulation accepts OBS_VALUE_NIVEAU as a harmonized numeric value field', () => {
  const base = { GEO: '72', GEO_OBJECT: 'DEPARTEMENT', SEX: '_T', TIME_PERIOD: 2023 };
  const result = population.buildDepartmentPopulation([
    { ...base, AGE: '_T', OBS_VALUE_NIVEAU: 600000 },
    { ...base, AGE: 'Y15T19', OBS_VALUE_NIVEAU: 35000 },
    { ...base, AGE: 'Y20T24', OBS_VALUE_NIVEAU: 33000 },
    { ...base, AGE: 'Y25T29', OBS_VALUE_NIVEAU: 32000 },
  ], 2023);

  assert.equal(result.get('72').population15To29, 100000);
});

test('extractRowsFromMelodiPayload accepts common Melodi list envelopes', () => {
  assert.equal(typeof population.extractRowsFromMelodiPayload, 'function');
  const rows = [{ GEO: '44' }];
  assert.deepEqual(population.extractRowsFromMelodiPayload(rows), rows);
  assert.deepEqual(population.extractRowsFromMelodiPayload({ observations: rows }), rows);
  assert.deepEqual(population.extractRowsFromMelodiPayload({ data: rows }), rows);
  assert.deepEqual(population.extractRowsFromMelodiPayload({ results: rows }), rows);
});
