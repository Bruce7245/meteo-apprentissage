const test = require('node:test');
const assert = require('node:assert/strict');

let daily = {};
try {
  daily = require('../occupation-vigilance-daily.cjs');
} catch {
  daily = {};
}

function dependencies(overrides = {}) {
  return {
    contextRun: { status: 'ready', date: '2026-10-05' },
    populationMeta: { runId: 'population-run', sourceVersion: 'population-v1' },
    occupationReferenceMeta: { runId: 'rome-run', sourceVersion: 'rome-v1' },
    config: {
      status: 'validated',
      version: 'config-v1',
      calculationVersion: 'occupationVigilance.v1',
    },
    ...overrides,
  };
}

function contexts() {
  return [
    {
      departmentCode: '72',
      romeCode: 'D1108',
      activeOffersCount: 12,
      openingsCount: 15,
      population15To29: 95000,
      sourceVersions: { offerRunId: 'offers-72-v1' },
    },
    {
      departmentCode: '44',
      romeCode: 'M1607',
      activeOffersCount: 5,
      openingsCount: 6,
      population15To29: 210000,
      sourceVersions: { offerRunId: 'offers-44-v1' },
    },
    {
      departmentCode: '44',
      romeCode: 'D1108',
      activeOffersCount: 0,
      openingsCount: 0,
      population15To29: 210000,
      sourceVersions: { offerRunId: 'offers-44-v1' },
    },
  ];
}

function fakeRepository(overrides = {}) {
  const writes = [];
  const updates = [];
  const created = [];

  return {
    writes,
    updates,
    created,
    loadDependencies: async () => dependencies(),
    loadContexts: async () => contexts(),
    loadHistories: async () => new Map(),
    loadOccupationReferences: async () => new Map([
      ['D1108', { romeCode: 'D1108', label: 'Vente en alimentation' }],
      ['M1607', { romeCode: 'M1607', label: 'Secrétariat' }],
    ]),
    loadDepartmentNames: async () => new Map([
      ['72', 'Sarthe'],
      ['44', 'Loire-Atlantique'],
    ]),
    getRun: async () => null,
    createRun: async (run) => created.push(run),
    writeStagedResults: async (runId, chunk) => writes.push({ runId, chunk }),
    updateRun: async (runId, patch) => updates.push({ runId, patch }),
    recordPreflightFailure: async () => {},
    ...overrides,
  };
}

test('missing required dependency fails before calculation or staged writes', async () => {
  assert.equal(typeof daily.buildDailyOccupationVigilanceRun, 'function');

  let computeCalls = 0;
  const repository = fakeRepository({
    loadDependencies: async () => dependencies({ populationMeta: null }),
  });

  const result = await daily.buildDailyOccupationVigilanceRun({
    date: '2026-10-05',
    repository,
    computeVigilance: () => {
      computeCalls += 1;
      return {};
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'DEPENDENCIES_NOT_READY');
  assert.equal(computeCalls, 0);
  assert.equal(repository.writes.length, 0);
});

test('unvalidated config fails before staged writes', async () => {
  const repository = fakeRepository({
    loadDependencies: async () => dependencies({
      config: {
        status: 'draft',
        version: 'config-v1',
        calculationVersion: 'occupationVigilance.v1',
      },
    }),
  });

  const result = await daily.buildDailyOccupationVigilanceRun({
    date: '2026-10-05',
    repository,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'CONFIG_NOT_VALIDATED');
  assert.equal(repository.writes.length, 0);
});

test('daily builder evaluates each pair once, chunks writes and ends in validating state', async () => {
  const repository = fakeRepository();
  const evaluated = [];

  const result = await daily.buildDailyOccupationVigilanceRun({
    date: '2026-10-05',
    repository,
    batchSize: 2,
    computeVigilance: (input, config) => {
      evaluated.push(`${input.departmentCode}_${input.romeCode}_${config.version}`);
      return {
        publishedLevel: input.activeOffersCount === 0 ? 'insufficient_data' : 'green',
        confidenceLevel: input.activeOffersCount === 0 ? 'low' : 'high',
        confidenceScore: input.activeOffersCount === 0 ? 0 : 90,
        expectedOffers: 10,
        observedVsExpectedRatio: input.activeOffersCount / 10,
        reasonCodes: [],
        factors: {},
        calculationVersion: config.calculationVersion,
        configVersion: config.version,
      };
    },
  });

  assert.equal(evaluated.length, 3);
  assert.deepEqual(new Set(evaluated).size, 3);
  assert.equal(repository.writes.length, 2);
  assert.equal(repository.writes[0].chunk.length, 2);
  assert.equal(repository.writes[1].chunk.length, 1);
  assert.equal(result.status, 'validating');
  assert.equal(result.computedPairs, 3);
  assert.equal(result.insufficientDataPairs, 1);
  assert.equal(repository.updates.at(-1).patch.status, 'validating');
});

test('same date config and source fingerprint reuses a completed run without recalculation', async () => {
  let computeCalls = 0;
  const repository = fakeRepository({
    getRun: async (runId) => ({
      runId,
      status: 'ready',
      computedPairs: 3,
      insufficientDataPairs: 0,
    }),
  });

  const result = await daily.buildDailyOccupationVigilanceRun({
    date: '2026-10-05',
    repository,
    computeVigilance: () => {
      computeCalls += 1;
      return {};
    },
  });

  assert.equal(result.reused, true);
  assert.equal(result.status, 'ready');
  assert.equal(computeCalls, 0);
  assert.equal(repository.writes.length, 0);
  assert.equal(repository.created.length, 0);
});
