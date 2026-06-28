const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
  projectId: 'meteo-apprentissage',
});

const db = getFirestore();

const collectionsToDelete = [
  'departmentStats',
  'departmentDailyStats',
  'apiImports',
];

async function deleteCollection(collectionName, batchSize = 300) {
  const collectionRef = db.collection(collectionName);

  let deletedCount = 0;

  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();

    snapshot.docs.forEach((document) => {
      batch.delete(document.ref);
    });

    await batch.commit();

    deletedCount += snapshot.size;
    console.log(`${collectionName}: ${deletedCount} document(s) supprimé(s)`);
  }

  console.log(`${collectionName}: suppression terminée`);
}

async function main() {
  for (const collectionName of collectionsToDelete) {
    await deleteCollection(collectionName);
  }

  console.log('Nettoyage terminé.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur nettoyage:', error);
    process.exit(1);
  });
