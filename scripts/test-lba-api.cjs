const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({
  projectId: 'meteo-apprentissage',
});

const db = getFirestore();

const apiUrl = process.env.API_APPRENTISSAGE_URL;
const apiToken = process.env.API_APPRENTISSAGE_TOKEN;

if (!apiUrl) {
  console.error('API_APPRENTISSAGE_URL est obligatoire.');
  process.exit(1);
}

if (!apiToken) {
  console.error('API_APPRENTISSAGE_TOKEN est obligatoire.');
  process.exit(1);
}

function extractItems(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  const possibleKeys = [
    'results',
    'items',
    'data',
    'jobs',
    'offers',
    'opportunities',
    'recruteurs_lba',
    'offres_emploi_lba',
    'offres_emploi_partenaires',
  ];

  for (const key of possibleKeys) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }

  return [];
}

function cleanUrl(url) {
  return String(url)
    .replace(/([?&](token|access_token|apikey|api_key)=)[^&]+/gi, '$1***');
}

async function testApi() {
  console.log('Appel API en cours...');
  console.log(cleanUrl(apiUrl));

  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    console.error('Réponse non JSON reçue.');
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  const items = extractItems(data);
  const sample = items.slice(0, 3);

  await db.collection('apiImports').doc('lba-last-test').set(
    {
      source: 'api-apprentissage-recherche-offre',
      url: cleanUrl(apiUrl),
      ok: response.ok,
      status: response.status,
      contentType,
      detectedItemsCount: items.length,
      sample,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`Statut HTTP : ${response.status}`);
  console.log(`Éléments détectés : ${items.length}`);
  console.log('Résumé enregistré dans Firestore : apiImports/lba-last-test');

  if (!response.ok) {
    console.error('L’API a répondu avec une erreur.');
    process.exit(1);
  }
}

testApi()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur test API :', error);
    process.exit(1);
  });
