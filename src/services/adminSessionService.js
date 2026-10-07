import { auth } from '../firebase.js';

const ADMIN_SESSION_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getAdminSessionHttp';
const ADMIN_LOGOUT_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/recordAdminLogoutHttp';

async function postWithAdminToken(endpoint, user, { forceRefresh = false } = {}) {
  if (!user) {
    const error = new Error('Session administrateur absente.');
    error.status = 401;
    throw error;
  }

  const token = await user.getIdToken(forceRefresh);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error || 'Impossible de vérifier la session administrateur.'
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload || {};
}

export function verifyAdminSession(user = auth.currentUser) {
  return postWithAdminToken(
    ADMIN_SESSION_ENDPOINT,
    user,
    { forceRefresh: true }
  );
}

export async function recordAdminLogout(user = auth.currentUser) {
  if (!user) return;

  await postWithAdminToken(
    ADMIN_LOGOUT_ENDPOINT,
    user,
    { forceRefresh: false }
  );
}
