const test = require('node:test');
const assert = require('node:assert/strict');

let precompute = {};
try {
  precompute = require('../occupation-vigilance-precompute.cjs');
} catch {
  precompute = {};
}

function fakeRepository(overrides = {}) {
  const contextWrites = [];
  const historyWrites = [];
  const contextRuns = [];
  const historyRuns = [];

  return {
    contextWrites,
    historyWrites,
    contextRuns,
    historyRuns,
    getPreparationStatus: async () => ({
      contextReady: false,
      historyReady: false,
      offerSourceFingerprint: null,
    }),
    loadOfferSourceFingerprint: async () => 'sha256:offers-current',
    loadPopulationByDepartment: async () => new Map([
      ['72', { populationTotal: 570000, population15To29: 95000, referenceYear: 2026, runId: 'population-v1' }],
    ]),
    loadFormationsByDepartment: async () => new Map([
      ['72', [{ formationId: 'f1', rncp: 'RNCP1', romeCodes: ['D1108'], sessions: [] }]],
    ]),
    loadRomeUniverse: async () => [],
    loadOfferDepartments: async () => [{
      departmentCode: '72',
      activeRunId: 'offers-72-v1',
      offers: [
        { offerDocId: 'o1', romeCodes: ['D1108'], openingCount: 1, locationQuality: 'in_department' },
        { offerDocId: 'o2', romeCodes: ['M1607'], openingCount: 1, locationQuality: 'in_department' },
      ],
    }],
    writeContexts: async (date, rows) => contextWrites.push({ date, rows }),
    markContextRunReady: async (date, meta) => contextRuns.push({ date, meta }),
    loadCurrentContexts: async () => [],
    loadRecentContextHistory: async () => new Map([
      ['72_D1108', [
        { date: '2026-10-04', activeOffersCount: 10 },
        { date: '2026-10-05', activeOffersCount: 12 },
      ]],
      ['72_M1607', [
        { date: '2026-10-04', activeOffersCount: 5 },
        { date: '2026-10-05', activeOffersCount: 4 },
      ]],
    ]),
    loadMonthlyRomeHistory: async () => new Map(),
    writeHistories: async (date, rows) => historyWrites.push({ date, rows }),
    markHistoryRunReady: async (date, meta) => historyRuns.push({ date, meta }),
    ...overrides,
  };
}

test('prepareOccupationVigilanceInputs builds context before history and marks both dependencies ready', async () => {
  assert.equal(typeof precompute.prepareOccupationVigilanceInputs, 'function');

  const repository = fakeRepository();
  const events = [];

  const result = await precompute.prepareOccupationVigilanceInputs({
    date: '2026-10-05',
    repository,
    aggregateContext: ({ departmentCode, romeCode }) => {
      events.push(`context:${departmentCode}_${romeCode}`);
      return {
        departmentCode,
        romeCode,
        activeOffersCount: romeCode === 'D1108' ? 12 : 4,
      };
    },
    computeRecentTrend: (history) => ({
      status: history.at(-1).activeOffersCount >= history[0].activeOffersCount
        ? 'improving'
        : 'degrading',
      changeRatio: null,
      observations: history.length,
    }),
    computeSeasonality: () => ({
      status: 'unavailable',
      factor: 1,
      sampleMonths: 0,
      completeness: 0,
    }),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.contextsCount, 2);
  assert.equal(result.historiesCount, 2);
  assert.equal(repository.contextWrites.length, 1);
  assert.equal(repository.historyWrites.length, 1);
  assert.equal(repository.contextRuns.length, 1);
  assert.equal(repository.historyRuns.length, 1);
  assert.deepEqual(
    repository.contextWrites[0].rows.map((row) => row.romeCode).sort(),
    ['D1108', 'M1607']
  );
  assert.equal(events.length, 2);
});

test('prepareOccupationVigilanceInputs fails when no daily offer snapshot is available', async () => {
  const repository = fakeRepository({
    loadOfferDepartments: async () => [],
  });

  await assert.rejects(
    () => precompute.prepareOccupationVigilanceInputs({
      date: '2026-10-05',
      repository,
      aggregateContext: () => ({}),
      computeRecentTrend: () => ({}),
      computeSeasonality: () => ({}),
    }),
    /No daily offer department snapshots/
  );

  assert.equal(repository.contextWrites.length, 0);
  assert.equal(repository.historyWrites.length, 0);
});

test('prepareOccupationVigilanceInputs reuses a fully ready preparation without rebuilding', async () => {
  let loads = 0;
  const repository = fakeRepository({
    getPreparationStatus: async () => ({
      contextReady: true,
      historyReady: true,
      contextsCount: 14,
      historiesCount: 14,
      offerSourceFingerprint: 'sha256:offers-current',
    }),
    loadOfferDepartments: async () => {
      loads += 1;
      return [];
    },
  });

  const result = await precompute.prepareOccupationVigilanceInputs({
    date: '2026-10-05',
    repository,
  });

  assert.equal(result.reused, true);
  assert.equal(result.status, 'ready');
  assert.equal(loads, 0);
});


test('validated ROME universe creates zero-offer department contexts instead of omitting them', async () => {
  const repository = fakeRepository({
    loadRomeUniverse: async () => ['D1108', 'M1607', 'G1602'],
  });

  const result = await precompute.prepareOccupationVigilanceInputs({
    date: '2026-10-05',
    repository,
    aggregateContext: ({ departmentCode, romeCode, offers }) => ({
      departmentCode,
      romeCode,
      activeOffersCount: offers.filter((offer) =>
        (offer.romeCodes || []).includes(romeCode)
      ).length,
    }),
    computeRecentTrend: () => ({
      status: 'unknown',
      changeRatio: null,
      observations: 0,
    }),
    computeSeasonality: () => ({
      status: 'unavailable',
      factor: 1,
      sampleMonths: 0,
      completeness: 0,
    }),
  });

  assert.equal(result.contextsCount, 3);
  const rows = repository.contextWrites[0].rows;
  const missingLocalSignal = rows.find((row) => row.romeCode === 'G1602');

  assert.ok(missingLocalSignal);
  assert.equal(missingLocalSignal.activeOffersCount, 0);
});


test('ready preparation is rebuilt when the same-date offer source fingerprint changed', async () => {
  let offerLoads = 0;
  const repository = fakeRepository({
    getPreparationStatus: async () => ({
      contextReady: true,
      historyReady: true,
      contextsCount: 2,
      historiesCount: 2,
      offerSourceFingerprint: 'sha256:offers-old',
    }),
    loadOfferSourceFingerprint: async () => 'sha256:offers-new',
    loadOfferDepartments: async () => {
      offerLoads += 1;
      return [{
        departmentCode: '72',
        activeRunId: 'offers-72-v2',
        offers: [
          {
            offerDocId: 'new-offer',
            romeCodes: ['D1108'],
            openingCount: 1,
            locationQuality: 'in_department',
          },
        ],
      }];
    },
  });

  const result = await precompute.prepareOccupationVigilanceInputs({
    date: '2026-10-05',
    repository,
    aggregateContext: ({ departmentCode, romeCode, offers }) => ({
      departmentCode,
      romeCode,
      activeOffersCount: offers.length,
    }),
    computeRecentTrend: () => ({
      status: 'unknown',
      changeRatio: null,
      observations: 0,
    }),
    computeSeasonality: () => ({
      status: 'unavailable',
      factor: 1,
      sampleMonths: 0,
      completeness: 0,
    }),
  });

  assert.equal(result.reused, false);
  assert.equal(offerLoads, 1);
  assert.equal(repository.contextRuns.at(-1).meta.offerSourceFingerprint, 'sha256:offers-new');
});
