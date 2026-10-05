const test = require('node:test');
const assert = require('node:assert/strict');

let publicOccupation = {};
try {
  publicOccupation = require('../lib/public-occupation-vigilance.cjs');
} catch {
  publicOccupation = {};
}

test('normalizePublicRomeCode accepts exact ROME codes only', () => {
  assert.equal(typeof publicOccupation.normalizePublicRomeCode, 'function');

  assert.equal(publicOccupation.normalizePublicRomeCode('d1108'), 'D1108');
  assert.equal(publicOccupation.normalizePublicRomeCode(' M1607 '), 'M1607');
  assert.equal(publicOccupation.normalizePublicRomeCode('D110'), null);
  assert.equal(publicOccupation.normalizePublicRomeCode('D11088'), null);
  assert.equal(publicOccupation.normalizePublicRomeCode('BAD'), null);
});

test('resolvePublishedOccupationRun requires the current pointer and a published matching run', () => {
  assert.equal(typeof publicOccupation.resolvePublishedOccupationRun, 'function');

  assert.deepEqual(
    publicOccupation.resolvePublishedOccupationRun(null, null),
    { ok: false, error: 'NO_PUBLISHED_OCCUPATION_RUN' }
  );

  assert.deepEqual(
    publicOccupation.resolvePublishedOccupationRun(
      { runId: 'run-1', date: '2026-10-05' },
      { runId: 'run-1', status: 'ready', date: '2026-10-05' }
    ),
    { ok: false, error: 'OCCUPATION_RUN_NOT_PUBLISHED' }
  );

  assert.deepEqual(
    publicOccupation.resolvePublishedOccupationRun(
      { runId: 'run-1', date: '2026-10-05' },
      { runId: 'run-2', status: 'published', date: '2026-10-05' }
    ),
    { ok: false, error: 'OCCUPATION_RUN_MISMATCH' }
  );

  assert.deepEqual(
    publicOccupation.resolvePublishedOccupationRun(
      { runId: 'run-1', date: '2026-10-05' },
      { runId: 'run-1', status: 'published', date: '2026-10-05' }
    ),
    { ok: true, runId: 'run-1', date: '2026-10-05' }
  );
});

test('sanitizePublicOccupationMap keeps all five public states and strips run internals', () => {
  assert.equal(typeof publicOccupation.sanitizePublicOccupationMap, 'function');

  const result = publicOccupation.sanitizePublicOccupationMap({
    runId: 'internal-run',
    configVersion: 'secret-config',
    sourceFingerprint: 'secret-fingerprint',
    date: '2026-10-05',
    romeCode: 'D1108',
    romeLabel: 'Vente en alimentation',
    departments: [
      {
        date: '2026-10-05',
        departmentCode: '72',
        departmentName: 'Sarthe',
        romeCode: 'D1108',
        romeLabel: 'Vente en alimentation',
        publishedLevel: 'green',
        confidenceLevel: 'high',
        activeOffersCount: 12,
        dataAvailable: true,
        schemaVersion: 'internal-schema',
      },
      {
        date: '2026-10-05',
        departmentCode: '44',
        departmentName: 'Loire-Atlantique',
        romeCode: 'D1108',
        romeLabel: 'Vente en alimentation',
        publishedLevel: 'insufficient_data',
        confidenceLevel: 'low',
        activeOffersCount: 0,
        dataAvailable: false,
        runId: 'must-not-leak',
      },
    ],
  });

  assert.deepEqual(result, {
    date: '2026-10-05',
    romeCode: 'D1108',
    romeLabel: 'Vente en alimentation',
    departments: [
      {
        departmentCode: '44',
        departmentName: 'Loire-Atlantique',
        publishedLevel: 'insufficient_data',
        confidenceLevel: 'low',
        activeOffersCount: 0,
        dataAvailable: false,
      },
      {
        departmentCode: '72',
        departmentName: 'Sarthe',
        publishedLevel: 'green',
        confidenceLevel: 'high',
        activeOffersCount: 12,
        dataAvailable: true,
      },
    ],
  });

  assert.equal(JSON.stringify(result).includes('internal-run'), false);
  assert.equal(JSON.stringify(result).includes('secret-config'), false);
  assert.equal(JSON.stringify(result).includes('schemaVersion'), false);
});

test('sanitizePublicOccupationDepartment exposes approved aggregates and reason codes only', () => {
  assert.equal(typeof publicOccupation.sanitizePublicOccupationDepartment, 'function');

  const result = publicOccupation.sanitizePublicOccupationDepartment({
    date: '2026-10-05',
    departmentCode: '72',
    departmentName: 'Sarthe',
    romeCode: 'D1108',
    romeLabel: 'Vente en alimentation',
    publishedLevel: 'orange',
    confidenceLevel: 'medium',
    activeOffersCount: 4,
    openingsCount: 5,
    distinctObservedEmployersCount: 3,
    distinctObservedNafCount: 2,
    employerConcentration: 0.5,
    formationsCount: 2,
    upcomingSessionsCount: 1,
    distinctRncpCount: 2,
    populationTotal: 570000,
    population15To29: 95000,
    populationReferenceYear: 2026,
    recentTrend: { status: 'degrading', changeRatio: -0.2, observations: 8 },
    seasonality: { status: 'active', factor: 0.9, sampleMonths: 28, completeness: 1 },
    expectedOffers: 10,
    observedVsExpectedRatio: 0.4,
    reasonCodes: ['OFFERS_LOW_VS_EXPECTED'],
    dataAvailable: true,
    runId: 'private-run',
    configVersion: 'private-config',
    sourceVersions: { raw: true },
    siret: '12345678901234',
    phone: '0102030405',
    address: '1 rue privée',
    raw: { secret: true },
  });

  assert.deepEqual(result, {
    date: '2026-10-05',
    departmentCode: '72',
    departmentName: 'Sarthe',
    romeCode: 'D1108',
    romeLabel: 'Vente en alimentation',
    publishedLevel: 'orange',
    confidenceLevel: 'medium',
    activeOffersCount: 4,
    openingsCount: 5,
    distinctObservedEmployersCount: 3,
    distinctObservedNafCount: 2,
    employerConcentration: 0.5,
    formationsCount: 2,
    upcomingSessionsCount: 1,
    distinctRncpCount: 2,
    populationTotal: 570000,
    population15To29: 95000,
    populationReferenceYear: 2026,
    recentTrend: { status: 'degrading', changeRatio: -0.2, observations: 8 },
    seasonality: { status: 'active', factor: 0.9, sampleMonths: 28, completeness: 1 },
    expectedOffers: 10,
    observedVsExpectedRatio: 0.4,
    reasonCodes: ['OFFERS_LOW_VS_EXPECTED'],
    dataAvailable: true,
  });

  for (const forbidden of [
    'runId',
    'configVersion',
    'sourceVersions',
    'siret',
    'phone',
    'address',
    'raw',
  ]) {
    assert.equal(forbidden in result, false, forbidden);
  }
});
