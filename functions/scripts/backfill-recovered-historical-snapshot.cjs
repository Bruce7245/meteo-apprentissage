const { createHash } = require('node:crypto');
const admin = require('firebase-admin');
const {
  applyHistoricalLocationRecovery,
  buildHistoricalDepartmentSnapshot,
  evaluateHistoricalRecoveryQuality,
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

function departmentFromPostalCode(value) {
  const postal = String(value || '').trim();

  if (/^97[1-6]\d{2}$/.test(postal)) return postal.slice(0, 3);

  if (/^20\d{3}$/.test(postal)) {
    const numeric = Number(postal);
    if (numeric >= 20000 && numeric <= 20199) return '2A';
    if (numeric >= 20200 && numeric <= 20699) return '2B';
    return null;
  }

  if (/^\d{5}$/.test(postal)) return postal.slice(0, 2);

  return null;
}

function offerDocId(value) {
  return createHash('sha256')
    .update(String(value || ''))
    .digest('hex');
}

function sourceFingerprint(rows, recoveryDate, minimumRecoveryRate) {
  const hash = createHash('sha256');

  const normalized = rows
    .map((row) => ({
      id: row.id,
      departmentCode: row.departmentCode || null,
      offerId: row.offerId || null,
      workplaceSiret: row.workplaceSiret || null,
      openingCount: Number(row.openingCount || 0),
      romeCodes: Array.isArray(row.romeCodes)
        ? [...row.romeCodes].map(String).sort()
        : [],
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  hash.update(String(recoveryDate));
  hash.update('\n');
  hash.update(String(minimumRecoveryRate));
  hash.update('\n');

  for (const row of normalized) {
    hash.update(JSON.stringify(row));
    hash.update('\n');
  }

  return hash.digest('hex');
}

async function loadInseeBySiret(sirets) {
  const unique = Array.from(
    new Set(
      sirets
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  const output = new Map();

  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const refs = chunk.map((siret) =>
      db.collection('inseeEstablishments').doc(siret)
    );

    const snapshots = await db.getAll(...refs);

    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        output.set(snapshot.id, snapshot.data() || {});
      }
    }
  }

  return output;
}

async function loadRecoveryMetadata(recoveryDate, departmentCodes) {
  const map = new Map();

  for (let index = 0; index < departmentCodes.length; index += 30) {
    const chunk = departmentCodes.slice(index, index + 30);
    const refs = chunk.map((departmentCode) =>
      db
        .collection('dailyOfferSnapshots')
        .doc(recoveryDate)
        .collection('departments')
        .doc(departmentCode)
    );

    const snapshots = await db.getAll(...refs);

    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        map.set(snapshot.id, snapshot.data() || {});
      }
    }
  }

  return map;
}

async function recoverObservationLocations(
  observations,
  recoveryDate,
  recoveryMetadata,
  inseeBySiret
) {
  const recovered = [];

  for (let index = 0; index < observations.length; index += 30) {
    const chunk = observations.slice(index, index + 30);
    const refs = [];
    const rows = [];

    for (const observation of chunk) {
      const departmentCode = normalizeDepartmentCode(
        observation.departmentCode
      );
      const id = String(observation.offerId || '').trim();

      if (!departmentCode || !id) {
        rows.push({
          observation,
          departmentCode,
          offerId: id,
          refIndex: null,
        });
        continue;
      }

      rows.push({
        observation,
        departmentCode,
        offerId: id,
        refIndex: refs.length,
      });

      refs.push(
        db
          .collection('dailyOfferSnapshots')
          .doc(recoveryDate)
          .collection('departments')
          .doc(departmentCode)
          .collection('offers')
          .doc(offerDocId(id))
      );
    }

    const snapshots = refs.length > 0
      ? await db.getAll(...refs)
      : [];

    for (const row of rows) {
      let location = null;

      if (row.refIndex !== null) {
        const snapshot = snapshots[row.refIndex];

        if (snapshot?.exists) {
          const offer = snapshot.data() || {};
          const activeRunId = String(
            recoveryMetadata.get(row.departmentCode)?.activeRunId || ''
          ).trim();

          const recoveryRunMatches =
            activeRunId &&
            String(offer.runId || '').trim() === activeRunId;

          const recoveredDepartment =
            normalizeDepartmentCode(offer.effectiveDepartmentCode) ||
            departmentFromPostalCode(offer.postalCode);

          if (recoveryRunMatches && recoveredDepartment) {
            location = {
              source: 'recovery_snapshot',
              departmentCode: recoveredDepartment,
              postalCode: offer.postalCode || null,
              city: offer.city || null,
            };
          }
        }
      }

      if (!location) {
        const siret = String(
          row.observation.workplaceSiret || ''
        ).trim();
        const establishment = inseeBySiret.get(siret);

        if (establishment) {
          const recoveredDepartment =
            normalizeDepartmentCode(establishment.departmentCode) ||
            departmentFromPostalCode(establishment.postalCode);

          if (recoveredDepartment) {
            location = {
              source: 'insee_establishment',
              departmentCode: recoveredDepartment,
              postalCode: establishment.postalCode || null,
              city: establishment.city || null,
            };
          }
        }
      }

      recovered.push({
        observation: applyHistoricalLocationRecovery(
          row.observation,
          location
        ),
        resolved: !!location,
        recoverySource: location?.source || null,
        recoveredDepartmentCode:
          location?.departmentCode || null,
      });
    }
  }

  return recovered;
}

async function commitOfferWrites(items) {
  let batch = db.batch();
  let operations = 0;
  let writtenOffers = 0;

  async function flush(force = false) {
    if (operations === 0) return;

    if (force || operations >= 400) {
      await batch.commit();
      batch = db.batch();
      operations = 0;
    }
  }

  for (const item of items) {
    const departmentRef = db
      .collection('dailyOfferSnapshots')
      .doc(item.date)
      .collection('departments')
      .doc(item.departmentCode);

    for (const offer of item.offers) {
      batch.set(
        departmentRef
          .collection('offers')
          .doc(offer.offerDocId),
        {
          ...offer,
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      operations += 1;
      writtenOffers += 1;
      await flush(false);
    }
  }

  await flush(true);
  return writtenOffers;
}

async function activateEligibleDepartments(items, recoveryDate, minimumRecoveryRate) {
  let batch = db.batch();
  let operations = 0;

  async function flush(force = false) {
    if (operations === 0) return;

    if (force || operations >= 400) {
      await batch.commit();
      batch = db.batch();
      operations = 0;
    }
  }

  for (const item of items) {
    const ref = db
      .collection('dailyOfferSnapshots')
      .doc(item.date)
      .collection('departments')
      .doc(item.departmentCode);

    batch.set(
      ref,
      {
        date: item.date,
        departmentCode: item.departmentCode,
        activeRunId: item.runId,
        source: 'jobOfferObservations+recovered_location',
        sourceRoute: 'historical-recovery',
        executionMode: 'historical_recovery_backfill',
        recoveryDate,
        minimumRecoveryRate,
        recoveryRate: item.quality.recoveryRate,
        sourceObservationCount: item.quality.total,
        recoveredObservationCount: item.quality.resolved,
        unresolvedObservationCount: item.quality.unresolved,
        storedOffersCount: item.offers.length,
        recoverySources: item.recoverySources,
        summary: item.summary,
        strictSummary: item.strictSummary,
        qualityStatus: 'calibration_only',
        importedAt:
          admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion:
          'dailyOfferSnapshots.historicalRecovery.v1',
      },
      { merge: true }
    );

    operations += 1;
    await flush(false);
  }

  await flush(true);
}

async function main() {
  const targetDate = String(readArg('date', '')).trim();
  const recoveryDate = String(
    readArg('recover-from-date', '')
  ).trim();
  const minimumRecoveryRate = Number(
    readArg('min-recovery', '0.95')
  );
  const write = hasFlag('write');

  if (!validDate(targetDate)) {
    throw new Error(`Invalid --date: ${targetDate}`);
  }

  if (!validDate(recoveryDate)) {
    throw new Error(
      `Invalid --recover-from-date: ${recoveryDate}`
    );
  }

  if (
    !Number.isFinite(minimumRecoveryRate) ||
    minimumRecoveryRate <= 0 ||
    minimumRecoveryRate > 1
  ) {
    throw new Error(
      `Invalid --min-recovery: ${minimumRecoveryRate}`
    );
  }

  const observationSnapshot = await db
    .collection('jobOfferObservations')
    .where('date', '==', targetDate)
    .get();

  if (observationSnapshot.empty) {
    throw new Error(
      `No historical observations for ${targetDate}`
    );
  }

  const observations = observationSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() || {}),
  }));

  const departmentCodes = Array.from(
    new Set(
      observations
        .map((row) =>
          normalizeDepartmentCode(row.departmentCode)
        )
        .filter(Boolean)
    )
  ).sort((a, b) =>
    a.localeCompare(b, 'fr', { numeric: true })
  );

  const [recoveryMetadata, inseeBySiret] =
    await Promise.all([
      loadRecoveryMetadata(recoveryDate, departmentCodes),
      loadInseeBySiret(
        observations.map((row) => row.workplaceSiret)
      ),
    ]);

  const recoveredRows = await recoverObservationLocations(
    observations,
    recoveryDate,
    recoveryMetadata,
    inseeBySiret
  );

  const byDepartment = new Map();

  for (const row of recoveredRows) {
    const departmentCode = normalizeDepartmentCode(
      row.observation.departmentCode
    );

    if (!departmentCode) continue;

    if (!byDepartment.has(departmentCode)) {
      byDepartment.set(departmentCode, []);
    }

    byDepartment.get(departmentCode).push(row);
  }

  const fingerprint = sourceFingerprint(
    observations,
    recoveryDate,
    minimumRecoveryRate
  );
  const runId =
    `historical_recovered_${targetDate}_${fingerprint.slice(0, 12)}`;

  const eligible = [];
  const ineligible = [];

  for (const departmentCode of departmentCodes) {
    const rows = byDepartment.get(departmentCode) || [];
    const quality = evaluateHistoricalRecoveryQuality(
      {
        total: rows.length,
        resolved: rows.filter((row) => row.resolved).length,
      },
      minimumRecoveryRate
    );

    const recoverySources = rows.reduce(
      (acc, row) => {
        const key = row.recoverySource || 'unresolved';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {}
    );

    const item = {
      date: targetDate,
      departmentCode,
      runId,
      quality,
      recoverySources,
    };

    if (!quality.eligible) {
      ineligible.push(item);
      continue;
    }

    const snapshot = buildHistoricalDepartmentSnapshot(
      rows.map((row) => row.observation),
      {
        runId,
        targetDate,
        departmentCode,
      }
    );

    eligible.push({
      ...item,
      ...snapshot,
    });
  }

  const totals = eligible.reduce(
    (acc, item) => {
      acc.sourceObservations += item.quality.total;
      acc.recoveredObservations += item.quality.resolved;
      acc.unresolvedObservations += item.quality.unresolved;
      acc.storedOffers += item.offers.length;
      acc.strictOffers += Number(
        item.strictSummary?.totalOffers || 0
      );
      acc.strictOpenings += Number(
        item.strictSummary?.totalOpenings || 0
      );
      return acc;
    },
    {
      sourceObservations: 0,
      recoveredObservations: 0,
      unresolvedObservations: 0,
      storedOffers: 0,
      strictOffers: 0,
      strictOpenings: 0,
    }
  );

  console.log(JSON.stringify({
    phase: 'preview',
    ok: true,
    date: targetDate,
    recoveryDate,
    minimumRecoveryRate,
    write,
    runId,
    sourceObservationCount: observations.length,
    departmentsObserved: departmentCodes.length,
    eligibleDepartments: eligible.length,
    ineligibleDepartments: ineligible.length,
    ineligibleDepartmentCodes:
      ineligible.map((item) => item.departmentCode),
    totals,
  }, null, 2));

  if (!write) return;

  const existing = await db
    .collection('dailyOfferSnapshots')
    .doc(targetDate)
    .collection('departments')
    .get();

  if (!existing.empty) {
    throw new Error(
      `Target snapshot date ${targetDate} is not empty; refusing historical recovery write`
    );
  }

  const writtenOffers = await commitOfferWrites(eligible);

  if (writtenOffers !== totals.storedOffers) {
    throw new Error(
      `Staged offer write mismatch: written=${writtenOffers}, expected=${totals.storedOffers}`
    );
  }

  await activateEligibleDepartments(
    eligible,
    recoveryDate,
    minimumRecoveryRate
  );

  const verification = await db
    .collection('dailyOfferSnapshots')
    .doc(targetDate)
    .collection('departments')
    .get();

  if (verification.size !== eligible.length) {
    throw new Error(
      `Eligible department activation mismatch: active=${verification.size}, expected=${eligible.length}`
    );
  }

  for (const doc of verification.docs) {
    const data = doc.data() || {};

    if (String(data.activeRunId || '') !== runId) {
      throw new Error(
        `Unexpected activeRunId for ${doc.id}: ${data.activeRunId}`
      );
    }

    if (Number(data.recoveryRate || 0) < minimumRecoveryRate) {
      throw new Error(
        `Recovery quality gate failed after write for ${doc.id}`
      );
    }
  }

  await db
    .collection('apiImports')
    .doc(`historical_recovery_${targetDate}`)
    .set(
      {
        type: 'historical_recovery_snapshot_backfill',
        date: targetDate,
        recoveryDate,
        activeRunId: runId,
        minimumRecoveryRate,
        sourceObservationCount: observations.length,
        eligibleDepartments: eligible.length,
        ineligibleDepartments: ineligible.length,
        ineligibleDepartmentCodes:
          ineligible.map((item) => item.departmentCode),
        totals,
        finishedAt:
          admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion:
          'historical_recovery_snapshot_backfill.v1',
      },
      { merge: false }
    );

  console.log(JSON.stringify({
    phase: 'verified',
    ok: true,
    date: targetDate,
    runId,
    eligibleDepartments: verification.size,
    ineligibleDepartments: ineligible.length,
    totals,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
