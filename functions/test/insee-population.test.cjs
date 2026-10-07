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


test('buildDepartmentPopulationFromWorksheetRows reads the real INSEE two-row Ensemble header', () => {
  const groupHeader = Array(44).fill(null);
  groupHeader[0] = 'Départements';
  groupHeader[2] = 'Ensemble';
  groupHeader[23] = 'Hommes';

  const ageHeader = Array(44).fill(null);
  [
    '0 à 4 ans',
    '5 à 9 ans',
    '10 à 14 ans',
    '15 à 19 ans',
    '20 à 24 ans',
    '25 à 29 ans',
    '30 à 34 ans',
    '35 à 39 ans',
    '40 à 44 ans',
    '45 à 49 ans',
    '50 à 54 ans',
    '55 à 59 ans',
    '60 à 64 ans',
    '65 à 69 ans',
    '70 à 74 ans',
    '75 à 79 ans',
    '80 à 84 ans',
    '85 à 89 ans',
    '90 à 94 ans',
    '95 ans et plus',
    'Total',
  ].forEach((label, offset) => {
    ageHeader[2 + offset] = label;
  });

  const ain = Array(44).fill(null);
  ain[0] = '01';
  ain[1] = 'Ain';
  ain[5] = 42894;
  ain[6] = 31632;
  ain[7] = 37404;
  ain[22] = 698810;

  const mayotte = Array(44).fill(null);
  mayotte[0] = '976';
  mayotte[1] = 'Mayotte';
  mayotte[5] = 30000;
  mayotte[6] = 31000;
  mayotte[7] = 29000;
  mayotte[22] = 330000;

  const worksheetRows = [
    ['Estimation de population au 1er janvier, par département, sexe et âge quinquennal'],
    ['Année 2026'],
    [],
    groupHeader,
    ageHeader,
    ain,
    mayotte,
  ];

  const result = population.buildDepartmentPopulationFromWorksheetRows(
    worksheetRows,
    2026
  );

  assert.deepEqual(result.get('01'), {
    departmentCode: '01',
    populationTotal: 698810,
    population15To29: 111930,
    referenceYear: 2026,
  });
  assert.deepEqual(result.get('976'), {
    departmentCode: '976',
    populationTotal: 330000,
    population15To29: 90000,
    referenceYear: 2026,
  });
});


test('buildDepartmentPopulationFromWorksheetRows continues past the metropolitan summary to DROM rows', () => {
  const groupHeader = Array(23).fill(null);
  groupHeader[0] = 'Départements';
  groupHeader[2] = 'Ensemble';

  const ageHeader = Array(23).fill(null);
  [
    '0 à 4 ans',
    '5 à 9 ans',
    '10 à 14 ans',
    '15 à 19 ans',
    '20 à 24 ans',
    '25 à 29 ans',
    '30 à 34 ans',
    '35 à 39 ans',
    '40 à 44 ans',
    '45 à 49 ans',
    '50 à 54 ans',
    '55 à 59 ans',
    '60 à 64 ans',
    '65 à 69 ans',
    '70 à 74 ans',
    '75 à 79 ans',
    '80 à 84 ans',
    '85 à 89 ans',
    '90 à 94 ans',
    '95 ans et plus',
    'Total',
  ].forEach((label, offset) => {
    ageHeader[2 + offset] = label;
  });

  const valDOise = Array(23).fill(null);
  valDOise[0] = '95';
  valDOise[1] = "Val-d'Oise";
  valDOise[5] = 50000;
  valDOise[6] = 51000;
  valDOise[7] = 52000;
  valDOise[22] = 1260000;

  const metropolitanSummary = Array(23).fill(null);
  metropolitanSummary[0] = 'France métropolitaine';

  const guadeloupe = Array(23).fill(null);
  guadeloupe[0] = '971';
  guadeloupe[1] = 'Guadeloupe';
  guadeloupe[5] = 22000;
  guadeloupe[6] = 21000;
  guadeloupe[7] = 20000;
  guadeloupe[22] = 375000;

  const mayotte = Array(23).fill(null);
  mayotte[0] = '976';
  mayotte[1] = 'Mayotte';
  mayotte[5] = 30000;
  mayotte[6] = 31000;
  mayotte[7] = 29000;
  mayotte[22] = 330000;

  const result = population.buildDepartmentPopulationFromWorksheetRows(
    [
      groupHeader,
      ageHeader,
      valDOise,
      metropolitanSummary,
      guadeloupe,
      mayotte,
    ],
    2026
  );

  assert.equal(result.has('95'), true);
  assert.equal(result.has('971'), true);
  assert.equal(result.has('976'), true);
  assert.equal(result.get('976').population15To29, 90000);
});
