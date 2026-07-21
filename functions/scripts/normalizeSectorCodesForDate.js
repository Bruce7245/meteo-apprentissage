const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "meteo-apprentissage" });
}

const db = admin.firestore();

const TARGET_DATE = process.env.TARGET_DATE || "2026-06-22";
const WRITE = process.env.WRITE === "1";

const SECTOR_META = {
  A: { sectorCode: "agriculture", sectorLabel: "Agriculture / espaces naturels", icon: "agriculture" },
  B: { sectorCode: "artisanat_arts", sectorLabel: "Artisanat / arts", icon: "arts" },
  C: { sectorCode: "banque_immobilier", sectorLabel: "Banque / assurance / immobilier", icon: "bank" },
  D: { sectorCode: "commerce_vente", sectorLabel: "Commerce / vente", icon: "commerce" },
  E: { sectorCode: "communication_media", sectorLabel: "Communication / médias / numérique", icon: "communication" },
  F: { sectorCode: "btp", sectorLabel: "Bâtiment / travaux publics", icon: "btp" },
  G: { sectorCode: "restauration_tourisme_loisirs", sectorLabel: "Hôtellerie / restauration / tourisme / loisirs", icon: "restaurant" },
  H: { sectorCode: "industrie", sectorLabel: "Industrie", icon: "industry" },
  I: { sectorCode: "maintenance", sectorLabel: "Installation / maintenance", icon: "maintenance" },
  J: { sectorCode: "sante", sectorLabel: "Santé", icon: "health" },
  K: { sectorCode: "services_social", sectorLabel: "Services / social / collectivité", icon: "services" },
  L: { sectorCode: "spectacle", sectorLabel: "Spectacle", icon: "culture" },
  M: { sectorCode: "support_entreprise", sectorLabel: "Support administratif / entreprise", icon: "admin" },
  N: { sectorCode: "transport_logistique", sectorLabel: "Transport / logistique", icon: "transport" },
};

function normalizeSector(data) {
  const raw = String(data.sectorCode || "").trim().toUpperCase();
  const meta = SECTOR_META[raw];

  if (!meta) return null;

  return {
    ...data,
    oldSectorCode: data.sectorCode,
    sectorFamilyCode: raw,
    sectorCode: meta.sectorCode,
    sectorLabel: meta.sectorLabel,
    icon: meta.icon,
    normalizedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: data.schemaVersion || "departmentSectorDailyStats.normalized.v1",
  };
}

async function normalizeDailyStats() {
  const snap = await db.collection("departmentSectorDailyStats")
    .where("date", "==", TARGET_DATE)
    .get();

  let batch = db.batch();
  let count = 0;
  let normalized = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const next = normalizeSector(data);

    if (!next) {
      skipped += 1;
      continue;
    }

    const nextId = `${TARGET_DATE}_${next.departmentCode}_${next.sectorCode}`;
    const nextRef = db.collection("departmentSectorDailyStats").doc(nextId);

    console.log("daily", doc.id, "->", nextId);

    if (WRITE) {
      batch.set(nextRef, next, { merge: true });

      if (doc.id !== nextId) {
        batch.delete(doc.ref);
      }

      count += 1;

      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }

    normalized += 1;
  }

  if (WRITE && count % 400 !== 0) {
    await batch.commit();
  }

  return { scanned: snap.size, normalized, skipped };
}

async function normalizeCurrentStats() {
  const snap = await db.collection("departmentSectorStats")
    .where("date", "==", TARGET_DATE)
    .get();

  let batch = db.batch();
  let count = 0;
  let normalized = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const next = normalizeSector(data);

    if (!next) {
      skipped += 1;
      continue;
    }

    const nextId = `${next.departmentCode}_${next.sectorCode}`;
    const nextRef = db.collection("departmentSectorStats").doc(nextId);

    console.log("current", doc.id, "->", nextId);

    if (WRITE) {
      batch.set(nextRef, next, { merge: true });

      if (doc.id !== nextId) {
        batch.delete(doc.ref);
      }

      count += 1;

      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }

    normalized += 1;
  }

  if (WRITE && count % 400 !== 0) {
    await batch.commit();
  }

  return { scanned: snap.size, normalized, skipped };
}

async function main() {
  console.log("===== NORMALISATION SECTEURS =====");
  console.log("TARGET_DATE:", TARGET_DATE);
  console.log("WRITE:", WRITE);

  const daily = await normalizeDailyStats();
  const current = await normalizeCurrentStats();

  console.log({ daily, current });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
