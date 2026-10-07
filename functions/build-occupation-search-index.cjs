const crypto = require('node:crypto');
const admin = require('firebase-admin');
const {
  buildOccupationIndexEntry,
  buildTrainingIndexEntries,
} = require('./lib/occupation-search-index.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'meteo-apprentissage' });
}

const db = admin.firestore();
const asOfDate = String(process.argv[2] || new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date()));

function stableHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

async function loadCurrentRomeReference() {
  const metaSnapshot = await db
    .collection('occupationReferenceMeta')
    .doc('current')
    .get();

  if (!metaSnapshot.exists) {
    throw new Error('occupationReferenceMeta/current is missing');
  }

  const meta = metaSnapshot.data() || {};
  const runId = String(meta.runId || '').trim();

  if (!runId) {
    throw new Error('occupationReferenceMeta/current has no runId');
  }

  const snapshot = await db
    .collection('occupationReference')
    .where('importRunId', '==', runId)
    .get();

  if (snapshot.empty) {
    throw new Error(`No occupationReference entries found for run ${runId}`);
  }

  return {
    meta,
    entries: snapshot.docs.map((doc) => doc.data()),
  };
}

async function loadFormationDetails() {
  const formations = [];
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

      formations.push({
        intitule: data.intitule || data.title || null,
        rncp: data.rncp || null,
        romeCodes: Array.isArray(data.romeCodes) ? data.romeCodes : [],
      });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < 1000) break;
  }

  return formations;
}

async function commitEntries(entries, runId) {
  const collection = db
    .collection('publicOccupationSearchIndexes')
    .doc(runId)
    .collection('entries');

  let batch = db.batch();
  let pending = 0;

  for (const entry of entries) {
    batch.set(collection.doc(entry.entryId), {
      ...entry,
      indexRunId: runId,
      schemaVersion: 'publicOccupationSearchEntry.v1',
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    pending += 1;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }
}

async function main() {
  const [romeReference, formations] = await Promise.all([
    loadCurrentRomeReference(),
    loadFormationDetails(),
  ]);

  const occupationEntries = romeReference.entries
    .map((entry) => buildOccupationIndexEntry(entry, { asOfDate }))
    .filter(Boolean);

  const provisionalTrainingEntries = buildTrainingIndexEntries(formations, {
    source: 'formationDetails',
    sourceVersion: 'pending',
    asOfDate,
  });

  const trainingProjectionHash = stableHash(
    provisionalTrainingEntries.map((entry) => ({
      publicId: entry.publicId,
      rncp: entry.rncp,
      normalizedLabel: entry.normalizedLabel,
      romeCodes: entry.romeCodes,
    }))
  );

  const trainingSourceVersion = `sha256:${trainingProjectionHash}`;

  const trainingEntries = buildTrainingIndexEntries(formations, {
    source: 'formationDetails',
    sourceVersion: trainingSourceVersion,
    asOfDate,
  });

  const sourceFingerprint = stableHash({
    asOfDate,
    romeRunId: romeReference.meta.runId,
    romeSourceVersion: romeReference.meta.sourceVersion,
    trainingSourceVersion,
  });

  const runId = `occupation_search_${asOfDate}_${sourceFingerprint.slice(0, 12)}`;
  const runRef = db.collection('publicOccupationSearchIndexes').doc(runId);

  const allEntries = [...occupationEntries, ...trainingEntries];

  await runRef.set({
    runId,
    status: 'building',
    asOfDate,
    occupationEntriesCount: occupationEntries.length,
    trainingEntriesCount: trainingEntries.length,
    totalEntriesCount: allEntries.length,
    sourceVersions: {
      romeRunId: romeReference.meta.runId,
      romeSourceVersion: romeReference.meta.sourceVersion || null,
      trainingSourceVersion,
    },
    sourceFingerprint,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'publicOccupationSearchIndex.v1',
  }, { merge: true });

  try {
    await commitEntries(allEntries, runId);

    await runRef.set({
      status: 'ready',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection('publicOccupationSearchIndexMeta').doc('current').set({
      runId,
      asOfDate,
      occupationEntriesCount: occupationEntries.length,
      trainingEntriesCount: trainingEntries.length,
      totalEntriesCount: allEntries.length,
      sourceVersions: {
        romeRunId: romeReference.meta.runId,
        romeSourceVersion: romeReference.meta.sourceVersion || null,
        trainingSourceVersion,
      },
      sourceFingerprint,
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 'publicOccupationSearchIndexMeta.v1',
    });

    console.log(JSON.stringify({
      ok: true,
      runId,
      asOfDate,
      occupationEntriesCount: occupationEntries.length,
      trainingEntriesCount: trainingEntries.length,
      totalEntriesCount: allEntries.length,
      trainingSourceVersion,
    }, null, 2));
  } catch (error) {
    await runRef.set({
      status: 'failed',
      error: String(error?.message || error).slice(0, 1000),
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
