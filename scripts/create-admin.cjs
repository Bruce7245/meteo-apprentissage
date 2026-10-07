const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({
  projectId: 'meteo-apprentissage',
});

const email = String(process.env.ADMIN_EMAIL || '')
  .trim()
  .toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');

if (!email || !password) {
  console.error('ADMIN_EMAIL et ADMIN_PASSWORD sont obligatoires.');
  process.exit(1);
}

if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error('ADMIN_EMAIL doit contenir une adresse e-mail valide.');
  process.exit(1);
}

if (password.length < 12) {
  console.error('ADMIN_PASSWORD doit contenir au moins 12 caractères.');
  process.exit(1);
}

const auth = getAuth();
const db = getFirestore();

async function createAdmin() {
  let userRecord;
  let created = false;

  try {
    userRecord = await auth.getUserByEmail(email);

    userRecord = await auth.updateUser(userRecord.uid, {
      password,
      emailVerified: true,
      disabled: false,
    });

    console.log(`Compte administrateur existant mis à jour : ${email}`);
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
    created = true;

    console.log(`Compte administrateur créé : ${email}`);
  }

  await db.collection('users').doc(userRecord.uid).set(
    {
      email,
      role: 'admin',
      status: 'active',
      authProvider: 'password',
      updatedAt: FieldValue.serverTimestamp(),
      ...(created
        ? { createdAt: FieldValue.serverTimestamp() }
        : {}),
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
