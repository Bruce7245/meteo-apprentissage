const {
  normalizeRomeCode,
} = require('./occupation-search.cjs');

const REASON_CODES = Object.freeze([
  'CONFIG_INVALID',
  'ROME_UNKNOWN',
  'ROME_BASELINE_MISSING',
  'PRIMARY_OFFERS_MISSING',
  'OFFERS_NONE',
  'OFFERS_VERY_LOW_VS_EXPECTED',
  'OFFERS_LOW_VS_EXPECTED',
  'OFFERS_NEAR_EXPECTED',
  'OFFERS_AT_OR_ABOVE_EXPECTED',
  'OFFERS_ABSOLUTE_VOLUME_LOW',
  'POPULATION_CONTEXT_MISSING',
  'SEASONALITY_UNAVAILABLE',
  'EMPLOYER_DIVERSITY_LOW',
  'TRAINING_PRESSURE_HIGH',
  'RECENT_TREND_DEGRADING',
  'INTERANNUAL_TREND_DEGRADING',
  'INTERANNUAL_TREND_IMPROVING',
  'INTERANNUAL_TREND_UNAVAILABLE',
]);

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

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

function clamp(value, bounds) {
  return Math.max(Number(bounds.min), Math.min(Number(bounds.max), value));
}

function validateBounds(bounds, name, errors) {
  if (!bounds || typeof bounds !== 'object') {
    errors.push(`factorBounds.${name} is required`);
    return;
  }

  const min = positiveNumber(bounds.min);
  const max = positiveNumber(bounds.max);

  if (min === null || max === null || min > max) {
    errors.push(`factorBounds.${name} must have positive min <= max`);
  }
}

function historicalTrendSettings(config) {
  const raw = config?.historicalTrend || {};
  const minimumYears = Number.isInteger(raw.minimumYears)
    ? raw.minimumYears
    : 3;
  const weight = finiteNumber(raw.weight);
  const stableBand = finiteNumber(raw.stableBand);
  const minFactor = positiveNumber(raw.minFactor);
  const maxFactor = positiveNumber(raw.maxFactor);

  return {
    minimumYears,
    weight:
      weight !== null && weight >= 0 && weight <= 1
        ? weight
        : 0.5,
    stableBand:
      stableBand !== null && stableBand >= 0
        ? stableBand
        : 0.05,
    minFactor: minFactor ?? 0.9,
    maxFactor: maxFactor ?? 1.1,
  };
}

function effectiveOfferThresholds(expectedOffers, config) {
  const expected = nonNegativeNumber(expectedOffers);

  if (expected === null) return null;

  return {
    greenMinOffers: Math.max(
      Number(config.minimumGreenActiveOffers),
      Math.ceil(expected * Number(config.thresholds.greenMinRatio))
    ),
    yellowMinOffers: Math.ceil(
      expected * Number(config.thresholds.yellowMinRatio)
    ),
    orangeMinOffers: Math.ceil(
      expected * Number(config.thresholds.orangeMinRatio)
    ),
  };
}

function validateOccupationVigilanceConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return {
      ok: false,
      errors: ['config must be an object'],
    };
  }

  if (!String(config.version || '').trim()) {
    errors.push('version is required');
  }

  if (!['draft', 'validated'].includes(config.status)) {
    errors.push('status must be draft or validated');
  }

  if (!String(config.calculationVersion || '').trim()) {
    errors.push('calculationVersion is required');
  }

  if (positiveNumber(config.referencePopulation15To29) === null) {
    errors.push('referencePopulation15To29 must be positive');
  }

  if (positiveNumber(config.expectedOffersFloor) === null) {
    errors.push('expectedOffersFloor must be positive');
  }

  const minimumGreenActiveOffers = positiveNumber(config.minimumGreenActiveOffers);
  if (
    minimumGreenActiveOffers === null ||
    !Number.isInteger(minimumGreenActiveOffers)
  ) {
    errors.push('minimumGreenActiveOffers must be a positive integer');
  }

  const baselines = config.baselines;

  if (
    !baselines ||
    typeof baselines !== 'object' ||
    Array.isArray(baselines) ||
    Object.keys(baselines).length === 0
  ) {
    errors.push('baselines must contain at least one ROME baseline');
  } else {
    for (const [romeCode, baseline] of Object.entries(baselines)) {
      if (
        !normalizeRomeCode(romeCode) ||
        positiveNumber(baseline?.expectedOffersAtReferencePopulation) === null
      ) {
        errors.push(`baselines.${romeCode} is invalid`);
      }
    }
  }

  for (const name of [
    'population',
    'trainingPressure',
    'diversityFragility',
    'seasonality',
  ]) {
    validateBounds(config.factorBounds?.[name], name, errors);
  }

  const trainingCoefficient = nonNegativeNumber(
    config.coefficients?.trainingPressurePerFormation
  );
  const diversityThreshold = finiteNumber(
    config.coefficients?.lowDiversityConcentrationThreshold
  );
  const diversityFactor = positiveNumber(
    config.coefficients?.lowDiversityFactor
  );

  if (trainingCoefficient === null) {
    errors.push('coefficients.trainingPressurePerFormation must be >= 0');
  }

  if (
    diversityThreshold === null ||
    diversityThreshold < 0 ||
    diversityThreshold > 1
  ) {
    errors.push(
      'coefficients.lowDiversityConcentrationThreshold must be between 0 and 1'
    );
  }

  if (diversityFactor === null || diversityFactor < 1) {
    errors.push('coefficients.lowDiversityFactor must be >= 1');
  }

  const green = positiveNumber(config.thresholds?.greenMinRatio);
  const yellow = positiveNumber(config.thresholds?.yellowMinRatio);
  const orange = positiveNumber(config.thresholds?.orangeMinRatio);

  if (
    green === null ||
    yellow === null ||
    orange === null ||
    !(green > yellow && yellow > orange)
  ) {
    errors.push(
      'thresholds must satisfy greenMinRatio > yellowMinRatio > orangeMinRatio > 0'
    );
  }

  if (config.historicalTrend !== undefined) {
    const settings = historicalTrendSettings(config);

    if (
      settings.minimumYears < 2 ||
      settings.minFactor > settings.maxFactor
    ) {
      errors.push(
        'historicalTrend must have minimumYears >= 2 and minFactor <= maxFactor'
      );
    }

    const rawWeight = finiteNumber(config.historicalTrend?.weight);
    if (
      rawWeight !== null &&
      (rawWeight < 0 || rawWeight > 1)
    ) {
      errors.push('historicalTrend.weight must be between 0 and 1');
    }
  }

  const highMin = finiteNumber(config.confidence?.highMin);
  const mediumMin = finiteNumber(config.confidence?.mediumMin);

  if (
    highMin === null ||
    mediumMin === null ||
    highMin < 0 ||
    highMin > 100 ||
    mediumMin < 0 ||
    mediumMin > 100 ||
    highMin <= mediumMin
  ) {
    errors.push('confidence thresholds must satisfy 100 >= highMin > mediumMin >= 0');
  }

  for (const key of [
    'missingPopulation',
    'missingSeasonality',
    'missingDiversity',
    'missingTraining',
  ]) {
    if (nonNegativeNumber(config.confidence?.penalties?.[key]) === null) {
      errors.push(`confidence.penalties.${key} must be >= 0`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function computeExpectedOffers(input, config) {
  const validation = validateOccupationVigilanceConfig(config);

  if (!validation.ok) {
    throw new Error(`Invalid occupation vigilance config: ${validation.errors.join('; ')}`);
  }

  const romeCode = normalizeRomeCode(input?.romeCode);
  const baseline = romeCode ? config.baselines?.[romeCode] : null;

  if (!baseline) {
    throw new Error(`Missing ROME baseline: ${romeCode || input?.romeCode}`);
  }

  const referencePopulation = Number(config.referencePopulation15To29);
  const population = positiveNumber(input?.population15To29);

  let confidencePenalty = 0;

  const populationFactor = population === null
    ? 1
    : clamp(
        population / referencePopulation,
        config.factorBounds.population
      );

  if (population === null) {
    confidencePenalty += Number(
      config.confidence.penalties.missingPopulation
    );
  }

  const formationsCount = nonNegativeNumber(input?.formationsCount);
  const trainingPressure = formationsCount === null
    ? 1
    : clamp(
        1 +
          formationsCount *
            Number(config.coefficients.trainingPressurePerFormation),
        config.factorBounds.trainingPressure
      );

  if (formationsCount === null) {
    confidencePenalty += Number(
      config.confidence.penalties.missingTraining
    );
  }

  const concentration = finiteNumber(input?.employerConcentration);
  let diversityFragility = 1;

  if (concentration === null) {
    confidencePenalty += Number(
      config.confidence.penalties.missingDiversity
    );
  } else if (
    concentration >=
    Number(config.coefficients.lowDiversityConcentrationThreshold)
  ) {
    diversityFragility = clamp(
      Number(config.coefficients.lowDiversityFactor),
      config.factorBounds.diversityFragility
    );
  }

  const seasonalityStatus = input?.seasonality?.status;
  const seasonalityCandidate = finiteNumber(input?.seasonality?.factor);

  const seasonality =
    seasonalityStatus === 'active' &&
    seasonalityCandidate !== null &&
    seasonalityCandidate > 0
      ? clamp(
          seasonalityCandidate,
          config.factorBounds.seasonality
        )
      : 1;

  if (seasonalityStatus !== 'active') {
    confidencePenalty += Number(
      config.confidence.penalties.missingSeasonality
    );
  }

  const historicalSettings = historicalTrendSettings(config);
  const interannualStatus = input?.interannualTrend?.status;
  const annualTrendRatio = finiteNumber(
    input?.interannualTrend?.annualTrendRatio
  );

  const historicalTrend =
    interannualStatus === 'active' &&
    annualTrendRatio !== null
      ? clamp(
          1 - annualTrendRatio * historicalSettings.weight,
          {
            min: historicalSettings.minFactor,
            max: historicalSettings.maxFactor,
          }
        )
      : 1;

  const factors = {
    population: round(populationFactor),
    trainingPressure: round(trainingPressure),
    diversityFragility: round(diversityFragility),
    seasonality: round(seasonality),
    historicalTrend: round(historicalTrend),
  };

  const rawExpected =
    Number(baseline.expectedOffersAtReferencePopulation) *
    factors.population *
    factors.trainingPressure *
    factors.diversityFragility *
    factors.seasonality *
    factors.historicalTrend;

  const expectedOffers = round(
    Math.max(Number(config.expectedOffersFloor), rawExpected)
  );

  return {
    expectedOffers,
    factors,
    confidencePenalty: round(confidencePenalty),
  };
}

function insufficientResult(config, reasonCode) {
  return {
    publishedLevel: 'insufficient_data',
    confidenceLevel: 'low',
    confidenceScore: 0,
    expectedOffers: null,
    observedVsExpectedRatio: null,
    reasonCodes: [reasonCode],
    factors: null,
    effectiveThresholds: null,
    calculationVersion: config?.calculationVersion || null,
    configVersion: config?.version || null,
  };
}

function confidenceLevel(score, config) {
  if (score >= Number(config.confidence.highMin)) return 'high';
  if (score >= Number(config.confidence.mediumMin)) return 'medium';
  return 'low';
}

function levelFromRatio(ratio, thresholds) {
  if (ratio >= Number(thresholds.greenMinRatio)) return 'green';
  if (ratio >= Number(thresholds.yellowMinRatio)) return 'yellow';
  if (ratio >= Number(thresholds.orangeMinRatio)) return 'orange';
  return 'red';
}

function offerReasonFromLevel(level, activeOffersCount) {
  if (activeOffersCount === 0) return 'OFFERS_NONE';

  const map = {
    green: 'OFFERS_AT_OR_ABOVE_EXPECTED',
    yellow: 'OFFERS_NEAR_EXPECTED',
    orange: 'OFFERS_LOW_VS_EXPECTED',
    red: 'OFFERS_VERY_LOW_VS_EXPECTED',
  };

  return map[level];
}

function computeOccupationVigilance(input, config) {
  const validation = validateOccupationVigilanceConfig(config);

  if (!validation.ok || config?.status !== 'validated') {
    return insufficientResult(config, 'CONFIG_INVALID');
  }

  const romeCode = normalizeRomeCode(input?.romeCode);

  if (!romeCode || input?.romeKnown !== true) {
    return insufficientResult(config, 'ROME_UNKNOWN');
  }

  if (!config.baselines?.[romeCode]) {
    return insufficientResult(config, 'ROME_BASELINE_MISSING');
  }

  const activeOffersCount = nonNegativeNumber(input?.activeOffersCount);

  if (activeOffersCount === null) {
    return insufficientResult(config, 'PRIMARY_OFFERS_MISSING');
  }

  const expected = computeExpectedOffers(
    {
      ...input,
      romeCode,
    },
    config
  );

  const observedVsExpectedRatio = round(
    activeOffersCount / expected.expectedOffers
  );
  let publishedLevel = levelFromRatio(
    observedVsExpectedRatio,
    config.thresholds
  );

  const absoluteVolumeBlocksGreen =
    publishedLevel === 'green' &&
    activeOffersCount < Number(config.minimumGreenActiveOffers);

  if (absoluteVolumeBlocksGreen) {
    publishedLevel = 'yellow';
  }

  const confidenceScore = Math.max(
    0,
    Math.min(100, round(100 - expected.confidencePenalty))
  );

  const reasonCodes = [
    absoluteVolumeBlocksGreen
      ? 'OFFERS_AT_OR_ABOVE_EXPECTED'
      : offerReasonFromLevel(publishedLevel, activeOffersCount),
  ];

  if (absoluteVolumeBlocksGreen) {
    reasonCodes.push('OFFERS_ABSOLUTE_VOLUME_LOW');
  }

  if (positiveNumber(input?.population15To29) === null) {
    reasonCodes.push('POPULATION_CONTEXT_MISSING');
  }

  if (input?.seasonality?.status !== 'active') {
    reasonCodes.push('SEASONALITY_UNAVAILABLE');
  }

  const concentration = finiteNumber(input?.employerConcentration);
  if (
    concentration !== null &&
    concentration >=
      Number(config.coefficients.lowDiversityConcentrationThreshold)
  ) {
    reasonCodes.push('EMPLOYER_DIVERSITY_LOW');
  }

  if (expected.factors.trainingPressure > 1) {
    reasonCodes.push('TRAINING_PRESSURE_HIGH');
  }

  if (input?.recentTrend?.status === 'degrading') {
    reasonCodes.push('RECENT_TREND_DEGRADING');
  }

  if (input?.interannualTrend?.status !== 'active') {
    reasonCodes.push('INTERANNUAL_TREND_UNAVAILABLE');
  } else if (input?.interannualTrend?.direction === 'degrading') {
    reasonCodes.push('INTERANNUAL_TREND_DEGRADING');
  } else if (input?.interannualTrend?.direction === 'improving') {
    reasonCodes.push('INTERANNUAL_TREND_IMPROVING');
  }

  return {
    publishedLevel,
    confidenceLevel: confidenceLevel(confidenceScore, config),
    confidenceScore,
    expectedOffers: expected.expectedOffers,
    observedVsExpectedRatio,
    reasonCodes,
    factors: expected.factors,
    effectiveThresholds: effectiveOfferThresholds(
      expected.expectedOffers,
      config
    ),
    calculationVersion: config.calculationVersion,
    configVersion: config.version,
  };
}

module.exports = {
  REASON_CODES,
  validateOccupationVigilanceConfig,
  computeExpectedOffers,
  computeOccupationVigilance,
  effectiveOfferThresholds,
};
