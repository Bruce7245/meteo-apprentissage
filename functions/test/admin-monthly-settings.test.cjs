'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  monthShift, monthDays, calculateMonth, compare,
  checkSeasonality, normalizeDailyDepartment, DEPS,
} = require('../lib/admin-monthly-settings.cjs');
const {
  validMonth, populationMap, employerMap, handler,
} = require('../admin-monthly-settings.cjs');

const months = Array(12).fill('unknown');
const rawSnapshot = (date, code, offers, opts = {}) => ({
  date,
  departmentCode: code,
  activeRunId: 'run_' + date,
  sourceRoute: '/job/v1/search',
  storedOffersCount: offers,
  strictSummary: {
    totalOffers: offers,
    totalOpenings: offers * 2,
    isPossiblySaturated: false,
  },
  ...opts,
});

function monthInput(month, offers, opts = {}) {
  const daily = new Map();
  for (const date of monthDays(month)) {
    daily.set(date, new Map([['72', rawSnapshot(date, '72', offers, opts)]]));
  }
  return daily;
}

function result(month, offers, opts = {}) {
  const population = new Map([['72', 100000]]);
  const employerCount = new Map([['72', 2000]]);
  return calculateMonth(month, monthInput(month, offers, opts),
    population, employerCount, '2027-05-10')
    .find(row => row.departmentCode === '72');
}

test('department scope contains 101 valid codes, including Corsica and DROM', () => {
  assert.equal(DEPS.length, 101);
  assert.equal(new Set(DEPS).size, 101);
  assert.ok(DEPS.includes('2A') && DEPS.includes('976'));
});

test('month arithmetic handles year boundaries and leap days', () => {
  assert.equal(monthShift('2026-01', -1), '2025-12');
  assert.equal(monthShift('2026-03', -12), '2025-03');
  assert.equal(monthDays('2024-02').length, 29);
  assert.equal(monthDays('2025-02').length, 28);
  assert.equal(validMonth('2026-10', '2026-10-10'), true);
  assert.equal(validMonth('2026-11', '2026-10-10'), false);
  assert.equal(validMonth('2026-13', '2026-10-10'), false);
});

test('monthly ratio uses daily active stock average and not sum of daily offers', () => {
  const row = result('2026-04', 100);
  assert.equal(row.daysObserved, 30);
  assert.equal(row.averageOffers, 100);
  assert.equal(row.averageOpenings, 200);
  assert.equal(row.offersPer10000Young, 10);
  assert.equal(row.offersPer100Employers, 5);
  assert.equal(row.quality, 'comparable');
  assert.equal(row.comparisonReady, true);
});

test('MoM and YoY percentages use same-month baseline with zero safely blocked', () => {
  const march = result('2026-03', 40);
  const april = result('2026-04', 30);
  assert.equal(compare(april, march).value, -0.25);
  assert.equal(compare(april, result('2025-04', 60)).value, -0.5);
  assert.equal(compare(april, result('2025-04', 0)), null);
});

test('missing current day makes the month incomplete even if snapshots exist', () => {
  const row = calculateMonth('2026-10', monthInput('2026-10', 20),
    new Map([['72', 100000]]), new Map(), '2026-10-10')
    .find(item => item.departmentCode === '72');
  assert.equal(row.daysObserved, 9);
  assert.equal(row.daysExpected, 31);
  assert.equal(row.quality, 'incomplete');
  assert.equal(row.comparisonReady, false);
  assert.equal(compare(row, result('2026-09', 20)), null);
});

test('missing daily snapshot invalidates the comparison', () => {
  const data = monthInput('2026-04', 50);
  data.delete('2026-04-15');
  const row = calculateMonth('2026-04', data, new Map([['72', 100000]]),
    new Map(), '2027-05-10').find(item => item.departmentCode === '72');
  assert.equal(row.daysObserved, 29);
  assert.equal(row.quality, 'incomplete');
  assert.equal(compare(row, result('2026-03', 50)), null);
});

test('method change across months invalidates percentages', () => {
  const old = result('2026-03', 60);
  const latest = result('2026-04', 30, {qualityMethod: 'export_v2'});
  assert.equal(latest.quality, 'comparable');
  assert.equal(compare(latest, old), null);
  const mixed = monthInput('2026-04', 30);
  mixed.get('2026-04-17').qualityMethod = 'export_v2';
  const row = calculateMonth('2026-04', mixed, new Map([['72', 100000]]),
    new Map(), '2027-05-10').find(item => item.departmentCode === '72');
  assert.equal(row.quality, 'method_change');
});

test('unknown saturation assessment labels change indicative, not certified', () => {
  const weak = result('2026-04', 50, {
    strictSummary: {totalOffers: 50, totalOpenings: 100, isPossiblySaturated: null},
    summary: {isPossiblySaturated: null},
  });
  const old = result('2026-03', 40);
  assert.equal(weak.quality, 'indicative');
  assert.equal(compare(weak, old).quality, 'indicative');
  assert.equal(compare(weak, old).value, 0.25);
});

test('suspected saturation prevents period comparison', () => {
  const capped = result('2026-04', 50, {
    strictSummary: {totalOffers: 50, totalOpenings: 100, isPossiblySaturated: true},
  });
  assert.equal(capped.quality, 'saturated');
  assert.equal(compare(capped, result('2026-03', 50)), null);
});

test('invalid strict summary or impossible strict > stored count is excluded', () => {
  assert.equal(normalizeDailyDepartment(rawSnapshot('2026-04-01', '72', 2,
    {storedOffersCount: 1})), null);
  assert.equal(normalizeDailyDepartment(rawSnapshot('2026-04-01', '72', 2,
    {strictSummary: {totalOffers: -1, totalOpenings: 1}})), null);
});

test('INSEE references require complete official run and matching year', () => {
  const meta = {exists: true, data: () => ({
    runId: 'population_2026', departmentsCount: 101, referenceYear: 2026,
  })};
  const rows = {docs: [
    {id: '72', data: () => ({
      runId: 'population_2026', referenceYear: 2026, population15To29: 12345,
    })},
    {id: '73', data: () => ({
      runId: 'previous', referenceYear: 2026, population15To29: 99999,
    })},
  ]};
  const map = populationMap(meta, rows);
  assert.equal(map.referenceYear, 2026);
  assert.equal(map.populations.get('72'), 12345);
  assert.equal(map.populations.has('73'), false);
});

test('Sirene denominator excludes dry-runs and incomplete imports', () => {
  const imports = {docs: [
    {id: '72', data: () => ({write: true, complete: true, employerOnly: true, activeOnly: false})},
    {id: '73', data: () => ({write: false, complete: true})},
  ]};
  const stats = {docs: [
    {id: '72', data: () => ({employerOnly: true, activeEmployerEstablishmentsCount: 500})},
    {id: '73', data: () => ({employerOnly: true, activeEmployerEstablishmentsCount: 100})},
  ]};
  const naf = {docs: [{id: '72'}, {id: '73'}]};
  const map = employerMap(imports, stats, naf);
  assert.equal(map.get('72'), 500);
  assert.equal(map.has('73'), false);
});

test('seasonality requires 12 known levels and reason; never mutates inputs', () => {
  assert.throws(() => checkSeasonality({months: [], reason: 'A detailed rationale'}));
  assert.throws(() => checkSeasonality({months, reason: 'short'}));
  const parsed = checkSeasonality({months, reason: 'Based on INSEE cycle'});
  parsed.months[0] = 'high';
  assert.equal(months[0], 'unknown');
});

test('HTTP endpoint denies unsupported methods before Firestore access', async () => {
  const response = {
    statusCode: null,
    set() {return this;},
    status(value) {this.statusCode = value; return this;},
    json(value) {this.body = value; return this;},
  };
  await handler({request: {method: 'GET'}, response});
  assert.equal(response.statusCode, 405);
  assert.equal(response.body.ok, false);
});
