const test = require('node:test');
const assert = require('node:assert/strict');

let run = {};
try {
  run = require('../lib/occupation-domain-vigilance-run.cjs');
} catch {
  run = {};
}

test('buildOccupationDomainRunId is deterministic and version-sensitive', () => {
  assert.equal(typeof run.buildOccupationDomainRunId, 'function');

  const input = {
    date: '2026-10-06',
    calculationVersion: 'occupationDomainVigilance.v1',
    configVersion: 'occupationDomainVigilance.v1.cal.test',
    sourceFingerprint:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };

  const first = run.buildOccupationDomainRunId(input);
  const second = run.buildOccupationDomainRunId({ ...input });

  assert.equal(first, second);
  assert.match(
    first,
    /^occupation_domain_vigilance_2026-10-06_[a-f0-9]{16}$/
  );

  assert.notEqual(
    first,
    run.buildOccupationDomainRunId({
      ...input,
      configVersion: 'occupationDomainVigilance.v1.cal.other',
    })
  );
});

test('buildDomainSourceFingerprint is key-order independent', () => {
  assert.equal(typeof run.buildDomainSourceFingerprint, 'function');

  const a = run.buildDomainSourceFingerprint({
    domains: 'domains-v1',
    offers: 'offers-v1',
    population: 'population-v1',
  });

  const b = run.buildDomainSourceFingerprint({
    population: 'population-v1',
    offers: 'offers-v1',
    domains: 'domains-v1',
  });

  assert.equal(a, b);
  assert.match(a, /^sha256:[a-f0-9]{64}$/);
});
