const test = require('node:test');
const assert = require('node:assert/strict');

let calibration = {};
try {
  calibration = require('../lib/occupation-calibration.cjs');
} catch {
  calibration = {};
}

function sample({
  romeCode = 'D1401',
  date,
  offers,
  population = 100000,
  employers = 8,
  sessions = 4,
}) {
  return {
    romeCode,
    date,
    activeOffersCount: offers,
    population15To29: population,
    distinctObservedEmployersCount: employers,
    upcomingSessionsCount: sessions,
  };
}

test('buildCalibration derives deterministic medians and ratio quantiles', () => {
  assert.equal(typeof calibration.buildCalibration, 'function');
  const result = calibration.buildCalibration([
    sample({ date: '2026-01-01', offers: 4, population: 80000, employers: 4, sessions: 0 }),
    sample({ date: '2026-02-01', offers: 8, population: 90000, employers: 6, sessions: 2 }),
    sample({ date: '2026-03-01', offers: 10, population: 100000, employers: 8, sessions: 4 }),
    sample({ date: '2026-04-01', offers: 12, population: 110000, employers: 10, sessions: 6 }),
    sample({ date: '2026-05-01', offers: 16, population: 120000, employers: 12, sessions: 8 }),
  ], {
    minimumSamplesPerRome: 5,
    minimumCalibratedRomeCodes: 1,
  });

  assert.equal(result.status, 'draft');
  assert.equal(result.canValidate, true);
  assert.deepEqual(result.romeBaselines.D1401, {
    baseExpectedOffers: 10,
    referencePopulation15To29: 100000,
    referenceObservedEmployers: 8,
    referenceUpcomingSessions: 4,
    sampleCount: 5,
  });
  assert.deepEqual(result.ratioQuantiles, {
    p10: 0.4,
    p25: 0.8,
    p50: 1,
    p75: 1.2,
    p90: 1.6,
  });
  assert.deepEqual(result.activeOfferQuantiles, {
    p10: 4,
    p25: 8,
    p50: 10,
    p75: 12,
    p90: 16,
  });
});

test('buildCalibration excludes sparse ROME histories and refuses validation when coverage is too small', () => {
  const result = calibration.buildCalibration([
    sample({ romeCode: 'D1401', date: '2026-01-01', offers: 10 }),
    sample({ romeCode: 'D1401', date: '2026-02-01', offers: 12 }),
    sample({ romeCode: 'M1607', date: '2026-01-01', offers: 4 }),
  ], {
    minimumSamplesPerRome: 3,
    minimumCalibratedRomeCodes: 1,
  });

  assert.equal(result.canValidate, false);
  assert.deepEqual(result.excludedRomeCodes.sort(), ['D1401', 'M1607']);
  assert.deepEqual(result.romeBaselines, {});
});

test('buildCalibration ignores invalid observations instead of coercing them to zero', () => {
  const result = calibration.buildCalibration([
    sample({ date: '2026-01-01', offers: 10 }),
    sample({ date: '2026-02-01', offers: 'bad' }),
    sample({ date: '2026-03-01', offers: 12 }),
  ], {
    minimumSamplesPerRome: 2,
    minimumCalibratedRomeCodes: 1,
  });

  assert.equal(result.romeBaselines.D1401.sampleCount, 2);
  assert.equal(result.invalidObservationCount, 1);
});

test('buildValidatedVigilanceConfig requires an explicit reviewed policy and rejects sparse calibration', () => {
  assert.equal(typeof calibration.buildValidatedVigilanceConfig, 'function');

  const sparse = calibration.buildCalibration([
    sample({ date: '2026-01-01', offers: 10 }),
  ], {
    minimumSamplesPerRome: 2,
    minimumCalibratedRomeCodes: 1,
  });
  assert.throws(
    () => calibration.buildValidatedVigilanceConfig(sparse, {}),
    /cannot be validated/i
  );
});

test('buildValidatedVigilanceConfig produces a validated engine config only from explicit policy values', () => {
  const draft = calibration.buildCalibration([
    sample({ date: '2026-01-01', offers: 8 }),
    sample({ date: '2026-02-01', offers: 10 }),
    sample({ date: '2026-03-01', offers: 12 }),
  ], {
    minimumSamplesPerRome: 3,
    minimumCalibratedRomeCodes: 1,
  });

  const validated = calibration.buildValidatedVigilanceConfig(draft, {
    configVersion: 'occupationVigilance.v1',
    minimumExpectedOffers: 1,
    minimumGreenActiveOffers: 3,
    thresholds: { greenMinRatio: 0.9, yellowMinRatio: 0.65, orangeMinRatio: 0.4 },
    factorBounds: {
      population: { min: 0.5, max: 1.8 },
      employer: { min: 0.7, max: 1.4 },
      training: { min: 0.8, max: 1.3 },
      seasonality: { min: 0.8, max: 1.2 },
    },
    factorWeights: { population: 1, employer: 0.4, training: 0.25 },
    seasonality: { minimumActiveMonths: 24, completenessThreshold: 0.9 },
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
  });

  assert.equal(validated.status, 'validated');
  assert.equal(validated.configVersion, 'occupationVigilance.v1');
  assert.equal(validated.calculationVersion, 'occupationVigilance.engine.v1');
  assert.deepEqual(validated.romeBaselines, draft.romeBaselines);
  assert.equal(validated.calibrationId, draft.calibrationId);
});

test('buildCalibration excludes observations explicitly marked as missing primary offer data', () => {
  const rows = [
    { ...sample({ date: '2026-01-01', offers: 0 }), primaryOfferDataStatus: 'missing' },
    { ...sample({ date: '2026-02-01', offers: 10 }), primaryOfferDataStatus: 'available' },
    { ...sample({ date: '2026-03-01', offers: 12 }), primaryOfferDataStatus: 'available' },
  ];
  const result = calibration.buildCalibration(rows, {
    minimumSamplesPerRome: 2,
    minimumCalibratedRomeCodes: 1,
  });
  assert.equal(result.romeBaselines.D1401.sampleCount, 2);
  assert.equal(result.invalidObservationCount, 1);
});
