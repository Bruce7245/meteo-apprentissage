function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeDomainCode(value) {
  const code = text(value).toUpperCase();
  return /^[A-Z][0-9]{2}$/.test(code) ? code : null;
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

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function clamp(value, bounds) {
  return Math.max(
    Number(bounds.min),
    Math.min(Number(bounds.max), value)
  );
}

function validateBounds(bounds, name, errors) {
  if (!bounds || typeof bounds !== 'object') {
    errors.push(`factorBounds.${name} is required`);
    return;
  }

  const min = positiveNumber(bounds.min);
  const max = positiveNumber(bounds.max);

  if (min === null || max === null || min > max) {
    errors.push(
      `factorBounds.${name} must have positive min <= max`
    );
  }
}

function validateOccupationDomainVigilanceConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return {
      ok: false,
      errors: ['config must be an object'],
    };
  }

  if (!text(config.version)) {
    errors.push('version is required');
  }

  if (!['draft', 'validated'].includes(config.status)) {
    errors.push('status must be draft or validated');
  }

  if (
    config.calculationVersion !==
    'occupationDomainVigilance.v1'
  ) {
    errors.push(
      'calculationVersion must be occupationDomainVigilance.v1'
    );
  }

  if (positiveNumber(config.referencePopulation15To29) === null) {
    errors.push(
      'referencePopulation15To29 must be positive'
    );
  }

  if (positiveNumber(config.expectedOffersFloor) === null) {
    errors.push('expectedOffersFloor must be positive');
  }

  const minimumGreenActiveOffers =
    positiveNumber(config.minimumGreenActiveOffers);

  if (
    minimumGreenActiveOffers === null ||
    !Number.isInteger(minimumGreenActiveOffers)
  ) {
    errors.push(
      'minimumGreenActiveOffers must be a positive integer'
    );
  }

  const baselines = config.baselines;

  if (
    !baselines ||
    typeof baselines !== 'object' ||
    Array.isArray(baselines) ||
    Object.keys(baselines).length === 0
  ) {
    errors.push(
      'baselines must contain at least one domain baseline'
    );
  } else {
    for (const [domainCode, baseline] of Object.entries(
      baselines
    )) {
      if (
        !normalizeDomainCode(domainCode) ||
        positiveNumber(
          baseline?.expectedOffersAtReferencePopulation
        ) === null
      ) {
        errors.push(
          `baselines.${domainCode} is invalid`
        );
      }
    }
  }

  for (const name of [
    'population',
    'diversityFragility',
    'seasonality',
  ]) {
    validateBounds(
      config.factorBounds?.[name],
      name,
      errors
    );
  }

  const diversityThreshold = finiteNumber(
    config.coefficients
      ?.lowDiversityConcentrationThreshold
  );
  const diversityFactor = positiveNumber(
    config.coefficients?.lowDiversityFactor
  );

  if (
    diversityThreshold === null ||
    diversityThreshold < 0 ||
    diversityThreshold > 1
  ) {
    errors.push(
      'coefficients.lowDiversityConcentrationThreshold must be between 0 and 1'
    );
  }

  if (
    diversityFactor === null ||
    diversityFactor < 1
  ) {
    errors.push(
      'coefficients.lowDiversityFactor must be >= 1'
    );
  }

  const green = positiveNumber(
    config.thresholds?.greenMinRatio
  );
  const yellow = positiveNumber(
    config.thresholds?.yellowMinRatio
  );
  const orange = positiveNumber(
    config.thresholds?.orangeMinRatio
  );

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

  const highMin = finiteNumber(
    config.confidence?.highMin
  );
  const mediumMin = finiteNumber(
    config.confidence?.mediumMin
  );

  if (
    highMin === null ||
    mediumMin === null ||
    highMin < 0 ||
    highMin > 100 ||
    mediumMin < 0 ||
    mediumMin > 100 ||
    highMin <= mediumMin
  ) {
    errors.push(
      'confidence thresholds must satisfy 100 >= highMin > mediumMin >= 0'
    );
  }

  for (const key of [
    'missingPopulation',
    'missingSeasonality',
    'missingDiversity',
  ]) {
    if (
      nonNegativeNumber(
        config.confidence?.penalties?.[key]
      ) === null
    ) {
      errors.push(
        `confidence.penalties.${key} must be >= 0`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
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
    calculationVersion:
      config?.calculationVersion || null,
    configVersion:
      config?.version || null,
  };
}

function confidenceLevel(score, config) {
  if (score >= Number(config.confidence.highMin)) {
    return 'high';
  }

  if (score >= Number(config.confidence.mediumMin)) {
    return 'medium';
  }

  return 'low';
}

function levelFromRatio(ratio, thresholds) {
  if (ratio >= Number(thresholds.greenMinRatio)) {
    return 'green';
  }

  if (ratio >= Number(thresholds.yellowMinRatio)) {
    return 'yellow';
  }

  if (ratio >= Number(thresholds.orangeMinRatio)) {
    return 'orange';
  }

  return 'red';
}

function computeExpectedDomainOffers(input, config) {
  const domainCode = normalizeDomainCode(
    input?.domainCode
  );
  const baseline = domainCode
    ? config.baselines?.[domainCode]
    : null;

  if (!baseline) {
    throw new Error(
      `Missing domain baseline: ${domainCode || input?.domainCode}`
    );
  }

  let confidencePenalty = 0;

  const population =
    positiveNumber(input?.population15To29);

  const populationFactor =
    population === null
      ? 1
      : clamp(
          population /
            Number(
              config.referencePopulation15To29
            ),
          config.factorBounds.population
        );

  if (population === null) {
    confidencePenalty += Number(
      config.confidence.penalties
        .missingPopulation
    );
  }

  const concentration = finiteNumber(
    input?.employerConcentration
  );

  let diversityFragility = 1;

  if (concentration === null) {
    confidencePenalty += Number(
      config.confidence.penalties
        .missingDiversity
    );
  } else if (
    concentration >=
    Number(
      config.coefficients
        .lowDiversityConcentrationThreshold
    )
  ) {
    diversityFragility = clamp(
      Number(
        config.coefficients
          .lowDiversityFactor
      ),
      config.factorBounds.diversityFragility
    );
  }

  const seasonalityStatus =
    input?.seasonality?.status;
  const seasonalityCandidate =
    finiteNumber(input?.seasonality?.factor);

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
      config.confidence.penalties
        .missingSeasonality
    );
  }

  const factors = {
    population: round(populationFactor),
    diversityFragility:
      round(diversityFragility),
    seasonality: round(seasonality),
  };

  const expectedOffers = round(
    Math.max(
      Number(config.expectedOffersFloor),
      Number(
        baseline.expectedOffersAtReferencePopulation
      ) *
        factors.population *
        factors.diversityFragility *
        factors.seasonality
    )
  );

  return {
    expectedOffers,
    factors,
    confidencePenalty: round(confidencePenalty),
  };
}

function computeOccupationDomainVigilance(
  input,
  config
) {
  const validation =
    validateOccupationDomainVigilanceConfig(
      config
    );

  if (
    !validation.ok ||
    config?.status !== 'validated'
  ) {
    return insufficientResult(
      config,
      'CONFIG_INVALID'
    );
  }

  const domainCode =
    normalizeDomainCode(input?.domainCode);

  if (
    !domainCode ||
    input?.domainKnown !== true
  ) {
    return insufficientResult(
      config,
      'DOMAIN_UNKNOWN'
    );
  }

  if (!config.baselines?.[domainCode]) {
    return insufficientResult(
      config,
      'DOMAIN_BASELINE_MISSING'
    );
  }

  const activeOffersCount =
    nonNegativeNumber(
      input?.activeOffersCount
    );

  if (activeOffersCount === null) {
    return insufficientResult(
      config,
      'PRIMARY_OFFERS_MISSING'
    );
  }

  const expected =
    computeExpectedDomainOffers(
      {
        ...input,
        domainCode,
      },
      config
    );

  const observedVsExpectedRatio =
    round(
      activeOffersCount /
        expected.expectedOffers
    );

  let publishedLevel =
    levelFromRatio(
      observedVsExpectedRatio,
      config.thresholds
    );

  const absoluteVolumeBlocksGreen =
    publishedLevel === 'green' &&
    activeOffersCount <
      Number(
        config.minimumGreenActiveOffers
      );

  if (absoluteVolumeBlocksGreen) {
    publishedLevel = 'yellow';
  }

  const confidenceScore = Math.max(
    0,
    Math.min(
      100,
      round(
        100 -
          expected.confidencePenalty
      )
    )
  );

  const reasonCodes = [];

  if (activeOffersCount === 0) {
    reasonCodes.push('OFFERS_NONE');
  } else if (publishedLevel === 'green') {
    reasonCodes.push(
      'OFFERS_AT_OR_ABOVE_EXPECTED'
    );
  } else if (
    publishedLevel === 'yellow'
  ) {
    reasonCodes.push(
      'OFFERS_NEAR_EXPECTED'
    );
  } else if (
    publishedLevel === 'orange'
  ) {
    reasonCodes.push(
      'OFFERS_LOW_VS_EXPECTED'
    );
  } else {
    reasonCodes.push(
      'OFFERS_VERY_LOW_VS_EXPECTED'
    );
  }

  if (absoluteVolumeBlocksGreen) {
    reasonCodes.push(
      'OFFERS_ABSOLUTE_VOLUME_LOW'
    );
  }

  if (
    positiveNumber(
      input?.population15To29
    ) === null
  ) {
    reasonCodes.push(
      'POPULATION_CONTEXT_MISSING'
    );
  }

  if (
    input?.seasonality?.status !==
    'active'
  ) {
    reasonCodes.push(
      'SEASONALITY_UNAVAILABLE'
    );
  }

  const concentration = finiteNumber(
    input?.employerConcentration
  );

  if (
    concentration !== null &&
    concentration >=
      Number(
        config.coefficients
          .lowDiversityConcentrationThreshold
      )
  ) {
    reasonCodes.push(
      'EMPLOYER_DIVERSITY_LOW'
    );
  }

  if (
    input?.recentTrend?.status ===
    'degrading'
  ) {
    reasonCodes.push(
      'RECENT_TREND_DEGRADING'
    );
  }

  return {
    publishedLevel,
    confidenceLevel:
      confidenceLevel(
        confidenceScore,
        config
      ),
    confidenceScore,
    expectedOffers:
      expected.expectedOffers,
    observedVsExpectedRatio,
    reasonCodes,
    factors: expected.factors,
    calculationVersion:
      config.calculationVersion,
    configVersion: config.version,
  };
}

module.exports = {
  validateOccupationDomainVigilanceConfig,
  computeExpectedDomainOffers,
  computeOccupationDomainVigilance,
};
