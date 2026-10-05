const crypto = require('node:crypto');
const { normalizeRomeCode } = require('./occupation-search.cjs');
const { validateOccupationVigilanceConfig } = require('./occupation-vigilance.cjs');

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positive(value) {
  const number = finiteNonNegative(value);
  return number !== null && number > 0 ? number : null;
}

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
    ? text
    : null;
}

function median(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function nearestRankQuantile(values, probability) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil(probability * sorted.length));
  return sorted[Math.min(rank - 1, sorted.length - 1)];
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildCalibration(history, options = {}) {
  const minimumSamplesPerRome = Number.isInteger(options.minimumSamplesPerRome)
    ? options.minimumSamplesPerRome
    : 24;
  const minimumCalibratedRomeCodes = Number.isInteger(options.minimumCalibratedRomeCodes)
    ? options.minimumCalibratedRomeCodes
    : 20;

  if (minimumSamplesPerRome < 2) {
    throw new Error('minimumSamplesPerRome must be at least 2');
  }
  if (minimumCalibratedRomeCodes < 1) {
    throw new Error('minimumCalibratedRomeCodes must be at least 1');
  }

  const groups = new Map();
  let invalidObservationCount = 0;
  const dates = [];

  for (const item of Array.isArray(history) ? history : []) {
    const romeCode = normalizeRomeCode(item?.romeCode);
    const date = validDate(item?.date);
    const activeOffersCount = finiteNonNegative(item?.activeOffersCount);
    const population15To29 = positive(item?.population15To29);
    const employers = finiteNonNegative(item?.distinctObservedEmployersCount);
    const sessions = finiteNonNegative(item?.upcomingSessionsCount);
    const primaryOfferDataStatus = item?.primaryOfferDataStatus || item?.primaryDataStatus || null;

    if (
      (primaryOfferDataStatus && primaryOfferDataStatus !== 'available') ||
      !romeCode ||
      !date ||
      activeOffersCount === null ||
      population15To29 === null
    ) {
      invalidObservationCount += 1;
      continue;
    }

    if (!groups.has(romeCode)) groups.set(romeCode, []);
    groups.get(romeCode).push({
      romeCode,
      date,
      activeOffersCount,
      population15To29,
      employers,
      sessions,
    });
    dates.push(date);
  }

  const romeBaselines = {};
  const excludedRomeCodes = [];
  const normalizedRatios = [];
  const calibratedActiveOffers = [];

  for (const [romeCode, samples] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr'))) {
    if (samples.length < minimumSamplesPerRome) {
      excludedRomeCodes.push(romeCode);
      continue;
    }

    const baseExpectedOffers = median(samples.map((sample) => sample.activeOffersCount));
    const referencePopulation15To29 = median(samples.map((sample) => sample.population15To29));
    const referenceObservedEmployers = median(samples.map((sample) => sample.employers));
    const referenceUpcomingSessions = median(samples.map((sample) => sample.sessions));

    if (!(baseExpectedOffers > 0) || !(referencePopulation15To29 > 0)) {
      excludedRomeCodes.push(romeCode);
      continue;
    }

    romeBaselines[romeCode] = {
      baseExpectedOffers,
      referencePopulation15To29,
      referenceObservedEmployers: referenceObservedEmployers ?? 0,
      referenceUpcomingSessions: referenceUpcomingSessions ?? 0,
      sampleCount: samples.length,
    };

    for (const sample of samples) {
      normalizedRatios.push(sample.activeOffersCount / baseExpectedOffers);
      calibratedActiveOffers.push(sample.activeOffersCount);
    }
  }

  const ratioQuantiles = {
    p10: nearestRankQuantile(normalizedRatios, 0.10),
    p25: nearestRankQuantile(normalizedRatios, 0.25),
    p50: nearestRankQuantile(normalizedRatios, 0.50),
    p75: nearestRankQuantile(normalizedRatios, 0.75),
    p90: nearestRankQuantile(normalizedRatios, 0.90),
  };

  const activeOfferQuantiles = {
    p10: nearestRankQuantile(calibratedActiveOffers, 0.10),
    p25: nearestRankQuantile(calibratedActiveOffers, 0.25),
    p50: nearestRankQuantile(calibratedActiveOffers, 0.50),
    p75: nearestRankQuantile(calibratedActiveOffers, 0.75),
    p90: nearestRankQuantile(calibratedActiveOffers, 0.90),
  };

  const sortedDates = dates.sort((a, b) => a.localeCompare(b));
  const calibrationWindow = {
    startDate: sortedDates[0] || null,
    endDate: sortedDates[sortedDates.length - 1] || null,
  };

  const summaryForHash = {
    minimumSamplesPerRome,
    minimumCalibratedRomeCodes,
    romeBaselines,
    ratioQuantiles,
    activeOfferQuantiles,
    calibrationWindow,
  };
  const calibrationId = `cal_${stableHash(summaryForHash).slice(0, 16)}`;
  const calibratedRomeCount = Object.keys(romeBaselines).length;

  return {
    status: 'draft',
    calibrationId,
    calculationVersion: 'occupationVigilance.engine.v1',
    minimumSamplesPerRome,
    minimumCalibratedRomeCodes,
    calibratedRomeCount,
    excludedRomeCodes: [...new Set(excludedRomeCodes)].sort((a, b) => a.localeCompare(b, 'fr')),
    invalidObservationCount,
    calibrationWindow,
    ratioQuantiles,
    activeOfferQuantiles,
    romeBaselines,
    canValidate: calibratedRomeCount >= minimumCalibratedRomeCodes,
  };
}

function buildValidatedVigilanceConfig(calibration, policy) {
  if (!calibration?.canValidate) {
    throw new Error('Calibration cannot be validated: minimum coverage is not met');
  }

  const candidate = {
    status: 'validated',
    configVersion: policy?.configVersion,
    calculationVersion: calibration.calculationVersion || 'occupationVigilance.engine.v1',
    minimumExpectedOffers: policy?.minimumExpectedOffers,
    minimumGreenActiveOffers: policy?.minimumGreenActiveOffers,
    thresholds: policy?.thresholds,
    factorBounds: policy?.factorBounds,
    factorWeights: policy?.factorWeights,
    seasonality: policy?.seasonality,
    confidence: policy?.confidence,
    romeBaselines: calibration.romeBaselines,
    calibrationId: calibration.calibrationId,
    calibrationWindow: calibration.calibrationWindow,
    calibrationRatioQuantiles: calibration.ratioQuantiles,
    calibrationActiveOfferQuantiles: calibration.activeOfferQuantiles,
  };

  const validation = validateOccupationVigilanceConfig(candidate);
  if (!validation.ok) {
    throw new Error(`Invalid reviewed policy: ${validation.errors.join('; ')}`);
  }

  return candidate;
}

module.exports = {
  median,
  nearestRankQuantile,
  buildCalibration,
  buildValidatedVigilanceConfig,
};
