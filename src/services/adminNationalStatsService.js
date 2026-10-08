import { getReadyAdminUser } from './adminSessionService.js';

const URL = 'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getAdminNationalStatsHttp';

export async function getAdminNationalStats(days = 30) {
  const user = await getReadyAdminUser();
  if (!user) throw new Error('Session administrateur absente.');
  const token = await user.getIdToken();
  const response = await fetch(URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ days }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || 'Statistiques nationales indisponibles.');
  }
  return result;
}
