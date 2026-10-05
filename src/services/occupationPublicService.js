import { normalizeDepartmentCode } from '../utils/departmentUtils.js';
import { normalizeRomeCode } from '../utils/occupationUtils.js';

const PUBLIC_OCCUPATION_SEARCH_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicOccupationSearchHttp';
const PUBLIC_OCCUPATION_MAP_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicOccupationMapHttp';
const PUBLIC_OCCUPATION_DEPARTMENT_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicOccupationDepartmentHttp';

async function parsePublicResponse(response, fallbackMessage) {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error || `${fallbackMessage} (HTTP ${response.status})`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload || {};
}

export async function searchPublicOccupations(query, options = {}) {
  const normalizedQuery = String(query || '').trim();

  if (normalizedQuery.length < 2) return [];

  const url = new URL(PUBLIC_OCCUPATION_SEARCH_ENDPOINT);
  url.searchParams.set('q', normalizedQuery);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });

  const payload = await parsePublicResponse(
    response,
    'Recherche métiers et formations indisponible'
  );

  return Array.isArray(payload.results) ? payload.results : [];
}

export async function getPublicOccupationMap(romeCode, options = {}) {
  const rome = normalizeRomeCode(romeCode);
  if (!rome) {
    return { exists: false, romeCode: '', data: null, invalid: true };
  }

  const url = new URL(PUBLIC_OCCUPATION_MAP_ENDPOINT);
  url.searchParams.set('rome', rome);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });

  if (response.status === 404) {
    return { exists: false, romeCode: rome, data: null };
  }

  const payload = await parsePublicResponse(
    response,
    'Carte métier indisponible'
  );

  return {
    exists: payload?.exists === true,
    romeCode: rome,
    data: payload?.data || null,
  };
}

export async function getPublicOccupationDepartment(
  departmentCode,
  romeCode,
  options = {}
) {
  const department = normalizeDepartmentCode(departmentCode);
  const rome = normalizeRomeCode(romeCode);

  if (!department || !rome) {
    return {
      exists: false,
      departmentCode: department || '',
      romeCode: rome,
      data: null,
      invalid: true,
    };
  }

  const url = new URL(PUBLIC_OCCUPATION_DEPARTMENT_ENDPOINT);
  url.searchParams.set('department', department);
  url.searchParams.set('rome', rome);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });

  if (response.status === 404) {
    return {
      exists: false,
      departmentCode: department,
      romeCode: rome,
      data: null,
    };
  }

  const payload = await parsePublicResponse(
    response,
    'Détail métier du département indisponible'
  );

  return {
    exists: payload?.exists === true,
    departmentCode: department,
    romeCode: rome,
    data: payload?.data || null,
  };
}
