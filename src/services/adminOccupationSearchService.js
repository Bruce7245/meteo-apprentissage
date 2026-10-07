const PUBLIC_OCCUPATION_SEARCH_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getPublicOccupationSearchHttp';

export async function searchAdminOccupations(query, options = {}) {
  const normalizedQuery = String(query || '').trim();

  if (normalizedQuery.length < 2) return [];

  const url = new URL(PUBLIC_OCCUPATION_SEARCH_ENDPOINT);
  url.searchParams.set('q', normalizedQuery);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        'Recherche métiers et formations indisponible (HTTP ' +
          response.status +
          ')'
    );
  }

  return Array.isArray(payload?.results) ? payload.results : [];
}
