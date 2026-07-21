const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "meteo-apprentissage",
});

const db = admin.firestore();

const DEPARTMENT = "72";
const DATE = process.argv[2] || "2026-07-05";

function pick(data, keys) {
  const out = {};
  for (const key of keys) {
    out[key] = data[key] ?? null;
  }
  return out;
}

async function readWhere(collection, field, op, value) {
  const snapshot = await db.collection(collection).where(field, op, value).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function readAllLimited(collection, limit = 2000) {
  const snapshot = await db.collection(collection).limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function main() {
  const marketDocId = `${DATE}_${DEPARTMENT}`;
  const marketDoc = await db.collection("departmentMarketSnapshots").doc(marketDocId).get();

  const inseeSector = await readWhere("inseeDepartmentSectorStats", "departmentCode", "==", DEPARTMENT);
  const formationSector = await readWhere("formationDepartmentSectorStats", "departmentCode", "==", DEPARTMENT);

  const dailyByDepartmentCode = await readWhere("departmentSectorDailyStats", "departmentCode", "==", DEPARTMENT);
  const dailyByDate = dailyByDepartmentCode.filter((doc) => doc.date === DATE);

  const legacySectorAll = await readAllLimited("departmentSectorStats", 5000);
  const legacySector72 = legacySectorAll.filter((doc) => {
    return String(doc.departmentCode || "").toUpperCase() === DEPARTMENT ||
      String(doc.id || "").startsWith(`${DEPARTMENT}_`);
  });

  const dailyStatsAll = await readAllLimited("departmentDailyStats", 5000);
  const dailyStats72 = dailyStatsAll.filter((doc) => {
    return String(doc.code || doc.departmentCode || "").toUpperCase() === DEPARTMENT ||
      String(doc.id || "").endsWith(`_${DEPARTMENT}`);
  });

  const dailyStats72Dates = [...new Set(dailyStats72.map((doc) => doc.date || String(doc.id).slice(0, 10)))].sort();
  const sectorDaily72Dates = [...new Set(dailyByDepartmentCode.map((doc) => doc.date || "unknown"))].sort();

  console.log(JSON.stringify({
    date: DATE,
    departmentCode: DEPARTMENT,

    marketSnapshotExists: marketDoc.exists,
    marketSnapshot: marketDoc.exists
      ? pick(marketDoc.data(), [
          "date",
          "departmentCode",
          "sectorsCount",
          "significantSectorsCount",
          "globalPublishedLevel",
          "schemaVersion",
        ])
      : null,

    inseeDepartmentSectorStats: {
      count: inseeSector.length,
      sample: inseeSector.slice(0, 10).map((doc) => ({
        id: doc.id,
        sectorCode: doc.sectorCode,
        sectorLabel: doc.sectorLabel,
        activeEmployerEstablishmentsCount: doc.activeEmployerEstablishmentsCount,
        activeEstablishmentsCount: doc.activeEstablishmentsCount,
        establishmentsCount: doc.establishmentsCount,
      })),
    },

    formationDepartmentSectorStats: {
      count: formationSector.length,
      sample: formationSector.slice(0, 5).map((doc) => ({
        id: doc.id,
        sectorCode: doc.sectorCode,
        formationsCount: doc.formationsCount,
        estimatedNeedToSecure: doc.estimatedNeedToSecure,
      })),
    },

    departmentDailyStats: {
      countFor72: dailyStats72.length,
      availableDates: dailyStats72Dates.slice(-20),
      docsForTargetDate: dailyStats72
        .filter((doc) => (doc.date || String(doc.id).slice(0, 10)) === DATE)
        .map((doc) => ({
          id: doc.id,
          date: doc.date,
          code: doc.code,
          departmentCode: doc.departmentCode,
          returnedActiveJobsCount: doc.returnedActiveJobsCount,
          jobsCount: doc.jobsCount,
          openingCount: doc.openingCount,
          lastError: doc.lastError || null,
        })),
    },

    departmentSectorDailyStats: {
      countFor72: dailyByDepartmentCode.length,
      countForTargetDate: dailyByDate.length,
      availableDates: sectorDaily72Dates.slice(-20),
      sampleForTargetDate: dailyByDate.slice(0, 12).map((doc) => ({
        id: doc.id,
        date: doc.date,
        departmentCode: doc.departmentCode,
        sectorCode: doc.sectorCode,
        sectorLabel: doc.sectorLabel,
        activeOffersCount: doc.activeOffersCount,
        jobsCount: doc.jobsCount,
        openingCount: doc.openingCount,
        activeSampleCount: doc.activeSampleCount,
        usefulStock: doc.usefulStock,
      })),
    },

    departmentSectorStatsLegacy: {
      countFor72: legacySector72.length,
      sample: legacySector72.slice(0, 12).map((doc) => ({
        id: doc.id,
        date: doc.date,
        departmentCode: doc.departmentCode,
        sectorCode: doc.sectorCode,
        sectorLabel: doc.sectorLabel,
        jobsCount: doc.jobsCount,
        openingCount: doc.openingCount,
        activeOffersCount: doc.activeOffersCount,
        offersCount: doc.offersCount,
      })),
    },
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
