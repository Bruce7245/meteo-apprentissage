const admin = require('firebase-admin');
const {
  aggregateOccupationContext,
} = require('./lib/occupation-context.cjs');
const {
  normalizeRomeCode,
} = require('./lib/occupation-search.cjs');
const {
  normalizeDepartmentCode,
} = require('./lib/insee-population.cjs');

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

const asOfDate = String(process.argv[2] || parisDateString());

async function loadPopulation() {
  const snapshot = await db.collection('departmentPopulationReference').get();
  const map = new Map();

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const code = normalizeDepartmentCode(data.departmentCode || doc.id);

    if (code) {
      map.set(code, data);
    }
  }

  return map;
}

async function loadFormationsByDepartment() {
  const byDepartment = new Map();
  let lastDoc = null;

  while (true) {
    let query = db
      .collection('formationDetails')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(1000);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const departmentCode = normalizeDepartmentCode(
        data?.venue?.departmentCode ||
        data?.importDepartmentCode
      );

      if (!departmentCode) continue;

      if (!byDepartment.has(departmentCode)) {
        byDepartment.set(departmentCode, []);
      }

      byDepartment.get(departmentCode).push({
        formationId: data.formationId || doc.id,
        rncp: data.rncp || null,
        intitule: data.intitule || null,
        romeCodes: Array.isArray(data.romeCodes) ? data.romeCodes : [],
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
        primarySession: data.primarySession || null,
        venue: {
          departmentCode,
        },
      });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < 1000) break;
  }

  return byDepartment;
}

async function loadActiveDepartmentOffers(departmentRef, activeRunId) {
  const offers = [];
  let lastDoc = null;

  while (true) {
    let query = departmentRef
      .collection('offers')
      .where('runId', '==', activeRunId)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(1000);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      offers.push({
        offerDocId: doc.id,
        ...doc.data(),
      });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < 1000) break;
  }

  return offers;
}

function collectRomeCodes(offers, formations) {
  const codes = new Set();

  for (const item of [...offers, ...formations]) {
    for (const value of Array.isArray(item?.romeCodes) ? item.romeCodes : []) {
      const code = normalizeRomeCode(value);
      if (code) codes.add(code);
    }
  }

  return Array.from(codes).sort((a, b) => a.localeCompare(b, 'fr'));
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

  if (count > 0) {
    await batch.commit();
  }
}

async function main() {
  const [populationByDepartment, formationsByDepartment] = await Promise.all([
    loadPopulation(),
    loadFormationsByDepartment(),
  ]);

  const departmentsSnapshot = await db
    .collection('dailyOfferSnapshots')
    .doc(asOfDate)
    .collection('departments')
    .get();

  if (departmentsSnapshot.empty) {
    throw new Error(`No daily offer department snapshots for ${asOfDate}`);
  }

  const writes = [];
  let departmentsProcessed = 0;
  let occupationContexts = 0;

  for (const departmentDoc of departmentsSnapshot.docs) {
    const departmentCode = normalizeDepartmentCode(departmentDoc.id);
    if (!departmentCode) continue;

    const meta = departmentDoc.data() || {};
    const activeRunId = String(meta.activeRunId || '').trim();

    if (!activeRunId) {
      throw new Error(
        `Department ${departmentCode} has no activeRunId for ${asOfDate}`
      );
    }

    const offers = await loadActiveDepartmentOffers(
      departmentDoc.ref,
      activeRunId
    );
    const formations = formationsByDepartment.get(departmentCode) || [];
    const population = populationByDepartment.get(departmentCode) || null;
    const romeCodes = collectRomeCodes(offers, formations);

    for (const romeCode of romeCodes) {
      const aggregate = aggregateOccupationContext({
        departmentCode,
        romeCode,
        asOfDate,
        offers,
        formations,
        population,
      });

      writes.push({
        ref: db
          .collection('occupationContextStats')
          .doc(`${asOfDate}_${departmentCode}_${romeCode}`),
        data: {
          date: asOfDate,
          ...aggregate,
          sourceVersions: {
            offerRunId: activeRunId,
            populationRunId: population?.runId || null,
            populationReferenceYear: population?.referenceYear || null,
            formationSchemaVersion: 'formationDetails.v1',
          },
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          schemaVersion: 'occupationContextStats.v1',
        },
      });

      occupationContexts += 1;
    }

    departmentsProcessed += 1;
  }

  await commitWrites(writes);

  await db.collection('occupationContextStatsRuns').doc(asOfDate).set({
    date: asOfDate,
    status: 'ready',
    departmentsProcessed,
    occupationContexts,
    populationDepartmentsAvailable: populationByDepartment.size,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'occupationContextStatsRun.v1',
  });

  console.log(JSON.stringify({
    ok: true,
    date: asOfDate,
    departmentsProcessed,
    occupationContexts,
    populationDepartmentsAvailable: populationByDepartment.size,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
