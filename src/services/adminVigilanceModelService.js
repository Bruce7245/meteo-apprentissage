import { auth } from '../firebase.js';
import { normalizeRomeCode } from '../utils/occupationUtils.js';

const ACTIVE_CONFIG_OCCUPATION_VIGILANCE_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getActiveOccupationVigilanceConfigHttp';
const ANALYSIS_OCCUPATION_VIGILANCE_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getOccupationVigilanceAnalysisHttp';
const SAVE_DRAFT_OCCUPATION_VIGILANCE_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/saveOccupationVigilanceConfigDraftHttp';
const CONFIG_HISTORY_OCCUPATION_VIGILANCE_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getOccupationVigilanceConfigHistoryHttp';
const CONFIG_COMPARE_OCCUPATION_VIGILANCE_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/compareOccupationVigilanceConfigsHttp';
const PREVIEW_OCCUPATION_VIGILANCE_CONFIG_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/previewOccupationVigilanceConfigHttp';
const ACTIVATE_OCCUPATION_VIGILANCE_CONFIG_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/activateOccupationVigilanceConfigHttp';

function cleanConfigForDraft(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Configuration candidate manquante.');
  }

  const {
    id,
    createdAt,
    validatedAt,
    validatedBy,
    sourceDraftId,
    baseConfigVersion,
    schemaVersion,
    ...rest
  } = config;

  void id;
  void createdAt;
  void validatedAt;
  void validatedBy;
  void sourceDraftId;
  void baseConfigVersion;
  void schemaVersion;

  return {
    ...rest,
    status: 'draft',
  };
}

async function postAdminOccupationConfig(endpoint, body, fallbackMessage) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error('Session administrateur absente.');
  }

  const token = await user.getIdToken();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error || fallbackMessage
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload || {};
}

export async function getActiveOccupationVigilanceConfig() {
  const payload = await postAdminOccupationConfig(
    ACTIVE_CONFIG_OCCUPATION_VIGILANCE_ENDPOINT,
    {},
    'Impossible de charger la configuration active du moteur.'
  );

  return payload.config || null;
}

export async function getOccupationAnalysisForRome(romeCode) {
  const rome = normalizeRomeCode(romeCode);

  if (!rome) {
    throw new Error('Code ROME invalide.');
  }

  return postAdminOccupationConfig(
    ANALYSIS_OCCUPATION_VIGILANCE_ENDPOINT,
    { romeCode: rome },
    'Impossible de charger l’analyse nationale de ce métier.'
  );
}

export async function getOccupationVigilanceConfigHistory() {
  return postAdminOccupationConfig(
    CONFIG_HISTORY_OCCUPATION_VIGILANCE_ENDPOINT,
    {},
    'Impossible de charger l’historique des versions du moteur.'
  );
}

export async function compareOccupationVigilanceConfigVersions(
  leftVersion,
  rightVersion,
  romeCode
) {
  const rome = normalizeRomeCode(romeCode);

  if (!rome) {
    throw new Error(
      'Choisissez un métier ROME avant de comparer les versions.'
    );
  }

  return postAdminOccupationConfig(
    CONFIG_COMPARE_OCCUPATION_VIGILANCE_ENDPOINT,
    {
      leftVersion: String(leftVersion || '').trim(),
      rightVersion: String(rightVersion || '').trim(),
      romeCode: rome,
    },
    'Impossible de comparer les versions du moteur.'
  );
}

export async function previewOccupationVigilanceConfig(
  candidateConfig,
  romeCode,
  baseConfigVersion
) {
  const rome = normalizeRomeCode(romeCode);

  if (!rome) {
    throw new Error(
      'Choisissez un métier ROME avant de lancer la simulation.'
    );
  }

  return postAdminOccupationConfig(
    PREVIEW_OCCUPATION_VIGILANCE_CONFIG_ENDPOINT,
    {
      candidateConfig: cleanConfigForDraft(candidateConfig),
      romeCode: rome,
      baseConfigVersion: String(baseConfigVersion || '').trim(),
    },
    'Impossible de simuler la configuration métier.'
  );
}

export async function saveOccupationVigilanceConfigDraft(
  candidateConfig,
  baseConfigVersion
) {
  const cleanBaseVersion = String(baseConfigVersion || '').trim();

  if (!cleanBaseVersion) {
    throw new Error('Version de base manquante.');
  }

  return postAdminOccupationConfig(
    SAVE_DRAFT_OCCUPATION_VIGILANCE_ENDPOINT,
    {
      candidateConfig: cleanConfigForDraft(candidateConfig),
      baseConfigVersion: cleanBaseVersion,
    },
    'Impossible d’enregistrer le brouillon.'
  );
}

export async function activateOccupationVigilanceConfigDraft(draftId) {
  return postAdminOccupationConfig(
    ACTIVATE_OCCUPATION_VIGILANCE_CONFIG_ENDPOINT,
    {
      draftId: String(draftId || '').trim(),
    },
    'Impossible d’activer la configuration métier.'
  );
}
