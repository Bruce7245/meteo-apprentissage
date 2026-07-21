const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "meteo-apprentissage",
});

const db = admin.firestore();

async function main() {
  const snapshot = await db
    .collection("formationDetails")
    .where("importDepartmentCode", "==", "72")
    .get();

  const sectors = {};
  const rncps = new Set();
  const cities = {};
  const sessionStarts = {};

  snapshot.docs.forEach((doc) => {
    const data = doc.data();

    const sector = data.sectorCode || "unknown";
    sectors[sector] = (sectors[sector] || 0) + 1;

    const city = data.venue?.city || "unknown";
    cities[city] = (cities[city] || 0) + 1;

    const start = data.primarySession?.debut
      ? String(data.primarySession.debut).slice(0, 10)
      : "unknown";

    sessionStarts[start] = (sessionStarts[start] || 0) + 1;

    if (data.rncp) {
      rncps.add(data.rncp);
    }
  });

  function top(counter, limit = 20) {
    return Object.entries(counter)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  console.log(JSON.stringify({
    departmentCode: "72",
    formationsCount: snapshot.size,
    uniqueRncpCount: rncps.size,
    sectors: top(sectors),
    cities: top(cities),
    sessionStarts: top(sessionStarts, 30),
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
