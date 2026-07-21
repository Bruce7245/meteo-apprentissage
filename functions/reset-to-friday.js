const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "meteo-apprentissage" });
}

const db = admin.firestore();

const KEEP_DATE = process.env.KEEP_DATE || "2026-06-26";
const WRITE = process.env.WRITE === "1";

const datedCollections = [
  "departmentDailyStats",
  "departmentSectorDailyStats",
  "departmentVigilanceDaily",
  "departmentSectorVigilanceDaily",
];

const fullResetCollections = [
  "departmentSectorStats",
];

async function deleteDocs(docs, label) {
  console.log(`${label}: ${docs.length} doc(s) ${WRITE ? "à supprimer" : "trouvés"}`);

  if (!WRITE || docs.length === 0) return docs.length;

  let batch = db.batch();
  let count = 0;

  for (const doc of docs) {
    batch.delete(doc.ref);
    count += 1;

    if (count % 450 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  if (count % 450 !== 0) {
    await batch.commit();
  }

  return docs.length;
}

async function deleteDatedCollectionExceptKeepDate(collectionName) {
  const snap = await db.collection(collectionName).get();

  const toDelete = snap.docs.filter((doc) => {
    const data = doc.data();
    return data.date !== KEEP_DATE;
  });

  return deleteDocs(toDelete, `${collectionName} sauf ${KEEP_DATE}`);
}

async function deleteCollectionAll(collectionName) {
  const snap = await db.collection(collectionName).get();
  return deleteDocs(snap.docs, collectionName);
}

async function main() {
  console.log("===== RESET CONTROLE APPRENTIFR =====");
  console.log("KEEP_DATE:", KEEP_DATE);
  console.log("WRITE:", WRITE);
  console.log("");

  for (const collectionName of datedCollections) {
    await deleteDatedCollectionExceptKeepDate(collectionName);
  }

  for (const collectionName of fullResetCollections) {
    await deleteCollectionAll(collectionName);
  }

  const aiReportsSnap = await db.collection("aiReports").get();
  const aiReportsToDelete = aiReportsSnap.docs.filter((doc) => doc.id !== KEEP_DATE);
  await deleteDocs(aiReportsToDelete, `aiReports sauf ${KEEP_DATE}`);

  const latestRef = db.collection("vigilancePublicIndex").doc("latest");
  const latest = await latestRef.get();

  console.log("vigilancePublicIndex/latest:", latest.exists ? "EXISTE" : "ABSENT");

  if (WRITE && latest.exists) {
    await latestRef.delete();
    console.log("vigilancePublicIndex/latest supprimé");
  }

  const apiImportsSnap = await db.collection("apiImports").get();

  const apiImportsToDelete = apiImportsSnap.docs.filter((doc) => {
    const data = doc.data();
    return data.date !== KEEP_DATE;
  });

  await deleteDocs(apiImportsToDelete, `apiImports sauf date ${KEEP_DATE}`);

  console.log("");
  console.log("===== FIN RESET =====");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
