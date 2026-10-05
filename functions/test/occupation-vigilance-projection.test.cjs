const test = require('node:test');
const assert = require('node:assert/strict');

let projection = {};
try {
  projection = require('../lib/occupation-vigilance-projection.cjs');
} catch {
  projection = {};
}

function sampleInput() {
  return {
    runId: 'occupation_vigilance_2026-10-05_deadbeef',
    date: '2026-10-05',
    departmentCode: '72',
    departmentName: 'Sarthe',
    romeCode: 'D1108',
    romeLabel: 'Vente en alimentation',
    context: {
      activeOffersCount: 12,
      openingsCount: 16,
      distinctObservedEmployersCount: 9,
      distinctObservedNafCount: 5,
      employerConcentration: 0.25,
      formationsCount: 4,
      upcomingSessionsCount: 3,
      distinctRncpCount: 2,
      populationTotal: 570000,
      population15To29: 95000,
      populationReferenceYear: 2026,
      siret: '12345678901234',
      raw: { secret: true },
    },
    history: {
      recentTrend: {
        status: 'degrading',
        changeRatio: -0.2,
        observations: 8,
      },
      seasonality: {
        status: 'active',
        factor: 0.9,
        sampleMonths: 28,
        completeness: 1,
      },
    },
    vigilance: {
      publishedLevel: 'orange',
      confidenceLevel: 'high',
      confidenceScore: 85,
      expectedOffers: 20,
      observedVsExpectedRatio: 0.6,
      reasonCodes: ['OFFERS_LOW_VS_EXPECTED', 'RECENT_TREND_DEGRADING'],
      factors: { population: 0.95 },
    },
    calculationVersion: 'occupationVigilance.v1',
    configVersion: 'config-v1',
    sourceVersions: {
      offers: 'offers-v1',
      population: 'population-v1',
    },
    secretCredential: 'never-public',
  };
}

test('buildInternalOccupationSnapshot retains deterministic calculation and aggregate context only', () => {
  assert.equal(typeof projection.buildInternalOccupationSnapshot, 'function');

  const result = projection.buildInternalOccupationSnapshot(sampleInput());

  assert.equal(result.runId, 'occupation_vigilance_2026-10-05_deadbeef');
  assert.equal(result.activeOffersCount, 12);
  assert.equal(result.recentTrend.status, 'degrading');
  assert.equal(result.seasonality.status, 'active');
  assert.equal(result.publishedLevel, 'orange');
  assert.equal(result.configVersion, 'config-v1');
  assert.equal('siret' in result, false);
  assert.equal('raw' in result, false);
  assert.equal('secretCredential' in result, false);
});

test('buildPublicOccupationMapEntry exposes only compact safe map fields including insufficient data', () => {
  assert.equal(typeof projection.buildPublicOccupationMapEntry, 'function');

  const snapshot = projection.buildInternalOccupationSnapshot(sampleInput());
  const result = projection.buildPublicOccupationMapEntry(snapshot);

  assert.deepEqual(result, {
    date: '2026-10-05',
    departmentCode: '72',
    departmentName: 'Sarthe',
    romeCode: 'D1108',
    romeLabel: 'Vente en alimentation',
    publishedLevel: 'orange',
    confidenceLevel: 'high',
    activeOffersCount: 12,
    dataAvailable: true,
  });

  const insufficient = projection.buildPublicOccupationMapEntry({
    ...snapshot,
    publishedLevel: 'insufficient_data',
    confidenceLevel: 'low',
  });
  assert.equal(insufficient.publishedLevel, 'insufficient_data');
  assert.equal(insufficient.dataAvailable, false);
});

test('buildPublicOccupationDepartmentDetail exposes aggregate metrics and deterministic reasons only', () => {
  assert.equal(typeof projection.buildPublicOccupationDepartmentDetail, 'function');

  const snapshot = projection.buildInternalOccupationSnapshot(sampleInput());
  const result = projection.buildPublicOccupationDepartmentDetail(snapshot);

  assert.deepEqual(result, {
    date: '2026-10-05',
    departmentCode: '72',
    departmentName: 'Sarthe',
    romeCode: 'D1108',
    romeLabel: 'Vente en alimentation',
    publishedLevel: 'orange',
    confidenceLevel: 'high',
    activeOffersCount: 12,
    openingsCount: 16,
    distinctObservedEmployersCount: 9,
    distinctObservedNafCount: 5,
    employerConcentration: 0.25,
    formationsCount: 4,
    upcomingSessionsCount: 3,
    distinctRncpCount: 2,
    populationTotal: 570000,
    population15To29: 95000,
    populationReferenceYear: 2026,
    recentTrend: {
      status: 'degrading',
      changeRatio: -0.2,
      observations: 8,
    },
    seasonality: {
      status: 'active',
      factor: 0.9,
      sampleMonths: 28,
      completeness: 1,
    },
    expectedOffers: 20,
    observedVsExpectedRatio: 0.6,
    reasonCodes: ['OFFERS_LOW_VS_EXPECTED', 'RECENT_TREND_DEGRADING'],
    dataAvailable: true,
  });

  for (const forbidden of [
    'runId',
    'configVersion',
    'sourceVersions',
    'siret',
    'raw',
    'secretCredential',
    'factors',
    'confidenceScore',
  ]) {
    assert.equal(forbidden in result, false, forbidden);
  }
});

test('validatePublicOccupationProjection rejects private fields and malformed public identifiers', () => {
  assert.equal(typeof projection.validatePublicOccupationProjection, 'function');

  const safe = projection.buildPublicOccupationDepartmentDetail(
    projection.buildInternalOccupationSnapshot(sampleInput())
  );
  assert.deepEqual(
    projection.validatePublicOccupationProjection(safe),
    { ok: true, errors: [] }
  );

  const unsafe = {
    ...safe,
    siret: '12345678901234',
    romeCode: 'bad',
  };
  const result = projection.validatePublicOccupationProjection(unsafe);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.includes('siret')), true);
  assert.equal(result.errors.some((item) => item.includes('romeCode')), true);
});
