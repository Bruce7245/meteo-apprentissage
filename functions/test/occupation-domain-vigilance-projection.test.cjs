const test = require('node:test');
const assert = require('node:assert/strict');

let projection = {};
try {
  projection = require('../lib/occupation-domain-vigilance-projection.cjs');
} catch {
  projection = {};
}

test('buildPublicOccupationDomainProjection emits only the public sector fields', () => {
  assert.equal(
    typeof projection.buildPublicOccupationDomainProjection,
    'function'
  );

  const result = projection.buildPublicOccupationDomainProjection({
    runId: 'run-1',
    date: '2026-10-06',
    departmentCode: '72',
    departmentName: 'Sarthe',
    domainCode: 'G12',
    domainLabel: "Animation d'activités de loisirs",
    publishedLevel: 'yellow',
    confidenceLevel: 'medium',
    activeOffersCount: 12,
    openingsCount: 14,
    expectedOffers: 15,
    observedVsExpectedRatio: 0.8,
    reasonCodes: ['OFFERS_NEAR_EXPECTED'],
    sourceVersions: {
      offerRunId: 'secret-ish',
    },
    siret: '12345678901234',
  });

  assert.deepEqual(Object.keys(result).sort(), [
    'activeOffersCount',
    'confidenceLevel',
    'dataAvailable',
    'date',
    'departmentCode',
    'departmentName',
    'domainCode',
    'domainLabel',
    'expectedOffers',
    'level',
    'levelLabel',
    'observedVsExpectedRatio',
    'openingsCount',
    'reasonCodes',
  ]);

  assert.equal(result.domainCode, 'G12');
  assert.equal(result.level, 'yellow');
  assert.equal(result.dataAvailable, true);
  assert.equal('siret' in result, false);
  assert.equal('sourceVersions' in result, false);
});

test('validatePublicOccupationDomainProjection rejects invalid domain/date/level values', () => {
  assert.equal(
    typeof projection.validatePublicOccupationDomainProjection,
    'function'
  );

  const valid = projection.buildPublicOccupationDomainProjection({
    date: '2026-10-06',
    departmentCode: '72',
    departmentName: 'Sarthe',
    domainCode: 'G12',
    domainLabel: "Animation d'activités de loisirs",
    publishedLevel: 'insufficient_data',
    confidenceLevel: 'low',
    activeOffersCount: 0,
    openingsCount: 0,
    expectedOffers: null,
    observedVsExpectedRatio: null,
    reasonCodes: ['DOMAIN_BASELINE_MISSING'],
  });

  assert.deepEqual(
    projection.validatePublicOccupationDomainProjection(valid),
    { ok: true, errors: [] }
  );

  assert.equal(
    projection.validatePublicOccupationDomainProjection({
      ...valid,
      domainCode: 'BAD',
    }).ok,
    false
  );
});
