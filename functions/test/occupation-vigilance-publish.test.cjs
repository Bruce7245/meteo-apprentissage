const test = require('node:test');
const assert = require('node:assert/strict');

let publish = {};
try {
  publish = require('../lib/occupation-vigilance-publish.cjs');
} catch {
  publish = {};
}

function run(overrides = {}) {
  return {
    runId: 'occupation_vigilance_2026-10-05_abcdef',
    date: '2026-10-05',
    status: 'validating',
    expectedPairs: 3,
    computedPairs: 3,
    insufficientDataPairs: 1,
    failedPairs: 0,
    configVersion: 'config-v1',
    calculationVersion: 'occupationVigilance.v1',
    sourceFingerprint: 'sha256:abc',
    ...overrides,
  };
}

function counts(overrides = {}) {
  return {
    snapshotsCount: 3,
    mapEntriesCount: 3,
    detailEntriesCount: 3,
    invalidPublicProjectionsCount: 0,
    sourceDateMismatchCount: 0,
    ...overrides,
  };
}

test('validateOccupationRun rejects count mismatches, invalid projections and source-date mismatches', () => {
  assert.equal(typeof publish.validateOccupationRun, 'function');

  assert.deepEqual(publish.validateOccupationRun(run(), counts()), {
    ok: true,
    errors: [],
  });

  const result = publish.validateOccupationRun(
    run(),
    counts({
      detailEntriesCount: 2,
      invalidPublicProjectionsCount: 1,
      sourceDateMismatchCount: 1,
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.includes('detailEntriesCount')), true);
  assert.equal(result.errors.some((item) => item.includes('invalidPublicProjectionsCount')), true);
  assert.equal(result.errors.some((item) => item.includes('sourceDateMismatchCount')), true);
});

test('publishOccupationRun blocks invalid staged data and preserves current pointer', async () => {
  assert.equal(typeof publish.publishOccupationRun, 'function');

  let pointer = { runId: 'previous-run' };
  const updates = [];
  const repository = {
    getRun: async () => run(),
    getStagedCounts: async () => counts({ mapEntriesCount: 2 }),
    markFailed: async (runId, patch) => updates.push({ runId, patch }),
    setRunReady: async () => { throw new Error('must not mark ready'); },
    publishAtomic: async () => { pointer = { runId: 'new-run' }; },
  };

  const result = await publish.publishOccupationRun(repository, run().runId);

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'RUN_VALIDATION_FAILED');
  assert.deepEqual(pointer, { runId: 'previous-run' });
  assert.equal(updates.length, 1);
});

test('publishOccupationRun marks run ready then performs one atomic pointer publication', async () => {
  let pointer = { runId: 'previous-run' };
  const actions = [];
  const repository = {
    getRun: async () => run(),
    getStagedCounts: async () => counts(),
    markFailed: async () => { throw new Error('must not fail'); },
    setRunReady: async (runId) => actions.push(['ready', runId]),
    publishAtomic: async (runId, expectedRun) => {
      actions.push(['publish', runId]);
      assert.equal(expectedRun.status, 'validating');
      pointer = { runId };
    },
  };

  const result = await publish.publishOccupationRun(repository, run().runId);

  assert.equal(result.status, 'published');
  assert.deepEqual(actions, [
    ['ready', run().runId],
    ['publish', run().runId],
  ]);
  assert.deepEqual(pointer, { runId: run().runId });
});
