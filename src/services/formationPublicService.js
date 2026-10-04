import { normalizeDepartmentCode } from '../utils/departmentUtils.js';

const PUBLIC_FORMATION_STATS_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicFormationDepartmentStatsHttp';

export async function getPublicFormationDepartmentStats(departmentCode) {
  const code = normalizeDepartmentCode(departmentCode);

  if (!code) {
    return {
      exists: false,
      departmentCode: code,
      data: null,
    };
  }

  const url = new URL(PUBLIC_FORMATION_STATS_ENDPOINT);
  url.searchParams.set('department', code);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (response.status === 404) {
    return {
      exists: false,
      departmentCode: code,
      data: null,
    };
  }

  if (!response.ok) {
    throw new Error(`Statistiques formations indisponibles (HTTP ${response.status})`);
  }

  const payload = await response.json();

  return {
    exists: payload?.exists === true,
    departmentCode: code,
    data: payload?.data || null,
  };
}
