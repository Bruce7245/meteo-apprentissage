const crypto = require('node:crypto');
const admin = require('firebase-admin');
const {
  buildOccupationDomainIndex,
  buildOccupationDomainIndexPublication,
} = require('./lib/occupation-domain-index.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'meteo-apprentissage' });
}

const db = admin.firestore();

const asOfDate = String(
  process.argv[2] ||
    new Intl.DateTimeFormat('fr-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
);

function stableHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

async function loadReferenceMeta(collectionName) {
  const snapshot = await db
    .collection(collectionName)
    .doc('current')
    .get();

  if (!snapshot.exists) {
    throw new Error(`${collectionName}/current is missing`);
  }

  const meta = snapshot.data() || {};
  const runId = String(meta.runId || '').trim();

  if (!runId) {
    throw new Error(
      `${collectionName}/current has no runId`
    );
  }

  return meta;
}

async function loadEntries(collectionName, runId) {
  const snapshot = await db
    .collection(collectionName)
    .where('importRunId', '==', runId)
    .get();

  if (snapshot.empty) {
    throw new Error(
      `No ${collectionName} entries found for run ${runId}`
    );
  }

  return snapshot.docs.map((doc) => doc.data() || {});
}

async function commitDomainDocuments(
  documents,
  runId
) {
  const collection = db
    .collection('publicOccupationDomainIndexes')
    .doc(runId)
    .collection('domains');

  let batch = db.batch();
  let pending = 0;

  for (const document of documents) {
    batch.set(
      collection.doc(document.domainCode),
      {
        ...document,
        indexRunId: runId,
        generatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      }
    );

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
  const [
    occupationMeta,
    domainMeta,
  ] = await Promise.all([
    loadReferenceMeta('occupationReferenceMeta'),
    loadReferenceMeta('occupationDomainReferenceMeta'),
  ]);

  const [
    occupationEntries,
    domainEntries,
  ] = await Promise.all([
    loadEntries(
      'occupationReference',
      String(occupationMeta.runId)
    ),
    loadEntries(
      'occupationDomainReference',
      String(domainMeta.runId)
    ),
  ]);

  const index = buildOccupationDomainIndex({
    asOfDate,
    domainMeta,
    occupationMeta,
    domainEntries,
    occupationEntries,
  });

  if (!index.eligible) {
    throw new Error(
      `PUBLIC_DOMAIN_INDEX_INELIGIBLE:${index.blockers.join('|')}`
    );
  }

  const sourceFingerprint = `sha256:${stableHash({
    asOfDate,
    sourceVersions: index.sourceVersions,
    domains: index.domains.map((domain) => ({
      domainCode: domain.domainCode,
      occupations: domain.occupations.map(
        (occupation) => occupation.romeCode
      ),
    })),
  })}`;

  const runId =
    `occupation_domain_index_${asOfDate}_${sourceFingerprint
      .replace(/^sha256:/, '')
      .slice(0, 12)}`;

  const publication =
    buildOccupationDomainIndexPublication(
      index,
      {
        runId,
        sourceFingerprint,
      }
    );

  const runRef = db
    .collection('publicOccupationDomainIndexes')
    .doc(runId);

  await runRef.set(
    {
      ...publication.run,
      startedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await commitDomainDocuments(
      publication.documents,
      runId
    );

    await runRef.set(
      {
        status: 'ready',
        writtenDomains:
          publication.documents.length,
        completedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await db
      .collection('publicOccupationDomainIndexMeta')
      .doc('current')
      .set({
        ...publication.meta,
        publishedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

    console.log(JSON.stringify({
      ok: true,
      runId,
      asOfDate,
      domainsCount:
        publication.documents.length,
      occupationEntriesCount:
        occupationEntries.length,
      sourceVersions:
        publication.meta.sourceVersions,
      sourceFingerprint,
    }, null, 2));
  } catch (error) {
    await runRef.set(
      {
        status: 'failed',
        error: String(
          error?.message || error
        ).slice(0, 1000),
        failedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
