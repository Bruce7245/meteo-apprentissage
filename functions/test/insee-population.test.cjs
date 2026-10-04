const test = require('node:test');
const assert = require('node:assert/strict');

let population = {};
try {
  population = require('../lib/insee-population.cjs');
} catch {
  population = {};
}

test('buildDepartmentPopulation aggregates total and ages 15-29 for department rows only', () => {
  assert.equal(typeof population.buildDepartmentPopulation, 'function');

  const rows = [
    { GEO_OBJECT: 'DEP', GEO: '72', SEX: '_T', AGE: '_T', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '567890' },
    { GEO_OBJECT: 'DEP', GEO: '72', SEX: '_T', AGE: 'Y15T19', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '31000' },
    { GEO_OBJECT: 'DEP', GEO: '72', SEX: '_T', AGE: 'Y20T24', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '33000' },
    { GEO_OBJECT: 'DEP', GEO: '72', SEX: '_T', AGE: 'Y25T29', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '32000' },
    { GEO_OBJECT: 'DEP', GEO: '72', SEX: 'M', AGE: '_T', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '280000' },
    { GEO_OBJECT: 'REG', GEO: '52', SEX: '_T', AGE: '_T', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '4000000' },
  ];

  const result = population.buildDepartmentPopulation(rows, '2026');

  assert.equal(result.size, 1);
  assert.deepEqual(result.get('72'), {
    departmentCode: '72',
    populationTotal: 567890,
    population15To29: 96000,
    referenceYear: 2026,
  });
});

test('buildDepartmentPopulation preserves Corsica and DROM department codes', () => {
  const rows = [];

  for (const [code, total, y15, y20, y25] of [
    ['2A', 160000, 8000, 9000, 8500],
    ['2B', 190000, 9000, 10000, 9500],
    ['971', 380000, 25000, 26000, 24000],
    ['976', 330000, 30000, 31000, 29000],
  ]) {
    rows.push(
      { GEO_OBJECT: 'DEP', GEO: code, SEX: '_T', AGE: '_T', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: total },
      { GEO_OBJECT: 'DEP', GEO: code, SEX: '_T', AGE: 'Y15T19', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: y15 },
      { GEO_OBJECT: 'DEP', GEO: code, SEX: '_T', AGE: 'Y20T24', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: y20 },
      { GEO_OBJECT: 'DEP', GEO: code, SEX: '_T', AGE: 'Y25T29', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: y25 },
    );
  }

  const result = population.buildDepartmentPopulation(rows, 2026);

  assert.deepEqual(Array.from(result.keys()), ['2A', '2B', '971', '976']);
  assert.equal(result.get('976').population15To29, 90000);
});

test('buildDepartmentPopulation ignores other years and non-total sex rows', () => {
  const rows = [
    { GEO_OBJECT: 'DEP', GEO: '01', SEX: '_T', AGE: '_T', TIME_PERIOD: '2025', OBS_VALUE_NIVEAU: '1000' },
    { GEO_OBJECT: 'DEP', GEO: '01', SEX: 'F', AGE: '_T', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '600' },
    { GEO_OBJECT: 'DEP', GEO: '01', SEX: '_T', AGE: '_T', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '1200' },
    { GEO_OBJECT: 'DEP', GEO: '01', SEX: '_T', AGE: 'Y15T19', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '100' },
    { GEO_OBJECT: 'DEP', GEO: '01', SEX: '_T', AGE: 'Y20T24', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '110' },
    { GEO_OBJECT: 'DEP', GEO: '01', SEX: '_T', AGE: 'Y25T29', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '120' },
  ];

  const result = population.buildDepartmentPopulation(rows, 2026);

  assert.equal(result.get('01').populationTotal, 1200);
  assert.equal(result.get('01').population15To29, 330);
});

test('buildDepartmentPopulation rejects invalid numeric observations instead of coercing them to zero', () => {
  assert.throws(
    () => population.buildDepartmentPopulation([
      { GEO_OBJECT: 'DEP', GEO: '75', SEX: '_T', AGE: '_T', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: 'not-a-number' },
      { GEO_OBJECT: 'DEP', GEO: '75', SEX: '_T', AGE: 'Y15T19', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '100' },
      { GEO_OBJECT: 'DEP', GEO: '75', SEX: '_T', AGE: 'Y20T24', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '100' },
      { GEO_OBJECT: 'DEP', GEO: '75', SEX: '_T', AGE: 'Y25T29', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '100' },
    ], 2026),
    /Invalid population value/
  );
});

test('buildDepartmentPopulation rejects incomplete age data for a department', () => {
  assert.throws(
    () => population.buildDepartmentPopulation([
      { GEO_OBJECT: 'DEP', GEO: '33', SEX: '_T', AGE: '_T', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '1700000' },
      { GEO_OBJECT: 'DEP', GEO: '33', SEX: '_T', AGE: 'Y15T19', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '100000' },
      { GEO_OBJECT: 'DEP', GEO: '33', SEX: '_T', AGE: 'Y20T24', TIME_PERIOD: '2026', OBS_VALUE_NIVEAU: '110000' },
    ], 2026),
    /Incomplete population age data for department 33/
  );
});

test('buildDepartmentPopulationFromWorksheetRows reads an INSEE-style quinquennial worksheet block', () => {
  assert.equal(typeof population.buildDepartmentPopulationFromWorksheetRows, 'function');

  const worksheetRows = [
    ['Estimations de population au 1er janvier 2026'],
    ['Ensemble'],
    [],
    ['Code', 'Département', '0 à 4 ans', '5 à 9 ans', '10 à 14 ans', '15 à 19 ans', '20 à 24 ans', '25 à 29 ans', '30 à 34 ans', 'Total'],
    ['01', 'Ain', 50000, 51000, 52000, 53000, 54000, 55000, 56000, 650000],
    ['2A', 'Corse-du-Sud', 10000, 11000, 12000, 13000, 14000, 15000, 16000, 160000],
    ['976', 'Mayotte', 30000, 31000, 32000, 33000, 34000, 35000, 36000, 330000],
    [],
    ['Hommes'],
    ['Code', 'Département', '0 à 4 ans', '5 à 9 ans', '10 à 14 ans', '15 à 19 ans', '20 à 24 ans', '25 à 29 ans', '30 à 34 ans', 'Total'],
    ['01', 'Ain', 25000, 25500, 26000, 26500, 27000, 27500, 28000, 320000],
  ];

  const result = population.buildDepartmentPopulationFromWorksheetRows(
    worksheetRows,
    2026
  );

  assert.deepEqual(result.get('01'), {
    departmentCode: '01',
    populationTotal: 650000,
    population15To29: 162000,
    referenceYear: 2026,
  });
  assert.equal(result.get('2A').population15To29, 42000);
  assert.equal(result.get('976').population15To29, 102000);
});
