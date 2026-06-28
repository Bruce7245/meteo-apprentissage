const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({
  projectId: 'meteo-apprentissage',
});

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error('ADMIN_EMAIL et ADMIN_PASSWORD sont obligatoires.');
  process.exit(1);
}

const auth = getAuth();
const db = getFirestore();

async function createAdmin() {
  let userRecord;

  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`Utilisateur existant trouvé : ${email}`);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      throw error;
    }

    userRecord = await auth.createUser({
      email,
      password,
      emailVerified: true,
      disabled: false,
    });

    console.log(`Utilisateur créé : ${email}`);
  }

  await db.collection('users').doc(userRecord.uid).set(
    {
      email,
      role: 'admin',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`Rôle admin attribué à : ${email}`);
  console.log(`UID : ${userRecord.uid}`);
}

createAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur création admin :', error);
    process.exit(1);
  });
