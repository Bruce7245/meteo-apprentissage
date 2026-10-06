const {
  buildOccupationDomainContexts,
} = require('./lib/occupation-domain-context.cjs');
const {
  normalizeDepartmentCode,
} = require('./lib/insee-population.cjs');

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
}

function resolveDomainOfferRunId(
  snapshotMeta = {},
  historicalImport = null
) {
  const activeRunId = text(snapshotMeta?.activeRunId);

  if (activeRunId) {
    return {
      runId: activeRunId,
      sourceMode: 'active_snapshot',
    };
  }

  const qualityStatus = text(
    snapshotMeta?.qualityStatus
  );

  if (qualityStatus === 'quarantined') {
    return {
      runId: null,
      sourceMode: 'quarantined',
    };
  }

  if (
    qualityStatus ===
      'calibration_only_quarantined' &&
    text(historicalImport?.activeRunId)
  ) {
    return {
      runId: text(historicalImport.activeRunId),
      sourceMode: 'historical_calibration_snapshot',
    };
  }

  return {
    runId: null,
    sourceMode: 'missing',
  };
}

async function prepareOccupationDomainContexts({
  date,
  repository,
  buildContexts = buildOccupationDomainContexts,
} = {}) {
  const targetDate = text(date);

  if (!validDate(targetDate)) {
    throw new Error(
      `Invalid occupation domain preparation date: ${date}`
    );
  }

  if (!repository) {
    throw new Error('repository is required');
  }

  const [
    domains,
    populationByDepartment,
    offerDepartments,
  ] = await Promise.all([
    repository.loadDomains(),
    repository.loadPopulationByDepartment(),
    repository.loadOfferDepartments(targetDate),
  ]);

  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error(
      'No official occupation domain reference available'
    );
  }

  if (
    !Array.isArray(offerDepartments) ||
    offerDepartments.length === 0
  ) {
    throw new Error(
      `No usable daily offer department snapshots for ${targetDate}`
    );
  }

  const contexts = [];

  for (const department of offerDepartments) {
    const departmentCode = normalizeDepartmentCode(
      department?.departmentCode
    );

    if (!departmentCode) continue;

    const population =
      populationByDepartment instanceof Map
        ? populationByDepartment.get(departmentCode)
        : populationByDepartment?.[departmentCode];

    const result = buildContexts({
      departmentCode,
      date: targetDate,
      domains,
      offers: Array.isArray(department?.offers)
        ? department.offers
        : [],
      population: population || null,
      sourceVersions: {
        offerRunId:
          text(department?.activeRunId) || null,
        offerSourceMode:
          text(department?.sourceMode) || null,
        populationRunId:
          text(population?.runId) || null,
      },
    });

    for (const context of result.contexts || []) {
      contexts.push(context);
    }
  }

  if (contexts.length === 0) {
    throw new Error(
      `No occupation domain contexts produced for ${targetDate}`
    );
  }

  await repository.writeContexts(
    targetDate,
    contexts
  );

  const meta = {
    departmentsProcessed:
      offerDepartments.length,
    domainContexts: contexts.length,
    domainsCount: domains.length,
  };

  await repository.markContextRunReady(
    targetDate,
    meta
  );

  return {
    date: targetDate,
    status: 'ready',
    departmentsProcessed:
      offerDepartments.length,
    contextsCount: contexts.length,
    domainsCount: domains.length,
  };
}

function createFirestoreOccupationDomainPrecomputeRepository(
  db,
  { FieldValue, FieldPath } = {}
) {
  if (!db) {
    throw new Error('Firestore db is required');
  }

  const serverTimestamp = () =>
    FieldValue?.serverTimestamp
      ? FieldValue.serverTimestamp()
      : new Date();

  const documentId = () =>
    FieldPath?.documentId
      ? FieldPath.documentId()
      : '__name__';

  async function loadOffers(
    departmentRef,
    runId
  ) {
    const offers = [];
    let last = null;

    while (true) {
      let query = departmentRef
        .collection('offers')
        .where('runId', '==', runId)
        .orderBy(documentId())
        .limit(1000);

      if (last) {
        query = query.startAfter(last);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        offers.push({
          offerDocId: doc.id,
          ...(doc.data() || {}),
        });
      }

      last =
        snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.size < 1000) break;
    }

    return offers;
  }

  async function commitRows(
    collectionName,
    rows,
    idForRow
  ) {
    let batch = db.batch();
    let count = 0;

    for (const row of rows) {
      batch.set(
        db
          .collection(collectionName)
          .doc(idForRow(row)),
        {
          ...row,
          generatedAt: serverTimestamp(),
        },
        { merge: false }
      );

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

  return {
    async loadDomains() {
      const metaSnapshot = await db
        .collection(
          'occupationDomainReferenceMeta'
        )
        .doc('current')
        .get();

      if (!metaSnapshot.exists) {
        throw new Error(
          'occupationDomainReferenceMeta/current is missing'
        );
      }

      const meta = metaSnapshot.data() || {};
      const runId = text(meta.runId);

      if (!runId) {
        throw new Error(
          'occupationDomainReferenceMeta/current has no runId'
        );
      }

      const snapshot = await db
        .collection('occupationDomainReference')
        .where('importRunId', '==', runId)
        .get();

      if (snapshot.empty) {
        throw new Error(
          `No occupation domains for run ${runId}`
        );
      }

      return snapshot.docs.map((doc) => ({
        ...(doc.data() || {}),
      }));
    },

    async loadPopulationByDepartment() {
      const snapshot = await db
        .collection(
          'departmentPopulationReference'
        )
        .get();

      const result = new Map();

      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const departmentCode =
          normalizeDepartmentCode(
            data.departmentCode || doc.id
          );

        if (departmentCode) {
          result.set(departmentCode, data);
        }
      }

      return result;
    },

    async loadOfferDepartments(date) {
      const snapshot = await db
        .collection('dailyOfferSnapshots')
        .doc(date)
        .collection('departments')
        .get();

      if (snapshot.empty) return [];

      let historicalImport = null;

      if (
        snapshot.docs.some(
          (doc) =>
            text(
              (doc.data() || {}).qualityStatus
            ) ===
            'calibration_only_quarantined'
        )
      ) {
        const importSnapshot = await db
          .collection('apiImports')
          .doc(
            `historical_recovery_${date}`
          )
          .get();

        historicalImport = importSnapshot.exists
          ? importSnapshot.data() || {}
          : null;
      }

      const rows = [];

      for (const doc of snapshot.docs) {
        const departmentCode =
          normalizeDepartmentCode(doc.id);

        if (!departmentCode) continue;

        const meta = doc.data() || {};
        const resolution =
          resolveDomainOfferRunId(
            meta,
            historicalImport
          );

        if (!resolution.runId) {
          continue;
        }

        rows.push({
          departmentCode,
          activeRunId: resolution.runId,
          sourceMode: resolution.sourceMode,
          offers: await loadOffers(
            doc.ref,
            resolution.runId
          ),
        });
      }

      return rows.sort((a, b) =>
        a.departmentCode.localeCompare(
          b.departmentCode,
          'fr',
          { numeric: true }
        )
      );
    },

    async writeContexts(date, rows) {
      await commitRows(
        'occupationDomainContextStats',
        rows,
        (row) =>
          `${date}_${row.departmentCode}_${row.domainCode}`
      );
    },

    async markContextRunReady(date, meta) {
      await db
        .collection(
          'occupationDomainContextStatsRuns'
        )
        .doc(date)
        .set(
          {
            date,
            status: 'ready',
            ...meta,
            generatedAt:
              serverTimestamp(),
            schemaVersion:
              'occupationDomainContextStatsRun.v1',
          },
          { merge: false }
        );
    },
  };
}

module.exports = {
  resolveDomainOfferRunId,
  prepareOccupationDomainContexts,
  createFirestoreOccupationDomainPrecomputeRepository,
};
