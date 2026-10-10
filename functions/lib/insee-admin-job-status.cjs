'use strict';

const { authenticateAdminRequest } = require('./admin-auth.cjs');

const ALLOWED_STATUSES = new Set(['running', 'paused', 'done', 'error']);

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function timestampIso(value) {
  if (!value || typeof value.toDate !== 'function') return null;
  const date = value.toDate();
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString()
    : null;
}

function departmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^(?:0[1-9]|[1-8][0-9]|9[0-5]|2A|2B|97[1-6])$/.test(code) ? code : null;
}

/** Return an intentionally small allowlist of monitoring fields, never a Firestore raw job. */
function sanitizeInseeCollectionJob(job) {
  if (!job || typeof job !== 'object') return null;
  return {
    status: ALLOWED_STATUSES.has(job.status) ? job.status : 'unknown',
    currentDepartmentCode: departmentCode(job.currentDepartmentCode),
    currentPosition: nonNegativeInteger(job.currentPosition),
    endPosition: nonNegativeInteger(job.endPosition),
    totalPages: nonNegativeInteger(job.totalPages),
    totalReceived: nonNegativeInteger(job.totalReceived),
    completedDepartmentsCount: nonNegativeInteger(job.completedDepartmentsCount),
    currentDepartmentPages: nonNegativeInteger(job.currentDepartmentPages),
    lastRunPages: nonNegativeInteger(job.lastRunPages),
    lastRunReceived: nonNegativeInteger(job.lastRunReceived),
    lastCompletedDepartmentCode: departmentCode(job.lastCompletedDepartmentCode),
    lastHeartbeatAt: timestampIso(job.lastHeartbeatAt),
    updatedAt: timestampIso(job.updatedAt),
    createdAt: timestampIso(job.createdAt),
    errorAt: timestampIso(job.errorAt),
    finishedAt: timestampIso(job.finishedAt),
    hasError: job.status === 'error' || Boolean(job.errorMessage),
  };
}

async function handleInseeCollectionStatus({ request, response, auth, db } = {}) {
  response.set?.('Cache-Control', 'private, no-store');

  if (request?.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }

  if (request?.method !== 'POST') {
    response.set?.('Allow', 'POST, OPTIONS');
    response.status(405).json({ ok: false, error: 'Méthode non autorisée' });
    return;
  }

  try {
    const decoded = await authenticateAdminRequest({
      request, response, auth, db,
      requiredProvider: 'password',
      requireEmailVerified: true,
    });
    if (!decoded) return;

    const snapshot = await db.collection('adminJobs').doc('inseeNationalBackgroundJob').get();
    response.status(200).json({
      ok: true,
      exists: snapshot.exists,
      job: snapshot.exists ? sanitizeInseeCollectionJob(snapshot.data()) : null,
    });
  } catch (error) {
    console.error('getInseeCollectionStatusHttp error', {
      code: String(error?.code || 'internal').slice(0, 80),
    });
    response.status(503).json({
      ok: false,
      error: 'Statut de la collecte momentanément indisponible.',
    });
  }
}

module.exports = { sanitizeInseeCollectionJob, handleInseeCollectionStatus };
