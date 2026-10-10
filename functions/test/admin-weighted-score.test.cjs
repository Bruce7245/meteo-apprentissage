'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MODEL_VERSION, DEFAULT_WEIGHTS, SEASONALITY_NEUTRAL_FACTOR,
  MIN_BENCHMARK_DEPARTMENTS, validateWeights, computeWeights,
  buildReference, simulateTerritorialScores,
} = require('../lib/admin-weighted-score.cjs');
const {savedScoreWeights, saveScoreWeights} = require('../admin-monthly-settings.cjs');

function departments(overrides = {}) {
  return Array.from({length: 101}, (_, i) => ({
    departmentCode: String(i + 1).padStart(3, '0'),
    quality: 'comparable',
    comparisonReady: true,
    population15To29: 100000,
    activeEmployerEstablishmentsCount: 1000,
    averageOffers: 100,
    offersPer10000Young: 10,
    changeMonth: {value: 0, quality: 'comparable'},
    changeYear: {value: 0, quality: 'comparable'},
    ...overrides,
  }));
}

test('approved coefficients keep seasonality weight separate from neutral factor', () => {
  assert.deepEqual(DEFAULT_WEIGHTS, {
    offersFoundation: 5,
    density: 4,
    employers: 3.5,
    trend: 4,
    seasonality: 2.5,
  });
  assert.equal(SEASONALITY_NEUTRAL_FACTOR, 1);
  assert.equal(computeWeights(DEFAULT_WEIGHTS).density, 4);
  assert.equal(computeWeights(DEFAULT_WEIGHTS).seasonalityReserved, 2.5);
  assert.equal(computeWeights(DEFAULT_WEIGHTS).seasonalityFactor, 1);
});

test('weights must be in 0–5 at half-step intervals', () => {
  assert.equal(validateWeights(DEFAULT_WEIGHTS).ok, true);
  assert.equal(validateWeights({...DEFAULT_WEIGHTS, employers: 3.25}).ok, false);
  assert.equal(validateWeights({...DEFAULT_WEIGHTS, trend: 5.5}).ok, false);
  assert.equal(validateWeights({...DEFAULT_WEIGHTS, density: 0}).ok, false);
  assert.equal(validateWeights({...DEFAULT_WEIGHTS, offersFoundation: 0}).ok, false);
});

test('all valid national departments at reference level yield score 50, not fivefold counted offers', () => {
  const simulation = simulateTerritorialScores(departments());
  assert.equal(simulation.mode, 'simulation_only');
  assert.equal(simulation.calculationVersion, MODEL_VERSION);
  assert.equal(simulation.reference.eligibleDepartments, 101);
  assert.equal(simulation.reference.referenceOffersPer10000Young, 10);
  assert.equal(simulation.reference.referenceEmployersPer10000Young, 100);
  assert.equal(simulation.summary.scored, 101);
  const row = simulation.scores[0];
  assert.equal(row.score, 50);
  assert.equal(row.quality, 'experimental');
  assert.equal(row.activeWeights.density, 4);
  assert.equal(row.activeWeights.employers, 3.5);
  assert.equal(row.activeWeights.trend, 4);
  assert.equal(row.seasonalityFactorApplied, 1);
  assert.deepEqual(Object.keys(row.components).sort(), ['density', 'employers', 'trend']);
});

test('a missing national reference blocks all scores without fabricated normalization', () => {
  const simulation = simulateTerritorialScores(departments().slice(0, MIN_BENCHMARK_DEPARTMENTS - 1));
  assert.equal(simulation.reference.referenceOffersPer10000Young, null);
  assert.equal(simulation.summary.scored, 0);
  assert.equal(simulation.scores[0].score, null);
  assert.equal(simulation.scores[0].quality, 'unavailable');
});

test('missing employer values are not silently converted into zero companies', () => {
  const simulation = simulateTerritorialScores(
    departments({activeEmployerEstablishmentsCount: null})
  );
  assert.equal(simulation.reference.referenceEmployersPer10000Young, null);
  assert.equal(simulation.scores[0].components.employers, null);
  assert.equal(simulation.scores[0].quality, 'partial');
  assert.equal(simulation.scores[0].activeWeights.employers, 0);
});

test('zero real employers is a valid observed employer-potential component', () => {
  const rows = departments();
  rows[0].activeEmployerEstablishmentsCount = 0;
  const simulation = simulateTerritorialScores(rows);
  assert.equal(simulation.reference.employerCoverageDepartments, 101);
  assert.equal(simulation.scores[0].components.employers, 0);
});

test('declines lower the trend score and missing annual series keeps score partial', () => {
  const base = simulateTerritorialScores(departments()).scores[0];
  const declined = simulateTerritorialScores(
    departments({changeMonth: {value: -0.2, quality: 'comparable'}, changeYear: null})
  ).scores[0];
  assert.ok(declined.score < base.score);
  assert.equal(declined.components.trend, 30);
  assert.equal(declined.quality, 'partial');
});

test('a changed seasonality importance does not distort results while factor is neutral', () => {
  const one = simulateTerritorialScores(departments(), DEFAULT_WEIGHTS);
  const another = simulateTerritorialScores(departments(), {
    ...DEFAULT_WEIGHTS,
    seasonality: 5,
  });
  assert.deepEqual(
    one.scores.map(row => row.score),
    another.scores.map(row => row.score)
  );
});

test('fewer than two distinct dimensions forbid an artificially overconfident score', () => {
  const simulation = simulateTerritorialScores(
    departments({
      activeEmployerEstablishmentsCount: null,
      changeMonth: null,
      changeYear: null,
    })
  );
  assert.equal(simulation.scores[0].score, null);
  assert.ok(simulation.scores[0].reasons.includes('AT_LEAST_TWO_DISTINCT_DIMENSIONS_REQUIRED'));
});

test('partial, saturated and method-change months cannot create a score', () => {
  for (const quality of ['incomplete', 'saturated', 'method_change', 'missing_population']) {
    const simulation = simulateTerritorialScores(departments({quality, comparisonReady: false}));
    assert.equal(simulation.scores[0].score, null);
  }
});

test('source capping not assessed labels computed values as indicative, not certified', () => {
  const simulation = simulateTerritorialScores(
    departments({quality: 'indicative'})
  );
  assert.equal(simulation.scores[0].quality, 'indicative');
});

test('missing administrative scoring draft gets the approved defaults', () => {
  assert.deepEqual(savedScoreWeights({exists:false}).weights, DEFAULT_WEIGHTS);
  assert.equal(savedScoreWeights({exists:false}).version, 0);
  assert.ok(savedScoreWeights({exists:true,data:()=>({weights:{density:99}})}).configurationWarning);
});

function mockResponse() {
  return {
    code: null, body: null,
    status(code) {this.code = code; return this;},
    json(body) {this.body = body; return this;},
  };
}

test('draft score save rejects a non-neutral seasonality factor before accessing DB', async () => {
  const response = mockResponse();
  await saveScoreWeights({
    input: {
      weights: DEFAULT_WEIGHTS,
      reason: 'Documented adjustment',
      expectedVersion: 0,
      seasonalityFactor: 0.8,
    },
    response,
  });
  assert.equal(response.code, 400);
  assert.match(response.body.error, /1,00/);
});

test('score save never writes a published vigilance config', async () => {
  const writes = [];
  let readVersion = 0;
  const db = {
    collection(name) {
      assert.ok(name.startsWith('adminWeightedScoreDraft'));
      return {doc(id) {
        return {
          path: name + '/' + id,
          get: async () => ({exists:true,data:()=>({version:readVersion})}),
        };
      }};
    },
    async runTransaction(fn) {
      const tx = {
        get: ref => ref.get(),
        set: (ref, value) => writes.push({ref:ref.path, value}),
      };
      return fn(tx);
    },
  };
  const response = mockResponse();
  await saveScoreWeights({
    input: {
      weights: DEFAULT_WEIGHTS,
      reason: 'Calibration still pending',
      expectedVersion: 0,
      seasonalityFactor: 1,
    },
    db, admin: {uid:'test-user'},
    response,
    FieldValue: {serverTimestamp: () => 'mock_timestamp'},
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.version, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes.map(row => row.ref).sort(),
    ['adminWeightedScoreDraft/current', 'adminWeightedScoreDraftHistory/national_000001']
  );
  assert.equal(writes[0].value.mode, 'simulation_only');
  assert.equal(writes[0].value.updatedBy, 'test-user');
  readVersion = 1;
  const conflict = mockResponse();
  await saveScoreWeights({
    input: {
      weights: DEFAULT_WEIGHTS,
      reason: 'Conflicting outdated config',
      expectedVersion: 0,
    },
    db, admin: {uid:'test-user'}, response: conflict,
    FieldValue: {serverTimestamp: () => 'mock_timestamp'},
  });
  assert.equal(conflict.code, 409);
  assert.equal(writes.length, 2);
});
