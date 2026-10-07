const test = require('node:test');
const assert = require('node:assert/strict');

let publish = {};
try {
  publish = require('../lib/occupation-domain-vigilance-publish.cjs');
} catch {
  publish = {};
}

function run(overrides = {}) {
  return {
    runId: 'occupation_domain_vigilance_2026-10-06_abcdef',
    date: '2026-10-06',
    status: 'validating',
    expectedPairs: 4,
    computedPairs: 4,
    insufficientDataPairs: 1,
    failedPairs: 0,
    configVersion: 'domain-config-v1',
    calculationVersion: 'occupationDomainVigilance.v1',
    sourceFingerprint: 'sha256:abc',
    ...overrides,
  };
}

function counts(overrides = {}) {
  return {
    snapshotsCount: 4,
    mapEntriesCount: 4,
    detailEntriesCount: 4,
    invalidPublicProjectionsCount: 0,
    sourceDateMismatchCount: 0,
    ...overrides,
  };
}

test('validateOccupationDomainRun rejects incomplete or invalid staged data', () => {
  assert.equal(typeof publish.validateOccupationDomainRun, 'function');

  assert.deepEqual(
    publish.validateOccupationDomainRun(run(), counts()),
    { ok: true, errors: [] }
  );

  const result = publish.validateOccupationDomainRun(
    run(),
    counts({
      mapEntriesCount: 3,
      invalidPublicProjectionsCount: 1,
      sourceDateMismatchCount: 1,
    })
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some((item) => item.includes('mapEntriesCount')),
    true
  );
  assert.equal(
    result.errors.some((item) => item.includes('invalidPublicProjectionsCount')),
    true
  );
  assert.equal(
    result.errors.some((item) => item.includes('sourceDateMismatchCount')),
    true
  );
});

test('publishOccupationDomainRun preserves previous pointer on validation failure', async () => {
  assert.equal(typeof publish.publishOccupationDomainRun, 'function');

  let pointer = { runId: 'previous-domain-run' };
  let failed = false;

  const repository = {
    getRun: async () => run(),
    getStagedCounts: async () =>
      counts({ detailEntriesCount: 3 }),
    markFailed: async () => {
      failed = true;
    },
    setRunReady: async () => {
      throw new Error('must not mark ready');
    },
    publishAtomic: async () => {
      pointer = { runId: 'new-run' };
    },
  };

  const result = await publish.publishOccupationDomainRun(
    repository,
    run().runId
  );

  assert.equal(result.status, 'failed');
  assert.equal(failed, true);
  assert.deepEqual(pointer, { runId: 'previous-domain-run' });
});

test('publishOccupationDomainRun marks ready then flips pointer once', async () => {
  const actions = [];
  let pointer = { runId: 'previous-domain-run' };

  const repository = {
    getRun: async () => run(),
    getStagedCounts: async () => counts(),
    markFailed: async () => {
      throw new Error('must not fail');
    },
    setRunReady: async (runId) =>
      actions.push(['ready', runId]),
    publishAtomic: async (runId) => {
      actions.push(['publish', runId]);
      pointer = { runId };
    },
  };

  const result = await publish.publishOccupationDomainRun(
    repository,
    run().runId
  );

  assert.equal(result.status, 'published');
  assert.deepEqual(actions, [
    ['ready', run().runId],
    ['publish', run().runId],
  ]);
  assert.deepEqual(pointer, { runId: run().runId });
});
