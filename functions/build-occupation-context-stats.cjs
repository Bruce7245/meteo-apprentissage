const admin = require('firebase-admin');
const {
  aggregateOccupationContext,
  summarizeStrictOffersByRome,
} = require('./lib/occupation-context.cjs');
const { extractDailyRomeObservations } = require('./lib/occupation-history.cjs');
const { normalizeRomeCode } = require('./lib/occupation-search.cjs');
const { dailyDepartmentSnapshotPath } = require('./lib/occupation-source-layout.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'meteo-apprentissage' });
}

const db = admin.firestore();
const departmentCode = String(process.argv[2] || '').trim().toUpperCase();
const asOfDate = String(process.argv[3] || new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())).trim();

if (!/^(?:\d{2}|2A|2B|97[1-6])$/.test(departmentCode)) {
  throw new Error('Usage: node functions/build-occupation-context-stats.cjs <departmentCode> [YYYY-MM-DD]');
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
  throw new Error(`Invalid asOfDate: ${asOfDate}`);
}

async function loadPopulation() {
  const snapshot = await db.collection('departmentPopulationReference').doc(departmentCode).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function loadFormations() {
  let snapshot = await db
    .collection('formationDetails')
    .where('importDepartmentCode', '==', departmentCode)
    .get();

  if (snapshot.empty) {
    snapshot = await db
      .collection('formationDetails')
      .where('venue.departmentCode', '==', departmentCode)
      .get();
  }

  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function loadDailyOfferSnapshot() {
  const ref = db.doc(dailyDepartmentSnapshotPath(asOfDate, departmentCode));
  const snapshot = await ref.get();
  return { ref, exists: snapshot.exists, data: snapshot.exists ? snapshot.data() || {} : null };
}

async function loadRawOffers(departmentRef) {
  const offers = [];
  let lastDoc = null;

  while (true) {
    let query = departmentRef
      .collection('offers')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(1000);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      offers.push({ id: doc.id, ...(doc.data() || {}) });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 1000) break;
  }

  return offers;
}

function fallbackSummaryByRome(snapshotData) {
  const map = new Map();
  for (const item of extractDailyRomeObservations(snapshotData || {})) {
    map.set(item.romeCode, {
      activeOffersCount: item.activeOffersCount,
      openingsCount: item.openingsCount ?? null,
    });
  }
  return map;
}

function collectRomeCodes(formations, offerSummaryByRome, rawOffers) {
  const codes = new Set(offerSummaryByRome.keys());
  for (const formation of formations) {
    for (const value of Array.isArray(formation?.romeCodes) ? formation.romeCodes : []) {
      const code = normalizeRomeCode(value);
      if (code) codes.add(code);
    }
  }
  for (const offer of rawOffers) {
    for (const value of Array.isArray(offer?.romeCodes) ? offer.romeCodes : []) {
      const code = normalizeRomeCode(value);
      if (code) codes.add(code);
    }
  }
  return [...codes].sort((a, b) => a.localeCompare(b, 'fr'));
}

async function commitDocuments(documents) {
  let batch = db.batch();
  let pending = 0;
  for (const document of documents) {
    batch.set(
      db.collection('occupationContextStats').doc(`${asOfDate}_${departmentCode}_${document.romeCode}`),
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
  const [population, formations, dailySnapshot] = await Promise.all([
    loadPopulation(),
    loadFormations(),
    loadDailyOfferSnapshot(),
  ]);

  const rawOffers = dailySnapshot.exists ? await loadRawOffers(dailySnapshot.ref) : [];
  const exactSummary = summarizeStrictOffersByRome(rawOffers);
  const offerSummaryByRome = exactSummary.size > 0
    ? exactSummary
    : fallbackSummaryByRome(dailySnapshot.data);
  const romeCodes = collectRomeCodes(formations, offerSummaryByRome, rawOffers);
  const computedAt = admin.firestore.FieldValue.serverTimestamp();

  const output = romeCodes.map((romeCode) => ({
    ...aggregateOccupationContext({
      departmentCode,
      romeCode,
      asOfDate,
      offerSummary: dailySnapshot.exists
        ? (offerSummaryByRome.get(romeCode) || { activeOffersCount: 0, openingsCount: 0 })
        : null,
      offers: rawOffers,
      formations,
      population,
    }),
    sourceCollections: [
      'dailyOfferSnapshots/{date}/departments/{department}/offers',
      'formationDetails',
      'departmentPopulationReference',
    ],
    computedAt,
    schemaVersion: 'occupationContextStats.v1',
  }));

  await commitDocuments(output);

  console.log(JSON.stringify({
    ok: true,
    departmentCode,
    asOfDate,
    romeCodesCount: output.length,
    formationsRead: formations.length,
    dailyOfferSnapshotAvailable: dailySnapshot.exists,
    rawOfferDetailsRead: rawOffers.length,
    populationAvailable: Boolean(population),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
