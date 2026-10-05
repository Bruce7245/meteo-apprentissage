const admin = require('firebase-admin');
const {
  computeRecentOfferTrend,
  computeSeasonalityProfile,
} = require('./lib/occupation-history.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'meteo-apprentissage' });
}

const db = admin.firestore();

function parisDateString(date = new Date()) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dateOffset(dateString, days) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const asOfDate = String(process.argv[2] || parisDateString());
const asOfMonth = asOfDate.slice(0, 7);
const recentStartDate = dateOffset(asOfDate, -13);

function keyFor(departmentCode, romeCode) {
  return `${departmentCode}_${romeCode}`;
}

async function loadCurrentContexts() {
  const snapshot = await db
    .collection('occupationContextStats')
    .where('date', '==', asOfDate)
    .get();

  return snapshot.docs.map((doc) => doc.data() || {});
}

async function loadRecentContexts(targetKeys) {
  const snapshot = await db
    .collection('occupationContextStats')
    .where('date', '>=', recentStartDate)
    .where('date', '<=', asOfDate)
    .get();

  const byKey = new Map();

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const key = keyFor(data.departmentCode, data.romeCode);

    if (!targetKeys.has(key)) continue;

    if (!byKey.has(key)) byKey.set(key, []);

    byKey.get(key).push({
      date: data.date,
      activeOffersCount: data.activeOffersCount,
    });
  }

  return byKey;
}

async function loadMonthlyRomeHistory(targetKeys) {
  const byKey = new Map();
  let lastDoc = null;

  while (true) {
    let query = db
      .collection('lbaOfferStatsByMonthDepartmentRome')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(1000);

    if (lastDoc) query = query.startAfter(lastDoc);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const key = keyFor(data.departmentCode, data.romeCode);

      if (!targetKeys.has(key)) continue;

      if (!byKey.has(key)) byKey.set(key, []);

      byKey.get(key).push({
        month: data.month,
        offersCount: data.offersCount,
      });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < 1000) break;
  }

  return byKey;
}

async function commitWrites(writes) {
  let batch = db.batch();
  let count = 0;

  for (const write of writes) {
    batch.set(write.ref, write.data, { merge: false });
    count += 1;

    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) await batch.commit();
}

async function main() {
  const currentContexts = await loadCurrentContexts();

  if (currentContexts.length === 0) {
    throw new Error(`No occupationContextStats for ${asOfDate}`);
  }

  const targetKeys = new Set(
    currentContexts.map((item) => keyFor(item.departmentCode, item.romeCode))
  );

  const [recentByKey, monthlyByKey] = await Promise.all([
    loadRecentContexts(targetKeys),
    loadMonthlyRomeHistory(targetKeys),
  ]);

  const writes = [];

  for (const current of currentContexts) {
    const key = keyFor(current.departmentCode, current.romeCode);

    const recentTrend = computeRecentOfferTrend(recentByKey.get(key) || []);
    const seasonality = computeSeasonalityProfile(
      monthlyByKey.get(key) || [],
      {
        asOfMonth,
        minActiveMonths: 24,
        completenessThreshold: 0.9,
        // Analytical safety clamp only; production engine applies its own
        // versioned configuration bounds again.
        minFactor: 0.5,
        maxFactor: 2,
      }
    );

    writes.push({
      ref: db.collection('occupationHistoryStats').doc(key),
      data: {
        departmentCode: current.departmentCode,
        romeCode: current.romeCode,
        asOfDate,
        recentWindowStartDate: recentStartDate,
        recentTrend,
        seasonality,
        sources: {
          recent: 'occupationContextStats',
          monthly: 'lbaOfferStatsByMonthDepartmentRome',
        },
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 'occupationHistoryStats.v1',
      },
    });
  }

  await commitWrites(writes);

  await db.collection('occupationHistoryStatsRuns').doc(asOfDate).set({
    date: asOfDate,
    status: 'ready',
    contextsCount: writes.length,
    recentWindowStartDate: recentStartDate,
    minActiveSeasonalityMonths: 24,
    completenessThreshold: 0.9,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'occupationHistoryStatsRun.v1',
  });

  console.log(JSON.stringify({
    ok: true,
    date: asOfDate,
    contextsCount: writes.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
