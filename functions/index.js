const { initializeApp } = require('firebase-admin/app')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
const { defineSecret } = require('firebase-functions/params')
const { onRequest } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { DEPARTMENTS } = require('./departments')

initializeApp()

const db = getFirestore()
const lbaApiKey = defineSecret('LBA_API_KEY')
const inseeApiKey = defineSecret('INSEE_API_KEY')

const DEPARTMENTS_PER_DAY = 3
const REGION = 'europe-west1'

function parisDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function ensureDepartmentStates() {
  const batch = db.batch()

  for (const code of DEPARTMENTS) {
    const ref = db.collection('departmentImportState').doc(code)
    batch.set(
      ref,
      {
        code,
        status: 'pending',
        attempts: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }

  await batch.commit()
}

async function selectNextDepartments(limit = DEPARTMENTS_PER_DAY) {
  const snapshot = await db
    .collection('departmentImportState')
    .where('status', 'in', ['pending', 'failed'])
    .orderBy('updatedAt', 'asc')
    .limit(limit)
    .get()

  return snapshot.docs.map((doc) => doc.id)
}

async function markDepartmentsQueued(codes, runDate) {
  const batch = db.batch()

  for (const code of codes) {
    batch.set(
      db.collection('departmentImportState').doc(code),
      {
        status: 'queued',
        queuedForDate: runDate,
        attempts: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }

  await batch.commit()
}

async function getCoverage() {
  const [all, completed] = await Promise.all([
    db.collection('departmentImportState').count().get(),
    db.collection('departmentImportState').where('status', '==', 'completed').count().get(),
  ])

  const total = all.data().count
  const completedCount = completed.data().count

  return {
    total,
    completed: completedCount,
    percent: total === 0 ? 0 : Math.round((completedCount / total) * 10000) / 100,
  }
}

async function requestLbaExport(apiKey) {
  const response = await fetch('https://api.apprentissage.beta.gouv.fr/api/job/v1/export', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
      'User-Agent': 'ApprentiFR/0.2',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`La Bonne Alternance ${response.status}: ${body.slice(0, 500)}`)
  }

  return response.json()
}

exports.initializeDepartmentQueue = onRequest(
  { region: REGION },
  async (request, response) => {
    await ensureDepartmentStates()
    const coverage = await getCoverage()

    response.status(200).json({
      ok: true,
      departmentsPerDay: DEPARTMENTS_PER_DAY,
      coverage,
    })
  },
)

exports.planDailyInseeImports = onSchedule(
  {
    schedule: '15 5 * * *',
    timeZone: 'Europe/Paris',
    region: REGION,
    secrets: [inseeApiKey],
    retryCount: 2,
  },
  async () => {
    const date = parisDateKey()
    await ensureDepartmentStates()

    const codes = await selectNextDepartments()
    await markDepartmentsQueued(codes, date)

    await db.collection('importRuns').doc(`insee-${date}`).set({
      type: 'insee-departments',
      date,
      departmentCodes: codes,
      departmentsPerDay: DEPARTMENTS_PER_DAY,
      status: codes.length === 0 ? 'nothing-to-do' : 'queued',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    logger.info('Daily INSEE department import planned', { date, codes })
  },
)

exports.refreshLbaExport = onSchedule(
  {
    schedule: '30 5 * * *',
    timeZone: 'Europe/Paris',
    region: REGION,
    secrets: [lbaApiKey],
    retryCount: 2,
  },
  async () => {
    const date = parisDateKey()
    const exportMetadata = await requestLbaExport(lbaApiKey.value())

    await db.collection('sourceExports').doc(`lba-jobs-${date}`).set({
      source: 'la-bonne-alternance',
      type: 'jobs-export',
      date,
      lastUpdate: exportMetadata.lastUpdate ?? null,
      downloadUrl: exportMetadata.url,
      urlExpiresQuickly: true,
      status: 'ready-to-download',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    logger.info('La Bonne Alternance export metadata refreshed', {
      date,
      lastUpdate: exportMetadata.lastUpdate,
    })
  },
)

exports.importCoverage = onRequest(
  { region: REGION, cors: true },
  async (request, response) => {
    const coverage = await getCoverage()
    response.status(200).json({
      ok: true,
      departmentsPerDay: DEPARTMENTS_PER_DAY,
      coverage,
    })
  },
)
