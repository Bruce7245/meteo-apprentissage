const admin = require("firebase-admin");
const {
  DEFAULT_FORMATION_CAPACITY,
  FORMATION_NEED_METHOD_VERSION,
  computeFormationNeed,
} = require("./lib/formation-need.cjs");

admin.initializeApp({
  projectId: "meteo-apprentissage",
});

const db = admin.firestore();

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

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
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
    estimatedDefaultCapacityTotal: 0,
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

  for (const session of sessions) {
    group.sessionsCount += 1;

    const startDate = toDateOnly(
      session.debut || session.startDate || session.dateDebut || null
    );
    const days = daysBetween(startDate, asOfDate);
    const need = computeFormationNeed({
      capacity: session.capacite ?? session.capacity ?? null,
      daysBeforeStart: days,
      defaultCapacity: DEFAULT_FORMATION_CAPACITY,
    });

    if (startDate) {
      increment(group.sessionStartCounter, startDate);
    } else {
      group.unknownSessionDateCount += 1;
    }

    if (need.hasKnownCapacity) {
      group.knownCapacityTotal += need.retainedCapacity;
    } else {
      group.missingCapacitySessionsCount += 1;
      group.estimatedDefaultCapacityTotal += need.retainedCapacity;
    }

    if (days === null) {
      continue;
    }

    if (days >= 0) {
      group.upcomingSessionsCount += 1;

      if (days <= 30) {
        group.upcomingSessionsNext30Days += 1;
      }
      if (days <= 60) {
        group.upcomingSessionsNext60Days += 1;
      }
      if (days <= 90) {
        group.upcomingSessionsNext90Days += 1;
      }
    } else if (days >= -90) {
      group.recentStartedSessionsCount += 1;
    } else {
      group.pastSessionsCount += 1;
    }

    if (need.coefficient <= 0) {
      continue;
    }

    group.estimatedCapacityTotal += need.retainedCapacity;
    group.estimatedNeedToSecure += need.estimatedNeed;

    if (
      group.nearestSessionDaysBeforeStart === null ||
      Math.abs(days) < Math.abs(group.nearestSessionDaysBeforeStart)
    ) {
      group.nearestSessionDaysBeforeStart = days;
      group.nearestSessionStartDate = startDate;
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

    knownCapacityTotal: round(group.knownCapacityTotal),
    missingCapacitySessionsCount: group.missingCapacitySessionsCount,
    estimatedDefaultCapacityTotal: round(group.estimatedDefaultCapacityTotal),
    estimatedCapacityTotal: round(group.estimatedCapacityTotal),
    estimatedNeedToSecure: round(group.estimatedNeedToSecure),

    nearestSessionStartDate: group.nearestSessionStartDate,
    nearestSessionDaysBeforeStart: group.nearestSessionDaysBeforeStart,

    pastSessionsCount: group.pastSessionsCount,
    unknownSessionDateCount: group.unknownSessionDateCount,

    topRomeCodes: topCounter(group.romeCounter, 15),
    topCities: topCounter(group.cityCounter, 15),
    topSessionStartDates: topCounter(group.sessionStartCounter, 20),

    defaultCapacity: DEFAULT_FORMATION_CAPACITY,
    defaultCapacityUsedBySector: DEFAULT_FORMATION_CAPACITY,
    calculationMethod: FORMATION_NEED_METHOD_VERSION,

    source: "formationDetails",
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: "formationDepartmentSectorStats.v2",
  };
}

async function main() {
  const departmentCode = process.argv[2] || "72";
  const asOfDate = process.argv[3] || parisDateString();

  console.log("==================================================");
  console.log("AGREGATION FORMATIONS PAR DEPARTEMENT / SECTEUR");
  console.log("==================================================");
  console.log(`Departement : ${departmentCode}`);
  console.log(`Date calcul : ${asOfDate}`);
  console.log(`Methode : ${FORMATION_NEED_METHOD_VERSION}`);
  console.log(`Capacite par defaut : ${DEFAULT_FORMATION_CAPACITY}`);
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
      defaultCapacity: DEFAULT_FORMATION_CAPACITY,
      calculationMethod: FORMATION_NEED_METHOD_VERSION,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: "formation_department_sector_stats_import.v2",
    },
    { merge: true }
  );

  console.log(JSON.stringify({
    ok: true,
    departmentCode,
    asOfDate,
    calculationMethod: FORMATION_NEED_METHOD_VERSION,
    defaultCapacity: DEFAULT_FORMATION_CAPACITY,
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
