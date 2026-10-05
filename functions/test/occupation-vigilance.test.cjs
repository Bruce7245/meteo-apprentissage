const test = require('node:test');
const assert = require('node:assert/strict');

let vigilance = {};
try {
  vigilance = require('../lib/occupation-vigilance.cjs');
} catch {
  vigilance = {};
}

function validConfig(overrides = {}) {
  return {
    version: 'test-config.v1',
    status: 'validated',
    calculationVersion: 'occupationVigilance.v1',
    referencePopulation15To29: 100000,
    expectedOffersFloor: 0.5,
    minimumGreenActiveOffers: 3,
    baselines: {
      D1108: {
        expectedOffersAtReferencePopulation: 20,
      },
      M1607: {
        expectedOffersAtReferencePopulation: 10,
      },
    },
    factorBounds: {
      population: { min: 0.5, max: 2 },
      trainingPressure: { min: 1, max: 1.2 },
      diversityFragility: { min: 1, max: 1.15 },
      seasonality: { min: 0.8, max: 1.25 },
    },
    coefficients: {
      trainingPressurePerFormation: 0.02,
      lowDiversityConcentrationThreshold: 0.7,
      lowDiversityFactor: 1.1,
    },
    thresholds: {
      greenMinRatio: 0.9,
      yellowMinRatio: 0.65,
      orangeMinRatio: 0.4,
    },
    confidence: {
      highMin: 80,
      mediumMin: 60,
      penalties: {
        missingPopulation: 20,
        missingSeasonality: 10,
        missingDiversity: 10,
        missingTraining: 5,
      },
    },
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    departmentCode: '72',
    romeCode: 'D1108',
    romeKnown: true,
    activeOffersCount: 20,
    openingsCount: 25,
    population15To29: 100000,
    formationsCount: 0,
    employerConcentration: 0.4,
    seasonality: {
      status: 'active',
      factor: 1,
    },
    recentTrend: {
      status: 'stable',
      changeRatio: 0,
    },
    ...overrides,
  };
}

test('validateOccupationVigilanceConfig accepts a complete calibrated configuration', () => {
  assert.equal(typeof vigilance.validateOccupationVigilanceConfig, 'function');

  assert.deepEqual(
    vigilance.validateOccupationVigilanceConfig(validConfig()),
    {
      ok: true,
      errors: [],
    }
  );
});

test('validateOccupationVigilanceConfig rejects missing baselines and unordered thresholds', () => {
  const config = validConfig({
    baselines: {},
    thresholds: {
      greenMinRatio: 0.5,
      yellowMinRatio: 0.7,
      orangeMinRatio: 0.4,
    },
  });

  const result = vigilance.validateOccupationVigilanceConfig(config);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes('baselines')), true);
  assert.equal(result.errors.some((error) => error.includes('thresholds')), true);
});

test('computeExpectedOffers scales the ROME baseline by population and clamps extreme population factors', () => {
  assert.equal(typeof vigilance.computeExpectedOffers, 'function');

  const low = vigilance.computeExpectedOffers(
    baseInput({ population15To29: 10000 }),
    validConfig()
  );
  const high = vigilance.computeExpectedOffers(
    baseInput({ population15To29: 500000 }),
    validConfig()
  );

  assert.equal(low.factors.population, 0.5);
  assert.equal(low.expectedOffers, 10);

  assert.equal(high.factors.population, 2);
  assert.equal(high.expectedOffers, 40);
});

test('computeExpectedOffers uses neutral factors and confidence penalties when secondary data is missing', () => {
  const result = vigilance.computeExpectedOffers(
    baseInput({
      population15To29: null,
      formationsCount: null,
      employerConcentration: null,
      seasonality: {
        status: 'unavailable',
        factor: 1.8,
      },
    }),
    validConfig()
  );

  assert.deepEqual(result.factors, {
    population: 1,
    trainingPressure: 1,
    diversityFragility: 1,
    seasonality: 1,
  });
  assert.equal(result.expectedOffers, 20);
  assert.equal(result.confidencePenalty, 45);
});

test('computeExpectedOffers bounds training, diversity and seasonality factors', () => {
  const result = vigilance.computeExpectedOffers(
    baseInput({
      formationsCount: 100,
      employerConcentration: 0.95,
      seasonality: {
        status: 'active',
        factor: 4,
      },
    }),
    validConfig()
  );

  assert.deepEqual(result.factors, {
    population: 1,
    trainingPressure: 1.2,
    diversityFragility: 1.1,
    seasonality: 1.25,
  });
  assert.equal(result.expectedOffers, 33);
});

test('computeExpectedOffers applies the configured expected-offer floor', () => {
  const config = validConfig({
    baselines: {
      D1108: {
        expectedOffersAtReferencePopulation: 0.01,
      },
    },
    expectedOffersFloor: 0.5,
  });

  const result = vigilance.computeExpectedOffers(
    baseInput({ population15To29: 1000 }),
    config
  );

  assert.equal(result.expectedOffers, 0.5);
});

test('computeOccupationVigilance returns insufficient_data for invalid config, unknown ROME or missing primary offers', () => {
  assert.equal(typeof vigilance.computeOccupationVigilance, 'function');

  const invalidConfig = vigilance.computeOccupationVigilance(
    baseInput(),
    validConfig({ status: 'draft' })
  );
  assert.equal(invalidConfig.publishedLevel, 'insufficient_data');
  assert.deepEqual(invalidConfig.reasonCodes, ['CONFIG_INVALID']);

  const unknownRome = vigilance.computeOccupationVigilance(
    baseInput({ romeKnown: false }),
    validConfig()
  );
  assert.equal(unknownRome.publishedLevel, 'insufficient_data');
  assert.deepEqual(unknownRome.reasonCodes, ['ROME_UNKNOWN']);

  const missingOffers = vigilance.computeOccupationVigilance(
    baseInput({ activeOffersCount: null }),
    validConfig()
  );
  assert.equal(missingOffers.publishedLevel, 'insufficient_data');
  assert.deepEqual(missingOffers.reasonCodes, ['PRIMARY_OFFERS_MISSING']);
});

test('zero active offers can never produce green', () => {
  const result = vigilance.computeOccupationVigilance(
    baseInput({ activeOffersCount: 0 }),
    validConfig()
  );

  assert.notEqual(result.publishedLevel, 'green');
  assert.equal(result.publishedLevel, 'red');
  assert.equal(result.reasonCodes.includes('OFFERS_NONE'), true);
});

test('exact observed/expected thresholds map deterministically to green yellow orange red', () => {
  const config = validConfig();

  const green = vigilance.computeOccupationVigilance(
    baseInput({ activeOffersCount: 18 }),
    config
  );
  const yellow = vigilance.computeOccupationVigilance(
    baseInput({ activeOffersCount: 13 }),
    config
  );
  const orange = vigilance.computeOccupationVigilance(
    baseInput({ activeOffersCount: 8 }),
    config
  );
  const red = vigilance.computeOccupationVigilance(
    baseInput({ activeOffersCount: 7 }),
    config
  );

  assert.equal(green.observedVsExpectedRatio, 0.9);
  assert.equal(green.publishedLevel, 'green');

  assert.equal(yellow.observedVsExpectedRatio, 0.65);
  assert.equal(yellow.publishedLevel, 'yellow');

  assert.equal(orange.observedVsExpectedRatio, 0.4);
  assert.equal(orange.publishedLevel, 'orange');

  assert.equal(red.observedVsExpectedRatio, 0.35);
  assert.equal(red.publishedLevel, 'red');
});

test('degrading trend and concentrated employers add deterministic reason codes without deciding the level themselves', () => {
  const result = vigilance.computeOccupationVigilance(
    baseInput({
      activeOffersCount: 15,
      employerConcentration: 0.9,
      recentTrend: {
        status: 'degrading',
        changeRatio: -0.25,
      },
    }),
    validConfig()
  );

  assert.equal(result.reasonCodes.includes('EMPLOYER_DIVERSITY_LOW'), true);
  assert.equal(result.reasonCodes.includes('RECENT_TREND_DEGRADING'), true);

  for (const reason of result.reasonCodes) {
    assert.equal(vigilance.REASON_CODES.includes(reason), true, reason);
  }
});


test('a very low absolute offer volume cannot be green even when the ratio is favorable', () => {
  const result = vigilance.computeOccupationVigilance(
    baseInput({
      activeOffersCount: 2,
      population15To29: 100000,
    }),
    validConfig({
      minimumGreenActiveOffers: 3,
      baselines: {
        D1108: {
          expectedOffersAtReferencePopulation: 2,
        },
      },
    })
  );

  assert.equal(result.observedVsExpectedRatio, 1);
  assert.equal(result.publishedLevel, 'yellow');
  assert.equal(result.reasonCodes.includes('OFFERS_ABSOLUTE_VOLUME_LOW'), true);
});

test('minimumGreenActiveOffers must be a positive whole offer count', () => {
  assert.equal(
    vigilance.validateOccupationVigilanceConfig(
      validConfig({ minimumGreenActiveOffers: 2.5 })
    ).ok,
    false
  );
  assert.equal(
    vigilance.validateOccupationVigilanceConfig(
      validConfig({ minimumGreenActiveOffers: 0 })
    ).ok,
    false
  );
});
