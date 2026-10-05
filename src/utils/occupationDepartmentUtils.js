import { getRomeSearchState } from './occupationUtils.js';

const REASON_LABELS = {
  CONFIG_INVALID:
    'La configuration de calcul n’est pas validée pour cette publication.',
  ROME_UNKNOWN:
    'Le métier sélectionné n’est pas reconnu dans le référentiel ROME publié.',
  ROME_BASELINE_MISSING:
    'Le moteur ne dispose pas encore d’une base de comparaison suffisante pour ce métier.',
  PRIMARY_OFFERS_MISSING:
    'Le signal principal des offres actives est indisponible.',
  OFFERS_NONE:
    'Aucune offre active n’est observée pour ce métier dans le département.',
  OFFERS_VERY_LOW_VS_EXPECTED:
    'Le volume d’offres est très inférieur au niveau attendu.',
  OFFERS_LOW_VS_EXPECTED:
    'Le volume d’offres est inférieur au niveau attendu.',
  OFFERS_NEAR_EXPECTED:
    'Le volume d’offres est proche du niveau attendu.',
  OFFERS_AT_OR_ABOVE_EXPECTED:
    'Le volume d’offres atteint ou dépasse le niveau attendu.',
  OFFERS_ABSOLUTE_VOLUME_LOW:
    'Le volume absolu reste trop faible pour publier un niveau vert.',
  POPULATION_CONTEXT_MISSING:
    'Le contexte démographique est indisponible et réduit la confiance du signal.',
  SEASONALITY_UNAVAILABLE:
    'L’historique disponible ne permet pas encore d’activer un facteur saisonnier.',
  EMPLOYER_DIVERSITY_LOW:
    'Les offres observées sont concentrées sur un nombre limité d’employeurs.',
  TRAINING_PRESSURE_HIGH:
    'Le contexte de formation augmente le niveau d’offres attendu.',
  RECENT_TREND_DEGRADING:
    'La tendance récente du volume d’offres est en dégradation.',
};

export function resolveDepartmentPublicMode(search = '') {
  const state = getRomeSearchState(search);

  if (!state.present) {
    return {
      mode: 'global',
      romeCode: '',
    };
  }

  if (!state.valid) {
    return {
      mode: 'invalid_occupation',
      romeCode: '',
    };
  }

  return {
    mode: 'occupation',
    romeCode: state.romeCode,
  };
}

export function getOccupationReasonLabel(reasonCode) {
  const code = String(reasonCode || '').trim().toUpperCase();
  return REASON_LABELS[code] || code || 'Signal complémentaire non documenté.';
}
