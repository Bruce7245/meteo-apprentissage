const test = require('node:test');
const assert = require('node:assert/strict');

let vigilance = {};
try {
  vigilance = require('../lib/occupation-vigilance.cjs');
} catch {
  vigilance = {};
}

function config(overrides = {}) {
  return {
    status: 'validated',
    configVersion: 'occupationVigilance.v1-test',
    calculationVersion: 'occupationVigilance.engine.v1',
    minimumExpectedOffers: 1,
    minimumGreenActiveOffers: 3,
    thresholds: {
      greenMinRatio: 0.9,
      yellowMinRatio: 0.65,
      orangeMinRatio: 0.4,
    },
    factorBounds: {
      population: { min: 0.5, max: 1.8 },
      employer: { min: 0.7, max: 1.4 },
      training: { min: 0.8, max: 1.3 },
      seasonality: { min: 0.8, max: 1.2 },
    },
    factorWeights: {
      population: 1,
      employer: 0.4,
      training: 0.25,
    },
    seasonality: {
      minimumActiveMonths: 24,
      completenessThreshold: 0.9,
    },
    confidence: {
      highMin: 0.8,
      mediumMin: 0.55,
      penalties: {
        missingPopulation: 0.2,
        missingEmployer: 0.15,
        lowEmployerCoverage: 0.15,
        missingTraining: 0.1,
        missingSeasonality: 0.05,
      },
      minimumEmployerCoverage: 0.6,
      highConcentrationThreshold: 0.7,
    },
    romeBaselines: {
      D1401: {
        baseExpectedOffers: 10,
        referencePopulation15To29: 100000,
        referenceObservedEmployers: 8,
        referenceUpcomingSessions: 4,
      },
    },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    departmentCode: '72',
    romeCode: 'D1401',
    primaryDataStatus: 'available',
    activeOffersCount: 10,
    openingsCount: 12,
    population15To29: 100000,
    distinctObservedEmployersCount: 8,
    knownEmployerOfferCoverage: 1,
    employerConcentration: 0.25,
    formationsCount: 2,
    upcomingSessionsCount: 4,
    seasonalityStatus: 'active',
    seasonalityFactor: 1,
    recentTrend: { status: 'stable', changeRatio: 0 },
    ...overrides,
  };
}

test('validateOccupationVigilanceConfig accepts a coherent validated config', () => {
  assert.equal(typeof vigilance.validateOccupationVigilanceConfig, 'function');
  assert.deepEqual(vigilance.validateOccupationVigilanceConfig(config()), {
    ok: true,
    errors: [],
  });
});

test('validateOccupationVigilanceConfig rejects incoherent thresholds and bounds', () => {
  const invalid = config({
    thresholds: { greenMinRatio: 0.5, yellowMinRatio: 0.7, orangeMinRatio: 0.4 },
    factorBounds: {
      ...config().factorBounds,
      seasonality: { min: 1.3, max: 0.8 },
    },
  });
  const result = vigilance.validateOccupationVigilanceConfig(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => /threshold/i.test(message)));
  assert.ok(result.errors.some((message) => /seasonality/i.test(message)));
});

test('computeExpectedOffers uses contextual factors but clamps them to config bounds', () => {
  assert.equal(typeof vigilance.computeExpectedOffers, 'function');
  const result = vigilance.computeExpectedOffers(input({
    population15To29: 1000000,
    distinctObservedEmployersCount: 100,
    upcomingSessionsCount: 100,
    seasonalityFactor: 5,
  }), config());

  assert.deepEqual(result.factors, {
    population: 1.8,
    employer: 1.4,
    training: 1.3,
    seasonality: 1.2,
  });
  assert.equal(result.expectedOffers, 39.312);
});

test('missing secondary factors are neutral and reduce confidence instead of forcing data insufficiency', () => {
  const result = vigilance.computeOccupationVigilance(input({
    population15To29: null,
    distinctObservedEmployersCount: null,
    knownEmployerOfferCoverage: null,
    formationsCount: null,
    upcomingSessionsCount: null,
    seasonalityStatus: 'unavailable',
    seasonalityFactor: null,
  }), config());

  assert.notEqual(result.publishedLevel, 'insufficient_data');
  assert.equal(result.factors.population, 1);
  assert.equal(result.factors.employer, 1);
  assert.equal(result.factors.training, 1);
  assert.equal(result.factors.seasonality, 1);
  assert.equal(result.confidenceLevel, 'low');
  assert.ok(result.reasonCodes.includes('POPULATION_DATA_MISSING'));
  assert.ok(result.reasonCodes.includes('SEASONALITY_UNAVAILABLE'));
});

test('zero active offers can never produce green', () => {
  const result = vigilance.computeOccupationVigilance(input({ activeOffersCount: 0 }), config({
    minimumExpectedOffers: 0.01,
    romeBaselines: {
      D1401: {
        baseExpectedOffers: 0.01,
        referencePopulation15To29: 100000,
        referenceObservedEmployers: 8,
        referenceUpcomingSessions: 4,
      },
    },
  }));

  assert.notEqual(result.publishedLevel, 'green');
  assert.ok(result.reasonCodes.includes('OFFERS_ZERO'));
});

test('threshold boundaries map exactly to green yellow orange and red', () => {
  const c = config();
  assert.equal(vigilance.computeOccupationVigilance(input({ activeOffersCount: 9 }), c).publishedLevel, 'green');
  assert.equal(vigilance.computeOccupationVigilance(input({ activeOffersCount: 6.5 }), c).publishedLevel, 'yellow');
  assert.equal(vigilance.computeOccupationVigilance(input({ activeOffersCount: 4 }), c).publishedLevel, 'orange');
  assert.equal(vigilance.computeOccupationVigilance(input({ activeOffersCount: 3.99 }), c).publishedLevel, 'red');
});

test('missing primary offer signal produces insufficient_data', () => {
  const result = vigilance.computeOccupationVigilance(input({
    primaryDataStatus: 'missing',
    activeOffersCount: null,
  }), config());
  assert.equal(result.publishedLevel, 'insufficient_data');
  assert.ok(result.reasonCodes.includes('PRIMARY_OFFER_DATA_MISSING'));
});

test('unknown ROME baseline produces insufficient_data', () => {
  const result = vigilance.computeOccupationVigilance(input({ romeCode: 'M1607' }), config());
  assert.equal(result.publishedLevel, 'insufficient_data');
  assert.ok(result.reasonCodes.includes('ROME_BASELINE_MISSING'));
});

test('draft or invalid configs cannot produce publishable vigilance', () => {
  const draft = vigilance.computeOccupationVigilance(input(), config({ status: 'draft' }));
  assert.equal(draft.publishedLevel, 'insufficient_data');
  assert.ok(draft.reasonCodes.includes('CONFIG_NOT_VALIDATED'));

  const invalid = vigilance.computeOccupationVigilance(input(), config({ minimumExpectedOffers: 0 }));
  assert.equal(invalid.publishedLevel, 'insufficient_data');
  assert.ok(invalid.reasonCodes.includes('CONFIG_INVALID'));
});

test('high employer concentration lowers confidence without changing the observed offer count', () => {
  const normal = vigilance.computeOccupationVigilance(input(), config());
  const concentrated = vigilance.computeOccupationVigilance(input({ employerConcentration: 0.9 }), config());
  assert.equal(concentrated.activeOffersCount, normal.activeOffersCount);
  assert.ok(concentrated.confidenceScore < normal.confidenceScore);
  assert.ok(concentrated.reasonCodes.includes('EMPLOYER_DIVERSITY_LOW'));
});

test('decreasing recent trend is exposed as a deterministic reason but does not directly rewrite the ratio', () => {
  const stable = vigilance.computeOccupationVigilance(input(), config());
  const decreasing = vigilance.computeOccupationVigilance(input({
    recentTrend: { status: 'decreasing', changeRatio: -0.4 },
  }), config());
  assert.equal(decreasing.observedVsExpectedRatio, stable.observedVsExpectedRatio);
  assert.ok(decreasing.reasonCodes.includes('RECENT_TREND_DECREASING'));
});

test('zero calibrated employer or training reference keeps the contextual factor neutral', () => {
  const c = config({
    romeBaselines: {
      D1401: {
        baseExpectedOffers: 10,
        referencePopulation15To29: 100000,
        referenceObservedEmployers: 0,
        referenceUpcomingSessions: 0,
      },
    },
  });
  assert.equal(vigilance.validateOccupationVigilanceConfig(c).ok, true);
  const result = vigilance.computeExpectedOffers(input({
    distinctObservedEmployersCount: 25,
    upcomingSessionsCount: 12,
  }), c);
  assert.equal(result.factors.employer, 1);
  assert.equal(result.factors.training, 1);
});

test('a very low absolute offer volume cannot become green even when the contextual ratio is favorable', () => {
  const c = config({
    minimumGreenActiveOffers: 3,
    romeBaselines: {
      D1401: {
        baseExpectedOffers: 2,
        referencePopulation15To29: 100000,
        referenceObservedEmployers: 8,
        referenceUpcomingSessions: 4,
      },
    },
  });
  const result = vigilance.computeOccupationVigilance(input({ activeOffersCount: 2 }), c);
  assert.equal(result.observedVsExpectedRatio, 1);
  assert.equal(result.publishedLevel, 'yellow');
  assert.ok(result.reasonCodes.includes('OFFERS_ABSOLUTE_VOLUME_LOW'));
});

test('config validation rejects seasonality activation below 24 months or invalid completeness', () => {
  const tooShort = config({ seasonality: { minimumActiveMonths: 12, completenessThreshold: 0.9 } });
  assert.equal(vigilance.validateOccupationVigilanceConfig(tooShort).ok, false);
  const invalidCompleteness = config({ seasonality: { minimumActiveMonths: 24, completenessThreshold: 1.2 } });
  assert.equal(vigilance.validateOccupationVigilanceConfig(invalidCompleteness).ok, false);
});

test('minimumGreenActiveOffers must be a positive whole offer count', () => {
  assert.equal(vigilance.validateOccupationVigilanceConfig(config({ minimumGreenActiveOffers: 2.5 })).ok, false);
  assert.equal(vigilance.validateOccupationVigilanceConfig(config({ minimumGreenActiveOffers: 0 })).ok, false);
});
