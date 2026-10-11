import {DEPARTMENT_CODES} from './departmentUtils.js';
import {getAdminSimulationColor} from './adminSimulationColors.mjs';

export const OVERSEAS_CODES = Object.freeze(['971', '972', '973', '974', '976']);

export const DEPARTMENT_FALLBACK_NAMES = Object.freeze({
  '971':'Guadeloupe',
  '972':'Martinique',
  '973':'Guyane',
  '974':'La Réunion',
  '976':'Mayotte',
});

const VALUE_KEYS = Object.freeze(['green', 'yellow', 'orange', 'red', 'unknown']);
const VALID_CODES = new Set(DEPARTMENT_CODES);

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Project the existing authenticated Admin response to a full France map.
 * The API supplies the national reference, provisional window and scores.
 * No score, method threshold or vigilance level is calculated here.
 */
export function buildAdminNationalSimulationMap(payload) {
  const valid = payload?.ok === true &&
    payload.scope === 'all_offers_department' &&
    Array.isArray(payload?.departments) &&
    Array.isArray(payload?.scoreSimulation?.scores);

  const statsByCode = new Map();
  const scoresByCode = new Map();
  if (valid) {
    for (const item of payload.departments) {
      if (VALID_CODES.has(item?.departmentCode)) {
        statsByCode.set(item.departmentCode, item);
      }
    }
    for (const item of payload.scoreSimulation.scores) {
      if (VALID_CODES.has(item?.departmentCode)) {
        scoresByCode.set(item.departmentCode, item);
      }
    }
  }

  const departments = DEPARTMENT_CODES.map(code => {
    const data = statsByCode.get(code) || null;
    const score = scoresByCode.get(code) || null;
    const color = getAdminSimulationColor(score);
    return {
      code,
      departmentCode: code,
      name: data?.departmentName || DEPARTMENT_FALLBACK_NAMES[code] ||
        `Département ${code}`,
      color,
      level: color.key,
      score: safeNumber(score?.score),
      index: safeNumber(color.index),
      basis: color.basis,
      scoreQuality: score?.quality || 'unavailable',
      scoreRecord: score,
      data,
      daysObserved: data?.daysObserved ?? null,
      daysExpected: data?.daysExpected ?? null,
      density: safeNumber(data?.offersPer10000Young),
      averageOffers: safeNumber(data?.averageOffers),
      employers: safeNumber(data?.activeEmployerEstablishmentsCount),
      offersPer100Employers: safeNumber(data?.offersPer100Employers),
      changeMonth: data?.changeMonth || null,
      changeYear: data?.changeYear || null,
    };
  });

  const levels = Object.fromEntries(VALUE_KEYS.map(value => [
    value, departments.filter(department => department.color.key === value).length,
  ]));

  const scoring = valid ? payload.scoreSimulation : null;
  const result = {
    available: valid,
    month: valid ? payload.month : null,
    modelVersion: scoring?.calculationVersion || null,
    mode: scoring?.mode || null,
    isProvisional: scoring?.mode === 'provisional_admin_only',
    previewBasis: scoring?.previewBasis || null,
    reference: scoring?.reference || null,
    populationReferenceYear: valid ? payload.populationReferenceYear : null,
    weights: valid ? payload.scoreConfig?.weights || null : null,
    departments,
    byCode: new Map(departments.map(department => [department.code, department])),
    summary: {
      total: departments.length,
      ...levels,
      colored: departments.length - levels.unknown,
      weighted: departments.filter(d =>
        d.basis === 'weighted' || d.basis === 'weighted_partial').length,
      densityOnly: departments.filter(d => d.basis === 'density_only').length,
      provisional: departments.filter(d =>
        d.scoreRecord?.isProvisional === true && d.score !== null).length,
    },
  };

  return result;
}
