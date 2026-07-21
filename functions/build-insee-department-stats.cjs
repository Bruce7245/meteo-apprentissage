const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "meteo-apprentissage" });
}

const db = admin.firestore();

const departmentCode = String(process.argv[2] || "72").toUpperCase();
const pageSize = 1000;

function addCounter(map, key, patch = {}) {
  const safeKey = key || "unknown";

  if (!map[safeKey]) {
    map[safeKey] = {
      count: 0,
      ...patch,
    };
  }

  map[safeKey].count += 1;

  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null && map[safeKey][field] == null) {
      map[safeKey][field] = value;
    }
  }
}

async function commitWrites(writes) {
  let batch = db.batch();
  let count = 0;

  for (const write of writes) {
    batch.set(write.ref, write.data, { merge: true });
    count += 1;

    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }
}

async function main() {
  console.log("Agrégation INSEE département", departmentCode);

  let lastDocId = null;
  let scanned = 0;
  let activeEmployerEstablishmentsCount = 0;

  const sectorStats = {};
  const nafStats = {};
  const cityStats = {};

  while (true) {
    let query = db.collection("inseeEstablishments")
      .where("importDepartmentCode", "==", departmentCode)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);

    if (lastDocId) {
      query = query.startAfter(lastDocId);
    }

    const snap = await query.get();

    if (snap.empty) {
      break;
    }

    for (const doc of snap.docs) {
      scanned += 1;
      lastDocId = doc.id;

      const data = doc.data();

      if (data.active !== true) {
        continue;
      }

      activeEmployerEstablishmentsCount += 1;

      const sectorCode = data.sectorCode || "unknown";
      const sectorLabel = data.sectorLabel || "Secteur inconnu";
      const nafCode = data.nafCode || "unknown";
      const city = data.city || "unknown";

      addCounter(sectorStats, sectorCode, {
        sectorCode,
        sectorLabel,
      });

      addCounter(nafStats, nafCode, {
        nafCode,
        sectorCode,
        sectorLabel,
      });

      addCounter(cityStats, city, {
        city,
      });
    }

    console.log("Scannés:", scanned, "Actifs employeurs:", activeEmployerEstablishmentsCount);

    if (snap.size < pageSize) {
      break;
    }
  }

  const computedAt = admin.firestore.FieldValue.serverTimestamp();

  const sortedSectors = Object.values(sectorStats)
    .sort((a, b) => b.count - a.count);

  const sortedNaf = Object.values(nafStats)
    .sort((a, b) => b.count - a.count);

  const sortedCities = Object.values(cityStats)
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  const writes = [];

  writes.push({
    ref: db.collection("inseeDepartmentStats").doc(departmentCode),
    data: {
      departmentCode,
      importScope: "active_employer_establishments",
      importedDocumentsCount: scanned,
      activeEmployerEstablishmentsCount,
      sectorsCount: sortedSectors.length,
      nafCodesCount: sortedNaf.length,
      topSectors: sortedSectors.slice(0, 20),
      topNafCodes: sortedNaf.slice(0, 30),
      topCities: sortedCities,
      source: "api-sirene-insee-3.11",
      computedAt,
      schemaVersion: "inseeDepartmentStats.v1",
    },
  });

  for (const sector of sortedSectors) {
    writes.push({
      ref: db.collection("inseeDepartmentSectorStats").doc(`${departmentCode}_${sector.sectorCode}`),
      data: {
        departmentCode,
        sectorCode: sector.sectorCode,
        sectorLabel: sector.sectorLabel,
        activeEmployerEstablishmentsCount: sector.count,
        source: "api-sirene-insee-3.11",
        computedAt,
        schemaVersion: "inseeDepartmentSectorStats.v1",
      },
    });
  }

  for (const naf of sortedNaf) {
    writes.push({
      ref: db.collection("inseeDepartmentNafStats").doc(`${departmentCode}_${naf.nafCode}`),
      data: {
        departmentCode,
        nafCode: naf.nafCode,
        sectorCode: naf.sectorCode,
        sectorLabel: naf.sectorLabel,
        activeEmployerEstablishmentsCount: naf.count,
        source: "api-sirene-insee-3.11",
        computedAt,
        schemaVersion: "inseeDepartmentNafStats.v1",
      },
    });
  }

  await commitWrites(writes);

  console.log("");
  console.log("Agrégation terminée.");
  console.log("Documents scannés:", scanned);
  console.log("Établissements actifs employeurs:", activeEmployerEstablishmentsCount);
  console.log("Secteurs:", sortedSectors.length);
  console.log("NAF:", sortedNaf.length);

  console.log("");
  console.log("Top secteurs:");
  console.table(sortedSectors.slice(0, 15));

  console.log("");
  console.log("Top NAF:");
  console.table(sortedNaf.slice(0, 15));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
