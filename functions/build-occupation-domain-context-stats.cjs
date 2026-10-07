const admin = require('firebase-admin');
const {
  prepareOccupationDomainContexts,
  createFirestoreOccupationDomainPrecomputeRepository,
} = require('./occupation-domain-precompute.cjs');

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'meteo-apprentissage',
  });
}

const db = admin.firestore();

const date = String(process.argv[2] || '').trim();

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(
    'Usage: node build-occupation-domain-context-stats.cjs YYYY-MM-DD'
  );
  process.exit(1);
}

const repository =
  createFirestoreOccupationDomainPrecomputeRepository(
    db,
    {
      FieldValue: admin.firestore.FieldValue,
      FieldPath: admin.firestore.FieldPath,
    }
  );

prepareOccupationDomainContexts({
  date,
  repository,
})
  .then((result) => {
    console.log(
      JSON.stringify(
        {
          ok: true,
          ...result,
        },
        null,
        2
      )
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
