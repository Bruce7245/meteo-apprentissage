const {
  buildSourceFingerprint,
  buildOccupationRunId,
} = require('./lib/occupation-vigilance-run.cjs');
const {
  buildInternalOccupationSnapshot,
  buildPublicOccupationMapEntry,
  buildPublicOccupationDepartmentDetail,
} = require('./lib/occupation-vigilance-projection.cjs');

function pairKey(departmentCode, romeCode) {
  return `${departmentCode}_${romeCode}`;
}

function mapGet(value, key) {
  if (value instanceof Map) return value.get(key);
  return value?.[key];
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function sourceVersionsFromContexts(contexts, dependencies) {
  const contextSources = contexts
    .map((context) => ({
      key: pairKey(context.departmentCode, context.romeCode),
      sourceVersions: context.sourceVersions || {},
    }))
    .sort((a, b) => a.key.localeCompare(b.key, 'fr'));

  return {
    contextDate: dependencies.contextRun?.date || null,
    contextSourcesFingerprint: buildSourceFingerprint(contextSources),
    populationRunId: dependencies.populationMeta?.runId || null,
    populationSourceVersion: dependencies.populationMeta?.sourceVersion || null,
    romeRunId: dependencies.occupationReferenceMeta?.runId || null,
    romeSourceVersion: dependencies.occupationReferenceMeta?.sourceVersion || null,
  };
}

async function preflightFailure(repository, payload) {
  if (typeof repository?.recordPreflightFailure === 'function') {
    await repository.recordPreflightFailure(payload);
  }
  return { status: 'failed', ...payload };
}

function resolveComputeVigilance(provided) {
  if (typeof provided === 'function') return provided;
  return require('./lib/occupation-vigilance.cjs').computeOccupationVigilance;
}

async function buildDailyOccupationVigilanceRun({
  date,
  repository,
  computeVigilance,
  batchSize = 120,
} = {}) {
  const targetDate = cleanText(date);

  if (!validDate(targetDate)) {
    throw new Error(`Invalid occupation vigilance date: ${date}`);
  }
  if (!repository) throw new Error('repository is required');

  const dependencies = await repository.loadDependencies(targetDate);

  if (
    !dependencies?.contextRun ||
    dependencies.contextRun.status !== 'ready' ||
    !dependencies?.populationMeta ||
    !dependencies?.occupationReferenceMeta ||
    !dependencies?.config
  ) {
    return preflightFailure(repository, {
      date: targetDate,
      errorCode: 'DEPENDENCIES_NOT_READY',
    });
  }

  if (dependencies.config.status !== 'validated') {
    return preflightFailure(repository, {
      date: targetDate,
      errorCode: 'CONFIG_NOT_VALIDATED',
    });
  }

  const contexts = await repository.loadContexts(targetDate);
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return preflightFailure(repository, {
      date: targetDate,
      errorCode: 'CONTEXTS_NOT_READY',
    });
  }

  const sourceVersions = sourceVersionsFromContexts(contexts, dependencies);
  const sourceFingerprint = buildSourceFingerprint(sourceVersions);
  const runId = buildOccupationRunId({
    date: targetDate,
    calculationVersion: dependencies.config.calculationVersion,
    configVersion: dependencies.config.version,
    sourceFingerprint,
  });

  const existing = await repository.getRun(runId);
  if (existing && ['ready', 'published'].includes(existing.status)) {
    return { ...existing, reused: true };
  }

  await repository.createRun({
    runId,
    date: targetDate,
    status: 'building',
    calculationVersion: dependencies.config.calculationVersion,
    configVersion: dependencies.config.version,
    sourceVersions,
    sourceFingerprint,
    expectedPairs: contexts.length,
    computedPairs: 0,
    insufficientDataPairs: 0,
    failedPairs: 0,
  });

  try {
    const keys = contexts.map((context) => pairKey(context.departmentCode, context.romeCode));
    const romeCodes = Array.from(new Set(contexts.map((context) => context.romeCode)));
    const departmentCodes = Array.from(new Set(contexts.map((context) => context.departmentCode)));

    const [histories, references, departmentNames] = await Promise.all([
      repository.loadHistories(keys),
      repository.loadOccupationReferences(
        romeCodes,
        dependencies.occupationReferenceMeta
      ),
      repository.loadDepartmentNames(departmentCodes),
    ]);

    const calculate = resolveComputeVigilance(computeVigilance);
    const staged = [];
    let insufficientDataPairs = 0;
    let failedPairs = 0;

    for (const context of contexts) {
      const key = pairKey(context.departmentCode, context.romeCode);
      const history = mapGet(histories, key) || {};
      const reference = mapGet(references, context.romeCode) || null;
      const departmentName = mapGet(departmentNames, context.departmentCode) ||
        `Département ${context.departmentCode}`;

      try {
        const vigilance = calculate({
          ...context,
          romeKnown: !!reference,
          recentTrend: history.recentTrend || { status: 'unknown' },
          seasonality: history.seasonality || { status: 'unavailable', factor: 1 },
        }, dependencies.config);

        if (vigilance.publishedLevel === 'insufficient_data') {
          insufficientDataPairs += 1;
        }

        const snapshot = buildInternalOccupationSnapshot({
          runId,
          date: targetDate,
          departmentCode: context.departmentCode,
          departmentName,
          romeCode: context.romeCode,
          romeLabel: reference?.label || context.romeCode,
          context,
          history,
          vigilance,
          calculationVersion: dependencies.config.calculationVersion,
          configVersion: dependencies.config.version,
          sourceVersions: {
            ...sourceVersions,
            ...(context.sourceVersions || {}),
          },
        });

        staged.push({
          key,
          snapshot,
          mapEntry: buildPublicOccupationMapEntry(snapshot),
          detail: buildPublicOccupationDepartmentDetail(snapshot),
        });
      } catch {
        failedPairs += 1;
      }
    }

    if (failedPairs > 0) {
      await repository.updateRun(runId, {
        status: 'failed',
        computedPairs: staged.length,
        insufficientDataPairs,
        failedPairs,
        errorCode: 'PAIR_CALCULATION_FAILED',
      });

      return {
        runId,
        date: targetDate,
        status: 'failed',
        computedPairs: staged.length,
        insufficientDataPairs,
        failedPairs,
        errorCode: 'PAIR_CALCULATION_FAILED',
      };
    }

    const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || 120, 120));
    for (let index = 0; index < staged.length; index += safeBatchSize) {
      await repository.writeStagedResults(
        runId,
        staged.slice(index, index + safeBatchSize)
      );
    }

    const patch = {
      status: 'validating',
      expectedPairs: contexts.length,
      computedPairs: staged.length,
      insufficientDataPairs,
      failedPairs: 0,
    };
    await repository.updateRun(runId, patch);

    return {
      runId,
      date: targetDate,
      ...patch,
      sourceFingerprint,
      configVersion: dependencies.config.version,
      calculationVersion: dependencies.config.calculationVersion,
    };
  } catch (error) {
    await repository.updateRun(runId, {
      status: 'failed',
      errorCode: 'RUN_BUILD_FAILED',
      error: String(error?.message || error).slice(0, 1000),
    });
    throw error;
  }
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function createFirestoreOccupationVigilanceRepository(db, FieldValue) {
  if (!db) throw new Error('Firestore db is required');
  const serverTimestamp = () => FieldValue?.serverTimestamp
    ? FieldValue.serverTimestamp()
    : new Date();

  return {
    async loadDependencies(date) {
      const [contextRunSnap, populationSnap, romeSnap, configSnap] = await Promise.all([
        db.collection('occupationContextStatsRuns').doc(date).get(),
        db.collection('departmentPopulationReferenceMeta').doc('current').get(),
        db.collection('occupationReferenceMeta').doc('current').get(),
        db.collection('occupationVigilanceConfigs').where('status', '==', 'validated').get(),
      ]);

      const configs = configSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) =>
          timestampMillis(b.validatedAt || b.createdAt) -
          timestampMillis(a.validatedAt || a.createdAt)
        );

      return {
        contextRun: contextRunSnap.exists ? contextRunSnap.data() : null,
        populationMeta: populationSnap.exists ? populationSnap.data() : null,
        occupationReferenceMeta: romeSnap.exists ? romeSnap.data() : null,
        config: configs[0] || null,
      };
    },

    async loadContexts(date) {
      const snapshot = await db.collection('occupationContextStats').where('date', '==', date).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    },

    async loadHistories(keys) {
      const output = new Map();
      for (let index = 0; index < keys.length; index += 100) {
        const refs = keys.slice(index, index + 100).map((key) =>
          db.collection('occupationHistoryStats').doc(key)
        );
        if (refs.length === 0) continue;
        const snapshots = await db.getAll(...refs);
        for (const snap of snapshots) {
          if (snap.exists) output.set(snap.id, snap.data());
        }
      }
      return output;
    },

    async loadOccupationReferences(romeCodes, meta) {
      const wanted = new Set(romeCodes);
      const snapshot = await db.collection('occupationReference')
        .where('importRunId', '==', meta.runId)
        .get();
      const output = new Map();
      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        if (wanted.has(data.romeCode)) output.set(data.romeCode, data);
      }
      return output;
    },

    async loadDepartmentNames(departmentCodes) {
      const output = new Map();
      for (let index = 0; index < departmentCodes.length; index += 100) {
        const refs = departmentCodes.slice(index, index + 100).map((code) =>
          db.collection('departments').doc(code)
        );
        if (refs.length === 0) continue;
        const snapshots = await db.getAll(...refs);
        for (const snap of snapshots) {
          if (!snap.exists) continue;
          const data = snap.data() || {};
          output.set(snap.id, data.name || data.departmentName || snap.id);
        }
      }
      return output;
    },

    async getRun(runId) {
      const snap = await db.collection('occupationVigilanceRuns').doc(runId).get();
      return snap.exists ? snap.data() : null;
    },

    async createRun(run) {
      await db.collection('occupationVigilanceRuns').doc(run.runId).set({
        ...run,
        startedAt: serverTimestamp(),
        schemaVersion: 'occupationVigilanceRun.v1',
      }, { merge: false });
    },

    async writeStagedResults(runId, chunk) {
      const batch = db.batch();
      for (const item of chunk) {
        batch.set(
          db.collection('occupationVigilanceSnapshots').doc(runId).collection('entries').doc(item.key),
          { ...item.snapshot, computedAt: serverTimestamp(), schemaVersion: 'occupationVigilanceSnapshot.v1' },
          { merge: false }
        );
        batch.set(
          db.collection('publicOccupationVigilanceMaps').doc(runId).collection('entries').doc(item.key),
          { ...item.mapEntry, runId, schemaVersion: 'publicOccupationVigilanceMapEntry.v1' },
          { merge: false }
        );
        batch.set(
          db.collection('publicOccupationVigilanceDetails').doc(runId).collection('entries').doc(item.key),
          { ...item.detail, runId, schemaVersion: 'publicOccupationVigilanceDetail.v1' },
          { merge: false }
        );
      }
      await batch.commit();
    },

    async updateRun(runId, patch) {
      await db.collection('occupationVigilanceRuns').doc(runId).set({
        ...patch,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    },

    async recordPreflightFailure(payload) {
      await db.collection('occupationVigilancePreflightFailures').add({
        ...payload,
        recordedAt: serverTimestamp(),
        schemaVersion: 'occupationVigilancePreflightFailure.v1',
      });
    },
  };
}

module.exports = {
  pairKey,
  sourceVersionsFromContexts,
  buildDailyOccupationVigilanceRun,
  createFirestoreOccupationVigilanceRepository,
};
