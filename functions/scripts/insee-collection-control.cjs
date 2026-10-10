'use strict';

// Read-only by default. "start" must be explicitly confirmed by the workflow.
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { classifyDepartment } = require('../lib/insee-collection-state.cjs');

const PROJECT_ID = 'meteo-apprentissage';
const MODE = String(process.env.INSEE_COLLECTION_MODE || 'audit').trim().toLowerCase();
const CONFIRM = String(process.env.INSEE_COLLECTION_CONFIRM || '').trim();
const JOB_COLLECTION = 'adminJobs';
const JOB_ID = 'inseeNationalBackgroundJob';

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

function departmentCode(document) {
  const data = document.data() || {};
  return String(data.departmentCode || document.id).trim().toUpperCase();
}

async function readCoverage() {
  const [departmentsSnap, importSnap, statsSnap, nafSnap, jobSnap] = await Promise.all([
    db.collection('departments').get(),
    db.collection('inseeDepartmentImportIndex').get(),
    db.collection('inseeDepartmentStats').get(),
    db.collection('inseeDepartmentNafStatsIndex').get(),
    db.collection(JOB_COLLECTION).doc(JOB_ID).get(),
  ]);

  const departments = departmentsSnap.docs
    .filter((doc) => (doc.data() || {}).enabled !== false)
    .map((doc) => departmentCode(doc))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'fr'));

  const imports = new Map(importSnap.docs.map((doc) => [departmentCode(doc), doc.data() || {}]));
  const stats = new Set(statsSnap.docs.map((doc) => departmentCode(doc)));
  const naf = new Set(nafSnap.docs.map((doc) => departmentCode(doc)));

  const rows = departments.map((code) => {
    const state = classifyDepartment({
      importRecord: imports.get(code) || null,
      statsAvailable: stats.has(code),
      nafStatsAvailable: naf.has(code),
    });
    return {
      code,
      status: state.status,
      resumable: state.resumable,
      stats: state.statsAvailable,
      naf: state.nafStatsAvailable,
    };
  });

  const statusCounts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const job = jobSnap.exists ? jobSnap.data() || {} : null;

  return {
    departments,
    rows,
    statusCounts,
    currentJob: job ? {
      status: job.status || 'unknown',
      currentDepartmentCode: job.currentDepartmentCode || null,
      currentPosition: job.currentPosition ?? null,
      endPosition: job.endPosition ?? null,
      lastCompletedDepartmentCode: job.lastCompletedDepartmentCode || null,
      totalPages: job.totalPages ?? null,
      totalReceived: job.totalReceived ?? null,
      lastRunSource: job.lastRunSource || null,
      errorMessage: typeof job.errorMessage === 'string'
        ? job.errorMessage.slice(0, 400)
        : null,
    } : null,
  };
}

async function beginJob(coverage) {
  if (CONFIRM !== 'REPRENDRE') {
    throw new Error('Confirmation REPRENDRE obligatoire pour commencer la collecte.');
  }

  if (coverage.departments.length < 1 || coverage.departments.length > 110) {
    throw new Error('Liste departements invalide : abandon du lancement.');
  }

  if (coverage.rows.every((row) => row.status === 'ready')) {
    return { started: false, reason: 'all_departments_ready' };
  }

  const jobRef = db.collection(JOB_COLLECTION).doc(JOB_ID);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(jobRef);
    if (existing.exists && (existing.data() || {}).status === 'running') {
      throw new Error('Un job INSEE est deja actif : ne pas le remplacer.');
    }

    transaction.set(jobRef, {
      status: 'running',
      startPosition: 1,
      endPosition: coverage.departments.length,
      currentPosition: 1,
      cursor: '',
      currentDepartmentPages: 0,
      currentDepartmentReceived: 0,
      nombre: 500,
      pagesPerRun: 6,
      delayMsBetweenPages: 1500,
      maxMsPerRun: 480000,
      skipExistingStats: true,
      runSnapshots: false,
      runCommentary: false,
      snapshotDate: null,
      totalPages: 0,
      totalReceived: 0,
      completedDepartmentsCount: 0,
      selectedDepartmentCodes: coverage.departments,
      leaseUntilMs: 0,
      leaseOwner: null,
      errorMessage: null,
      schemaVersion: 'inseeNationalBackgroundJob.v2',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    started: true,
    scheduler: 'resumeInseeNationalBackgroundJob',
    scheduledIntervalMinutes: 5,
    selectedDepartments: coverage.departments.length,
    skippedIfComplete: true,
    resumedViaStoredCursors: true,
    marketVigilancePublicationEnabled: false,
  };
}

async function main() {
  if (!['audit', 'start'].includes(MODE)) {
    throw new Error('Mode incorrect: audit ou start uniquement');
  }

  const coverage = await readCoverage();
  const pending = coverage.rows.filter((row) => row.status !== 'ready');

  const report = {
    mode: MODE,
    expectedDepartments: coverage.departments.length,
    statusCounts: coverage.statusCounts,
    pendingDepartments: pending.map((row) => row.code),
    resumableDepartments: pending.filter((row) => row.resumable).map((row) => row.code),
    currentJob: coverage.currentJob,
  };

  console.log(JSON.stringify({ audit: report }, null, 2));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = require('node:fs');
    const breakdown = Object.entries(coverage.statusCounts)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## INSEE - Entreprises (${MODE})\n\n${breakdown}\n\nEn attente : ${pending.length} departements.\n\n`
    );
  }

  if (MODE === 'start') {
    const result = await beginJob(coverage);
    console.log(JSON.stringify({ launch: result }, null, 2));
  }
}

main().catch((error) => {
  console.error('INSEE collection control failed:', error.message);
  process.exitCode = 1;
});
