const admin = require('firebase-admin');
const {
  aggregateOccupationContext,
  extractOfferDetailsFromSnapshot,
} = require('./lib/occupation-context.cjs');
const { extractDailyRomeObservations } = require('./lib/occupation-history.cjs');
const { normalizeRomeCode } = require('./lib/occupation-search.cjs');

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

async function loadOfferAggregateDocuments() {
  const snapshots = [];

  for (const collectionName of ['lbaOfferStatsDaily', 'dailyOfferSnapshots']) {
    const snapshot = await db
      .collection(collectionName)
      .where('departmentCode', '==', departmentCode)
      .where('date', '==', asOfDate)
      .get();
    for (const doc of snapshot.docs) {
      snapshots.push({ collectionName, id: doc.id, data: doc.data() || {} });
    }
  }

  return snapshots;
}

function buildOfferSummaryByRome(documents) {
  const byRome = new Map();
  for (const document of documents) {
    for (const observation of extractDailyRomeObservations(document.data)) {
      if (observation.date !== asOfDate) continue;
      const previous = byRome.get(observation.romeCode);
      if (previous && previous.activeOffersCount !== observation.activeOffersCount) {
        throw new Error(
          `Conflicting offer totals for ${departmentCode}/${observation.romeCode}/${asOfDate}`
        );
      }
      byRome.set(observation.romeCode, {
        activeOffersCount: observation.activeOffersCount,
        openingsCount: observation.openingsCount ?? previous?.openingsCount ?? null,
      });
    }
  }
  return byRome;
}

function collectRawOffers(documents) {
  const byId = new Map();
  for (const document of documents) {
    for (const [index, offer] of extractOfferDetailsFromSnapshot(document.data).entries()) {
      const id = String(
        offer?.offerId || offer?.id || offer?.partnerJobId || `${document.id}:${index}`
      );
      if (!byId.has(id)) byId.set(id, offer);
    }
  }
  return [...byId.values()];
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
  const [population, formations, offerDocuments] = await Promise.all([
    loadPopulation(),
    loadFormations(),
    loadOfferAggregateDocuments(),
  ]);

  const offerSummaryByRome = buildOfferSummaryByRome(offerDocuments);
  const rawOffers = collectRawOffers(offerDocuments);
  const romeCodes = collectRomeCodes(formations, offerSummaryByRome, rawOffers);
  const computedAt = admin.firestore.FieldValue.serverTimestamp();

  const output = romeCodes.map((romeCode) => ({
    ...aggregateOccupationContext({
      departmentCode,
      romeCode,
      asOfDate,
      offerSummary: offerSummaryByRome.get(romeCode) || null,
      offers: rawOffers,
      formations,
      population,
    }),
    sourceCollections: [
      'lbaOfferStatsDaily',
      'dailyOfferSnapshots',
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
    offerAggregateDocumentsRead: offerDocuments.length,
    rawOfferDetailsRead: rawOffers.length,
    populationAvailable: Boolean(population),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
