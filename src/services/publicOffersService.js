import { normalizeDepartmentCode } from '../utils/departmentUtils.js';
import { normalizeRomeCode } from '../utils/occupationUtils.js';

const PUBLIC_DEPARTMENT_OFFERS_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicDepartmentOffersHttp';

export async function getPublicDepartmentOffers(
  departmentCode,
  limit = 20,
  options = {}
) {
  const code = normalizeDepartmentCode(departmentCode);
  const requestedRome = options?.romeCode
    ? String(options.romeCode)
    : '';
  const romeCode = requestedRome
    ? normalizeRomeCode(requestedRome)
    : '';

  if (!code || (requestedRome && !romeCode)) {
    return {
      exists: false,
      departmentCode: code,
      romeCode,
      data: null,
      invalid: true,
    };
  }

  const url = new URL(PUBLIC_DEPARTMENT_OFFERS_ENDPOINT);
  url.searchParams.set('department', code);
  url.searchParams.set(
    'limit',
    String(Math.min(Math.max(Number(limit) || 20, 1), 20))
  );

  if (romeCode) {
    url.searchParams.set('rome', romeCode);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal: options?.signal,
  });

  if (response.status === 404) {
    return {
      exists: false,
      departmentCode: code,
      romeCode,
      data: null,
    };
  }

  if (!response.ok) {
    throw new Error(
      'Offres indisponibles (HTTP ' + String(response.status) + ')'
    );
  }

  const payload = await response.json();

  return {
    exists: payload?.exists === true,
    departmentCode: code,
    romeCode,
    data: payload?.data || null,
  };
}
