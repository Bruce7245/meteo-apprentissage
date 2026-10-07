const test = require('node:test');
const assert = require('node:assert/strict');

let vigilance = {};
try {
  vigilance = require('../lib/occupation-domain-vigilance.cjs');
} catch {
  vigilance = {};
}

function validConfig(overrides = {}) {
  return {
    version: 'occupationDomainVigilance.v1.cal.test',
    status: 'validated',
    calculationVersion: 'occupationDomainVigilance.v1',
    referencePopulation15To29: 100000,
    expectedOffersFloor: 0.5,
    minimumGreenActiveOffers: 3,
    baselines: {
      G12: {
        expectedOffersAtReferencePopulation: 20,
      },
      D11: {
        expectedOffersAtReferencePopulation: 10,
      },
    },
    factorBounds: {
      population: { min: 0.5, max: 2 },
      diversityFragility: { min: 1, max: 1.15 },
      seasonality: { min: 0.8, max: 1.25 },
    },
    coefficients: {
      lowDiversityConcentrationThreshold: 0.7,
      lowDiversityFactor: 1.1,
    },
    thresholds: {
      greenMinRatio: 0.9,
      yellowMinRatio: 0.65,
      orangeMinRatio: 0.4,
    },
    confidence: {
      highMin: 67,
      mediumMin: 34,
      penalties: {
        missingPopulation: 34,
        missingSeasonality: 33,
        missingDiversity: 33,
      },
    },
    calibration: {
      windowStart: '2026-10-05',
      windowEnd: '2026-10-06',
      inputSamplesCount: 100,
      validSamplesCount: 100,
      invalidSamplesCount: 0,
      domainCount: 2,
      minimumSamplesPerDomain: 24,
      minimumTotalSamples: 100,
      ratioQuantiles: {
        q25: 0.4,
        q50: 0.65,
        q75: 0.9,
      },
      domainSampleCounts: {
        G12: 50,
        D11: 50,
      },
      excludedDates: ['2026-10-04'],
    },
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    departmentCode: '72',
    domainCode: 'G12',
    domainKnown: true,
    activeOffersCount: 20,
    openingsCount: 25,
    population15To29: 100000,
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

test('validateOccupationDomainVigilanceConfig accepts a complete validated config', () => {
  assert.equal(
    typeof vigilance.validateOccupationDomainVigilanceConfig,
    'function'
  );

  assert.deepEqual(
    vigilance.validateOccupationDomainVigilanceConfig(
      validConfig()
    ),
    {
      ok: true,
      errors: [],
    }
  );
});

test('computeOccupationDomainVigilance returns insufficient_data for draft config, unknown domain and missing baseline', () => {
  assert.equal(
    typeof vigilance.computeOccupationDomainVigilance,
    'function'
  );

  const draft = vigilance.computeOccupationDomainVigilance(
    baseInput(),
    validConfig({ status: 'draft' })
  );
  assert.equal(draft.publishedLevel, 'insufficient_data');
  assert.deepEqual(draft.reasonCodes, ['CONFIG_INVALID']);

  const unknown = vigilance.computeOccupationDomainVigilance(
    baseInput({ domainKnown: false }),
    validConfig()
  );
  assert.equal(unknown.publishedLevel, 'insufficient_data');
  assert.deepEqual(unknown.reasonCodes, ['DOMAIN_UNKNOWN']);

  const missingBaseline = vigilance.computeOccupationDomainVigilance(
    baseInput({ domainCode: 'M18' }),
    validConfig()
  );
  assert.equal(missingBaseline.publishedLevel, 'insufficient_data');
  assert.deepEqual(
    missingBaseline.reasonCodes,
    ['DOMAIN_BASELINE_MISSING']
  );
});

test('zero active offers is deterministically red when a domain baseline exists', () => {
  const result = vigilance.computeOccupationDomainVigilance(
    baseInput({ activeOffersCount: 0 }),
    validConfig()
  );

  assert.equal(result.publishedLevel, 'red');
  assert.equal(result.reasonCodes.includes('OFFERS_NONE'), true);
  assert.equal(result.observedVsExpectedRatio, 0);
});

test('exact sector observed/expected thresholds map to green yellow orange red', () => {
  const config = validConfig();

  const green = vigilance.computeOccupationDomainVigilance(
    baseInput({ activeOffersCount: 18 }),
    config
  );
  const yellow = vigilance.computeOccupationDomainVigilance(
    baseInput({ activeOffersCount: 13 }),
    config
  );
  const orange = vigilance.computeOccupationDomainVigilance(
    baseInput({ activeOffersCount: 8 }),
    config
  );
  const red = vigilance.computeOccupationDomainVigilance(
    baseInput({ activeOffersCount: 7 }),
    config
  );

  assert.equal(green.publishedLevel, 'green');
  assert.equal(yellow.publishedLevel, 'yellow');
  assert.equal(orange.publishedLevel, 'orange');
  assert.equal(red.publishedLevel, 'red');
});

test('missing secondary signals use neutral factors and lower confidence', () => {
  const result = vigilance.computeOccupationDomainVigilance(
    baseInput({
      population15To29: null,
      employerConcentration: null,
      seasonality: {
        status: 'unavailable',
        factor: null,
      },
    }),
    validConfig()
  );

  assert.deepEqual(result.factors, {
    population: 1,
    diversityFragility: 1,
    seasonality: 1,
  });
  assert.equal(result.confidenceLevel, 'low');
  assert.equal(
    result.reasonCodes.includes('POPULATION_CONTEXT_MISSING'),
    true
  );
  assert.equal(
    result.reasonCodes.includes('SEASONALITY_UNAVAILABLE'),
    true
  );
});

test('low absolute sector offer volume cannot be green even with a favorable ratio', () => {
  const result = vigilance.computeOccupationDomainVigilance(
    baseInput({
      activeOffersCount: 2,
    }),
    validConfig({
      minimumGreenActiveOffers: 3,
      baselines: {
        G12: {
          expectedOffersAtReferencePopulation: 2,
        },
      },
    })
  );

  assert.equal(result.observedVsExpectedRatio, 1);
  assert.equal(result.publishedLevel, 'yellow');
  assert.equal(
    result.reasonCodes.includes('OFFERS_ABSOLUTE_VOLUME_LOW'),
    true
  );
});
