const crypto = require('node:crypto');
const {
  computeOccupationVigilance,
  validateOccupationVigilanceConfig,
} = require('./lib/occupation-vigilance.cjs');

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function bearerToken(request) {
  const header = text(request?.get?.('authorization'));

  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

function stableManualVersion(config) {
  const payload = {
    calculationVersion: config?.calculationVersion || null,
    referencePopulation15To29: config?.referencePopulation15To29 ?? null,
    expectedOffersFloor: config?.expectedOffersFloor ?? null,
    minimumGreenActiveOffers: config?.minimumGreenActiveOffers ?? null,
    baselines: config?.baselines || {},
    factorBounds: config?.factorBounds || {},
    coefficients: config?.coefficients || {},
    thresholds: config?.thresholds || {},
    historicalTrend: config?.historicalTrend || {},
    confidence: config?.confidence || {},
    calibration: config?.calibration || null,
  };

  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 12);

  return `occupationVigilance.manual.${hash}`;
}

function manualCandidateFromDraft(activeConfig, draftConfig) {
  const active = activeConfig || {};
  const draft = draftConfig || {};

  return {
    ...active,
    version: active.version,
    status: 'draft',
    calculationVersion:
      draft.historicalTrend
        ? 'occupationVigilance.v1.2'
        : active.calculationVersion,
    minimumGreenActiveOffers:
      draft.minimumGreenActiveOffers ??
      active.minimumGreenActiveOffers,
    thresholds: {
      ...(active.thresholds || {}),
      ...(draft.thresholds || {}),
    },
    historicalTrend:
      draft.historicalTrend || active.historicalTrend,
    coefficients: {
      ...(active.coefficients || {}),
      ...(draft.coefficients || {}),
    },
  };
}

async function latestValidatedConfig(db) {
  const snapshot = await db
    .collection('occupationVigilanceConfigs')
    .where('status', '==', 'validated')
    .get();

  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .sort(
      (a, b) =>
        timestampMillis(b.validatedAt || b.createdAt) -
        timestampMillis(a.validatedAt || a.createdAt)
    )[0] || null;
}

async function activateOccupationVigilanceDraft({
  draftId,
  uid,
  email,
  db,
  FieldValue,
} = {}) {
  const cleanDraftId = text(draftId);

  if (!cleanDraftId) {
    return {
      ok: false,
      status: 400,
      errorCode: 'DRAFT_ID_REQUIRED',
      error: 'draftId requis',
    };
  }

  const draftRef = db
    .collection('occupationVigilanceConfigDrafts')
    .doc(cleanDraftId);
  const draftSnap = await draftRef.get();

  if (!draftSnap.exists) {
    return {
      ok: false,
      status: 404,
      errorCode: 'DRAFT_NOT_FOUND',
      error: 'Brouillon introuvable',
    };
  }

  const draft = draftSnap.data() || {};

  if (draft.status !== 'draft') {
    return {
      ok: false,
      status: 409,
      errorCode: 'DRAFT_NOT_EDITABLE',
      error: 'Ce brouillon n’est plus activable',
    };
  }

  const activeConfig = await latestValidatedConfig(db);
  const baseConfigVersion = text(draft.baseConfigVersion);

  if (
    activeConfig &&
    baseConfigVersion &&
    activeConfig.version !== baseConfigVersion
  ) {
    return {
      ok: false,
      status: 409,
      errorCode: 'STALE_DRAFT',
      error:
        'La configuration active a changé depuis la création du brouillon. Rechargez les paramètres avant activation.',
      activeConfigVersion: activeConfig.version,
      baseConfigVersion,
    };
  }

  if (!activeConfig) {
    return {
      ok: false,
      status: 409,
      errorCode: 'ACTIVE_CONFIG_MISSING',
      error: 'Aucune configuration active ne peut servir de base.',
    };
  }

  const candidate = {
    ...manualCandidateFromDraft(
      activeConfig,
      draft.candidateConfig || {}
    ),
    status: 'validated',
  };

  candidate.version = stableManualVersion(candidate);

  const validation = validateOccupationVigilanceConfig(candidate);

  if (!validation.ok) {
    return {
      ok: false,
      status: 422,
      errorCode: 'CONFIG_INVALID',
      error: 'Configuration invalide',
      validationErrors: validation.errors,
    };
  }

  const existing = await db
    .collection('occupationVigilanceConfigs')
    .doc(candidate.version)
    .get();

  if (existing.exists) {
    return {
      ok: true,
      status: 200,
      version: candidate.version,
      reused: true,
    };
  }

  const serverTimestamp = () =>
    FieldValue?.serverTimestamp
      ? FieldValue.serverTimestamp()
      : new Date();

  const batch = db.batch();
  const configRef = db
    .collection('occupationVigilanceConfigs')
    .doc(candidate.version);
  const auditRef = db
    .collection('occupationVigilanceConfigAudit')
    .doc();

  batch.set(
    configRef,
    {
      ...candidate,
      createdAt: serverTimestamp(),
      validatedAt: serverTimestamp(),
      validatedBy: {
        uid: text(uid) || null,
        email: text(email) || null,
      },
      sourceDraftId: cleanDraftId,
      baseConfigVersion: baseConfigVersion || activeConfig?.version || null,
      schemaVersion: 'occupationVigilanceConfig.v1',
    },
    { merge: false }
  );

  batch.set(
    draftRef,
    {
      status: 'activated',
      activatedVersion: candidate.version,
      activatedAt: serverTimestamp(),
      activatedBy: {
        uid: text(uid) || null,
        email: text(email) || null,
      },
    },
    { merge: true }
  );

  batch.set(
    auditRef,
    {
      action: 'activate_manual_config',
      draftId: cleanDraftId,
      activatedVersion: candidate.version,
      previousVersion: activeConfig?.version || null,
      actor: {
        uid: text(uid) || null,
        email: text(email) || null,
      },
      recordedAt: serverTimestamp(),
      schemaVersion: 'occupationVigilanceConfigAudit.v1',
    },
    { merge: false }
  );

  await batch.commit();

  return {
    ok: true,
    status: 200,
    version: candidate.version,
    reused: false,
  };
}

function normalizeRomeCode(value) {
  const code = text(value).toUpperCase();
  return /^[A-Z][0-9]{4}$/.test(code) ? code : '';
}

function runSortValue(run) {
  const date = text(run?.date);
  const timestamp = Math.max(
    timestampMillis(run?.publishedAt),
    timestampMillis(run?.updatedAt),
    timestampMillis(run?.startedAt)
  );

  return {
    date,
    timestamp,
  };
}

async function latestReadyOccupationRun(db) {
  const snapshot = await db
    .collection('occupationVigilanceRuns')
    .get();

  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .filter((run) =>
      ['published', 'ready'].includes(text(run.status))
    )
    .sort((a, b) => {
      const aSort = runSortValue(a);
      const bSort = runSortValue(b);
      const dateCompare = bSort.date.localeCompare(aSort.date);

      if (dateCompare !== 0) return dateCompare;
      return bSort.timestamp - aSort.timestamp;
    })[0] || null;
}

function snapshotToVigilanceInput(snapshot = {}) {
  return {
    romeCode: snapshot.romeCode,
    romeKnown: true,
    activeOffersCount: snapshot.activeOffersCount,
    population15To29: snapshot.population15To29,
    formationsCount: snapshot.formationsCount,
    employerConcentration: snapshot.employerConcentration,
    recentTrend:
      snapshot.recentTrend || { status: 'unknown' },
    seasonality:
      snapshot.seasonality || {
        status: 'unavailable',
        factor: 1,
      },
    interannualTrend:
      snapshot.interannualTrend || {
        status: 'unavailable',
        direction: 'unknown',
        factor: 1,
      },
  };
}

function levelRank(level) {
  const ranks = {
    green: 0,
    yellow: 1,
    orange: 2,
    red: 3,
    insufficient_data: -1,
  };

  return ranks[text(level)] ?? -1;
}

function emptyLevelCounts() {
  return {
    green: 0,
    yellow: 0,
    orange: 0,
    red: 0,
    insufficient_data: 0,
  };
}

function simulateOccupationRows({
  snapshots,
  activeConfig,
  candidateConfig,
  romeCode,
} = {}) {
  const rome = normalizeRomeCode(romeCode);

  if (!rome) {
    throw new Error('Code ROME invalide pour la simulation.');
  }

  if (!activeConfig) {
    throw new Error('Configuration active manquante.');
  }

  const candidate = {
    ...manualCandidateFromDraft(
      activeConfig,
      candidateConfig || {}
    ),
    status: 'validated',
  };

  candidate.version = stableManualVersion(candidate);

  const validation = validateOccupationVigilanceConfig(candidate);

  if (!validation.ok) {
    const error = new Error(
      'Configuration de simulation invalide : ' +
      validation.errors.join('; ')
    );
    error.validationErrors = validation.errors;
    throw error;
  }

  const currentLevels = emptyLevelCounts();
  const proposedLevels = emptyLevelCounts();
  const rows = [];

  let changedCount = 0;
  let worsenedCount = 0;
  let improvedCount = 0;

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (normalizeRomeCode(snapshot?.romeCode) !== rome) continue;

    const currentLevel = text(
      snapshot.publishedLevel || 'insufficient_data'
    );
    const proposed = computeOccupationVigilance(
      snapshotToVigilanceInput(snapshot),
      candidate
    );
    const proposedLevel = proposed.publishedLevel;

    if (currentLevel in currentLevels) {
      currentLevels[currentLevel] += 1;
    }

    if (proposedLevel in proposedLevels) {
      proposedLevels[proposedLevel] += 1;
    }

    const changed = currentLevel !== proposedLevel;
    const currentRank = levelRank(currentLevel);
    const proposedRank = levelRank(proposedLevel);
    const direction = !changed
      ? 'unchanged'
      : currentRank < 0 || proposedRank < 0
        ? 'changed'
        : proposedRank > currentRank
          ? 'worsened'
          : 'improved';

    if (changed) changedCount += 1;
    if (direction === 'worsened') worsenedCount += 1;
    if (direction === 'improved') improvedCount += 1;

    rows.push({
      departmentCode: snapshot.departmentCode || null,
      departmentName: snapshot.departmentName || null,
      romeCode: rome,
      romeLabel: snapshot.romeLabel || rome,
      activeOffersCount: snapshot.activeOffersCount ?? null,
      currentLevel,
      proposedLevel,
      changed,
      direction,
      currentExpectedOffers: snapshot.expectedOffers ?? null,
      proposedExpectedOffers: proposed.expectedOffers,
      currentObservedVsExpectedRatio:
        snapshot.observedVsExpectedRatio ?? null,
      proposedObservedVsExpectedRatio:
        proposed.observedVsExpectedRatio,
      currentEffectiveThresholds:
        snapshot.effectiveThresholds || null,
      proposedEffectiveThresholds:
        proposed.effectiveThresholds || null,
      proposedFactors: proposed.factors || null,
      proposedConfidenceLevel:
        proposed.confidenceLevel || 'low',
      proposedReasonCodes:
        Array.isArray(proposed.reasonCodes)
          ? proposed.reasonCodes
          : [],
    });
  }

  rows.sort((a, b) => {
    if (a.changed !== b.changed) return a.changed ? -1 : 1;

    const directionRank = {
      worsened: 0,
      improved: 1,
      changed: 2,
      unchanged: 3,
    };
    const directionDiff =
      (directionRank[a.direction] ?? 9) -
      (directionRank[b.direction] ?? 9);

    if (directionDiff !== 0) return directionDiff;

    const proposedDiff =
      levelRank(b.proposedLevel) -
      levelRank(a.proposedLevel);

    if (proposedDiff !== 0) return proposedDiff;

    return text(a.departmentName || a.departmentCode)
      .localeCompare(
        text(b.departmentName || b.departmentCode),
        'fr'
      );
  });

  return {
    candidateVersion: candidate.version,
    romeCode: rome,
    romeLabel: rows[0]?.romeLabel || rome,
    summary: {
      departmentsCount: rows.length,
      changedCount,
      worsenedCount,
      improvedCount,
      unchangedCount: rows.length - changedCount,
      currentLevels,
      proposedLevels,
    },
    rows,
  };
}

async function previewOccupationVigilanceConfig({
  candidateConfig,
  romeCode,
  baseConfigVersion,
  db,
} = {}) {
  const activeConfig = await latestValidatedConfig(db);

  if (!activeConfig) {
    return {
      ok: false,
      status: 409,
      errorCode: 'ACTIVE_CONFIG_MISSING',
      error: 'Aucune configuration active ne peut servir de base.',
    };
  }

  const expectedBaseVersion = text(baseConfigVersion);

  if (
    expectedBaseVersion &&
    expectedBaseVersion !== activeConfig.version
  ) {
    return {
      ok: false,
      status: 409,
      errorCode: 'STALE_SIMULATION_BASE',
      error:
        'La configuration active a changé depuis l’ouverture de cette page. Rechargez les paramètres avant de simuler.',
      activeConfigVersion: activeConfig.version,
      baseConfigVersion: expectedBaseVersion,
    };
  }

  const run = await latestReadyOccupationRun(db);

  if (!run) {
    return {
      ok: false,
      status: 409,
      errorCode: 'RUN_MISSING',
      error: 'Aucun run métier prêt ou publié pour simuler.',
    };
  }

  const rome = normalizeRomeCode(romeCode);

  if (!rome) {
    return {
      ok: false,
      status: 400,
      errorCode: 'ROME_REQUIRED',
      error: 'Un métier ROME valide est requis pour simuler.',
    };
  }

  const snapshot = await db
    .collection('occupationVigilanceSnapshots')
    .doc(run.id)
    .collection('entries')
    .where('romeCode', '==', rome)
    .get();

  const rows = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  if (rows.length === 0) {
    return {
      ok: false,
      status: 404,
      errorCode: 'ROME_NOT_IN_RUN',
      error: 'Aucun département disponible pour ce métier dans le dernier run.',
    };
  }

  try {
    const simulation = simulateOccupationRows({
      snapshots: rows,
      activeConfig,
      candidateConfig,
      romeCode: rome,
    });

    return {
      ok: true,
      status: 200,
      run: {
        id: run.id,
        date: run.date || null,
        configVersion: run.configVersion || null,
        calculationVersion: run.calculationVersion || null,
      },
      activeConfigVersion: activeConfig.version,
      ...simulation,
    };
  } catch (error) {
    return {
      ok: false,
      status: 422,
      errorCode: 'SIMULATION_INVALID',
      error: error.message,
      validationErrors:
        Array.isArray(error.validationErrors)
          ? error.validationErrors
          : [],
    };
  }
}

async function authenticateAdminRequest({
  request,
  response,
  auth,
  db,
} = {}) {
  const token = bearerToken(request);

  if (!token) {
    response.status(401).json({
      ok: false,
      error: 'Authentification requise',
    });
    return null;
  }

  let decoded;

  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    response.status(401).json({
      ok: false,
      error: 'Jeton Firebase invalide',
    });
    return null;
  }

  const userSnap = await db
    .collection('users')
    .doc(decoded.uid)
    .get();

  if (!userSnap.exists || userSnap.data()?.role !== 'admin') {
    response.status(403).json({
      ok: false,
      error: 'Droits administrateur requis',
    });
    return null;
  }

  return decoded;
}

async function handleOccupationVigilanceConfigPreview({
  request,
  response,
  auth,
  db,
} = {}) {
  if (request?.method !== 'POST') {
    response.status(405).json({
      ok: false,
      error: 'Méthode non autorisée',
    });
    return;
  }

  const decoded = await authenticateAdminRequest({
    request,
    response,
    auth,
    db,
  });

  if (!decoded) return;

  const result = await previewOccupationVigilanceConfig({
    candidateConfig: request?.body?.candidateConfig,
    romeCode: request?.body?.romeCode,
    baseConfigVersion: request?.body?.baseConfigVersion,
    db,
  });

  response.status(result.status).json(result);
}

async function handleOccupationVigilanceConfigActivation({
  request,
  response,
  auth,
  db,
  FieldValue,
} = {}) {
  if (request?.method !== 'POST') {
    response.status(405).json({
      ok: false,
      error: 'Méthode non autorisée',
    });
    return;
  }

  const decoded = await authenticateAdminRequest({
    request,
    response,
    auth,
    db,
  });

  if (!decoded) return;

  const result = await activateOccupationVigilanceDraft({
    draftId: request?.body?.draftId,
    uid: decoded.uid,
    email: decoded.email || null,
    db,
    FieldValue,
  });

  response.status(result.status).json(result);
}

module.exports = {
  bearerToken,
  stableManualVersion,
  manualCandidateFromDraft,
  snapshotToVigilanceInput,
  simulateOccupationRows,
  previewOccupationVigilanceConfig,
  authenticateAdminRequest,
  handleOccupationVigilanceConfigPreview,
  activateOccupationVigilanceDraft,
  handleOccupationVigilanceConfigActivation,
};
