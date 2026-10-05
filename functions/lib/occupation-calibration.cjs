const crypto = require('node:crypto');

const CALCULATION_VERSION = 'occupationVigilance.v1.1';
const SECONDARY_SIGNAL_COUNT = 4;

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

function normalizeRomeCode(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^[A-Z][0-9]{4}$/.test(text) ? text : null;
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

  if (items.length === 0 || q === null || q < 0 || q > 1) return null;
  if (items.length === 1) return items[0];

  const position = (items.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;

  if (lowerIndex === upperIndex) return items[lowerIndex];

  return round(
    items[lowerIndex] +
      (items[upperIndex] - items[lowerIndex]) * fraction
  );
}

function median(values) {
  return quantile(values, 0.5);
}

function normalizeSample(sample) {
  const romeCode = normalizeRomeCode(sample?.romeCode);
  const activeOffersCount = nonNegativeNumber(sample?.activeOffersCount);
  const population15To29 = positiveNumber(sample?.population15To29);

  if (!romeCode || activeOffersCount === null || population15To29 === null) {
    return null;
  }

  return {
    date: String(sample?.date || '').slice(0, 10) || null,
    departmentCode: String(sample?.departmentCode || '').trim() || null,
    romeCode,
    activeOffersCount,
    population15To29,
    formationsCount: nonNegativeNumber(sample?.formationsCount),
    employerConcentration: finiteNumber(sample?.employerConcentration),
  };
}

function stableVersion(samples, options) {
  const payload = {
    calculationVersion: CALCULATION_VERSION,
    options: {
      minimumSamplesPerRome: options.minimumSamplesPerRome,
      minimumTotalSamples: options.minimumTotalSamples,
    },
    samples: samples
      .map((sample) => [
        sample.date,
        sample.departmentCode,
        sample.romeCode,
        sample.activeOffersCount,
        sample.population15To29,
        sample.formationsCount,
        sample.employerConcentration,
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };

  return `${CALCULATION_VERSION}.cal.${crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 12)}`;
}

function buildCalibration(history, options = {}) {
  const minimumSamplesPerRome = Number.isInteger(options.minimumSamplesPerRome)
    ? options.minimumSamplesPerRome
    : 24;
  const minimumTotalSamples = Number.isInteger(options.minimumTotalSamples)
    ? options.minimumTotalSamples
    : 240;

  const rawHistory = Array.isArray(history) ? history : [];
  const samples = rawHistory.map(normalizeSample).filter(Boolean);
  const invalidSamplesCount = rawHistory.length - samples.length;
  const blockers = [];

  if (samples.length < minimumTotalSamples) {
    blockers.push(`TOTAL_SAMPLE_COUNT:${samples.length}<${minimumTotalSamples}`);
  }

  const byRome = new Map();
  for (const sample of samples) {
    if (!byRome.has(sample.romeCode)) byRome.set(sample.romeCode, []);
    byRome.get(sample.romeCode).push(sample);
  }

  for (const romeCode of Array.from(byRome.keys()).sort()) {
    const count = byRome.get(romeCode).length;
    if (count < minimumSamplesPerRome) {
      blockers.push(`ROME_SAMPLE_COUNT:${romeCode}:${count}<${minimumSamplesPerRome}`);
    }
  }

  if (byRome.size === 0) {
    blockers.push('ROME_BASELINES_EMPTY');
  }

  const populationValues = samples.map((sample) => sample.population15To29);
  const positiveActiveOfferValues = samples
    .map((sample) => sample.activeOffersCount)
    .filter((value) => value > 0);
  const referencePopulation15To29 = median(populationValues);
  const minimumGreenActiveOffers = Math.max(
    1,
    Math.ceil(quantile(positiveActiveOfferValues, 0.25) || 1)
  );

  if (!(referencePopulation15To29 > 0)) {
    blockers.push('REFERENCE_POPULATION_UNAVAILABLE');
  }

  const baselines = {};
  const normalizedOfferValues = [];

  if (referencePopulation15To29 > 0) {
    for (const romeCode of Array.from(byRome.keys()).sort()) {
      const normalizedOffers = byRome.get(romeCode).map((sample) => {
        const normalized =
          sample.activeOffersCount *
          (referencePopulation15To29 / sample.population15To29);
        normalizedOfferValues.push(normalized);
        return normalized;
      });

      const expectedOffersAtReferencePopulation = median(normalizedOffers);

      if (!(expectedOffersAtReferencePopulation > 0)) {
        blockers.push(`ROME_BASELINE_NON_POSITIVE:${romeCode}`);
        continue;
      }

      baselines[romeCode] = {
        expectedOffersAtReferencePopulation: round(
          expectedOffersAtReferencePopulation
        ),
      };
    }
  }

  const ratios = [];
  for (const sample of samples) {
    const baseline = baselines[sample.romeCode]?.expectedOffersAtReferencePopulation;
    if (!(baseline > 0)) continue;

    const expectedAtSamplePopulation =
      baseline * (sample.population15To29 / referencePopulation15To29);

    if (expectedAtSamplePopulation > 0) {
      ratios.push(sample.activeOffersCount / expectedAtSamplePopulation);
    }
  }

  const orangeMinRatio = quantile(ratios, 0.25);
  const yellowMinRatio = quantile(ratios, 0.5);
  const greenMinRatio = quantile(ratios, 0.75);

  if (
    !(greenMinRatio > yellowMinRatio && yellowMinRatio > orangeMinRatio) ||
    !(orangeMinRatio > 0)
  ) {
    blockers.push('RATIO_DISTRIBUTION_NOT_SEPARATED');
  }

  const eligibleForValidation = blockers.length === 0;

  if (!eligibleForValidation) {
    return {
      eligibleForValidation: false,
      validationBlockers: blockers,
      config: null,
      diagnostics: {
        inputSamplesCount: rawHistory.length,
        validSamplesCount: samples.length,
        invalidSamplesCount,
        romeCount: byRome.size,
      },
    };
  }

  const populationRatios = populationValues.map(
    (population) => population / referencePopulation15To29
  );
  const populationMin = Math.min(1, quantile(populationRatios, 0.1));
  const populationMax = Math.max(1, quantile(populationRatios, 0.9));
  const expectedOffersFloor = Math.max(
    Number.EPSILON,
    Math.min(...normalizedOfferValues.filter((value) => value > 0))
  );

  const concentrationValues = samples
    .map((sample) => sample.employerConcentration)
    .filter((value) => value !== null && value >= 0 && value <= 1);

  const missingSignalPenalty = 100 / SECONDARY_SIGNAL_COUNT;
  const dates = samples.map((sample) => sample.date).filter(Boolean).sort();
  const version = stableVersion(samples, {
    minimumSamplesPerRome,
    minimumTotalSamples,
  });

  const config = {
    version,
    status: 'draft',
    calculationVersion: CALCULATION_VERSION,
    referencePopulation15To29: round(referencePopulation15To29),
    expectedOffersFloor: round(expectedOffersFloor),
    minimumGreenActiveOffers,
    baselines,
    factorBounds: {
      population: {
        min: round(populationMin),
        max: round(populationMax),
      },
      trainingPressure: { min: 1, max: 1 },
      diversityFragility: { min: 1, max: 1 },
      seasonality: { min: 1, max: 1 },
    },
    coefficients: {
      trainingPressurePerFormation: 0,
      lowDiversityConcentrationThreshold:
        concentrationValues.length > 0
          ? round(median(concentrationValues))
          : 1,
      lowDiversityFactor: 1,
    },
    thresholds: {
      greenMinRatio: round(greenMinRatio),
      yellowMinRatio: round(yellowMinRatio),
      orangeMinRatio: round(orangeMinRatio),
    },
    confidence: {
      highMin: round(100 - missingSignalPenalty),
      mediumMin: round(100 - 2 * missingSignalPenalty),
      penalties: {
        missingPopulation: round(missingSignalPenalty),
        missingSeasonality: round(missingSignalPenalty),
        missingDiversity: round(missingSignalPenalty),
        missingTraining: round(missingSignalPenalty),
      },
    },
    calibration: {
      windowStart: dates[0] || null,
      windowEnd: dates[dates.length - 1] || null,
      inputSamplesCount: rawHistory.length,
      validSamplesCount: samples.length,
      invalidSamplesCount,
      romeCount: byRome.size,
      minimumSamplesPerRome,
      minimumTotalSamples,
      ratioQuantiles: {
        q25: round(orangeMinRatio),
        q50: round(yellowMinRatio),
        q75: round(greenMinRatio),
      },
      romeSampleCounts: Object.fromEntries(
        Array.from(byRome.entries())
          .sort(([a], [b]) => a.localeCompare(b, 'fr'))
          .map(([romeCode, romeSamples]) => [romeCode, romeSamples.length])
      ),
    },
  };

  return {
    eligibleForValidation: true,
    validationBlockers: [],
    config,
    diagnostics: config.calibration,
  };
}

function markCalibrationValidated(calibrationResult) {
  if (
    calibrationResult?.eligibleForValidation !== true ||
    !calibrationResult?.config ||
    calibrationResult.config.status !== 'draft'
  ) {
    throw new Error('Calibration is not eligible for validation');
  }

  return {
    ...calibrationResult.config,
    status: 'validated',
  };
}

module.exports = {
  CALCULATION_VERSION,
  median,
  quantile,
  buildCalibration,
  markCalibrationValidated,
};
