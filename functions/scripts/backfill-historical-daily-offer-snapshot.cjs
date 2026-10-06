const { createHash } = require('node:crypto');
const admin = require('firebase-admin');
const {
  buildHistoricalDepartmentSnapshot,
} = require('../lib/daily-offer-snapshot.cjs');
const {
  normalizeDepartmentCode,
} = require('../lib/insee-population.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'meteo-apprentissage' });
}

const db = admin.firestore();

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function observationFingerprint(rows) {
  const hash = createHash('sha256');

  const normalized = rows
    .map((row) => ({
      id: row.id,
      departmentCode: row.departmentCode || null,
      offerId: row.offerId || null,
      openingCount: Number(row.openingCount || 0),
      romeCodes: Array.isArray(row.romeCodes)
        ? [...row.romeCodes].map(String).sort()
        : [],
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (const row of normalized) {
    hash.update(JSON.stringify(row));
    hash.update('\n');
  }

  return hash.digest('hex');
}

function departmentCodeFromDailyStat(doc) {
  const data = doc.data() || {};
  return normalizeDepartmentCode(
    data.departmentCode ||
    data.code ||
    String(doc.id).split('_').pop()
  );
}

async function commitOfferWrites(snapshotByDepartment) {
  let batch = db.batch();
  let operationCount = 0;
  let writtenOffers = 0;

  async function commitIfNeeded(force = false) {
    if (operationCount === 0) return;

    if (force || operationCount >= 400) {
      await batch.commit();
      batch = db.batch();
      operationCount = 0;
    }
  }

  for (const item of snapshotByDepartment) {
    const departmentRef = db
      .collection('dailyOfferSnapshots')
      .doc(item.date)
      .collection('departments')
      .doc(item.departmentCode);

    for (const offer of item.offers) {
      batch.set(
        departmentRef.collection('offers').doc(offer.offerDocId),
        {
          ...offer,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      operationCount += 1;
      writtenOffers += 1;
      await commitIfNeeded(false);
    }
  }

  await commitIfNeeded(true);
  return writtenOffers;
}

async function activateDepartments(snapshotByDepartment, sourceObservationCount) {
  const batch = db.batch();

  for (const item of snapshotByDepartment) {
    const departmentRef = db
      .collection('dailyOfferSnapshots')
      .doc(item.date)
      .collection('departments')
      .doc(item.departmentCode);

    batch.set(
      departmentRef,
      {
        date: item.date,
        departmentCode: item.departmentCode,
        activeRunId: item.runId,
        source: 'jobOfferObservations',
        sourceRoute: 'historical-reconstruction',
        executionMode: 'historical_backfill',
        sourceObservationCount: item.sourceObservationCount,
        storedOffersCount: item.offers.length,
        summary: item.summary,
        strictSummary: item.strictSummary,
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 'dailyOfferSnapshots.historicalBackfill.v1',
      },
      { merge: true }
    );
  }

  const targetDate = snapshotByDepartment[0]?.date;
  const runId = snapshotByDepartment[0]?.runId;

  batch.set(
    db.collection('apiImports').doc(`historical_snapshot_${targetDate}`),
    {
      type: 'historical_daily_offer_snapshot_backfill',
      date: targetDate,
      source: 'jobOfferObservations',
      activeRunId: runId,
      departmentsCount: snapshotByDepartment.length,
      sourceObservationCount,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 'historical_daily_offer_snapshot_backfill.v1',
    },
    { merge: true }
  );

  await batch.commit();
}

async function verifyActiveSnapshots(targetDate, expectedDepartments) {
  const departments = await db
    .collection('dailyOfferSnapshots')
    .doc(targetDate)
    .collection('departments')
    .get();

  if (departments.size !== expectedDepartments) {
    throw new Error(
      `Historical snapshot verification failed: departments=${departments.size}, expected=${expectedDepartments}`
    );
  }

  const runIds = new Set();
  let activeOffers = 0;
  let strictOffers = 0;
  let openings = 0;
  const romeCodes = new Set();

  for (const departmentDoc of departments.docs) {
    const data = departmentDoc.data() || {};
    const activeRunId = String(data.activeRunId || '').trim();

    if (!activeRunId) {
      throw new Error(
        `Historical snapshot verification failed: ${departmentDoc.id} has no activeRunId`
      );
    }

    runIds.add(activeRunId);

    const offers = await departmentDoc.ref
      .collection('offers')
      .where('runId', '==', activeRunId)
      .get();

    activeOffers += offers.size;

    for (const offerDoc of offers.docs) {
      const offer = offerDoc.data() || {};
      if (offer.locationQuality === 'in_department') strictOffers += 1;
      openings += Number(offer.openingCount || 0);
      for (const code of Array.isArray(offer.romeCodes) ? offer.romeCodes : []) {
        romeCodes.add(String(code));
      }
    }
  }

  if (runIds.size !== 1) {
    throw new Error(
      `Historical snapshot verification failed: activeRunIds=${runIds.size}`
    );
  }

  return {
    departments: departments.size,
    activeRunId: Array.from(runIds)[0],
    activeOffers,
    strictOffers,
    openings,
    distinctRomeCodes: romeCodes.size,
  };
}

async function main() {
  const targetDate = String(readArg('date', '')).trim();
  const write = hasFlag('write');
  const expectedDepartments = Number.parseInt(
    readArg('expected-departments', '101'),
    10
  );

  if (!validDate(targetDate)) {
    throw new Error(`Invalid --date: ${targetDate}`);
  }

  if (!Number.isInteger(expectedDepartments) || expectedDepartments <= 0) {
    throw new Error(
      `Invalid --expected-departments: ${expectedDepartments}`
    );
  }

  const [dailyStats, observations] = await Promise.all([
    db.collection('departmentDailyStats')
      .where('date', '==', targetDate)
      .get(),
    db.collection('jobOfferObservations')
      .where('date', '==', targetDate)
      .get(),
  ]);

  const departmentCodes = Array.from(
    new Set(
      dailyStats.docs
        .map(departmentCodeFromDailyStat)
        .filter(Boolean)
    )
  ).sort((a, b) =>
    a.localeCompare(b, 'fr', { numeric: true })
  );

  if (departmentCodes.length !== expectedDepartments) {
    throw new Error(
      `Historical source incomplete for ${targetDate}: departments=${departmentCodes.length}, expected=${expectedDepartments}`
    );
  }

  const observationRows = observations.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() || {}),
  }));

  const observationsByDepartment = new Map();
  for (const observation of observationRows) {
    const code = normalizeDepartmentCode(observation.departmentCode);
    if (!code) continue;

    if (!observationsByDepartment.has(code)) {
      observationsByDepartment.set(code, []);
    }

    observationsByDepartment.get(code).push(observation);
  }

  const missingObservationDepartments = departmentCodes.filter(
    (code) => !observationsByDepartment.has(code)
  );

  if (missingObservationDepartments.length > 0) {
    throw new Error(
      `Historical source has no observations for departments: ${missingObservationDepartments.join(',')}`
    );
  }

  const fingerprint = observationFingerprint(observationRows);
  const runId = `historical_${targetDate}_${fingerprint.slice(0, 12)}`;

  const snapshotByDepartment = departmentCodes.map((departmentCode) => {
    const sourceObservations = observationsByDepartment.get(departmentCode) || [];
    const snapshot = buildHistoricalDepartmentSnapshot(
      sourceObservations,
      {
        runId,
        targetDate,
        departmentCode,
      }
    );

    return {
      date: targetDate,
      departmentCode,
      runId,
      sourceObservationCount: sourceObservations.length,
      ...snapshot,
    };
  });

  const totals = snapshotByDepartment.reduce(
    (acc, item) => {
      acc.sourceObservations += item.sourceObservationCount;
      acc.storedOffers += item.offers.length;
      acc.strictOffers += Number(
        item.strictSummary?.totalOffers || 0
      );
      acc.openings += Number(
        item.summary?.totalOpenings || 0
      );
      for (const entry of item.summary?.byRome || []) {
        if (entry?.code) acc.romeCodes.add(entry.code);
      }
      return acc;
    },
    {
      sourceObservations: 0,
      storedOffers: 0,
      strictOffers: 0,
      openings: 0,
      romeCodes: new Set(),
    }
  );

  const preview = {
    ok: true,
    date: targetDate,
    write,
    runId,
    sourceFingerprint: fingerprint,
    departments: snapshotByDepartment.length,
    sourceObservations: totals.sourceObservations,
    storedOffers: totals.storedOffers,
    strictOffers: totals.strictOffers,
    openings: totals.openings,
    distinctRomeCodes: totals.romeCodes.size,
  };

  console.log(JSON.stringify({ phase: 'preview', ...preview }, null, 2));

  if (!write) return;

  const writtenOffers = await commitOfferWrites(snapshotByDepartment);

  if (writtenOffers !== totals.storedOffers) {
    throw new Error(
      `Historical offer staging incomplete: written=${writtenOffers}, expected=${totals.storedOffers}`
    );
  }

  await activateDepartments(
    snapshotByDepartment,
    totals.sourceObservations
  );

  const verification = await verifyActiveSnapshots(
    targetDate,
    expectedDepartments
  );

  if (verification.activeRunId !== runId) {
    throw new Error(
      `Historical snapshot run mismatch: active=${verification.activeRunId}, expected=${runId}`
    );
  }

  if (verification.activeOffers !== totals.storedOffers) {
    throw new Error(
      `Historical snapshot offer mismatch: active=${verification.activeOffers}, expected=${totals.storedOffers}`
    );
  }

  console.log(JSON.stringify({
    phase: 'verified',
    ok: true,
    date: targetDate,
    runId,
    ...verification,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
