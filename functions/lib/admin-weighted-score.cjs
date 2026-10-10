'use strict';

/**
 * EXPERIMENTAL ANALYTICAL SCORE (NOT A PUBLISHED VIGILANCE LEVEL).
 *
 * Observed active offers (5/5) are the foundation of the density indicator:
 * they must NOT be added again as a separate subscore.
 * Seasonality importance (2.5/5) differs from its correction factor (1.00).
 *
 * Values are rescaled to 0-100 only for preliminary administration review.
 * 50 means national reference density (or no temporal change), NOT a legal
 * or statistical threshold between public vigilance colors.
 */

const MODEL_VERSION = 'adminTerritorialWeightedScore.experiment.v2';
const DEFAULT_WEIGHTS = Object.freeze({
  offersFoundation: 5,
  density: 4,
  employers: 3.5,
  trend: 4,
  seasonality: 2.5,
});
const SEASONALITY_NEUTRAL_FACTOR = 1;
const MIN_BENCHMARK_DEPARTMENTS = 75;
const MIN_PROVISIONAL_EMPLOYER_DEPARTMENTS = 45;
const EMPLOYER_POTENTIAL_SHARE = 0.6;
const EMPLOYER_INTENSITY_SHARE = 0.4;

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value) {
  const n = numberOrNull(value);
  return n !== null && n > 0 ? n : null;
}

function round(value, digits = 2) {
  const power = 10 ** digits;
  return Math.round((value + Number.EPSILON) * power) / power;
}

function clamp100(value) {
  return Math.min(100, Math.max(0, value));
}

function validateWeights(source) {
  const weights = {};
  const errors = [];
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {ok: false, errors: ['Les coefficients doivent former un objet.'], weights: null};
  }

  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const n = numberOrNull(source[key]);
    if (n === null || n < 0 || n > 5 || !Number.isInteger(n * 2)) {
      errors.push(key + ' doit être compris entre 0 et 5, par pas de 0,5.');
    } else {
      weights[key] = n;
    }
  }

  if (errors.length === 0 && (weights.offersFoundation === 0 || weights.density === 0)) {
    errors.push('Les offres et la densité sont des fondations obligatoires (> 0).');
  }
  return {ok: errors.length === 0, errors, weights: errors.length ? null : weights};
}

function computeWeights(weights) {
  return {
    density: weights.offersFoundation / 5 * weights.density,
    employers: weights.employers,
    employerPotential: weights.employers * EMPLOYER_POTENTIAL_SHARE,
    employerIntensity: weights.employers * EMPLOYER_INTENSITY_SHARE,
    trend: weights.trend,
    seasonalityReserved: weights.seasonality,
    seasonalityFactor: SEASONALITY_NEUTRAL_FACTOR,
  };
}

/**
 * National benchmark is computed only for valid, complete departmental stock
 * observations, and is explicitly unavailable if coverage is insufficient.
 * Employer density = employers / young population * 10,000, independent of
 * the current volume of job advertisements.
 */
function buildReference(rows = [], {provisional = false} = {}) {
  const permittedQualities = provisional
    ? ['comparable', 'indicative', 'provisional']
    : ['comparable', 'indicative'];
  const eligible = rows.filter(row =>
    permittedQualities.includes(row.quality) &&
    row.comparisonReady === true &&
    positive(row.population15To29) &&
    numberOrNull(row.averageOffers) !== null &&
    numberOrNull(row.offersPer10000Young) !== null
  );

  const populationSum = eligible.reduce((sum, row) => sum + row.population15To29, 0);
  const offerSum = eligible.reduce((sum, row) => sum + row.averageOffers, 0);
  const density = eligible.length >= MIN_BENCHMARK_DEPARTMENTS && populationSum > 0 && offerSum > 0
    ? offerSum / populationSum * 10000 : null;

  const employers = eligible.filter(row => {
    const count = numberOrNull(row.activeEmployerEstablishmentsCount);
    return count !== null && count >= 0;
  });
  const employerPopulation = employers.reduce((sum, row) => sum + row.population15To29, 0);
  const employerSum = employers.reduce((sum, row) => sum + row.activeEmployerEstablishmentsCount, 0);
  const minimumEmployerDepartments = provisional
    ? MIN_PROVISIONAL_EMPLOYER_DEPARTMENTS : MIN_BENCHMARK_DEPARTMENTS;
  const employerDensity = employers.length >= minimumEmployerDepartments &&
    employerPopulation > 0 && employerSum > 0
    ? employerSum / employerPopulation * 10000 : null;
  const offersFromEmployerGroup = employers.reduce((sum, row) => sum + row.averageOffers, 0);
  const offerIntensity = employers.length >= minimumEmployerDepartments &&
    employerSum > 0 && offersFromEmployerGroup > 0
    ? offersFromEmployerGroup / employerSum * 100 : null;

  return {
    referenceOffersPer10000Young: density,
    referenceEmployersPer10000Young: employerDensity,
    referenceOffersPer100Employers: offerIntensity,
    eligibleDepartments: eligible.length,
    employerCoverageDepartments: employers.length,
    minimumReferenceDepartments: MIN_BENCHMARK_DEPARTMENTS,
    minimumEmployerReferenceDepartments: minimumEmployerDepartments,
    isProvisionalReference: provisional,
    referenceScope: 'observed departments of requested calendar month',
    methodVersion: MODEL_VERSION,
  };
}

function normalizedLevel(value, benchmark) {
  const v = numberOrNull(value);
  const ref = positive(benchmark);
  return v !== null && v >= 0 && ref !== null
    ? clamp100(50 * v / ref) : null;
}

function averageTrend(changeMonth, changeYear) {
  const a = numberOrNull(changeMonth?.value);
  const b = numberOrNull(changeYear?.value);
  const valid = [a, b].filter(v => v !== null);
  if (!valid.length) return null;
  return {
    score: clamp100(50 + 100 * (valid.reduce((sum, v) => sum + v, 0) / valid.length)),
    componentsUsed: valid.length,
    indicative: [changeMonth, changeYear].some(item =>
      item && item.quality === 'indicative'),
  };
}

function simulateOne(row, reference, weights, {provisional = false} = {}) {
  const allowed = provisional
    ? ['comparable', 'indicative', 'provisional']
    : ['comparable', 'indicative'];
  const unusable = !row || !allowed.includes(row.quality) ||
    row.comparisonReady !== true;
  const coefficients = computeWeights(weights);

  if (unusable || !positive(reference.referenceOffersPer10000Young) ||
    positive(row.population15To29) === null) {
    return {
      score: null,
      quality: 'unavailable',
      reasons: [unusable ? 'INCOMPLETE_OR_NONCOMPARABLE_MONTH' : 'INSUFFICIENT_NATIONAL_REFERENCE'],
      components: null,
      activeWeights: null,
      seasonalityFactorApplied: SEASONALITY_NEUTRAL_FACTOR,
      calculationVersion: MODEL_VERSION,
    };
  }

  const density = normalizedLevel(
    row.offersPer10000Young, reference.referenceOffersPer10000Young);
  const employers = numberOrNull(row.activeEmployerEstablishmentsCount) !== null &&
    row.activeEmployerEstablishmentsCount >= 0
    ? normalizedLevel(
        row.activeEmployerEstablishmentsCount / row.population15To29 * 10000,
        reference.referenceEmployersPer10000Young)
    : null;
  const employerIntensity = normalizedLevel(
    row.offersPer100Employers, reference.referenceOffersPer100Employers);
  const trend = averageTrend(row.changeMonth, row.changeYear);
  const components = {
    density,
    employers,
    employerIntensity,
    trend: trend?.score ?? null,
  };
  const applicableWeights = {
    ...coefficients,
    employers: coefficients.employerPotential,
    employerIntensity: coefficients.employerIntensity,
    // M−1 and M−12 share a single 4/5 weight. One valid
    // comparator carries only half the maximum trend influence.
    trend: trend ? coefficients.trend * trend.componentsUsed / 2 : 0,
  };
  const activeWeights = {};
  const contributions = Object.entries(components).filter(([key, value]) => {
    const weight = applicableWeights[key];
    activeWeights[key] = value === null ? 0 : weight;
    return weight > 0 && value !== null;
  });

  // A density-only score would pretend missing context is irrelevant.
  if (!contributions.some(([key]) => key === 'density') || contributions.length < 2) {
    return {
      score: null,
      quality: 'unavailable',
      reasons: ['AT_LEAST_TWO_DISTINCT_DIMENSIONS_REQUIRED'],
      components,
      activeWeights,
      seasonalityFactorApplied: SEASONALITY_NEUTRAL_FACTOR,
      calculationVersion: MODEL_VERSION,
    };
  }

  const totalWeight = contributions.reduce((sum, [key]) =>
    sum + applicableWeights[key], 0);
  if (totalWeight === 0) {
    return {
      score: null, quality: 'unavailable', reasons: ['ZERO_TOTAL_WEIGHT'],
      components, activeWeights,
      seasonalityFactorApplied: SEASONALITY_NEUTRAL_FACTOR,
      calculationVersion: MODEL_VERSION,
    };
  }

  const score = round(contributions.reduce((sum, [key, value]) =>
    sum + value * applicableWeights[key], 0) / totalWeight);
  const hasAllComponents = components.density !== null &&
    (coefficients.employers === 0 ||
      (components.employers !== null && components.employerIntensity !== null)) &&
    (coefficients.trend === 0 || (trend && trend.componentsUsed === 2));
  const quality = row.quality === 'indicative' || trend?.indicative
    ? 'indicative' : provisional ? 'provisional'
      : hasAllComponents ? 'experimental' : 'partial';

  return {
    score,
    quality,
    reasons: [
      ...(hasAllComponents ? [] : ['MISSING_OPTIONAL_DIMENSIONS']),
      ...(quality === 'indicative' ? ['UNCERTIFIED_SOURCE_CAPPING'] : []),
    ],
    components: Object.fromEntries(Object.entries(components).map(([k, v]) =>
      [k, v === null ? null : round(v)])),
    activeWeights,
    availableWeight: round(totalWeight, 3),
    isProvisional: provisional,
    seasonalityFactorApplied: SEASONALITY_NEUTRAL_FACTOR,
    calculationVersion: MODEL_VERSION,
  };
}

function simulateTerritorialScores(rows, candidateWeights = DEFAULT_WEIGHTS, {provisional = false} = {}) {
  const validation = validateWeights(candidateWeights);
  if (!validation.ok) throw new Error('INVALID_SCORE_WEIGHTS: ' + validation.errors.join(' '));
  const weights = validation.weights;
  const reference = buildReference(rows, {provisional});
  const scores = (Array.isArray(rows) ? rows : []).map(row => ({
    departmentCode: row.departmentCode,
    ...simulateOne(row, reference, weights, {provisional}),
  }));
  return {
    mode: provisional ? 'provisional_admin_only' : 'simulation_only',
    calculationVersion: MODEL_VERSION,
    weights,
    effectiveWeights: computeWeights(weights),
    reference,
    scores,
    summary: {
      departments: scores.length,
      scored: scores.filter(s => s.score !== null).length,
      experimental: scores.filter(s => s.quality === 'experimental').length,
      indicative: scores.filter(s => s.quality === 'indicative').length,
      partial: scores.filter(s => s.quality === 'partial').length,
      provisional: scores.filter(s => s.quality === 'provisional').length,
      unavailable: scores.filter(s => s.score === null).length,
    },
    warning: provisional
      ? 'Score provisoire sur une fenêtre de jours communs, non comparable à un mois clos et sans seuil de vigilance. Aucune couleur publiée modifiée.'
      : 'Indice exploratoire relatif non calibré pour publier des vigilances. Ne change aucune couleur.',
  };
}

module.exports = {
  MODEL_VERSION, DEFAULT_WEIGHTS, SEASONALITY_NEUTRAL_FACTOR,
  MIN_BENCHMARK_DEPARTMENTS, MIN_PROVISIONAL_EMPLOYER_DEPARTMENTS,
  EMPLOYER_POTENTIAL_SHARE, EMPLOYER_INTENSITY_SHARE,
  validateWeights, computeWeights,
  buildReference, normalizedLevel, averageTrend,
  simulateOne, simulateTerritorialScores,
};
