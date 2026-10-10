/**
 * ADMIN-ONLY explanatory colors. These are NOT the published vigilance thresholds.
 *
 * 50/100 represents the departmental national-reference index in the
 * experimental model. The provisional bands are deliberately displayed
 * with a simulation label, not promoted to production vigilance.
 */
export const ADMIN_SIMULATION_COLOR_VERSION = 'adminSimulationColorBands.preview.v1';

export const ADMIN_SIMULATION_BANDS = Object.freeze([
  Object.freeze({min:60, key:'green', label:'Vert', meaning:'Indice relativement favorable'}),
  Object.freeze({min:45, key:'yellow', label:'Jaune', meaning:'Indice intermédiaire'}),
  Object.freeze({min:30, key:'orange', label:'Orange', meaning:'Indice relativement faible'}),
  Object.freeze({min:0, key:'red', label:'Rouge', meaning:'Indice très faible'}),
]);

const UNKNOWN_COLOR = Object.freeze({
  key:'unknown',
  label:'Indéterminé',
  meaning:'Référence ou données suffisantes absentes',
  basis:'unavailable',
  index:null,
  version:ADMIN_SIMULATION_COLOR_VERSION,
  detail:'Aucune couleur vert/jaune/orange/rouge ne peut être attribuée sans indice calculable.',
});

function validIndex(value) {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= 0 && value <= 100;
}

export function bandForAdminIndex(value) {
  if (!validIndex(value)) return null;
  return ADMIN_SIMULATION_BANDS.find(band=>value>=band.min) || null;
}

export function getAdminSimulationColor(result) {
  if (!result || typeof result !== 'object') return UNKNOWN_COLOR;
  const validWeighted = validIndex(result.score) && result.quality !== 'unavailable';

  let basis = null;
  let index = null;
  if (validWeighted) {
    basis = result.quality === 'partial' ? 'weighted_partial' : 'weighted';
    index = result.score;
  } else if (
    result.score === null &&
    Array.isArray(result.reasons) &&
    result.reasons.includes('AT_LEAST_TWO_DISTINCT_DIMENSIONS_REQUIRED') &&
    validIndex(result.components?.density)
  ) {
    // This is NOT the weighted score. We show a clearly labelled
    // single-indicator color only when the server has normalized the density
    // against an eligible national reference and returned it explicitly.
    basis = 'density_only';
    index = result.components.density;
  }

  const band = bandForAdminIndex(index);
  if (!band) return UNKNOWN_COLOR;
  const detail = basis === 'density_only'
    ? 'Couleur indicative basée uniquement sur la densité relative d’offres ; le score pondéré reste indisponible.'
    : basis === 'weighted_partial'
      ? 'Couleur exploratoire issue d’un score pondéré partiel : certains critères sont absents.'
      : result.isProvisional === true || result.quality === 'provisional'
        ? 'Couleur exploratoire issue d’un score provisoire calculé sur des journées communes.'
        : 'Couleur exploratoire issue du score expérimental, distinct de la vigilance publiée.';

  return {
    ...band,
    basis,
    index,
    detail,
    version:ADMIN_SIMULATION_COLOR_VERSION,
  };
}

export const ADMIN_SIMULATION_BAND_LEGEND =
  'Rouge : 0–29,99 · Orange : 30–44,99 · Jaune : 45–59,99 · Vert : 60–100. ' +
  'Bornes exploratoires non calibrées, réservées à l’administration.';
