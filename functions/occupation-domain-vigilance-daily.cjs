const {
  buildDomainSourceFingerprint,
  buildOccupationDomainRunId,
} = require('./lib/occupation-domain-vigilance-run.cjs');
const {
  buildPublicOccupationDomainProjection,
} = require('./lib/occupation-domain-vigilance-projection.cjs');

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
}

function pairKey(departmentCode, domainCode) {
  return `${departmentCode}_${domainCode}`;
}

function mapGet(value, key) {
  if (value instanceof Map) return value.get(key);
  return value?.[key];
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 0
    : date.getTime();
}

function sourceVersionsFromContexts(
  contexts,
  dependencies
) {
  const contextSources = contexts
    .map((context) => ({
      key: pairKey(
        context.departmentCode,
        context.domainCode
      ),
      sourceVersions:
        context.sourceVersions || {},
    }))
    .sort((a, b) =>
      a.key.localeCompare(b.key, 'fr')
    );

  return {
    contextDate:
      dependencies.contextRun?.date || null,
    contextSourcesFingerprint:
      buildDomainSourceFingerprint(
        contextSources
      ),
    populationRunId:
      dependencies.populationMeta?.runId ||
      null,
    populationSourceVersion:
      dependencies.populationMeta
        ?.sourceVersion || null,
    domainRunId:
      dependencies.domainReferenceMeta
        ?.runId || null,
    domainSourceVersion:
      dependencies.domainReferenceMeta
        ?.sourceVersion || null,
  };
}

async function preflightFailure(
  repository,
  payload
) {
  if (
    typeof repository
      ?.recordPreflightFailure === 'function'
  ) {
    await repository.recordPreflightFailure(
      payload
    );
  }

  return {
    status: 'failed',
    ...payload,
  };
}

function resolveCompute(provided) {
  if (typeof provided === 'function') {
    return provided;
  }

  return require(
    './lib/occupation-domain-vigilance.cjs'
  ).computeOccupationDomainVigilance;
}

async function buildDailyOccupationDomainVigilanceRun({
  date,
  repository,
  computeVigilance,
  batchSize = 120,
} = {}) {
  const targetDate = text(date);

  if (!validDate(targetDate)) {
    throw new Error(
      `Invalid occupation domain vigilance date: ${date}`
    );
  }

  if (!repository) {
    throw new Error('repository is required');
  }

  const dependencies =
    await repository.loadDependencies(
      targetDate
    );

  if (
    !dependencies?.contextRun ||
    dependencies.contextRun.status !==
      'ready' ||
    !dependencies?.populationMeta ||
    !dependencies?.domainReferenceMeta ||
    !dependencies?.config
  ) {
    return preflightFailure(
      repository,
      {
        date: targetDate,
        errorCode:
          'DEPENDENCIES_NOT_READY',
      }
    );
  }

  if (
    dependencies.config.status !==
    'validated'
  ) {
    return preflightFailure(
      repository,
      {
        date: targetDate,
        errorCode:
          'CONFIG_NOT_VALIDATED',
      }
    );
  }

  const contexts =
    await repository.loadContexts(
      targetDate
    );

  if (
    !Array.isArray(contexts) ||
    contexts.length === 0
  ) {
    return preflightFailure(
      repository,
      {
        date: targetDate,
        errorCode:
          'CONTEXTS_NOT_READY',
      }
    );
  }

  const sourceVersions =
    sourceVersionsFromContexts(
      contexts,
      dependencies
    );

  const sourceFingerprint =
    buildDomainSourceFingerprint(
      sourceVersions
    );

  const runId =
    buildOccupationDomainRunId({
      date: targetDate,
      calculationVersion:
        dependencies.config
          .calculationVersion,
      configVersion:
        dependencies.config.version,
      sourceFingerprint,
    });

  const existing =
    await repository.getRun(runId);

  if (
    existing &&
    ['ready', 'published'].includes(
      existing.status
    )
  ) {
    return {
      ...existing,
      reused: true,
    };
  }

  await repository.createRun({
    runId,
    date: targetDate,
    status: 'building',
    calculationVersion:
      dependencies.config
        .calculationVersion,
    configVersion:
      dependencies.config.version,
    sourceVersions,
    sourceFingerprint,
    expectedPairs: contexts.length,
    computedPairs: 0,
    insufficientDataPairs: 0,
    failedPairs: 0,
  });

  try {
    const domainCodes = Array.from(
      new Set(
        contexts.map(
          (context) =>
            context.domainCode
        )
      )
    );

    const departmentCodes = Array.from(
      new Set(
        contexts.map(
          (context) =>
            context.departmentCode
        )
      )
    );

    const [
      references,
      departmentNames,
    ] = await Promise.all([
      repository.loadDomainReferences(
        domainCodes,
        dependencies.domainReferenceMeta
      ),
      repository.loadDepartmentNames(
        departmentCodes
      ),
    ]);

    const calculate =
      resolveCompute(computeVigilance);

    const staged = [];
    let insufficientDataPairs = 0;
    let failedPairs = 0;

    for (const context of contexts) {
      const key = pairKey(
        context.departmentCode,
        context.domainCode
      );

      const reference =
        mapGet(
          references,
          context.domainCode
        ) || null;

      const departmentName =
        mapGet(
          departmentNames,
          context.departmentCode
        ) ||
        `Département ${context.departmentCode}`;

      try {
        const vigilance = calculate(
          {
            ...context,
            domainKnown: !!reference,
            recentTrend: {
              status: 'unknown',
            },
            seasonality: {
              status: 'unavailable',
              factor: 1,
            },
          },
          dependencies.config
        );

        if (
          vigilance.publishedLevel ===
          'insufficient_data'
        ) {
          insufficientDataPairs += 1;
        }

        const snapshot = {
          runId,
          date: targetDate,
          departmentCode:
            context.departmentCode,
          departmentName,
          domainCode:
            context.domainCode,
          domainLabel:
            reference?.domainLabel ||
            context.domainLabel ||
            context.domainCode,
          context: {
            ...context,
          },
          vigilance: {
            ...vigilance,
          },
          activeOffersCount:
            context.activeOffersCount,
          openingsCount:
            context.openingsCount,
          publishedLevel:
            vigilance.publishedLevel,
          confidenceLevel:
            vigilance.confidenceLevel,
          expectedOffers:
            vigilance.expectedOffers,
          observedVsExpectedRatio:
            vigilance
              .observedVsExpectedRatio,
          reasonCodes:
            vigilance.reasonCodes,
          calculationVersion:
            dependencies.config
              .calculationVersion,
          configVersion:
            dependencies.config.version,
          sourceVersions: {
            ...sourceVersions,
            ...(context.sourceVersions ||
              {}),
          },
        };

        const projection =
          buildPublicOccupationDomainProjection(
            snapshot
          );

        staged.push({
          key,
          snapshot,
          mapEntry: projection,
          detail: projection,
        });
      } catch {
        failedPairs += 1;
      }
    }

    if (failedPairs > 0) {
      await repository.updateRun(
        runId,
        {
          status: 'failed',
          computedPairs: staged.length,
          insufficientDataPairs,
          failedPairs,
          errorCode:
            'PAIR_CALCULATION_FAILED',
        }
      );

      return {
        runId,
        date: targetDate,
        status: 'failed',
        computedPairs: staged.length,
        insufficientDataPairs,
        failedPairs,
        errorCode:
          'PAIR_CALCULATION_FAILED',
      };
    }

    const safeBatchSize = Math.max(
      1,
      Math.min(
        Number(batchSize) || 120,
        120
      )
    );

    for (
      let index = 0;
      index < staged.length;
      index += safeBatchSize
    ) {
      await repository.writeStagedResults(
        runId,
        staged.slice(
          index,
          index + safeBatchSize
        )
      );
    }

    const patch = {
      status: 'validating',
      expectedPairs: contexts.length,
      computedPairs: staged.length,
      insufficientDataPairs,
      failedPairs: 0,
    };

    await repository.updateRun(
      runId,
      patch
    );

    return {
      runId,
      date: targetDate,
      ...patch,
      sourceFingerprint,
      configVersion:
        dependencies.config.version,
      calculationVersion:
        dependencies.config
          .calculationVersion,
    };
  } catch (error) {
    await repository.updateRun(
      runId,
      {
        status: 'failed',
        errorCode: 'RUN_BUILD_FAILED',
        error: String(
          error?.message || error
        ).slice(0, 1000),
      }
    );

    throw error;
  }
}

function createFirestoreOccupationDomainVigilanceRepository(
  db,
  FieldValue
) {
  if (!db) {
    throw new Error(
      'Firestore db is required'
    );
  }

  const serverTimestamp = () =>
    FieldValue?.serverTimestamp
      ? FieldValue.serverTimestamp()
      : new Date();

  return {
    async loadDependencies(date) {
      const [
        contextRunSnapshot,
        populationSnapshot,
        domainSnapshot,
        configSnapshot,
      ] = await Promise.all([
        db
          .collection(
            'occupationDomainContextStatsRuns'
          )
          .doc(date)
          .get(),
        db
          .collection(
            'departmentPopulationReferenceMeta'
          )
          .doc('current')
          .get(),
        db
          .collection(
            'occupationDomainReferenceMeta'
          )
          .doc('current')
          .get(),
        db
          .collection(
            'occupationDomainVigilanceConfigs'
          )
          .where(
            'status',
            '==',
            'validated'
          )
          .get(),
      ]);

      const configs =
        configSnapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...(doc.data() || {}),
          }))
          .sort(
            (a, b) =>
              timestampMillis(
                b.validatedAt ||
                  b.createdAt
              ) -
              timestampMillis(
                a.validatedAt ||
                  a.createdAt
              )
          );

      return {
        contextRun:
          contextRunSnapshot.exists
            ? contextRunSnapshot.data() ||
              {}
            : null,
        populationMeta:
          populationSnapshot.exists
            ? populationSnapshot.data() ||
              {}
            : null,
        domainReferenceMeta:
          domainSnapshot.exists
            ? domainSnapshot.data() || {}
            : null,
        config: configs[0] || null,
      };
    },

    async loadContexts(date) {
      const snapshot = await db
        .collection(
          'occupationDomainContextStats'
        )
        .where('date', '==', date)
        .get();

      return snapshot.docs.map(
        (doc) => ({
          id: doc.id,
          ...(doc.data() || {}),
        })
      );
    },

    async loadDomainReferences(
      domainCodes,
      meta
    ) {
      const wanted = new Set(
        domainCodes
      );

      const snapshot = await db
        .collection(
          'occupationDomainReference'
        )
        .where(
          'importRunId',
          '==',
          meta.runId
        )
        .get();

      const output = new Map();

      for (const doc of snapshot.docs) {
        const data = doc.data() || {};

        if (
          wanted.has(
            data.domainCode
          )
        ) {
          output.set(
            data.domainCode,
            data
          );
        }
      }

      return output;
    },

    async loadDepartmentNames(
      departmentCodes
    ) {
      const output = new Map();

      for (
        let index = 0;
        index < departmentCodes.length;
        index += 100
      ) {
        const refs =
          departmentCodes
            .slice(index, index + 100)
            .map((code) =>
              db
                .collection('departments')
                .doc(code)
            );

        if (refs.length === 0) continue;

        const snapshots =
          await db.getAll(...refs);

        for (const snapshot of snapshots) {
          if (!snapshot.exists) continue;

          const data =
            snapshot.data() || {};

          output.set(
            snapshot.id,
            data.name ||
              data.departmentName ||
              snapshot.id
          );
        }
      }

      return output;
    },

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

    async createRun(run) {
      await db
        .collection(
          'occupationDomainVigilanceRuns'
        )
        .doc(run.runId)
        .set(
          {
            ...run,
            startedAt:
              serverTimestamp(),
            schemaVersion:
              'occupationDomainVigilanceRun.v1',
          },
          { merge: false }
        );
    },

    async writeStagedResults(
      runId,
      chunk
    ) {
      const batch = db.batch();

      for (const item of chunk) {
        batch.set(
          db
            .collection(
              'occupationDomainVigilanceSnapshots'
            )
            .doc(runId)
            .collection('entries')
            .doc(item.key),
          {
            ...item.snapshot,
            computedAt:
              serverTimestamp(),
            schemaVersion:
              'occupationDomainVigilanceSnapshot.v1',
          },
          { merge: false }
        );

        batch.set(
          db
            .collection(
              'publicOccupationDomainVigilanceMaps'
            )
            .doc(runId)
            .collection('entries')
            .doc(item.key),
          {
            ...item.mapEntry,
            schemaVersion:
              'publicOccupationDomainVigilanceMapEntry.v1',
          },
          { merge: false }
        );

        batch.set(
          db
            .collection(
              'publicOccupationDomainVigilanceDetails'
            )
            .doc(runId)
            .collection('entries')
            .doc(item.key),
          {
            ...item.detail,
            schemaVersion:
              'publicOccupationDomainVigilanceDetail.v1',
          },
          { merge: false }
        );
      }

      await batch.commit();
    },

    async updateRun(runId, patch) {
      await db
        .collection(
          'occupationDomainVigilanceRuns'
        )
        .doc(runId)
        .set(
          {
            ...patch,
            updatedAt:
              serverTimestamp(),
          },
          { merge: true }
        );
    },

    async recordPreflightFailure(
      payload
    ) {
      await db
        .collection(
          'occupationDomainVigilancePreflightFailures'
        )
        .add({
          ...payload,
          recordedAt:
            serverTimestamp(),
          schemaVersion:
            'occupationDomainVigilancePreflightFailure.v1',
        });
    },
  };
}

async function executeOccupationDomainVigilanceForDate({
  date,
  db,
  FieldValue,
} = {}) {
  const repository =
    createFirestoreOccupationDomainVigilanceRepository(
      db,
      FieldValue
    );

  const buildResult =
    await buildDailyOccupationDomainVigilanceRun({
      date,
      repository,
    });

  if (
    buildResult.status === 'failed' ||
    buildResult.status === 'published'
  ) {
    return buildResult;
  }

  const {
    createFirestoreOccupationDomainPublisher,
    publishOccupationDomainRun,
  } = require(
    './lib/occupation-domain-vigilance-publish.cjs'
  );

  const publisher =
    createFirestoreOccupationDomainPublisher(
      db,
      FieldValue
    );

  return publishOccupationDomainRun(
    publisher,
    buildResult.runId
  );
}

module.exports = {
  pairKey,
  sourceVersionsFromContexts,
  buildDailyOccupationDomainVigilanceRun,
  createFirestoreOccupationDomainVigilanceRepository,
  executeOccupationDomainVigilanceForDate,
};
