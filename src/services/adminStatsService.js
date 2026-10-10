import { getReadyAdminUser } from './adminSessionService.js';
import { normalizeRomeCode } from '../utils/occupationUtils.js';

const OCCUPATION_STATS_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getOccupationVigilanceStatsHttp';

export async function getOccupationPublicationStats(
  romeCode,
  { historyLimit = 30 } = {}
) {
  const rome = normalizeRomeCode(romeCode);

  if (!rome) {
    throw new Error('Code ROME invalide.');
  }

  const user = await getReadyAdminUser();

  if (!user) {
    const error = new Error('Session administrateur absente.');
    error.status = 401;
    throw error;
  }

  const token = await user.getIdToken();
  const response = await fetch(OCCUPATION_STATS_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      romeCode: rome,
      historyLimit,
    }),
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error ||
        'Impossible de charger les statistiques de publication.'
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload || {};
}

const OCCUPATION_OFFERS_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getAdminOccupationOffersHttp';

export async function getAdminOccupationOffers(romeCode,{days=7}={}){
  const rome=normalizeRomeCode(romeCode);
  if(!rome)throw new Error('Code ROME invalide.');
  const user=await getReadyAdminUser();
  if(!user)throw new Error('Session administrateur absente.');
  const response=await fetch(OCCUPATION_OFFERS_ENDPOINT,{
    method:'POST',headers:{
      Accept:'application/json','Content-Type':'application/json',
      Authorization:'Bearer '+await user.getIdToken(),
    },body:JSON.stringify({romeCode:rome,days}),
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok || !result?.ok)throw new Error(result?.error || 'Statistiques métiers indisponibles.');
  return result;
}

const EDITORIAL_CATALOGUE_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getAdminEditorialOccupationCatalogueHttp';

export async function getAdminEditorialOccupationCatalogue() {
  const user = await getReadyAdminUser();
  if (!user) throw new Error('Session administrateur absente.');
  const response = await fetch(EDITORIAL_CATALOGUE_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + await user.getIdToken(),
    },
    body: '{}',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'Catalogue des métiers indisponible.');
  }
  return data;
}
