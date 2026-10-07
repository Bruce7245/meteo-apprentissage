const PUBLIC_OCCUPATION_DOMAINS_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicOccupationDomainsHttp';
const PUBLIC_OCCUPATION_DOMAIN_OCCUPATIONS_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicOccupationDomainOccupationsHttp';

async function parseResponse(response, fallbackMessage) {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error || fallbackMessage + ' (HTTP ' + response.status + ')'
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload || {};
}

export function normalizeOccupationDomainCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][0-9]{2}$/.test(code) ? code : '';
}

export async function getPublicOccupationDomains(options = {}) {
  const response = await fetch(PUBLIC_OCCUPATION_DOMAINS_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });

  const payload = await parseResponse(
    response,
    'Liste des secteurs indisponible'
  );

  return {
    asOfDate: payload.asOfDate || null,
    domains: Array.isArray(payload.domains) ? payload.domains : [],
  };
}

export async function getPublicOccupationDomainOccupations(
  domainCode,
  options = {}
) {
  const domain = normalizeOccupationDomainCode(domainCode);

  if (!domain) {
    return {
      exists: false,
      domainCode: '',
      occupations: [],
      invalid: true,
    };
  }

  const url = new URL(PUBLIC_OCCUPATION_DOMAIN_OCCUPATIONS_ENDPOINT);
  url.searchParams.set('domain', domain);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });

  if (response.status === 404) {
    return {
      exists: false,
      domainCode: domain,
      occupations: [],
    };
  }

  const payload = await parseResponse(
    response,
    'Métiers du secteur indisponibles'
  );

  return {
    exists: payload.exists === true,
    asOfDate: payload.asOfDate || null,
    occupationDataDate: payload.occupationDataDate || null,
    domainCode: payload.domainCode || domain,
    domainLabel: payload.domainLabel || domain,
    majorDomainCode: payload.majorDomainCode || '',
    majorDomainLabel: payload.majorDomainLabel || '',
    occupations: Array.isArray(payload.occupations)
      ? payload.occupations
      : [],
  };
}
