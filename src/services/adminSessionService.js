import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase.js';

const ADMIN_SESSION_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/getAdminSessionHttp';
const ADMIN_LOGOUT_ENDPOINT =
  'https://europe-west1-meteo-apprentissage.cloudfunctions.net/recordAdminLogoutHttp';

export async function getReadyAdminUser({ timeoutMs = 5000 } = {}) {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  if (typeof auth.authStateReady === 'function') {
    try {
      await auth.authStateReady();
    } catch {
      // Le listener ci-dessous reste la source de repli.
    }

    if (auth.currentUser) {
      return auth.currentUser;
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    let timeoutId = null;

    function finish(user) {
      if (settled) return;
      settled = true;

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      unsubscribe();
      resolve(user || null);
    }

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => finish(user),
      () => finish(null)
    );

    timeoutId = window.setTimeout(
      () => finish(auth.currentUser),
      timeoutMs
    );
  });
}

async function postWithAdminToken(endpoint, user, { forceRefresh = false } = {}) {
  const resolvedUser = user || await getReadyAdminUser();

  if (!resolvedUser) {
    const error = new Error('Session administrateur absente.');
    error.status = 401;
    throw error;
  }

  const token = await resolvedUser.getIdToken(forceRefresh);
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

export async function verifyAdminSession(user = null) {
  return postWithAdminToken(
    ADMIN_SESSION_ENDPOINT,
    user,
    { forceRefresh: true }
  );
}

export async function recordAdminLogout(user = null) {
  const resolvedUser = user || auth.currentUser;

  if (!resolvedUser) return;

  await postWithAdminToken(
    ADMIN_LOGOUT_ENDPOINT,
    resolvedUser,
    { forceRefresh: false }
  );
}
