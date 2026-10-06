const {
  validatePublicOccupationDomainProjection,
} = require('./occupation-domain-vigilance-projection.cjs');

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0
    ? number
    : null;
}

function validateOccupationDomainRun(run, stagedCounts) {
  const errors = [];

  if (!run || typeof run !== 'object') {
    return {
      ok: false,
      errors: ['run is required'],
    };
  }

  if (!['validating', 'ready'].includes(run.status)) {
    errors.push(
      'run.status must be validating or ready'
    );
  }

  const expectedPairs = finiteInteger(
    run.expectedPairs
  );
  const computedPairs = finiteInteger(
    run.computedPairs
  );
  const failedPairs = finiteInteger(
    run.failedPairs
  );

  if (
    expectedPairs === null ||
    computedPairs === null ||
    computedPairs !== expectedPairs
  ) {
    errors.push(
      'computedPairs must equal expectedPairs'
    );
  }

  if (failedPairs === null || failedPairs !== 0) {
    errors.push('failedPairs must be 0');
  }

  for (const key of [
    'snapshotsCount',
    'mapEntriesCount',
    'detailEntriesCount',
  ]) {
    const value = finiteInteger(
      stagedCounts?.[key]
    );

    if (
      value === null ||
      value !== expectedPairs
    ) {
      errors.push(
        `${key} must equal expectedPairs`
      );
    }
  }

  if (
    finiteInteger(
      stagedCounts
        ?.invalidPublicProjectionsCount
    ) !== 0
  ) {
    errors.push(
      'invalidPublicProjectionsCount must be 0'
    );
  }

  if (
    finiteInteger(
      stagedCounts?.sourceDateMismatchCount
    ) !== 0
  ) {
    errors.push(
      'sourceDateMismatchCount must be 0'
    );
  }

  for (const key of [
    'runId',
    'date',
    'configVersion',
    'calculationVersion',
    'sourceFingerprint',
  ]) {
    if (!String(run[key] || '').trim()) {
      errors.push(`${key} is required`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

async function publishOccupationDomainRun(
  repository,
  runId
) {
  if (!repository) {
    throw new Error('repository is required');
  }

  const run = await repository.getRun(runId);

  if (!run) {
    throw new Error(
      `Occupation domain vigilance run not found: ${runId}`
    );
  }

  if (run.status === 'published') {
    return {
      ...run,
      reused: true,
    };
  }

  const stagedCounts =
    await repository.getStagedCounts(
      runId,
      run
    );

  const validation =
    validateOccupationDomainRun(
      run,
      stagedCounts
    );

  if (!validation.ok) {
    await repository.markFailed(
      runId,
      {
        status: 'failed',
        errorCode:
          'RUN_VALIDATION_FAILED',
        validationErrors:
          validation.errors,
        stagedCounts,
      }
    );

    return {
      runId,
      status: 'failed',
      errorCode:
        'RUN_VALIDATION_FAILED',
      validationErrors:
        validation.errors,
      stagedCounts,
    };
  }

  if (run.status === 'validating') {
    await repository.setRunReady(
      runId,
      { stagedCounts }
    );
  }

  await repository.publishAtomic(
    runId,
    run
  );

  return {
    runId,
    date: run.date,
    status: 'published',
    stagedCounts,
  };
}

function createFirestoreOccupationDomainPublisher(
  db,
  FieldValue
) {
  if (!db) {
    throw new Error('Firestore db is required');
  }

  const serverTimestamp = () =>
    FieldValue?.serverTimestamp
      ? FieldValue.serverTimestamp()
      : new Date();

  async function readEntries(
    rootCollection,
    runId
  ) {
    return db
      .collection(rootCollection)
      .doc(runId)
      .collection('entries')
      .get();
  }

  return {
    async getRun(runId) {
      const snapshot = await db
        .collection(
          'occupationDomainVigilanceRuns'
        )
        .doc(runId)
        .get();

      return snapshot.exists
        ? snapshot.data() || {}
        : null;
    },

    async getStagedCounts(runId, run) {
      const [
        snapshots,
        maps,
        details,
      ] = await Promise.all([
        readEntries(
          'occupationDomainVigilanceSnapshots',
          runId
        ),
        readEntries(
          'publicOccupationDomainVigilanceMaps',
          runId
        ),
        readEntries(
          'publicOccupationDomainVigilanceDetails',
          runId
        ),
      ]);

      let invalidPublicProjectionsCount = 0;
      let sourceDateMismatchCount = 0;

      for (const collection of [
        maps,
        details,
      ]) {
        for (const doc of collection.docs) {
          const data = doc.data() || {};

          if (
            !validatePublicOccupationDomainProjection(
              data
            ).ok
          ) {
            invalidPublicProjectionsCount += 1;
          }

          if (data.date !== run.date) {
            sourceDateMismatchCount += 1;
          }
        }
      }

      for (const doc of snapshots.docs) {
        if (
          (doc.data() || {}).date !==
          run.date
        ) {
          sourceDateMismatchCount += 1;
        }
      }

      return {
        snapshotsCount: snapshots.size,
        mapEntriesCount: maps.size,
        detailEntriesCount: details.size,
        invalidPublicProjectionsCount,
        sourceDateMismatchCount,
      };
    },

    async markFailed(runId, patch) {
      await db
        .collection(
          'occupationDomainVigilanceRuns'
        )
        .doc(runId)
        .set(
          {
            ...patch,
            failedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
    },

    async setRunReady(runId, patch) {
      await db
        .collection(
          'occupationDomainVigilanceRuns'
        )
        .doc(runId)
        .set(
          {
            status: 'ready',
            ...patch,
            validatedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
    },

    async publishAtomic(
      runId,
      expectedRun
    ) {
      const runRef = db
        .collection(
          'occupationDomainVigilanceRuns'
        )
        .doc(runId);

      const pointerRef = db
        .collection(
          'publicOccupationDomainVigilanceIndex'
        )
        .doc('current');

      await db.runTransaction(
        async (transaction) => {
          const snapshot =
            await transaction.get(runRef);

          if (!snapshot.exists) {
            throw new Error(
              `Run disappeared before publish: ${runId}`
            );
          }

          const current =
            snapshot.data() || {};

          if (current.status !== 'ready') {
            throw new Error(
              `Run is not ready for publication: ${current.status}`
            );
          }

          transaction.set(
            runRef,
            {
              status: 'published',
              publishedAt:
                serverTimestamp(),
              updatedAt:
                serverTimestamp(),
            },
            { merge: true }
          );

          transaction.set(
            pointerRef,
            {
              runId,
              date: expectedRun.date,
              configVersion:
                expectedRun.configVersion,
              calculationVersion:
                expectedRun.calculationVersion,
              sourceFingerprint:
                expectedRun.sourceFingerprint,
              publishedAt:
                serverTimestamp(),
              schemaVersion:
                'publicOccupationDomainVigilanceIndex.v1',
            },
            { merge: false }
          );
        }
      );
    },
  };
}

module.exports = {
  validateOccupationDomainRun,
  publishOccupationDomainRun,
  createFirestoreOccupationDomainPublisher,
};
