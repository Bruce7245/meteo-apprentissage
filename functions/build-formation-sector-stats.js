const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "meteo-apprentissage",
});

const db = admin.firestore();

const DEFAULT_CAPACITY_BY_SECTOR = {
  support_entreprise: 18,
  commerce_vente: 18,
  btp: 16,
  industrie: 16,
  services_social: 18,
  restauration_tourisme_loisirs: 16,
  agriculture: 14,
  communication_media: 18,
  transport_logistique: 14,
  spectacle: 12,
  sante: 20,
  unknown: 15,
};

function toDateOnly(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function daysBetween(dateString, asOfDateString) {
  if (!dateString || !asOfDateString) return null;

  const date = new Date(`${dateString}T00:00:00.000Z`);
  const asOf = new Date(`${asOfDateString}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || Number.isNaN(asOf.getTime())) {
    return null;
  }

  return Math.round((date.getTime() - asOf.getTime()) / 86400000);
}

function parisDateString(date = new Date()) {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function increment(counter, key, amount = 1) {
  const cleanKey = key || "unknown";
  counter[cleanKey] = (counter[cleanKey] || 0) + amount;
}

function topCounter(counter, limit = 20) {
  return Object.entries(counter)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createEmptyGroup({ departmentCode, sectorCode, sectorLabel, asOfDate }) {
  return {
    departmentCode,
    sectorCode,
    sectorLabel: sectorLabel || sectorCode,
    asOfDate,

    formationsCount: 0,
    sessionsCount: 0,

    rncpSet: new Set(),
    romeCounter: {},
    cityCounter: {},
    sessionStartCounter: {},

    upcomingSessionsCount: 0,
    upcomingSessionsNext30Days: 0,
    upcomingSessionsNext60Days: 0,
    upcomingSessionsNext90Days: 0,
    recentStartedSessionsCount: 0,

    knownCapacityTotal: 0,
    missingCapacitySessionsCount: 0,
    estimatedCapacityTotal: 0,
    estimatedNeedToSecure: 0,

    nearestSessionStartDate: null,
    nearestSessionDaysBeforeStart: null,

    pastSessionsCount: 0,
    unknownSessionDateCount: 0,
  };
}

function addFormationToGroup(group, formation, asOfDate) {
  group.formationsCount += 1;

  const rncp = formation.rncp || null;
  if (rncp) group.rncpSet.add(rncp);

  const city = formation.venue?.city || "unknown";
  increment(group.cityCounter, city);

  const romeCodes = Array.isArray(formation.romeCodes)
    ? formation.romeCodes
    : [];

  for (const romeCode of romeCodes) {
    increment(group.romeCounter, romeCode);
  }

  const sessions = Array.isArray(formation.sessions) && formation.sessions.length > 0
    ? formation.sessions
    : formation.primarySession
      ? [formation.primarySession]
      : [];

  const defaultCapacity = DEFAULT_CAPACITY_BY_SECTOR[group.sectorCode] || DEFAULT_CAPACITY_BY_SECTOR.unknown;

  for (const session of sessions) {
    group.sessionsCount += 1;

    const startDate = toDateOnly(session.debut);
    const capacity = safeNumber(session.capacite, 0);
    const hasKnownCapacity = capacity > 0;

    if (startDate) {
      increment(group.sessionStartCounter, startDate);
    } else {
      group.unknownSessionDateCount += 1;
    }

    if (hasKnownCapacity) {
      group.knownCapacityTotal += capacity;
    } else {
      group.missingCapacitySessionsCount += 1;
    }

    const estimatedCapacity = hasKnownCapacity ? capacity : defaultCapacity;
    const days = daysBetween(startDate, asOfDate);

    if (days === null) {
      continue;
    }

    if (days < -30) {
      group.pastSessionsCount += 1;
      continue;
    }

    if (days >= -30 && days < 0) {
      group.recentStartedSessionsCount += 1;
      group.estimatedNeedToSecure += Math.round(estimatedCapacity * 0.25);
      group.estimatedCapacityTotal += estimatedCapacity;
      continue;
    }

    if (days >= 0) {
      group.upcomingSessionsCount += 1;
      group.estimatedCapacityTotal += estimatedCapacity;

      if (days <= 30) {
        group.upcomingSessionsNext30Days += 1;
        group.estimatedNeedToSecure += Math.round(estimatedCapacity * 1.0);
      } else if (days <= 60) {
        group.upcomingSessionsNext60Days += 1;
        group.estimatedNeedToSecure += Math.round(estimatedCapacity * 0.75);
      } else if (days <= 90) {
        group.upcomingSessionsNext90Days += 1;
        group.estimatedNeedToSecure += Math.round(estimatedCapacity * 0.5);
      } else {
        group.estimatedNeedToSecure += Math.round(estimatedCapacity * 0.25);
      }

      if (
        group.nearestSessionDaysBeforeStart === null ||
        days < group.nearestSessionDaysBeforeStart
      ) {
        group.nearestSessionDaysBeforeStart = days;
        group.nearestSessionStartDate = startDate;
      }
    }
  }
}

function serializeGroup(group) {
  return {
    departmentCode: group.departmentCode,
    sectorCode: group.sectorCode,
    sectorLabel: group.sectorLabel,
    asOfDate: group.asOfDate,

    formationsCount: group.formationsCount,
    sessionsCount: group.sessionsCount,
    rncpCount: group.rncpSet.size,

    upcomingSessionsCount: group.upcomingSessionsCount,
    upcomingSessionsNext30Days: group.upcomingSessionsNext30Days,
    upcomingSessionsNext60Days: group.upcomingSessionsNext60Days,
    upcomingSessionsNext90Days: group.upcomingSessionsNext90Days,
    recentStartedSessionsCount: group.recentStartedSessionsCount,

    knownCapacityTotal: group.knownCapacityTotal,
    missingCapacitySessionsCount: group.missingCapacitySessionsCount,
    estimatedCapacityTotal: group.estimatedCapacityTotal,
    estimatedNeedToSecure: group.estimatedNeedToSecure,

    nearestSessionStartDate: group.nearestSessionStartDate,
    nearestSessionDaysBeforeStart: group.nearestSessionDaysBeforeStart,

    pastSessionsCount: group.pastSessionsCount,
    unknownSessionDateCount: group.unknownSessionDateCount,

    topRomeCodes: topCounter(group.romeCounter, 15),
    topCities: topCounter(group.cityCounter, 15),
    topSessionStartDates: topCounter(group.sessionStartCounter, 20),

    defaultCapacityUsedBySector:
      DEFAULT_CAPACITY_BY_SECTOR[group.sectorCode] || DEFAULT_CAPACITY_BY_SECTOR.unknown,

    source: "formationDetails",
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: "formationDepartmentSectorStats.v1",
  };
}

async function main() {
  const departmentCode = process.argv[2] || "72";
  const asOfDate = process.argv[3] || parisDateString();

  console.log("==================================================");
  console.log("AGRÉGATION FORMATIONS PAR DÉPARTEMENT / SECTEUR");
  console.log("==================================================");
  console.log(`Département : ${departmentCode}`);
  console.log(`Date calcul : ${asOfDate}`);
  console.log("");

  const snapshot = await db
    .collection("formationDetails")
    .where("importDepartmentCode", "==", departmentCode)
    .get();

  const groups = new Map();

  snapshot.docs.forEach((doc) => {
    const formation = doc.data();

    const sectorCode = formation.sectorCode || "unknown";
    const sectorLabel = formation.sectorLabel || sectorCode;
    const key = `${departmentCode}_${sectorCode}`;

    if (!groups.has(key)) {
      groups.set(
        key,
        createEmptyGroup({
          departmentCode,
          sectorCode,
          sectorLabel,
          asOfDate,
        })
      );
    }

    addFormationToGroup(groups.get(key), formation, asOfDate);
  });

  const docs = Array.from(groups.values())
    .map(serializeGroup)
    .sort((a, b) => b.estimatedNeedToSecure - a.estimatedNeedToSecure);

  let batch = db.batch();
  let count = 0;

  for (const doc of docs) {
    const id = `${doc.departmentCode}_${doc.sectorCode}`;

    batch.set(
      db.collection("formationDepartmentSectorStats").doc(id),
      doc,
      { merge: true }
    );

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

  await db.collection("apiImports").doc(`formation_sector_stats_${departmentCode}`).set(
    {
      type: "formation_department_sector_stats",
      departmentCode,
      asOfDate,
      sourceCollection: "formationDetails",
      targetCollection: "formationDepartmentSectorStats",
      inputCount: snapshot.size,
      writtenCount: docs.length,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: "formation_department_sector_stats_import.v1",
    },
    { merge: true }
  );

  console.log(JSON.stringify({
    ok: true,
    departmentCode,
    asOfDate,
    inputCount: snapshot.size,
    writtenCount: docs.length,
    sectors: docs.map((doc) => ({
      sectorCode: doc.sectorCode,
      formationsCount: doc.formationsCount,
      sessionsCount: doc.sessionsCount,
      upcomingSessionsCount: doc.upcomingSessionsCount,
      recentStartedSessionsCount: doc.recentStartedSessionsCount,
      estimatedNeedToSecure: doc.estimatedNeedToSecure,
      nearestSessionStartDate: doc.nearestSessionStartDate,
      nearestSessionDaysBeforeStart: doc.nearestSessionDaysBeforeStart,
      rncpCount: doc.rncpCount,
    })),
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
