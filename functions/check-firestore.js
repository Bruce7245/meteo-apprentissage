const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "meteo-apprentissage",
});

const db = admin.firestore();

async function main() {
  const importDoc = await db
    .collection("apiImports")
    .doc("lba_formations_72_page_0")
    .get();

  console.log("===== apiImports/lba_formations_72_page_0 =====");

  if (!importDoc.exists) {
    console.log("Document introuvable");
  } else {
    console.log(JSON.stringify(importDoc.data(), null, 2));
  }

  const formationsSnapshot = await db
    .collection("formationDetails")
    .where("importDepartmentCode", "==", "72")
    .limit(10)
    .get();

  console.log("");
  console.log("===== 10 premières formations du 72 =====");
  console.log("Nombre trouvé :", formationsSnapshot.size);

  formationsSnapshot.docs.forEach((doc) => {
    const data = doc.data();

    console.log({
      id: doc.id,
      intitule: data.intitule,
      rncp: data.rncp,
      sectorCode: data.sectorCode,
      city: data.venue?.city,
      departmentCode: data.venue?.departmentCode,
      session: data.primarySession,
    });
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
