const { normalizeRomeCode } = require('./occupation-search.cjs');

const REASON_CODES = Object.freeze({
  PRIMARY_OFFER_DATA_MISSING: 'PRIMARY_OFFER_DATA_MISSING',
  ROME_BASELINE_MISSING: 'ROME_BASELINE_MISSING',
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_NOT_VALIDATED: 'CONFIG_NOT_VALIDATED',
  OFFERS_ZERO: 'OFFERS_ZERO',
  OFFERS_ABSOLUTE_VOLUME_LOW: 'OFFERS_ABSOLUTE_VOLUME_LOW',
  OFFERS_BELOW_EXPECTED: 'OFFERS_BELOW_EXPECTED',
  OFFERS_MODERATE_VS_EXPECTED: 'OFFERS_MODERATE_VS_EXPECTED',
  OFFERS_AT_OR_ABOVE_EXPECTED: 'OFFERS_AT_OR_ABOVE_EXPECTED',
  POPULATION_DATA_MISSING: 'POPULATION_DATA_MISSING',
  EMPLOYER_DATA_MISSING: 'EMPLOYER_DATA_MISSING',
  EMPLOYER_COVERAGE_LOW: 'EMPLOYER_COVERAGE_LOW',
  EMPLOYER_DIVERSITY_LOW: 'EMPLOYER_DIVERSITY_LOW',
  TRAINING_DATA_MISSING: 'TRAINING_DATA_MISSING',
  SEASONALITY_UNAVAILABLE: 'SEASONALITY_UNAVAILABLE',
  RECENT_TREND_DECREASING: 'RECENT_TREND_DECREASING',
});

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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function validateBounds(name, value, errors) {
  const minimum = positiveNumber(value?.min);
  const maximum = positiveNumber(value?.max);
  if (minimum === null || maximum === null || maximum < minimum) {
    errors.push(`${name} factor bounds must be positive and max >= min`);
  }
}

function validateOccupationVigilanceConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['Config must be an object'] };
  }

  if (!['draft', 'validated'].includes(config.status)) {
    errors.push('Config status must be draft or validated');
  }
  if (!String(config.configVersion || '').trim()) errors.push('configVersion is required');
  if (!String(config.calculationVersion || '').trim()) errors.push('calculationVersion is required');
  if (positiveNumber(config.minimumExpectedOffers) === null) {
    errors.push('minimumExpectedOffers must be > 0');
  }
  const minimumGreenActiveOffers = positiveNumber(config.minimumGreenActiveOffers);
  if (minimumGreenActiveOffers === null || !Number.isInteger(minimumGreenActiveOffers)) {
    errors.push('minimumGreenActiveOffers must be a positive integer');
  }

  const green = finiteNumber(config.thresholds?.greenMinRatio);
  const yellow = finiteNumber(config.thresholds?.yellowMinRatio);
  const orange = finiteNumber(config.thresholds?.orangeMinRatio);
  if (
    green === null || yellow === null || orange === null ||
    green <= yellow || yellow <= orange || orange < 0
  ) {
    errors.push('Vigilance thresholds must satisfy green > yellow > orange >= 0');
  }

  for (const name of ['population', 'employer', 'training', 'seasonality']) {
    validateBounds(name, config.factorBounds?.[name], errors);
  }

  for (const name of ['population', 'employer', 'training']) {
    const weight = finiteNumber(config.factorWeights?.[name]);
    if (weight === null || weight < 0 || weight > 1) {
      errors.push(`${name} factor weight must be between 0 and 1`);
    }
  }

  const minimumActiveMonths = finiteNumber(config.seasonality?.minimumActiveMonths);
  const completenessThreshold = finiteNumber(config.seasonality?.completenessThreshold);
  if (
    minimumActiveMonths === null ||
    !Number.isInteger(minimumActiveMonths) ||
    minimumActiveMonths < 24
  ) {
    errors.push('seasonality minimumActiveMonths must be an integer >= 24');
  }
  if (
    completenessThreshold === null ||
    completenessThreshold < 0 ||
    completenessThreshold > 1
  ) {
    errors.push('seasonality completenessThreshold must be between 0 and 1');
  }

  const confidence = config.confidence || {};
  const highMin = finiteNumber(confidence.highMin);
  const mediumMin = finiteNumber(confidence.mediumMin);
  if (
    highMin === null || mediumMin === null ||
    highMin > 1 || mediumMin < 0 || highMin <= mediumMin
  ) {
    errors.push('Confidence thresholds must satisfy 1 >= high > medium >= 0');
  }
  const minCoverage = finiteNumber(confidence.minimumEmployerCoverage);
  const concentrationThreshold = finiteNumber(confidence.highConcentrationThreshold);
  if (minCoverage === null || minCoverage < 0 || minCoverage > 1) {
    errors.push('minimumEmployerCoverage must be between 0 and 1');
  }
  if (concentrationThreshold === null || concentrationThreshold < 0 || concentrationThreshold > 1) {
    errors.push('highConcentrationThreshold must be between 0 and 1');
  }

  for (const name of [
    'missingPopulation',
    'missingEmployer',
    'lowEmployerCoverage',
    'missingTraining',
    'missingSeasonality',
  ]) {
    const penalty = finiteNumber(confidence.penalties?.[name]);
    if (penalty === null || penalty < 0 || penalty > 1) {
      errors.push(`Confidence penalty ${name} must be between 0 and 1`);
    }
  }

  if (!config.romeBaselines || typeof config.romeBaselines !== 'object') {
    errors.push('romeBaselines is required');
  } else {
    for (const [code, baseline] of Object.entries(config.romeBaselines)) {
      if (!normalizeRomeCode(code)) {
        errors.push(`Invalid ROME baseline code: ${code}`);
        continue;
      }
      for (const field of ['baseExpectedOffers', 'referencePopulation15To29']) {
        if (positiveNumber(baseline?.[field]) === null) {
          errors.push(`${code} baseline ${field} must be > 0`);
        }
      }
      for (const field of ['referenceObservedEmployers', 'referenceUpcomingSessions']) {
        if (nonNegativeNumber(baseline?.[field]) === null) {
          errors.push(`${code} baseline ${field} must be >= 0`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function factorFromReference(value, reference, weight, bounds) {
  const observed = nonNegativeNumber(value);
  const referenceValue = positiveNumber(reference);
  if (observed === null || referenceValue === null) return 1;
  const ratio = observed / referenceValue;
  const blended = 1 + weight * (ratio - 1);
  return clamp(blended, Number(bounds.min), Number(bounds.max));
}

function computeExpectedOffers(input, config) {
  const romeCode = normalizeRomeCode(input?.romeCode);
  const baseline = romeCode ? config?.romeBaselines?.[romeCode] : null;
  if (!baseline) throw new Error(`Missing ROME baseline for ${romeCode || input?.romeCode || ''}`);

  const population = nonNegativeNumber(input?.population15To29) === null
    ? 1
    : factorFromReference(
      input.population15To29,
      baseline.referencePopulation15To29,
      Number(config.factorWeights.population),
      config.factorBounds.population
    );

  const employer = nonNegativeNumber(input?.distinctObservedEmployersCount) === null
    ? 1
    : factorFromReference(
      input.distinctObservedEmployersCount,
      baseline.referenceObservedEmployers,
      Number(config.factorWeights.employer),
      config.factorBounds.employer
    );

  const training = nonNegativeNumber(input?.upcomingSessionsCount) === null
    ? 1
    : factorFromReference(
      input.upcomingSessionsCount,
      baseline.referenceUpcomingSessions,
      Number(config.factorWeights.training),
      config.factorBounds.training
    );

  const rawSeasonality = positiveNumber(input?.seasonalityFactor);
  const seasonality = input?.seasonalityStatus === 'active' && rawSeasonality !== null
    ? clamp(
      rawSeasonality,
      Number(config.factorBounds.seasonality.min),
      Number(config.factorBounds.seasonality.max)
    )
    : 1;

  const factors = { population, employer, training, seasonality };
  const rawExpected = Number(baseline.baseExpectedOffers) * population * employer * training * seasonality;
  const expectedOffers = Math.max(Number(config.minimumExpectedOffers), rawExpected);

  return { expectedOffers, factors };
}

function insufficientResult(input, reasonCodes, config = null) {
  return {
    departmentCode: input?.departmentCode || null,
    romeCode: normalizeRomeCode(input?.romeCode) || input?.romeCode || null,
    activeOffersCount: nonNegativeNumber(input?.activeOffersCount),
    expectedOffers: null,
    observedVsExpectedRatio: null,
    publishedLevel: 'insufficient_data',
    confidenceScore: 0,
    confidenceLevel: 'low',
    factors: {
      population: 1,
      employer: 1,
      training: 1,
      seasonality: 1,
    },
    reasonCodes: [...new Set(reasonCodes)],
    calculationVersion: config?.calculationVersion || null,
    configVersion: config?.configVersion || null,
  };
}

function confidenceLevel(score, config) {
  if (score >= Number(config.confidence.highMin)) return 'high';
  if (score >= Number(config.confidence.mediumMin)) return 'medium';
  return 'low';
}

function computeOccupationVigilance(input = {}, config = {}) {
  const validation = validateOccupationVigilanceConfig(config);
  if (!validation.ok) {
    return insufficientResult(input, [REASON_CODES.CONFIG_INVALID], config);
  }
  if (config.status !== 'validated') {
    return insufficientResult(input, [REASON_CODES.CONFIG_NOT_VALIDATED], config);
  }

  const romeCode = normalizeRomeCode(input.romeCode);
  if (!romeCode || !config.romeBaselines[romeCode]) {
    return insufficientResult(input, [REASON_CODES.ROME_BASELINE_MISSING], config);
  }

  const activeOffersCount = nonNegativeNumber(input.activeOffersCount);
  if (input.primaryDataStatus !== 'available' || activeOffersCount === null) {
    return insufficientResult(input, [REASON_CODES.PRIMARY_OFFER_DATA_MISSING], config);
  }

  const reasons = [];
  let confidenceScore = 1;
  const penalties = config.confidence.penalties;

  if (nonNegativeNumber(input.population15To29) === null) {
    reasons.push(REASON_CODES.POPULATION_DATA_MISSING);
    confidenceScore -= Number(penalties.missingPopulation);
  }

  const employerCount = nonNegativeNumber(input.distinctObservedEmployersCount);
  if (employerCount === null) {
    reasons.push(REASON_CODES.EMPLOYER_DATA_MISSING);
    confidenceScore -= Number(penalties.missingEmployer);
  } else {
    const coverage = finiteNumber(input.knownEmployerOfferCoverage);
    if (coverage === null || coverage < Number(config.confidence.minimumEmployerCoverage)) {
      reasons.push(REASON_CODES.EMPLOYER_COVERAGE_LOW);
      confidenceScore -= Number(penalties.lowEmployerCoverage);
    }

    const concentration = finiteNumber(input.employerConcentration);
    if (
      concentration !== null &&
      concentration > Number(config.confidence.highConcentrationThreshold)
    ) {
      reasons.push(REASON_CODES.EMPLOYER_DIVERSITY_LOW);
      confidenceScore -= Number(penalties.lowEmployerCoverage);
    }
  }

  if (
    nonNegativeNumber(input.formationsCount) === null ||
    nonNegativeNumber(input.upcomingSessionsCount) === null
  ) {
    reasons.push(REASON_CODES.TRAINING_DATA_MISSING);
    confidenceScore -= Number(penalties.missingTraining);
  }

  if (input.seasonalityStatus !== 'active' || positiveNumber(input.seasonalityFactor) === null) {
    reasons.push(REASON_CODES.SEASONALITY_UNAVAILABLE);
    confidenceScore -= Number(penalties.missingSeasonality);
  }

  if (input?.recentTrend?.status === 'decreasing') {
    reasons.push(REASON_CODES.RECENT_TREND_DECREASING);
  }

  const { expectedOffers, factors } = computeExpectedOffers({ ...input, romeCode }, config);
  const ratio = expectedOffers > 0 ? activeOffersCount / expectedOffers : null;

  let publishedLevel;
  if (ratio >= Number(config.thresholds.greenMinRatio)) {
    publishedLevel = 'green';
    reasons.push(REASON_CODES.OFFERS_AT_OR_ABOVE_EXPECTED);
  } else if (ratio >= Number(config.thresholds.yellowMinRatio)) {
    publishedLevel = 'yellow';
    reasons.push(REASON_CODES.OFFERS_MODERATE_VS_EXPECTED);
  } else if (ratio >= Number(config.thresholds.orangeMinRatio)) {
    publishedLevel = 'orange';
    reasons.push(REASON_CODES.OFFERS_BELOW_EXPECTED);
  } else {
    publishedLevel = 'red';
    reasons.push(REASON_CODES.OFFERS_BELOW_EXPECTED);
  }

  if (activeOffersCount === 0) {
    reasons.unshift(REASON_CODES.OFFERS_ZERO);
  }

  if (
    publishedLevel === 'green' &&
    activeOffersCount < Number(config.minimumGreenActiveOffers)
  ) {
    publishedLevel = 'yellow';
    reasons.push(REASON_CODES.OFFERS_ABSOLUTE_VOLUME_LOW);
  }

  confidenceScore = clamp(confidenceScore, 0, 1);

  return {
    departmentCode: input.departmentCode || null,
    romeCode,
    activeOffersCount,
    expectedOffers,
    observedVsExpectedRatio: ratio,
    publishedLevel,
    confidenceScore,
    confidenceLevel: confidenceLevel(confidenceScore, config),
    factors,
    reasonCodes: [...new Set(reasons)],
    calculationVersion: config.calculationVersion,
    configVersion: config.configVersion,
  };
}

module.exports = {
  REASON_CODES,
  validateOccupationVigilanceConfig,
  computeExpectedOffers,
  computeOccupationVigilance,
};
