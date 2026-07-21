const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp({ projectId: "meteo-apprentissage" });
}

const db = getFirestore();

function addBreakdown(target, source) {
  if (!source || typeof source !== "object") return;

  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + Number(value || 0);
  }
}

async function main() {
  console.log("===== STATUTS GLOBAUX departmentDailyStats =====");

  const dailySnap = await db.collection("departmentDailyStats")
    .orderBy("date", "desc")
    .limit(800)
    .get();

  const dailyStatuses = {};
  const dailyDates = new Set();

  for (const doc of dailySnap.docs) {
    const data = doc.data();

    if (data.date) dailyDates.add(data.date);

    addBreakdown(dailyStatuses, data.enrichedDetailSummary?.statusBreakdown);
    addBreakdown(dailyStatuses, data.statusDetailSummary?.statusBreakdown);
  }

  console.log("docs lus:", dailySnap.size);
  console.log("dates:", Array.from(dailyDates).sort());
  console.log("statuts:", Object.keys(dailyStatuses).sort());
  console.log("totaux:", dailyStatuses);

  console.log("");
  console.log("===== STATUTS SECTORIELS departmentSectorVigilanceDaily =====");

  const sectorSnap = await db.collection("departmentSectorVigilanceDaily")
    .orderBy("date", "desc")
    .limit(1200)
    .get();

  const sectorStatuses = {};
  const sectorDates = new Set();
  const sectors = new Set();

  for (const doc of sectorSnap.docs) {
    const data = doc.data();

    if (data.date) sectorDates.add(data.date);

    const sectorLabel = data.sectorLabel || data.sector || data.label;
    if (sectorLabel) sectors.add(sectorLabel);

    addBreakdown(sectorStatuses, data.metrics?.statusBreakdown);
    addBreakdown(sectorStatuses, data.statusBreakdown);
  }

  console.log("docs lus:", sectorSnap.size);
  console.log("dates:", Array.from(sectorDates).sort());
  console.log("secteurs:", Array.from(sectors).sort());
  console.log("statuts:", Object.keys(sectorStatuses).sort());
  console.log("totaux:", sectorStatuses);

  console.log("");
  console.log("===== FIN CHECK =====");
}

main().catch((error) => {
  console.error("ERREUR CHECK:", error);
  process.exit(1);
});
