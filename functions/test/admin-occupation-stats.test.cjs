const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDepartmentHistory,
  clampHistoryLimit,
  compactStatsRow,
  summarizeHistoryPoint,
} = require('../admin-occupation-stats.cjs');

test('clampHistoryLimit keeps publication history within safe bounds', () => {
  assert.equal(clampHistoryLimit(undefined), 30);
  assert.equal(clampHistoryLimit(2), 7);
  assert.equal(clampHistoryLimit(30), 30);
  assert.equal(clampHistoryLimit(120), 60);
});

test('compactStatsRow preserves only the fields needed by the editorial dashboard', () => {
  const row = compactStatsRow(
    {
      departmentCode: '72',
      departmentName: 'Sarthe',
      romeCode: 'D1108',
      romeLabel: 'Vente en alimentation',
      publishedLevel: 'orange',
      confidenceLevel: 'high',
      activeOffersCount: 18,
      expectedOffers: 24,
      observedVsExpectedRatio: 0.75,
      formationsCount: 8,
      population15To29: 92000,
      secretInternalField: 'must not leak',
    },
    '72_D1108'
  );

  assert.equal(row.id, '72_D1108');
  assert.equal(row.departmentCode, '72');
  assert.equal(row.publishedLevel, 'orange');
  assert.equal(row.activeOffersCount, 18);
  assert.equal(row.expectedOffers, 24);
  assert.equal(row.observedVsExpectedRatio, 0.75);
  assert.equal(row.secretInternalField, undefined);
});

test('summarizeHistoryPoint builds national publication totals for one run', () => {
  const point = summarizeHistoryPoint(
    {
      id: 'run-2026-10-06',
      date: '2026-10-06',
      configVersion: 'config-v1',
      calculationVersion: 'calc-v1',
    },
    [
      {
        publishedLevel: 'red',
        confidenceLevel: 'high',
        activeOffersCount: 10,
        expectedOffers: 20,
      },
      {
        publishedLevel: 'green',
        confidenceLevel: 'medium',
        activeOffersCount: 30,
        expectedOffers: 30,
      },
    ]
  );

  assert.equal(point.date, '2026-10-06');
  assert.equal(point.totalObservedOffers, 40);
  assert.equal(point.totalExpectedOffers, 50);
  assert.equal(point.observedVsExpectedRatio, 0.8);
  assert.equal(point.elevatedDepartments, 1);
  assert.equal(point.levels.red, 1);
  assert.equal(point.levels.green, 1);
});

test('buildDepartmentHistory keeps chronological points grouped by department', () => {
  const history = buildDepartmentHistory([
    {
      run: { date: '2026-10-05' },
      rows: [
        {
          departmentCode: '72',
          publishedLevel: 'yellow',
          confidenceLevel: 'high',
          activeOffersCount: 18,
          expectedOffers: 20,
          observedVsExpectedRatio: 0.9,
        },
      ],
    },
    {
      run: { date: '2026-10-06' },
      rows: [
        {
          departmentCode: '72',
          publishedLevel: 'red',
          confidenceLevel: 'high',
          activeOffersCount: 11,
          expectedOffers: 20,
          observedVsExpectedRatio: 0.55,
        },
        {
          departmentCode: '44',
          publishedLevel: 'green',
          confidenceLevel: 'medium',
          activeOffersCount: 28,
          expectedOffers: 25,
          observedVsExpectedRatio: 1.12,
        },
      ],
    },
  ]);

  assert.equal(history['72'].length, 2);
  assert.equal(history['72'][0].date, '2026-10-05');
  assert.equal(history['72'][1].publishedLevel, 'red');
  assert.equal(history['44'].length, 1);
  assert.equal(history['44'][0].activeOffersCount, 28);
});
