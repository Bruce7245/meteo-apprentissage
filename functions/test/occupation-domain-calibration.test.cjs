const test = require('node:test');
const assert = require('node:assert/strict');

let calibration = {};
try {
  calibration = require('../lib/occupation-domain-calibration.cjs');
} catch {
  calibration = {};
}

function historyFor(domainCode, values, date = '2026-10-06') {
  return values.map((activeOffersCount, index) => ({
    date,
    departmentCode: String(index + 1).padStart(2, '0'),
    domainCode,
    activeOffersCount,
    population15To29: 100000,
    employerConcentration: 0.25 + index * 0.02,
  }));
}

test('buildDomainCalibration derives independent per-domain baselines', () => {
  assert.equal(
    typeof calibration.buildDomainCalibration,
    'function'
  );

  const history = [
    ...historyFor('D11', [8, 12, 16, 20, 24, 28]),
    ...historyFor('G12', [4, 6, 8, 10, 12, 14]),
  ];

  const result = calibration.buildDomainCalibration(history, {
    minimumSamplesPerDomain: 6,
    minimumTotalSamples: 12,
  });

  assert.equal(result.eligibleForValidation, true);
  assert.equal(result.config.status, 'draft');
  assert.equal(
    result.config.calculationVersion,
    'occupationDomainVigilance.v1'
  );
  assert.equal(
    result.config.baselines.D11
      .expectedOffersAtReferencePopulation,
    18
  );
  assert.equal(
    result.config.baselines.G12
      .expectedOffersAtReferencePopulation,
    9
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

test('buildDomainCalibration excludes sparse domains instead of blocking eligible domains', () => {
  const history = [
    ...historyFor('G12', [2, 4, 6, 8, 10, 12, 14, 16]),
    ...historyFor('D11', [1, 2]),
  ];

  const result = calibration.buildDomainCalibration(history, {
    minimumSamplesPerDomain: 4,
    minimumTotalSamples: 8,
  });

  assert.equal(result.eligibleForValidation, true);
  assert.ok(result.config.baselines.G12);
  assert.equal(result.config.baselines.D11, undefined);
  assert.deepEqual(result.diagnostics.excludedDomainCodes.D11, {
    reason: 'INSUFFICIENT_SAMPLES',
    samplesCount: 2,
  });
});

test('buildDomainCalibration excludes a non-positive domain baseline', () => {
  const history = [
    ...historyFor('G12', [2, 4, 6, 8, 10, 12, 14, 16]),
    ...historyFor('D11', [0, 0, 0, 0]),
  ];

  const result = calibration.buildDomainCalibration(history, {
    minimumSamplesPerDomain: 4,
    minimumTotalSamples: 8,
  });

  assert.equal(result.eligibleForValidation, true);
  assert.ok(result.config.baselines.G12);
  assert.equal(result.config.baselines.D11, undefined);
  assert.deepEqual(result.diagnostics.excludedDomainCodes.D11, {
    reason: 'NON_POSITIVE_BASELINE',
    samplesCount: 4,
  });
});

test('buildDomainCalibration keeps zero-offer samples out of ratio quantiles', () => {
  const result = calibration.buildDomainCalibration(
    historyFor('G12', [0, 0, 0, 0, 2, 4, 8, 16]),
    {
      minimumSamplesPerDomain: 8,
      minimumTotalSamples: 8,
    }
  );

  assert.equal(result.eligibleForValidation, true);
  assert.ok(result.config.thresholds.orangeMinRatio > 0);
  assert.ok(
    result.config.thresholds.greenMinRatio >
      result.config.thresholds.yellowMinRatio
  );
});

test('buildDomainCalibration can explicitly exclude quarantined dates from its window', () => {
  const result = calibration.buildDomainCalibration(
    [
      ...historyFor('G12', [100, 100, 100, 100], '2026-10-04'),
      ...historyFor('G12', [2, 4, 8, 16], '2026-10-05'),
      ...historyFor('G12', [3, 6, 9, 18], '2026-10-06'),
    ],
    {
      minimumSamplesPerDomain: 4,
      minimumTotalSamples: 8,
      excludedDates: ['2026-10-04'],
    }
  );

  assert.equal(result.eligibleForValidation, true);
  assert.equal(result.config.calibration.windowStart, '2026-10-05');
  assert.equal(result.config.calibration.windowEnd, '2026-10-06');
  assert.equal(
    result.diagnostics.excludedDates.includes('2026-10-04'),
    true
  );
  assert.equal(result.config.calibration.inputSamplesCount, 8);
});

test('buildDomainCalibration produces a deterministic version for the same samples', () => {
  const history = [
    ...historyFor('D11', [8, 12, 16, 20, 24, 28]),
    ...historyFor('G12', [4, 6, 8, 10, 12, 14]),
  ];

  const options = {
    minimumSamplesPerDomain: 6,
    minimumTotalSamples: 12,
  };

  const first = calibration.buildDomainCalibration(history, options);
  const second = calibration.buildDomainCalibration(
    [...history].reverse(),
    options
  );

  assert.equal(first.config.version, second.config.version);
  assert.match(
    first.config.version,
    /^occupationDomainVigilance\.v1\.cal\.[a-f0-9]{12}$/
  );
});

test('markDomainCalibrationValidated requires an eligible draft', () => {
  assert.equal(
    typeof calibration.markDomainCalibrationValidated,
    'function'
  );

  assert.throws(
    () =>
      calibration.markDomainCalibrationValidated({
        eligibleForValidation: false,
        config: null,
      }),
    /not eligible/
  );

  const draft = calibration.buildDomainCalibration(
    historyFor('G12', [2, 4, 6, 8, 10, 12, 14, 16]),
    {
      minimumSamplesPerDomain: 4,
      minimumTotalSamples: 8,
    }
  );

  const validated =
    calibration.markDomainCalibrationValidated(draft);

  assert.equal(draft.config.status, 'draft');
  assert.equal(validated.status, 'validated');
  assert.equal(validated.version, draft.config.version);
});
