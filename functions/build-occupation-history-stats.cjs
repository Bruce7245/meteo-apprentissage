const admin = require('firebase-admin');
const {
  extractMonthlyRomeObservation,
  extractDailyRomeObservations,
  computeRecentOfferTrend,
} = require('./lib/occupation-history.cjs');
const { normalizeRomeCode } = require('./lib/occupation-search.cjs');
const { dailyOccupationContextCollection } = require('./lib/occupation-source-layout.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'meteo-apprentissage' });
}

const db = admin.firestore();
const departmentCode = String(process.argv[2] || '').trim().toUpperCase();

if (!/^(?:\d{2}|2A|2B|97[1-6])$/.test(departmentCode)) {
  throw new Error('Usage: node functions/build-occupation-history-stats.cjs <departmentCode>');
}

function add(grouped, romeCode, key, observation) {
  if (!grouped.has(romeCode)) {
    grouped.set(romeCode, { monthly: [], daily: [] });
  }
  grouped.get(romeCode)[key].push(observation);
}

function dedupeBy(items, key) {
  const byKey = new Map();
  for (const item of items) {
    const id = item[key];
    if (!id) continue;
    if (byKey.has(id) && byKey.get(id).activeOffersCount !== item.activeOffersCount) {
      throw new Error(`Conflicting ${key} occupation history for ${id}`);
    }
    byKey.set(id, item);
  }
  return [...byKey.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

async function loadMonthly() {
  const snapshot = await db
    .collection('lbaOfferStatsByMonthDepartmentRome')
    .where('departmentCode', '==', departmentCode)
    .get();
  return snapshot.docs.map((doc) => doc.data() || {});
}

async function loadDaily() {
  const snapshot = await db
    .collection(dailyOccupationContextCollection())
    .where('departmentCode', '==', departmentCode)
    .get();
  return snapshot.docs.map((doc) => doc.data() || {});
}

async function commitDocuments(documents) {
  let batch = db.batch();
  let pending = 0;
  for (const document of documents) {
    batch.set(
      db.collection('occupationHistoryStats').doc(`${departmentCode}_${document.romeCode}`),
      document,
      { merge: false }
    );
    pending += 1;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
}

async function main() {
  const [monthlyDocs, dailyDocs] = await Promise.all([loadMonthly(), loadDaily()]);
  const grouped = new Map();

  for (const data of monthlyDocs) {
    const observation = extractMonthlyRomeObservation(data);
    if (observation) add(grouped, observation.romeCode, 'monthly', observation);
  }

  for (const data of dailyDocs) {
    for (const observation of extractDailyRomeObservations(data)) {
      add(grouped, observation.romeCode, 'daily', observation);
    }
  }

  const computedAt = admin.firestore.FieldValue.serverTimestamp();
  const output = [];

  for (const [romeCodeRaw, history] of grouped) {
    const romeCode = normalizeRomeCode(romeCodeRaw);
    if (!romeCode) continue;

    const monthlyHistory = dedupeBy(history.monthly, 'month');
    const dailyHistory = dedupeBy(history.daily, 'date').slice(-30);
    const recentTrend = computeRecentOfferTrend(dailyHistory);

    output.push({
      departmentCode,
      romeCode,
      monthlyHistory,
      dailyHistory,
      monthlyObservationsCount: monthlyHistory.length,
      dailyObservationsCount: dailyHistory.length,
      recentTrend,
      sourceCollections: [
        'lbaOfferStatsByMonthDepartmentRome',
        'occupationContextStats',
      ],
      computedAt,
      schemaVersion: 'occupationHistoryStats.v1',
    });
  }

  output.sort((a, b) => a.romeCode.localeCompare(b.romeCode, 'fr'));
  await commitDocuments(output);

  console.log(JSON.stringify({
    ok: true,
    departmentCode,
    monthlyDocumentsRead: monthlyDocs.length,
    dailyContextDocumentsRead: dailyDocs.length,
    occupationHistoryDocumentsWritten: output.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
