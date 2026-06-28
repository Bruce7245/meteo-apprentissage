const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({
  projectId: 'meteo-apprentissage',
});

const db = getFirestore();

async function seedBulletin() {
  await db.collection('bulletins').doc('national-current').set(
    {
      title: 'Marché en tension modérée',
      level: 'Orange',
      summary:
        'Pour la période en cours, le volume d’offres d’apprentissage est inférieur au niveau attendu. Cette situation peut réduire les possibilités de trouver une structure d’accueil dans certains territoires.',
      status: 'published',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log('Bulletin national ajouté avec succès.');
}

seedBulletin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur seed bulletin :', error);
    process.exit(1);
  });
