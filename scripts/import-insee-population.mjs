import crypto from 'node:crypto';
import admin from 'firebase-admin';
import XLSX from 'xlsx';
import populationLib from '../functions/lib/insee-population.cjs';

const {
  buildDepartmentPopulationFromWorksheetRows,
} = populationLib;

const REFERENCE_YEAR = Number(process.env.POPULATION_REFERENCE_YEAR || 2026);
const SOURCE_URL = process.env.INSEE_POPULATION_URL ||
  'https://www.insee.fr/fr/statistiques/fichier/8721456/estim-pop-dep-sexe-aq-1975-2026.xlsx';
const SOURCE_NAME = 'INSEE estimations de population département sexe âge quinquennal';
const SOURCE_DATASET = 'estim-pop-dep-sexe-aq-1975-2026';
const EXPECTED_DEPARTMENT_COUNT = 101;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!DRY_RUN && !admin.apps.length) {
  admin.initializeApp();
}

const db = DRY_RUN ? null : admin.firestore();

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function fetchWorkbook() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      'User-Agent': 'ApprentiFR INSEE population importer',
    },
  });

  if (!response.ok) {
    throw new Error(`INSEE population HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function extractYearRows(buffer, referenceYear) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
  });

  const targetName = String(referenceYear);
  const sheetName = workbook.SheetNames.find(
    (name) => String(name).trim() === targetName
  );

  if (!sheetName) {
    throw new Error(
      `Population workbook has no sheet for reference year ${referenceYear}`
    );
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
}

function validatePopulationMap(populationMap) {
  const count = populationMap.size;
  const missingMayotte = !populationMap.has('976');

  if (count !== EXPECTED_DEPARTMENT_COUNT || missingMayotte) {
    throw new Error(
      `Population reference incomplete: departments=${count}, expected=${EXPECTED_DEPARTMENT_COUNT}, mayotte=${missingMayotte ? 'missing' : 'present'}`
    );
  }

  for (const [departmentCode, data] of populationMap) {
    if (
      !Number.isFinite(data.populationTotal) ||
      !Number.isFinite(data.population15To29) ||
      data.populationTotal <= 0 ||
      data.population15To29 < 0 ||
      data.population15To29 > data.populationTotal
    ) {
      throw new Error(`Invalid population aggregate for department ${departmentCode}`);
    }
  }
}

async function writeStagedRun(runId, rows, sourceVersion) {
  const runRef = db.collection('departmentPopulationReferenceRuns').doc(runId);
  const stagedRef = runRef.collection('departments');

  await runRef.set({
    runId,
    status: 'building',
    referenceYear: REFERENCE_YEAR,
    source: SOURCE_NAME,
    sourceDataset: SOURCE_DATASET,
    sourceUrl: SOURCE_URL,
    sourceVersion,
    expectedDepartments: EXPECTED_DEPARTMENT_COUNT,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'departmentPopulationReferenceRun.v1',
  });

  let batch = db.batch();
  let pending = 0;

  for (const data of rows.values()) {
    batch.set(stagedRef.doc(data.departmentCode), {
      ...data,
      source: SOURCE_NAME,
      sourceDataset: SOURCE_DATASET,
      sourceVersion,
      runId,
      schemaVersion: 'departmentPopulationReference.v1',
      importedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    pending += 1;

    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) {
    await batch.commit();
  }

  return runRef;
}

async function publishAtomically(runRef, runId, populationMap, sourceVersion) {
  const batch = db.batch();

  for (const data of populationMap.values()) {
    batch.set(
      db.collection('departmentPopulationReference').doc(data.departmentCode),
      {
        ...data,
        source: SOURCE_NAME,
        sourceDataset: SOURCE_DATASET,
        sourceVersion,
        runId,
        schemaVersion: 'departmentPopulationReference.v1',
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
    );
  }

  batch.set(db.collection('departmentPopulationReferenceMeta').doc('current'), {
    runId,
    referenceYear: REFERENCE_YEAR,
    source: SOURCE_NAME,
    sourceDataset: SOURCE_DATASET,
    sourceUrl: SOURCE_URL,
    sourceVersion,
    departmentsCount: populationMap.size,
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'departmentPopulationReferenceMeta.v1',
  });

  batch.set(runRef, {
    status: 'published',
    writtenDepartments: populationMap.size,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
}

async function main() {
  const buffer = await fetchWorkbook();
  const sourceHash = hashBuffer(buffer);
  const sourceVersion = `sha256:${sourceHash}`;
  const runId = `population_${REFERENCE_YEAR}_${sourceHash.slice(0, 12)}`;

  const worksheetRows = extractYearRows(buffer, REFERENCE_YEAR);
  const populationMap = buildDepartmentPopulationFromWorksheetRows(
    worksheetRows,
    REFERENCE_YEAR
  );

  validatePopulationMap(populationMap);

  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      runId,
      referenceYear: REFERENCE_YEAR,
      sourceVersion,
      departmentsCount: populationMap.size,
      sample: Array.from(populationMap.values()).slice(0, 8),
      mayotte: populationMap.get('976') || null,
    }, null, 2));
    return;
  }

  const runRef = await writeStagedRun(
    runId,
    populationMap,
    sourceVersion
  );

  try {
    await publishAtomically(
      runRef,
      runId,
      populationMap,
      sourceVersion
    );

    console.log(JSON.stringify({
      ok: true,
      runId,
      referenceYear: REFERENCE_YEAR,
      sourceVersion,
      departmentsCount: populationMap.size,
    }, null, 2));
  } catch (error) {
    await runRef.set({
      status: 'failed',
      error: String(error?.message || error).slice(0, 1000),
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
