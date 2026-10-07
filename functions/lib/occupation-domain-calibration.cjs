const crypto = require('node:crypto');

const CALCULATION_VERSION = 'occupationDomainVigilance.v1';

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function nonNegativeNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function normalizeDomainCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][0-9]{2}$/.test(code) ? code : null;
}

function normalizeDate(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function sortedFinite(values) {
  return (Array.isArray(values) ? values : [])
    .map(finiteNumber)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
}

function quantile(values, probability) {
  const items = sortedFinite(values);
  const q = finiteNumber(probability);

  if (
    items.length === 0 ||
    q === null ||
    q < 0 ||
    q > 1
  ) {
    return null;
  }

  if (items.length === 1) return items[0];

  const position = (items.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;

  if (lowerIndex === upperIndex) {
    return items[lowerIndex];
  }

  return round(
    items[lowerIndex] +
      (items[upperIndex] - items[lowerIndex]) *
        fraction
  );
}

function median(values) {
  return quantile(values, 0.5);
}

function normalizeSample(sample) {
  const domainCode = normalizeDomainCode(
    sample?.domainCode
  );
  const date = normalizeDate(sample?.date);
  const activeOffersCount = nonNegativeNumber(
    sample?.activeOffersCount
  );
  const population15To29 = positiveNumber(
    sample?.population15To29
  );

  if (
    !domainCode ||
    !date ||
    activeOffersCount === null ||
    population15To29 === null
  ) {
    return null;
  }

  return {
    date,
    departmentCode:
      String(sample?.departmentCode || '').trim() ||
      null,
    domainCode,
    activeOffersCount,
    population15To29,
    employerConcentration:
      finiteNumber(sample?.employerConcentration),
  };
}

function stableVersion(samples, options) {
  const payload = {
    calculationVersion: CALCULATION_VERSION,
    baselineMethod: 'positive-normalized-offers.v1',
    options: {
      minimumSamplesPerDomain:
        options.minimumSamplesPerDomain,
      minimumPositiveSamplesPerDomain:
        options.minimumPositiveSamplesPerDomain,
      minimumTotalSamples:
        options.minimumTotalSamples,
      excludedDates: [
        ...(options.excludedDates || []),
      ].sort(),
    },
    samples: samples
      .map((sample) => [
        sample.date,
        sample.departmentCode,
        sample.domainCode,
        sample.activeOffersCount,
        sample.population15To29,
        sample.employerConcentration,
      ])
      .sort((a, b) =>
        JSON.stringify(a).localeCompare(
          JSON.stringify(b)
        )
      ),
  };

  return `${CALCULATION_VERSION}.cal.${crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 12)}`;
}

function buildDomainCalibration(
  history,
  options = {}
) {
  const minimumSamplesPerDomain =
    Number.isInteger(options.minimumSamplesPerDomain)
      ? options.minimumSamplesPerDomain
      : 24;

  const minimumPositiveSamplesPerDomain =
    Number.isInteger(options.minimumPositiveSamplesPerDomain)
      ? options.minimumPositiveSamplesPerDomain
      : 4;

  const minimumTotalSamples =
    Number.isInteger(options.minimumTotalSamples)
      ? options.minimumTotalSamples
      : 240;

  const excludedDates = Array.from(
    new Set(
      (Array.isArray(options.excludedDates)
        ? options.excludedDates
        : [])
        .map(normalizeDate)
        .filter(Boolean)
    )
  ).sort();

  const excludedDateSet = new Set(excludedDates);

  const rawHistory = Array.isArray(history)
    ? history
    : [];

  const filteredRawHistory = rawHistory.filter(
    (sample) => {
      const date = normalizeDate(sample?.date);
      return date && !excludedDateSet.has(date);
    }
  );

  const samples = filteredRawHistory
    .map(normalizeSample)
    .filter(Boolean);

  const invalidSamplesCount =
    filteredRawHistory.length - samples.length;

  const blockers = [];

  if (samples.length < minimumTotalSamples) {
    blockers.push(
      `TOTAL_SAMPLE_COUNT:${samples.length}<${minimumTotalSamples}`
    );
  }

  const byDomain = new Map();

  for (const sample of samples) {
    if (!byDomain.has(sample.domainCode)) {
      byDomain.set(sample.domainCode, []);
    }

    byDomain.get(sample.domainCode).push(sample);
  }

  const excludedDomainCodes = {};
  const eligibleDomainCodes = [];

  for (const domainCode of Array.from(
    byDomain.keys()
  ).sort()) {
    const count = byDomain.get(domainCode).length;

    if (count < minimumSamplesPerDomain) {
      excludedDomainCodes[domainCode] = {
        reason: 'INSUFFICIENT_SAMPLES',
        samplesCount: count,
      };
      continue;
    }

    eligibleDomainCodes.push(domainCode);
  }

  if (byDomain.size === 0) {
    blockers.push('DOMAIN_BASELINES_EMPTY');
  }

  const candidateSamples =
    eligibleDomainCodes.flatMap(
      (domainCode) =>
        byDomain.get(domainCode)
    );

  const referencePopulation15To29 = median(
    candidateSamples.map(
      (sample) => sample.population15To29
    )
  );

  if (!(referencePopulation15To29 > 0)) {
    blockers.push(
      'REFERENCE_POPULATION_UNAVAILABLE'
    );
  }

  const baselines = {};
  const normalizedOfferValues = [];

  if (referencePopulation15To29 > 0) {
    for (const domainCode of eligibleDomainCodes) {
      const domainSamples =
        byDomain.get(domainCode);

      const normalizedPositiveOffers =
        domainSamples
          .filter(
            (sample) =>
              sample.activeOffersCount > 0
          )
          .map((sample) =>
            sample.activeOffersCount *
            (
              referencePopulation15To29 /
              sample.population15To29
            )
          );

      if (normalizedPositiveOffers.length === 0) {
        excludedDomainCodes[domainCode] = {
          reason: 'NON_POSITIVE_BASELINE',
          samplesCount: domainSamples.length,
        };
        continue;
      }

      if (
        normalizedPositiveOffers.length <
        minimumPositiveSamplesPerDomain
      ) {
        excludedDomainCodes[domainCode] = {
          reason: 'INSUFFICIENT_POSITIVE_SAMPLES',
          samplesCount: domainSamples.length,
          positiveSamplesCount:
            normalizedPositiveOffers.length,
        };
        continue;
      }

      const expected =
        median(normalizedPositiveOffers);

      normalizedOfferValues.push(
        ...normalizedPositiveOffers
      );

      baselines[domainCode] = {
        expectedOffersAtReferencePopulation:
          round(expected),
      };
    }
  }

  const calibrationSamples =
    candidateSamples.filter(
      (sample) =>
        baselines[sample.domainCode]
    );

  if (
    calibrationSamples.length <
    minimumTotalSamples
  ) {
    blockers.push(
      `ELIGIBLE_SAMPLE_COUNT:${calibrationSamples.length}<${minimumTotalSamples}`
    );
  }

  if (Object.keys(baselines).length === 0) {
    blockers.push('DOMAIN_BASELINES_EMPTY');
  }

  const positiveActiveOfferValues =
    calibrationSamples
      .map(
        (sample) =>
          sample.activeOffersCount
      )
      .filter((value) => value > 0);

  const minimumGreenActiveOffers =
    Math.max(
      1,
      Math.ceil(
        quantile(
          positiveActiveOfferValues,
          0.25
        ) || 1
      )
    );

  const ratios = [];

  for (const sample of calibrationSamples) {
    const baseline =
      baselines[sample.domainCode]
        ?.expectedOffersAtReferencePopulation;

    if (!(baseline > 0)) continue;

    const expectedAtSamplePopulation =
      baseline *
      (
        sample.population15To29 /
        referencePopulation15To29
      );

    if (!(expectedAtSamplePopulation > 0)) {
      continue;
    }

    const ratio =
      sample.activeOffersCount /
      expectedAtSamplePopulation;

    if (ratio > 0) {
      ratios.push(ratio);
    }
  }

  const orangeMinRatio =
    quantile(ratios, 0.25);
  const yellowMinRatio =
    quantile(ratios, 0.5);
  const greenMinRatio =
    quantile(ratios, 0.75);

  if (
    !(
      greenMinRatio >
        yellowMinRatio &&
      yellowMinRatio >
        orangeMinRatio
    ) ||
    !(orangeMinRatio > 0)
  ) {
    blockers.push(
      'RATIO_DISTRIBUTION_NOT_SEPARATED'
    );
  }

  const eligibleForValidation =
    blockers.length === 0;

  const diagnosticsBase = {
    rawInputSamplesCount: rawHistory.length,
    inputSamplesCount:
      filteredRawHistory.length,
    validSamplesCount: samples.length,
    invalidSamplesCount,
    inputDomainCount: byDomain.size,
    domainCount:
      Object.keys(baselines).length,
    excludedDomainCodes,
    excludedDomainCount:
      Object.keys(excludedDomainCodes).length,
    eligibleSamplesCount:
      calibrationSamples.length,
    excludedDates,
  };

  if (!eligibleForValidation) {
    return {
      eligibleForValidation: false,
      validationBlockers: blockers,
      config: null,
      diagnostics: diagnosticsBase,
    };
  }

  const populationRatios =
    calibrationSamples.map(
      (sample) =>
        sample.population15To29 /
        referencePopulation15To29
    );

  const populationMin = Math.min(
    1,
    quantile(populationRatios, 0.1)
  );

  const populationMax = Math.max(
    1,
    quantile(populationRatios, 0.9)
  );

  const expectedOffersFloor = Math.max(
    Number.EPSILON,
    Math.min(
      ...normalizedOfferValues.filter(
        (value) => value > 0
      )
    )
  );

  const concentrationValues =
    calibrationSamples
      .map(
        (sample) =>
          sample.employerConcentration
      )
      .filter(
        (value) =>
          value !== null &&
          value >= 0 &&
          value <= 1
      );

  const dates = calibrationSamples
    .map((sample) => sample.date)
    .sort();

  const version = stableVersion(
    samples,
    {
      minimumSamplesPerDomain,
      minimumPositiveSamplesPerDomain,
      minimumTotalSamples,
      excludedDates,
    }
  );

  const config = {
    version,
    status: 'draft',
    calculationVersion:
      CALCULATION_VERSION,
    referencePopulation15To29:
      round(
        referencePopulation15To29
      ),
    expectedOffersFloor:
      round(expectedOffersFloor),
    minimumGreenActiveOffers,
    baselines,
    factorBounds: {
      population: {
        min: round(populationMin),
        max: round(populationMax),
      },
      diversityFragility: {
        min: 1,
        max: 1,
      },
      seasonality: {
        min: 1,
        max: 1,
      },
    },
    coefficients: {
      lowDiversityConcentrationThreshold:
        concentrationValues.length > 0
          ? round(
              median(
                concentrationValues
              )
            )
          : 1,
      lowDiversityFactor: 1,
    },
    thresholds: {
      greenMinRatio:
        round(greenMinRatio),
      yellowMinRatio:
        round(yellowMinRatio),
      orangeMinRatio:
        round(orangeMinRatio),
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
      windowStart: dates[0] || null,
      windowEnd:
        dates[dates.length - 1] || null,
      inputSamplesCount:
        filteredRawHistory.length,
      validSamplesCount:
        samples.length,
      invalidSamplesCount,
      domainCount:
        Object.keys(baselines).length,
      minimumSamplesPerDomain,
      minimumPositiveSamplesPerDomain,
      minimumTotalSamples,
      ratioQuantiles: {
        q25: round(orangeMinRatio),
        q50: round(yellowMinRatio),
        q75: round(greenMinRatio),
      },
      domainSampleCounts:
        Object.fromEntries(
          Array.from(
            byDomain.entries()
          )
            .sort(([a], [b]) =>
              a.localeCompare(b, 'fr')
            )
            .map(
              ([domainCode, domainSamples]) => [
                domainCode,
                domainSamples.length,
              ]
            )
        ),
      excludedDates,
    },
  };

  return {
    eligibleForValidation: true,
    validationBlockers: [],
    config,
    diagnostics: {
      ...diagnosticsBase,
      ...config.calibration,
    },
  };
}

function markDomainCalibrationValidated(
  calibrationResult
) {
  if (
    calibrationResult
      ?.eligibleForValidation !== true ||
    !calibrationResult?.config ||
    calibrationResult.config.status !==
      'draft'
  ) {
    throw new Error(
      'Domain calibration is not eligible for validation'
    );
  }

  return {
    ...calibrationResult.config,
    status: 'validated',
  };
}

module.exports = {
  CALCULATION_VERSION,
  quantile,
  median,
  buildDomainCalibration,
  markDomainCalibrationValidated,
};
