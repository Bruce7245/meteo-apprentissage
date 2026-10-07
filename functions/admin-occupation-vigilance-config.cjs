const crypto = require('node:crypto');
const {
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

  const candidate = {
    ...(draft.candidateConfig || {}),
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

  const token = bearerToken(request);

  if (!token) {
    response.status(401).json({
      ok: false,
      error: 'Authentification requise',
    });
    return;
  }

  let decoded;

  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    response.status(401).json({
      ok: false,
      error: 'Jeton Firebase invalide',
    });
    return;
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
    return;
  }

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
  activateOccupationVigilanceDraft,
  handleOccupationVigilanceConfigActivation,
};
