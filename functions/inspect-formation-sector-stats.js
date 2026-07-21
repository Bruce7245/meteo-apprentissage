const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "meteo-apprentissage",
});

const db = admin.firestore();

async function main() {
  const snapshot = await db
    .collection("formationDepartmentSectorStats")
    .where("departmentCode", "==", "72")
    .get();

  const rows = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .sort((a, b) => Number(b.estimatedNeedToSecure || 0) - Number(a.estimatedNeedToSecure || 0));

  console.log(JSON.stringify(rows.map((row) => ({
    id: row.id,
    sectorCode: row.sectorCode,
    sectorLabel: row.sectorLabel,
    formationsCount: row.formationsCount,
    sessionsCount: row.sessionsCount,
    rncpCount: row.rncpCount,
    upcomingSessionsCount: row.upcomingSessionsCount,
    recentStartedSessionsCount: row.recentStartedSessionsCount,
    estimatedNeedToSecure: row.estimatedNeedToSecure,
    nearestSessionStartDate: row.nearestSessionStartDate,
    nearestSessionDaysBeforeStart: row.nearestSessionDaysBeforeStart,
    topCities: row.topCities?.slice(0, 5),
    topRomeCodes: row.topRomeCodes?.slice(0, 5),
  })), null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
