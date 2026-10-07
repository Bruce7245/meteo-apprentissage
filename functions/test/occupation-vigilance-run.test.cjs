const test = require('node:test');
const assert = require('node:assert/strict');

let run = {};
try {
  run = require('../lib/occupation-vigilance-run.cjs');
} catch {
  run = {};
}

test('buildSourceFingerprint is deterministic and independent of object key order', () => {
  assert.equal(typeof run.buildSourceFingerprint, 'function');

  const first = run.buildSourceFingerprint({
    offers: 'offers-v1',
    population: 'population-v1',
    rome: 'rome-v1',
  });
  const second = run.buildSourceFingerprint({
    rome: 'rome-v1',
    offers: 'offers-v1',
    population: 'population-v1',
  });

  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(
    first,
    run.buildSourceFingerprint({
      offers: 'offers-v2',
      population: 'population-v1',
      rome: 'rome-v1',
    })
  );
});

test('buildOccupationRunId is stable for identical inputs and changes with source/config versions', () => {
  assert.equal(typeof run.buildOccupationRunId, 'function');

  const input = {
    date: '2026-10-05',
    calculationVersion: 'occupationVigilance.v1',
    configVersion: 'config-abc',
    sourceFingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };

  const first = run.buildOccupationRunId(input);
  const second = run.buildOccupationRunId({ ...input });

  assert.equal(first, second);
  assert.match(first, /^occupation_vigilance_2026-10-05_[a-f0-9]{16}$/);
  assert.notEqual(
    first,
    run.buildOccupationRunId({
      ...input,
      configVersion: 'config-def',
    })
  );
});

test('run state machine allows only forward publication transitions or failure', () => {
  assert.ok(run.RUN_STATES);

  assert.equal(run.validateRunTransition(null, 'building'), true);
  assert.equal(run.validateRunTransition('building', 'validating'), true);
  assert.equal(run.validateRunTransition('validating', 'ready'), true);
  assert.equal(run.validateRunTransition('ready', 'published'), true);

  assert.equal(run.validateRunTransition('building', 'failed'), true);
  assert.equal(run.validateRunTransition('validating', 'failed'), true);
  assert.equal(run.validateRunTransition('ready', 'failed'), true);

  assert.equal(run.validateRunTransition('building', 'published'), false);
  assert.equal(run.validateRunTransition('validating', 'published'), false);
  assert.equal(run.validateRunTransition('published', 'failed'), false);
  assert.equal(run.validateRunTransition('failed', 'building'), false);
  assert.equal(run.validateRunTransition('unknown', 'building'), false);
});
