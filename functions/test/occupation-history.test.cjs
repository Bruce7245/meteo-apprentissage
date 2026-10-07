const test = require('node:test');
const assert = require('node:assert/strict');

let history = {};
try {
  history = require('../lib/occupation-history.cjs');
} catch {
  history = {};
}

test('computeRecentOfferTrend returns unknown with fewer than two usable observations', () => {
  assert.equal(typeof history.computeRecentOfferTrend, 'function');

  assert.deepEqual(
    history.computeRecentOfferTrend([
      { date: '2026-10-04', activeOffersCount: 12 },
    ]),
    {
      status: 'unknown',
      changeRatio: null,
      observations: 1,
    }
  );
});

test('computeRecentOfferTrend detects improving, degrading and stable offer volumes', () => {
  assert.deepEqual(
    history.computeRecentOfferTrend([
      { date: '2026-10-01', activeOffersCount: 100 },
      { date: '2026-10-04', activeOffersCount: 120 },
    ]),
    {
      status: 'improving',
      changeRatio: 0.2,
      observations: 2,
    }
  );

  assert.deepEqual(
    history.computeRecentOfferTrend([
      { date: '2026-10-01', activeOffersCount: 100 },
      { date: '2026-10-04', activeOffersCount: 80 },
    ]),
    {
      status: 'degrading',
      changeRatio: -0.2,
      observations: 2,
    }
  );

  assert.deepEqual(
    history.computeRecentOfferTrend([
      { date: '2026-10-01', activeOffersCount: 100 },
      { date: '2026-10-04', activeOffersCount: 105 },
    ]),
    {
      status: 'stable',
      changeRatio: 0.05,
      observations: 2,
    }
  );
});

test('computeSeasonalityProfile keeps factor neutral with fewer than 12 months', () => {
  assert.equal(typeof history.computeSeasonalityProfile, 'function');

  const monthlyHistory = Array.from({ length: 10 }, (_, index) => ({
    month: `2025-${String(index + 1).padStart(2, '0')}`,
    offersCount: 100 + index,
  }));

  assert.deepEqual(
    history.computeSeasonalityProfile(monthlyHistory, {
      asOfMonth: '2026-01',
      completenessThreshold: 0.9,
    }),
    {
      status: 'unavailable',
      factor: 1,
      sampleMonths: 10,
      completeness: 1,
    }
  );
});

test('computeSeasonalityProfile is descriptive but neutral with 12 to 23 complete months', () => {
  const monthlyHistory = [];
  for (let index = 0; index < 18; index += 1) {
    const date = new Date(Date.UTC(2024, index, 1));
    monthlyHistory.push({
      month: date.toISOString().slice(0, 7),
      offersCount: 100,
    });
  }

  const result = history.computeSeasonalityProfile(monthlyHistory, {
    asOfMonth: '2025-07',
    completenessThreshold: 0.9,
  });

  assert.equal(result.status, 'descriptive');
  assert.equal(result.factor, 1);
  assert.equal(result.sampleMonths, 18);
  assert.equal(result.completeness, 1);
});

test('computeSeasonalityProfile activates after 24 complete months and clamps the factor', () => {
  const monthlyHistory = [];

  for (let index = 0; index < 24; index += 1) {
    const date = new Date(Date.UTC(2024, index, 1));
    const monthNumber = date.getUTCMonth() + 1;

    monthlyHistory.push({
      month: date.toISOString().slice(0, 7),
      offersCount: monthNumber === 1 ? 250 : 100,
    });
  }

  const result = history.computeSeasonalityProfile(monthlyHistory, {
    asOfMonth: '2026-01',
    minActiveMonths: 24,
    completenessThreshold: 0.95,
    minFactor: 0.8,
    maxFactor: 1.25,
  });

  assert.equal(result.status, 'active');
  assert.equal(result.factor, 1.25);
  assert.equal(result.sampleMonths, 24);
  assert.equal(result.completeness, 1);
});

test('computeSeasonalityProfile treats missing months as missing coverage, never zero offers', () => {
  const monthlyHistory = [];
  const missing = new Set(['2024-06', '2025-02', '2025-11']);

  for (let index = 0; index < 27; index += 1) {
    const date = new Date(Date.UTC(2024, index, 1));
    const month = date.toISOString().slice(0, 7);

    if (!missing.has(month)) {
      monthlyHistory.push({
        month,
        offersCount: 100,
      });
    }
  }

  const result = history.computeSeasonalityProfile(monthlyHistory, {
    asOfMonth: '2026-04',
    minActiveMonths: 24,
    completenessThreshold: 0.95,
  });

  assert.equal(result.sampleMonths, 24);
  assert.equal(result.completeness, 24 / 27);
  assert.equal(result.status, 'descriptive');
  assert.equal(result.factor, 1);
});

test('computeSeasonalityProfile rejects invalid negative monthly values', () => {
  assert.throws(
    () => history.computeSeasonalityProfile([
      { month: '2025-01', offersCount: -1 },
    ], {
      asOfMonth: '2026-01',
      completenessThreshold: 0.9,
    }),
    /Invalid monthly offer count/
  );
});


test('computeInterannualTrendProfile detects a persistent same-period decline across previous years', () => {
  assert.equal(typeof history.computeInterannualTrendProfile, 'function');

  const result = history.computeInterannualTrendProfile([
    { month: '2023-10', offersCount: 100 },
    { month: '2024-10', offersCount: 80 },
    { month: '2025-10', offersCount: 60 },
    { month: '2024-09', offersCount: 500 },
    { month: '2025-09', offersCount: 500 },
  ], {
    asOfMonth: '2026-10',
    minYears: 3,
    stableBand: 0.05,
    weight: 0.5,
    minFactor: 0.9,
    maxFactor: 1.1,
  });

  assert.equal(result.status, 'active');
  assert.equal(result.direction, 'degrading');
  assert.equal(result.sampleYears, 3);
  assert.equal(result.latestHistoricalYear, 2025);
  assert.equal(result.latestHistoricalOffers, 60);
  assert.equal(result.previousHistoricalOffers, 80);
  assert.equal(result.lastYearChangeRatio, -0.25);
  assert.equal(result.factor, 1.1);
  assert.equal(result.normalMedian, 80);
});

test('computeInterannualTrendProfile stays descriptive until enough comparable years exist', () => {
  const result = history.computeInterannualTrendProfile([
    { month: '2024-10', offersCount: 40 },
    { month: '2025-10', offersCount: 44 },
  ], {
    asOfMonth: '2026-10',
    minYears: 3,
  });

  assert.equal(result.status, 'descriptive');
  assert.equal(result.direction, 'improving');
  assert.equal(result.sampleYears, 2);
  assert.equal(result.factor, 1);
  assert.equal(result.lastYearChangeRatio, 0.1);
});
