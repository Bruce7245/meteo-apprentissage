import { normalizeDepartmentCode } from '../utils/departmentUtils.js';

const PUBLIC_DEPARTMENT_OFFERS_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicDepartmentOffersHttp';

export async function getPublicDepartmentOffers(departmentCode, limit = 20) {
  const code = normalizeDepartmentCode(departmentCode);

  if (!code) {
    return {
      exists: false,
      departmentCode: code,
      data: null,
    };
  }

  const url = new URL(PUBLIC_DEPARTMENT_OFFERS_ENDPOINT);
  url.searchParams.set('department', code);
  url.searchParams.set('limit', String(Math.min(Math.max(Number(limit) || 20, 1), 20)));

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
    throw new Error(`Offres indisponibles (HTTP ${response.status})`);
  }

  const payload = await response.json();

  return {
    exists: payload?.exists === true,
    departmentCode: code,
    data: payload?.data || null,
  };
}
