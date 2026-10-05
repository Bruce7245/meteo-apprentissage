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
  assert.deepEqual(history.computeRecentOfferTrend([]), {
    status: 'unknown',
    changeRatio: null,
    observations: 0,
  });
  assert.equal(history.computeRecentOfferTrend([{ date: '2026-10-05', activeOffersCount: 12 }]).status, 'unknown');
});

test('computeRecentOfferTrend compares the oldest and newest usable daily values', () => {
  const result = history.computeRecentOfferTrend([
    { date: '2026-10-05', activeOffersCount: 12 },
    { date: '2026-10-03', activeOffersCount: 10 },
    { date: 'bad', activeOffersCount: 99 },
  ]);
  assert.equal(result.status, 'increasing');
  assert.equal(result.changeRatio, 0.2);
  assert.equal(result.observations, 2);
});

test('computeRecentOfferTrend avoids divide by zero while preserving direction', () => {
  const result = history.computeRecentOfferTrend([
    { date: '2026-10-03', activeOffersCount: 0 },
    { date: '2026-10-05', activeOffersCount: 4 },
  ]);
  assert.equal(result.status, 'increasing');
  assert.equal(result.changeRatio, null);
});

test('computeSeasonalityProfile is unavailable below 12 complete monthly observations', () => {
  assert.equal(typeof history.computeSeasonalityProfile, 'function');
  const monthly = Array.from({ length: 11 }, (_, index) => ({
    month: `2025-${String(index + 1).padStart(2, '0')}`,
    activeOffersCount: 10,
  }));
  const result = history.computeSeasonalityProfile(monthly, {
    asOfMonth: '2026-10',
    completenessThreshold: 0.9,
    minFactor: 0.8,
    maxFactor: 1.2,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.factor, 1);
  assert.equal(result.sampleMonths, 11);
});

test('computeSeasonalityProfile remains descriptive and neutral from 12 to 23 complete months', () => {
  const monthly = Array.from({ length: 18 }, (_, index) => {
    const date = new Date(Date.UTC(2025, index, 1));
    return {
      month: date.toISOString().slice(0, 7),
      activeOffersCount: date.getUTCMonth() === 9 ? 20 : 10,
    };
  });
  const result = history.computeSeasonalityProfile(monthly, {
    asOfMonth: '2026-10',
    completenessThreshold: 0.9,
    minFactor: 0.8,
    maxFactor: 1.2,
  });
  assert.equal(result.status, 'descriptive');
  assert.equal(result.factor, 1);
  assert.equal(result.completeness, 1);
});

test('computeSeasonalityProfile activates after 24 months and clamps the month ratio to configured bounds', () => {
  const monthly = Array.from({ length: 24 }, (_, index) => {
    const date = new Date(Date.UTC(2024, index, 1));
    return {
      month: date.toISOString().slice(0, 7),
      activeOffersCount: date.getUTCMonth() === 9 ? 30 : 10,
    };
  });

  const result = history.computeSeasonalityProfile(monthly, {
    asOfMonth: '2026-10',
    completenessThreshold: 0.9,
    minFactor: 0.8,
    maxFactor: 1.2,
  });

  assert.equal(result.status, 'active');
  assert.equal(result.factor, 1.2);
  assert.equal(result.sampleMonths, 24);
  assert.equal(result.completeness, 1);
});

test('computeSeasonalityProfile treats missing months as missing coverage, not zero offers', () => {
  const monthly = [];
  for (let index = 0; index < 24; index += 1) {
    if (index === 5 || index === 17) continue;
    const date = new Date(Date.UTC(2024, index, 1));
    monthly.push({ month: date.toISOString().slice(0, 7), activeOffersCount: 10 });
  }

  const result = history.computeSeasonalityProfile(monthly, {
    asOfMonth: '2026-10',
    completenessThreshold: 0.95,
    minFactor: 0.8,
    maxFactor: 1.2,
  });

  assert.equal(result.sampleMonths, 22);
  assert.equal(result.completeness, 22 / 24);
  assert.equal(result.status, 'descriptive');
  assert.equal(result.factor, 1);
});

test('extractMonthlyRomeObservation normalizes monthly aggregate field variants', () => {
  assert.equal(typeof history.extractMonthlyRomeObservation, 'function');
  assert.deepEqual(
    history.extractMonthlyRomeObservation({ month: '2026-09', romeCode: 'D1401', totalOffers: 12 }),
    { month: '2026-09', romeCode: 'D1401', activeOffersCount: 12 }
  );
  assert.deepEqual(
    history.extractMonthlyRomeObservation({ date: '2026-09-30', code: 'M1607', jobsCount: 7 }),
    { month: '2026-09', romeCode: 'M1607', activeOffersCount: 7 }
  );
});

test('extractDailyRomeObservations reads array or map byRome aggregates without inventing missing codes', () => {
  assert.equal(typeof history.extractDailyRomeObservations, 'function');
  assert.deepEqual(
    history.extractDailyRomeObservations({
      date: '2026-10-05',
      summary: { byRome: [{ romeCode: 'D1401', offersCount: 5 }, { code: 'M1607', count: 3 }] },
    }),
    [
      { date: '2026-10-05', romeCode: 'D1401', activeOffersCount: 5 },
      { date: '2026-10-05', romeCode: 'M1607', activeOffersCount: 3 },
    ]
  );
  assert.deepEqual(
    history.extractDailyRomeObservations({ date: '2026-10-04', byRome: { D1401: 4 } }),
    [{ date: '2026-10-04', romeCode: 'D1401', activeOffersCount: 4 }]
  );
});

test('extractDailyRomeObservations preserves opening totals when the aggregate provides them', () => {
  const result = history.extractDailyRomeObservations({
    date: '2026-10-05',
    byRome: [{ romeCode: 'D1401', offersCount: 5, openingsCount: 8 }],
  });
  assert.deepEqual(result, [
    { date: '2026-10-05', romeCode: 'D1401', activeOffersCount: 5, openingsCount: 8 },
  ]);
});

test('extractDailyRomeObservations accepts a document already aggregated to one ROME code', () => {
  assert.deepEqual(
    history.extractDailyRomeObservations({
      date: '2026-10-05',
      romeCode: 'D1401',
      activeOffersCount: 6,
      openingsCount: 9,
    }),
    [{ date: '2026-10-05', romeCode: 'D1401', activeOffersCount: 6, openingsCount: 9 }]
  );
});
