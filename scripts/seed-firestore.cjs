const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({
  credential: applicationDefault(),
  projectId: 'meteo-apprentissage',
});

const db = getFirestore();

const departments = [
  {
    id: '72',
    name: 'Sarthe',
    code: '72',
    level: 'Orange',
    reason: 'Volume d’offres inférieur au niveau attendu pour la période.',
    updatedAt: FieldValue.serverTimestamp(),
  },
  {
    id: '53',
    name: 'Mayenne',
    code: '53',
    level: 'Jaune',
    reason: 'Marché en léger resserrement sur plusieurs secteurs.',
    updatedAt: FieldValue.serverTimestamp(),
  },
  {
    id: '44',
    name: 'Loire-Atlantique',
    code: '44',
    level: 'Jaune',
    reason: 'Pression accrue sur les candidatures en alternance.',
    updatedAt: FieldValue.serverTimestamp(),
  },
];

async function seed() {
  const batch = db.batch();

  departments.forEach((department) => {
    const ref = db.collection('departments').doc(department.id);
    batch.set(ref, department);
  });

  await batch.commit();

  console.log('Données Firestore ajoutées avec succès.');
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur pendant le seed Firestore :', error);
    process.exit(1);
  });
