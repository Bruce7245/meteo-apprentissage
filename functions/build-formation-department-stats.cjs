const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "meteo-apprentissage" });
}

const db = admin.firestore();

const departmentCode = String(process.argv[2] || "72").toUpperCase();
const asOfDate = String(process.argv[3] || new Date().toISOString().slice(0, 10));
const defaultCapacity = Number(process.argv[4] || 8);

function parseDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

function diffDays(fromDate, toDate) {
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function getTimeCoefficient(daysBeforeStart) {
  if (daysBeforeStart > 180) return 0.10;
  if (daysBeforeStart > 120) return 0.20;
  if (daysBeforeStart > 90) return 0.35;
  if (daysBeforeStart > 60) return 0.50;
  if (daysBeforeStart > 30) return 0.70;
  if (daysBeforeStart > 15) return 0.85;
  if (daysBeforeStart >= 0) return 1.00;

  if (daysBeforeStart >= -30) return 0.60;
  if (daysBeforeStart >= -90) return 0.25;

  return 0;
}

function getSector(stats, sectorCode, sectorLabel) {
  const code = sectorCode || "unknown";

  if (!stats[code]) {
    stats[code] = {
      departmentCode,
      sectorCode: code,
      sectorLabel: sectorLabel || "Secteur inconnu",

      formationsCount: 0,
      sessionsCount: 0,
      upcomingSessionsCount: 0,
      recentStartedSessionsCount: 0,

      knownCapacityTotal: 0,
      estimatedDefaultCapacityTotal: 0,
      estimatedCapacityTotal: 0,
      estimatedNeedToSecure: 0,

      nearestSessionStartDate: null,
      nearestSessionDaysBeforeStart: null,

      rncpSet: new Set(),
      romeSet: new Set(),
      venueSiretSet: new Set(),
      uaiSet: new Set(),

      sessionStartCounter: {},
      topRncp: {},
      topRome: {},
      examples: [],
    };
  }

  return stats[code];
}

function addCount(map, key) {
  const safeKey = key || "unknown";
  map[safeKey] = (map[safeKey] || 0) + 1;
}

function toSortedCounterObject(counter) {
  return Object.entries(counter)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
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
  const asOf = parseDateOnly(asOfDate);

  if (!asOf) {
    throw new Error(`Date invalide: ${asOfDate}`);
  }

  console.log("Agrégation formations département", departmentCode);
  console.log("Date de calcul:", asOfDate);
  console.log("Capacité par défaut:", defaultCapacity);

  const snapshot = await db.collection("formationDetails")
    .where("venue.departmentCode", "==", departmentCode)
    .get();

  const sectorStats = {};
  const globalSessionStartCounter = {};

  let scanned = 0;

  for (const doc of snapshot.docs) {
    scanned += 1;

    const data = doc.data();

    const sector = getSector(
      sectorStats,
      data.sectorCode || "unknown",
      data.sectorLabel || "Secteur inconnu"
    );

    sector.formationsCount += 1;

    if (data.rncp) {
      sector.rncpSet.add(data.rncp);
      addCount(sector.topRncp, data.rncp);
    }

    for (const romeCode of data.romeCodes || []) {
      sector.romeSet.add(romeCode);
      addCount(sector.topRome, romeCode);
    }

    if (data.venue?.siret) {
      sector.venueSiretSet.add(data.venue.siret);
    }

    if (data.venue?.uai) {
      sector.uaiSet.add(data.venue.uai);
    }

    if (sector.examples.length < 8) {
      sector.examples.push({
        formationId: data.formationId || null,
        intitule: data.intitule || null,
        rncp: data.rncp || null,
        romeCodes: data.romeCodes || [],
        primarySession: data.primarySession || null,
        venue: data.venue || null,
      });
    }

    const sessions = Array.isArray(data.sessions) && data.sessions.length > 0
      ? data.sessions
      : data.primarySession
        ? [data.primarySession]
        : [];

    for (const session of sessions) {
      sector.sessionsCount += 1;

      const start = parseDateOnly(session.debut);
      const startKey = start ? start.toISOString().slice(0, 10) : "unknown";

      addCount(sector.sessionStartCounter, startKey);
      addCount(globalSessionStartCounter, startKey);

      if (!start) continue;

      const daysBeforeStart = diffDays(asOf, start);
      const timeCoefficient = getTimeCoefficient(daysBeforeStart);

      if (daysBeforeStart >= 0) {
        sector.upcomingSessionsCount += 1;
      } else if (daysBeforeStart >= -30) {
        sector.recentStartedSessionsCount += 1;
      }

      if (timeCoefficient <= 0) continue;

      if (
        sector.nearestSessionStartDate === null ||
        Math.abs(daysBeforeStart) < Math.abs(sector.nearestSessionDaysBeforeStart)
      ) {
        sector.nearestSessionStartDate = startKey;
        sector.nearestSessionDaysBeforeStart = daysBeforeStart;
      }

      const knownCapacity = Number(session.capacite);
      const hasKnownCapacity = Number.isFinite(knownCapacity) && knownCapacity > 0;
      const baseCapacity = hasKnownCapacity ? knownCapacity : defaultCapacity;

      if (hasKnownCapacity) {
        sector.knownCapacityTotal += knownCapacity;
      } else {
        sector.estimatedDefaultCapacityTotal += defaultCapacity;
      }

      sector.estimatedCapacityTotal += baseCapacity;
      sector.estimatedNeedToSecure += baseCapacity * timeCoefficient;
    }
  }

  const finalizedSectors = Object.values(sectorStats)
    .map((sector) => {
      const output = {
        departmentCode: sector.departmentCode,
        sectorCode: sector.sectorCode,
        sectorLabel: sector.sectorLabel,

        formationsCount: sector.formationsCount,
        sessionsCount: sector.sessionsCount,
        upcomingSessionsCount: sector.upcomingSessionsCount,
        recentStartedSessionsCount: sector.recentStartedSessionsCount,

        knownCapacityTotal: sector.knownCapacityTotal,
        estimatedDefaultCapacityTotal: sector.estimatedDefaultCapacityTotal,
        estimatedCapacityTotal: Math.round(sector.estimatedCapacityTotal * 100) / 100,
        estimatedNeedToSecure: Math.round(sector.estimatedNeedToSecure * 100) / 100,

        nearestSessionStartDate: sector.nearestSessionStartDate,
        nearestSessionDaysBeforeStart: sector.nearestSessionDaysBeforeStart,

        distinctRncpCount: sector.rncpSet.size,
        distinctRomeCount: sector.romeSet.size,
        distinctVenueSiretCount: sector.venueSiretSet.size,
        distinctUaiCount: sector.uaiSet.size,

        sessionStartCounter: Object.entries(sector.sessionStartCounter)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),

        topRncp: toSortedCounterObject(sector.topRncp)
          .map((item) => ({ rncp: item.key, count: item.count }))
          .slice(0, 20),

        topRome: toSortedCounterObject(sector.topRome)
          .map((item) => ({ romeCode: item.key, count: item.count }))
          .slice(0, 20),

        examples: sector.examples,
      };

      return output;
    })
    .sort((a, b) => b.estimatedNeedToSecure - a.estimatedNeedToSecure);

  const totals = finalizedSectors.reduce((acc, sector) => {
    acc.formationsCount += sector.formationsCount;
    acc.sessionsCount += sector.sessionsCount;
    acc.upcomingSessionsCount += sector.upcomingSessionsCount;
    acc.recentStartedSessionsCount += sector.recentStartedSessionsCount;
    acc.knownCapacityTotal += sector.knownCapacityTotal;
    acc.estimatedDefaultCapacityTotal += sector.estimatedDefaultCapacityTotal;
    acc.estimatedCapacityTotal += sector.estimatedCapacityTotal;
    acc.estimatedNeedToSecure += sector.estimatedNeedToSecure;
    return acc;
  }, {
    formationsCount: 0,
    sessionsCount: 0,
    upcomingSessionsCount: 0,
    recentStartedSessionsCount: 0,
    knownCapacityTotal: 0,
    estimatedDefaultCapacityTotal: 0,
    estimatedCapacityTotal: 0,
    estimatedNeedToSecure: 0,
  });

  totals.estimatedCapacityTotal = Math.round(totals.estimatedCapacityTotal * 100) / 100;
  totals.estimatedNeedToSecure = Math.round(totals.estimatedNeedToSecure * 100) / 100;

  const computedAt = admin.firestore.FieldValue.serverTimestamp();

  const writes = [];

  writes.push({
    ref: db.collection("formationDepartmentStats").doc(departmentCode),
    data: {
      departmentCode,
      asOfDate,
      defaultCapacity,
      importedDocumentsCount: scanned,
      ...totals,
      sectorsCount: finalizedSectors.length,
      topSectorsByEstimatedNeed: finalizedSectors.slice(0, 20).map((sector) => ({
        sectorCode: sector.sectorCode,
        sectorLabel: sector.sectorLabel,
        formationsCount: sector.formationsCount,
        sessionsCount: sector.sessionsCount,
        upcomingSessionsCount: sector.upcomingSessionsCount,
        estimatedNeedToSecure: sector.estimatedNeedToSecure,
        nearestSessionStartDate: sector.nearestSessionStartDate,
      })),
      globalSessionStartCounter: Object.entries(globalSessionStartCounter)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      source: "api-apprentissage-lba-formation-v1",
      computedAt,
      schemaVersion: "formationDepartmentStats.v1",
    },
  });

  for (const sector of finalizedSectors) {
    writes.push({
      ref: db.collection("formationDepartmentSectorStats").doc(`${departmentCode}_${sector.sectorCode}`),
      data: {
        ...sector,
        asOfDate,
        defaultCapacity,
        source: "api-apprentissage-lba-formation-v1",
        computedAt,
        schemaVersion: "formationDepartmentSectorStats.v1",
      },
    });
  }

  await commitWrites(writes);

  console.log("");
  console.log("Agrégation formations terminée.");
  console.log("Documents scannés:", scanned);
  console.log("Totaux:", totals);

  console.log("");
  console.log("Top secteurs par besoin estimé:");
  console.table(finalizedSectors.slice(0, 15).map((sector) => ({
    sectorCode: sector.sectorCode,
    formations: sector.formationsCount,
    sessions: sector.sessionsCount,
    upcoming: sector.upcomingSessionsCount,
    need: sector.estimatedNeedToSecure,
    nearest: sector.nearestSessionStartDate,
  })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
