import {buildAdminNationalSimulationMap} from './adminNationalSimulationMap.mjs';
import {buildAdminPublishedComparisonMap} from './adminPublishedComparisonMap.mjs';

export const AUDIT_VERSION = 'adminTerritorialModelAudit.phase1.v1';
export const AUDIT_THRESHOLD_MARGIN = 3;
export const AUDIT_THRESHOLDS = Object.freeze([30, 45, 60]);
export const AUDIT_LEVELS = Object.freeze(['green', 'yellow', 'orange', 'red']);

const LEVEL_ORDER = Object.freeze({green: 0, yellow: 1, orange: 2, red: 3});
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const nonNegative = value => numeric(value) && value >= 0;
const positive = value => numeric(value) && value > 0;
const codeKey = item => String(item?.departmentCode || '').trim().toUpperCase();

function duplicatedCodes(records) {
  const found = new Set();
  const duplicates = new Set();
  for (const item of Array.isArray(records) ? records : []) {
    const code = codeKey(item);
    if (!code) continue;
    if (found.has(code)) duplicates.add(code);
    found.add(code);
  }
  return duplicates;
}

function roughlyEqual(actual, expected) {
  return Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * 1e-5);
}

function thresholdProximity(index, margin) {
  if (!numeric(index)) return null;
  const distance = Math.min(...AUDIT_THRESHOLDS.map(threshold =>
    Math.abs(index - threshold)));
  return distance <= margin ? Math.round(distance * 100) / 100 : null;
}

function addFlag(flags, code, level, message) {
  flags.push({code, level, message});
}

function checkMonthlyRow(raw, code, duplicates, duplicateScores) {
  const flags = [];
  if (!raw) {
    addFlag(flags, 'NO_MONTHLY_ROW', 'warning', 'Aucune ligne mensuelle fournie.');
    return flags;
  }
  if (duplicates.has(code)) {
    addFlag(flags, 'DUPLICATE_MONTHLY_ROW', 'critical', 'Ligne mensuelle présente plusieurs fois.');
  }
  if (duplicateScores.has(code)) {
    addFlag(flags, 'DUPLICATE_SCORE', 'critical', 'Score présent plusieurs fois dans la réponse.');
  }

  if (!positive(raw.population15To29)) {
    addFlag(flags, 'MISSING_YOUNG_POPULATION', 'warning', 'Population INSEE 15–29 ans absente ou invalide.');
  }
  if (!nonNegative(raw.activeEmployerEstablishmentsCount)) {
    addFlag(flags, 'MISSING_EMPLOYERS', 'warning', 'Nombre d’établissements employeurs absent ou invalide.');
  }
  if (!Number.isInteger(raw.daysObserved) || raw.daysObserved < 0 ||
      !Number.isInteger(raw.daysExpected) || raw.daysExpected <= 0 ||
      raw.daysObserved > raw.daysExpected) {
    addFlag(flags, 'INVALID_DAY_COVERAGE', 'critical', 'Couverture des relevés incohérente.');
  } else if (raw.daysObserved === 0) {
    addFlag(flags, 'NO_DAILY_OBSERVATION', 'warning', 'Aucun relevé journalier.');
  }
  if (raw.averageOffers !== null && raw.averageOffers !== undefined &&
      !nonNegative(raw.averageOffers)) {
    addFlag(flags, 'INVALID_OFFERS', 'critical', 'Volume d’offres négatif ou invalide.');
  }
  if (nonNegative(raw.averageOffers) && positive(raw.population15To29)) {
    const expected = raw.averageOffers / raw.population15To29 * 10000;
    if (!numeric(raw.offersPer10000Young) ||
        !roughlyEqual(raw.offersPer10000Young, expected)) {
      addFlag(flags, 'YOUNG_DENSITY_MISMATCH', 'critical',
        'Ratio offres / 10 000 jeunes incohérent avec la moyenne du mois.');
    }
  }
  if (nonNegative(raw.averageOffers) &&
      positive(raw.activeEmployerEstablishmentsCount)) {
    const expected = raw.averageOffers / raw.activeEmployerEstablishmentsCount * 100;
    if (!numeric(raw.offersPer100Employers) ||
        !roughlyEqual(raw.offersPer100Employers, expected)) {
      addFlag(flags, 'EMPLOYER_INTENSITY_MISMATCH', 'critical',
        'Ratio offres / 100 établissements incohérent avec la moyenne du mois.');
    }
  }
  return flags;
}

/**
 * Technical diagnostic on already-authorized Admin responses.
 *
 * Never interprets a published fallback green as a real published signal.
 * Never compares colors as though they were a chronological trend, since
 * the two methods have different time bases and uncalibrated thresholds.
 * Does not compute new department scores or edit any source.
 */
export function buildAdminModelValidationAudit(experimentalPayload, publishedIndex, {
  thresholdMargin = AUDIT_THRESHOLD_MARGIN,
} = {}) {
  const modern = buildAdminNationalSimulationMap(experimentalPayload);
  const published = buildAdminPublishedComparisonMap(publishedIndex);
  const valid = modern.available;
  const rawByCode = new Map(valid
    ? experimentalPayload.departments.map(item => [codeKey(item), item]) : []);
  const duplicateRows = duplicatedCodes(valid ? experimentalPayload.departments : []);
  const duplicateScores = duplicatedCodes(valid ? experimentalPayload.scoreSimulation.scores : []);
  const publishedReady = published.available;

  const counts = {
    total: 101, monthlyRows: 0, observedRows: 0, population: 0,
    employers: 0, weighted: 0, weightedFourComponents: 0,
    weightedWithoutTrend: 0, weightedMissingStructural: 0,
    densityOnly: 0, unavailable: 0, provisionalScores: 0,
    indicativeScores: 0, missingTrends: 0, nearThreshold: 0,
    criticalDepartments: 0, warningDepartments: 0,
    compared: 0, strongerVigilance: 0, weakerVigilance: 0,
    unchangedVigilance: 0, majorDivergences: 0,
    excludedDefaultGreen: 0, excludedUnknownOrMissing: 0,
  };
  const matrix = Object.fromEntries(AUDIT_LEVELS.map(from => [
    from, Object.fromEntries([...AUDIT_LEVELS, 'unknown'].map(to => [to, 0])),
  ]));

  const rows = modern.departments.map(department => {
    const code = department.code;
    const raw = valid ? rawByCode.get(code) || null : null;
    const before = published.byCode.get(code);
    const simulated = department.scoreRecord;
    const level = department.color.key;
    const from = before?.color || 'unknown';
    const explicit = publishedReady && before?.explicitlyPublished === true;
    const paired = valid && explicit &&
      Object.hasOwn(LEVEL_ORDER, from) && Object.hasOwn(LEVEL_ORDER, level);
    const delta = paired ? LEVEL_ORDER[level] - LEVEL_ORDER[from] : null;
    const nearThreshold = valid
      ? thresholdProximity(department.index, thresholdMargin) : null;

    const flags = valid
      ? checkMonthlyRow(raw, code, duplicateRows, duplicateScores) : [];
    if (valid && department.basis === 'density_only') {
      addFlag(flags, 'DENSITY_ONLY', 'warning',
        'Couleur indicative : densité seule, sans score pondéré.');
    }
    if (valid && !simulated) {
      addFlag(flags, 'NO_SCORE_RECORD', 'warning', 'Aucune réponse du moteur de score.');
    }
    if (valid && nearThreshold !== null) {
      addFlag(flags, 'NEAR_EXPERIMENTAL_BAND', 'info',
        'À ' + nearThreshold + ' point(s) d’un seuil exploratoire (±' +
          thresholdMargin + '). Ce n’est pas un test des coefficients.');
    }

    const weighted = numeric(department.score) &&
      (department.basis === 'weighted' || department.basis === 'weighted_partial');
    const components = simulated?.components || {};
    const corePresent = numeric(components.density) &&
      numeric(components.employers) &&
      numeric(components.employerIntensity);
    const trendPresent = numeric(components.trend);
    const scoreQuality = simulated?.quality || 'unavailable';

    if (valid) {
      if (raw) counts.monthlyRows += 1;
      if (raw?.daysObserved > 0) counts.observedRows += 1;
      if (positive(raw?.population15To29)) counts.population += 1;
      if (nonNegative(raw?.activeEmployerEstablishmentsCount)) counts.employers += 1;
      if (weighted) {
        counts.weighted += 1;
        if (corePresent && trendPresent) counts.weightedFourComponents += 1;
        else if (corePresent && !trendPresent) counts.weightedWithoutTrend += 1;
        else counts.weightedMissingStructural += 1;
        if (!trendPresent) counts.missingTrends += 1;
      } else if (department.basis === 'density_only') {
        counts.densityOnly += 1;
      } else {
        counts.unavailable += 1;
      }
      if (simulated?.isProvisional === true && weighted) counts.provisionalScores += 1;
      if (scoreQuality === 'indicative' && weighted) counts.indicativeScores += 1;
      if (nearThreshold !== null) counts.nearThreshold += 1;
      if (flags.some(flag => flag.level === 'critical')) counts.criticalDepartments += 1;
      if (flags.some(flag => flag.level === 'warning')) counts.warningDepartments += 1;

      if (explicit && Object.hasOwn(matrix, from)) {
        matrix[from][level] = (matrix[from][level] ?? 0) + 1;
      }
      if (paired) {
        counts.compared += 1;
        if (delta > 0) counts.strongerVigilance += 1;
        else if (delta < 0) counts.weakerVigilance += 1;
        else counts.unchangedVigilance += 1;
        if (Math.abs(delta) >= 2) counts.majorDivergences += 1;
      } else if (publishedReady && before?.defaultGreen) {
        counts.excludedDefaultGreen += 1;
      } else {
        counts.excludedUnknownOrMissing += 1;
      }
    }

    return {
      code, name: raw?.departmentName || before?.name || department.name,
      oldLevel: from, oldExplicit: explicit, oldDefaultGreen: before?.defaultGreen === true,
      newLevel: level, index: department.index, score: department.score,
      scoreBasis: department.basis || 'unavailable', scoreQuality,
      provisional: simulated?.isProvisional === true,
      weighted, hasAllStructuralComponents: corePresent, hasTrend: trendPresent,
      nearThreshold, delta, change: delta === null ? 'non_comparable'
        : delta > 0 ? 'stronger' : delta < 0 ? 'weaker' : 'same',
      daysObserved: raw?.daysObserved ?? null,
      daysExpected: raw?.daysExpected ?? null,
      population15To29: raw?.population15To29 ?? null,
      employers: raw?.activeEmployerEstablishmentsCount ?? null,
      averageOffers: raw?.averageOffers ?? null,
      offersPer10000Young: raw?.offersPer10000Young ?? null,
      offersPer100Employers: raw?.offersPer100Employers ?? null,
      monthlyQuality: raw?.quality || 'unavailable',
      changeMonth: raw?.changeMonth?.value ?? null,
      changeYear: raw?.changeYear?.value ?? null,
      components, reasons: simulated?.reasons || [],
      flags,
    };
  });

  const scoreSimulation = valid ? experimentalPayload.scoreSimulation : null;
  const sharedDays = modern.previewBasis?.sharedDays || [];
  const reference = modern.reference || null;
  const guardrails = [];
  if (valid && modern.isProvisional) {
    if (sharedDays.length < 3 || (modern.previewBasis?.referenceDepartments || 0) < 75) {
      guardrails.push('Provenance provisoire insuffisante : moins de 3 jours ou de 75 départements alignés.');
    }
  }
  if (valid && modern.summary.colored && counts.weighted === 0) {
    guardrails.push('Aucune couleur fondée sur un score pondéré : carte alimentée uniquement par la densité.');
  }
  if (valid && counts.criticalDepartments) {
    guardrails.push(counts.criticalDepartments +
      ' département(s) avec incohérence(s) de données nécessitant vérification.');
  }
  if (valid && duplicateRows.size + duplicateScores.size > 0) {
    guardrails.push('Doublons détectés dans la réponse statistique.');
  }

  return {
    version: AUDIT_VERSION,
    available: valid,
    publishedAvailable: publishedReady,
    month: valid ? modern.month : null,
    publicationDate: publishedReady ? published.latestDate : null,
    modelVersion: modern.modelVersion,
    mode: modern.mode,
    isProvisional: modern.isProvisional,
    sharedDays: Array.isArray(sharedDays) ? sharedDays : [],
    referenceDepartments: modern.previewBasis?.referenceDepartments ?? null,
    previewMethod: modern.previewBasis?.method ?? null,
    populationReferenceYear: modern.populationReferenceYear,
    weights: modern.weights,
    reference,
    sourceScoreSummary: scoreSimulation?.summary || null,
    seasonalityNeutral: valid &&
      scoreSimulation?.scores?.every(s =>
        s.seasonalityFactorApplied === undefined ||
        s.seasonalityFactorApplied === 1) === true,
    thresholdMargin,
    counts,
    matrix,
    rows,
    guardrails,
    findings: [
      'Audit de cohérence technique, pas validation scientifique des seuils.',
      'Vert public par défaut exclu des transitions comparables.',
      'Les écarts entre méthodes ne représentent pas des évolutions dans le temps.',
      'Pour un mois provisoire, jours mensuels et jours communs du score diffèrent.',
      'Offres/jeunes, établissements/jeunes et offres/établissements ne sont pas indépendants.',
      'Sensibilité aux coefficients, saisonnalité annuelle et validation externe non évaluées.',
    ],
  };
}
