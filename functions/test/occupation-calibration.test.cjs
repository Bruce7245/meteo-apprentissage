const test = require('node:test');
const assert = require('node:assert/strict');

let calibration = {};
try {
  calibration = require('../lib/occupation-calibration.cjs');
} catch {
  calibration = {};
}

test('median and quantile are deterministic with linear interpolation', () => {
  assert.equal(typeof calibration.median, 'function');
  assert.equal(typeof calibration.quantile, 'function');

  assert.equal(calibration.median([4, 1, 3, 2]), 2.5);
  assert.equal(calibration.quantile([0, 10, 20, 30], 0.25), 7.5);
  assert.equal(calibration.quantile([0, 10, 20, 30], 0.5), 15);
});

test('buildCalibration derives reference population and per-ROME offer baselines from history', () => {
  assert.equal(typeof calibration.buildCalibration, 'function');

  const history = [];

  for (const [romeCode, offers] of [
    ['D1108', [8, 12, 16, 20, 24, 28]],
    ['M1607', [4, 6, 8, 10, 12, 14]],
  ]) {
    offers.forEach((activeOffersCount, index) => {
      history.push({
        date: `2026-0${index + 1}-01`,
        departmentCode: index % 2 === 0 ? '72' : '44',
        romeCode,
        activeOffersCount,
        population15To29: 100000,
        formationsCount: index,
        employerConcentration: 0.3 + index * 0.1,
      });
    });
  }

  const result = calibration.buildCalibration(history, {
    minimumSamplesPerRome: 6,
    minimumTotalSamples: 12,
  });

  assert.equal(result.eligibleForValidation, true);
  assert.deepEqual(result.validationBlockers, []);
  assert.equal(result.config.status, 'draft');
  assert.equal(result.config.referencePopulation15To29, 100000);
  assert.equal(
    result.config.baselines.D1108.expectedOffersAtReferencePopulation,
    18
  );
  assert.equal(
    result.config.baselines.M1607.expectedOffersAtReferencePopulation,
    9
  );
  assert.equal(
    result.config.factorBounds.trainingPressure.min,
    1
  );
  assert.equal(
    result.config.factorBounds.trainingPressure.max,
    1
  );
  assert.equal(
    result.config.coefficients.trainingPressurePerFormation,
    0
  );
  assert.equal(
    result.config.factorBounds.diversityFragility.min,
    1
  );
  assert.equal(
    result.config.factorBounds.diversityFragility.max,
    1
  );

  assert.equal(
    result.config.thresholds.greenMinRatio >
      result.config.thresholds.yellowMinRatio,
    true
  );
  assert.equal(
    result.config.thresholds.yellowMinRatio >
      result.config.thresholds.orangeMinRatio,
    true
  );
});

test('buildCalibration refuses sparse history instead of fabricating a production config', () => {
  const result = calibration.buildCalibration([
    {
      date: '2026-10-01',
      departmentCode: '72',
      romeCode: 'D1108',
      activeOffersCount: 10,
      population15To29: 100000,
    },
    {
      date: '2026-10-02',
      departmentCode: '72',
      romeCode: 'D1108',
      activeOffersCount: 12,
      population15To29: 100000,
    },
  ], {
    minimumSamplesPerRome: 6,
    minimumTotalSamples: 12,
  });

  assert.equal(result.eligibleForValidation, false);
  assert.equal(result.config, null);
  assert.equal(
    result.validationBlockers.some((item) => item.includes('TOTAL_SAMPLE_COUNT')),
    true
  );
  assert.equal(
    result.validationBlockers.some((item) => item.includes('ROME_SAMPLE_COUNT:D1108')),
    true
  );
});

test('buildCalibration refuses a ratio distribution with insufficient separation', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    date: `2026-${String((index % 9) + 1).padStart(2, '0')}-01`,
    departmentCode: index % 2 === 0 ? '72' : '44',
    romeCode: index < 6 ? 'D1108' : 'M1607',
    activeOffersCount: index < 6 ? 10 : 5,
    population15To29: 100000,
  }));

  const result = calibration.buildCalibration(history, {
    minimumSamplesPerRome: 6,
    minimumTotalSamples: 12,
  });

  assert.equal(result.eligibleForValidation, false);
  assert.equal(result.config, null);
  assert.equal(
    result.validationBlockers.includes('RATIO_DISTRIBUTION_NOT_SEPARATED'),
    true
  );
});

test('markCalibrationValidated requires an eligible draft and performs the explicit state change', () => {
  assert.equal(typeof calibration.markCalibrationValidated, 'function');

  assert.throws(
    () => calibration.markCalibrationValidated({
      eligibleForValidation: false,
      config: null,
    }),
    /Calibration is not eligible/
  );

  const history = [];
  for (const [romeCode, offers] of [
    ['D1108', [8, 12, 16, 20, 24, 28]],
    ['M1607', [4, 6, 8, 10, 12, 14]],
  ]) {
    offers.forEach((activeOffersCount, index) => {
      history.push({
        date: `2026-0${index + 1}-01`,
        departmentCode: index % 2 === 0 ? '72' : '44',
        romeCode,
        activeOffersCount,
        population15To29: 100000,
      });
    });
  }

  const draft = calibration.buildCalibration(history, {
    minimumSamplesPerRome: 6,
    minimumTotalSamples: 12,
  });

  const validated = calibration.markCalibrationValidated(draft);

  assert.equal(draft.config.status, 'draft');
  assert.equal(validated.status, 'validated');
  assert.equal(validated.version, draft.config.version);
});


test('calibration output stays compatible with the versioned config schema surface', () => {
  const schema = require('../config/occupation-vigilance.v1.schema.json');
  const history = [];

  for (const [romeCode, offers] of [
    ['D1108', [8, 12, 16, 20, 24, 28]],
    ['M1607', [4, 6, 8, 10, 12, 14]],
  ]) {
    offers.forEach((activeOffersCount, index) => {
      history.push({
        date: `2026-0${index + 1}-01`,
        departmentCode: index % 2 === 0 ? '72' : '44',
        romeCode,
        activeOffersCount,
        population15To29: 100000,
      });
    });
  }

  const result = calibration.buildCalibration(history, {
    minimumSamplesPerRome: 6,
    minimumTotalSamples: 12,
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(schema.properties, 'calibration'),
    true
  );

  for (const baseline of Object.values(result.config.baselines)) {
    assert.deepEqual(
      Object.keys(baseline).sort(),
      ['expectedOffersAtReferencePopulation']
    );
  }
});


test('calibration derives the absolute green offer floor from observed positive volumes', () => {
  const history = [];

  for (const [romeCode, offers] of [
    ['D1108', [2, 4, 6, 8, 10, 12]],
    ['M1607', [1, 3, 5, 7, 9, 11]],
  ]) {
    offers.forEach((activeOffersCount, index) => {
      history.push({
        date: `2026-0${index + 1}-01`,
        departmentCode: index % 2 === 0 ? '72' : '44',
        romeCode,
        activeOffersCount,
        population15To29: 100000,
      });
    });
  }

  const result = calibration.buildCalibration(history, {
    minimumSamplesPerRome: 6,
    minimumTotalSamples: 12,
  });

  assert.equal(result.eligibleForValidation, true);
  assert.equal(Number.isInteger(result.config.minimumGreenActiveOffers), true);
  assert.equal(result.config.minimumGreenActiveOffers >= 1, true);
  assert.equal(result.config.minimumGreenActiveOffers, 4);
});


test('buildCalibration excludes sparse ROME instead of blocking eligible national baselines', () => {
  const history = [];

  [2, 4, 6, 8, 10, 12, 14, 16].forEach((activeOffersCount, index) => {
    history.push({
      date: '2026-10-06',
      departmentCode: String(index + 1).padStart(2, '0'),
      romeCode: 'D1108',
      activeOffersCount,
      population15To29: 100000,
    });
  });

  [1, 2].forEach((activeOffersCount, index) => {
    history.push({
      date: '2026-10-06',
      departmentCode: String(index + 20),
      romeCode: 'M1607',
      activeOffersCount,
      population15To29: 100000,
    });
  });

  const result = calibration.buildCalibration(history, {
    minimumSamplesPerRome: 4,
    minimumTotalSamples: 8,
  });

  assert.equal(result.eligibleForValidation, true);
  assert.ok(result.config.baselines.D1108);
  assert.equal(result.config.baselines.M1607, undefined);
  assert.deepEqual(result.diagnostics.excludedRomeCodes.M1607, {
    reason: 'INSUFFICIENT_SAMPLES',
    samplesCount: 2,
  });
});

test('buildCalibration excludes a ROME with a non-positive baseline instead of blocking eligible ROME', () => {
  const history = [];

  [2, 4, 6, 8, 10, 12, 14, 16].forEach((activeOffersCount, index) => {
    history.push({
      date: '2026-10-06',
      departmentCode: String(index + 1).padStart(2, '0'),
      romeCode: 'D1108',
      activeOffersCount,
      population15To29: 100000,
    });
  });

  [0, 0, 0, 0].forEach((activeOffersCount, index) => {
    history.push({
      date: '2026-10-06',
      departmentCode: String(index + 30),
      romeCode: 'M1607',
      activeOffersCount,
      population15To29: 100000,
    });
  });

  const result = calibration.buildCalibration(history, {
    minimumSamplesPerRome: 4,
    minimumTotalSamples: 8,
  });

  assert.equal(result.eligibleForValidation, true);
  assert.ok(result.config.baselines.D1108);
  assert.equal(result.config.baselines.M1607, undefined);
  assert.deepEqual(result.diagnostics.excludedRomeCodes.M1607, {
    reason: 'NON_POSITIVE_BASELINE',
    samplesCount: 4,
  });
});
