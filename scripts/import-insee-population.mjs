import crypto from 'node:crypto';
import admin from 'firebase-admin';
import populationModule from '../functions/lib/insee-population.cjs';

const {
  buildDepartmentPopulation,
  extractRowsFromMelodiPayload,
} = populationModule;

const DATASET_ID = 'DS_RP_TD_POPULATION_AGESEX_PRINC';
const REFERENCE_YEAR = String(
  process.argv[2] || process.env.INSEE_POPULATION_REFERENCE_YEAR || '2023'
).trim();
const MINIMUM_DEPARTMENTS = Number.parseInt(
  process.env.INSEE_POPULATION_MIN_DEPARTMENTS || '100',
  10
);

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'meteo-apprentissage' });
}

const db = admin.firestore();

function sourceUrl() {
  if (process.env.INSEE_POPULATION_SOURCE_URL) {
    return process.env.INSEE_POPULATION_SOURCE_URL;
  }

  const url = new URL(`https://api.insee.fr/melodi/data/${DATASET_ID}`);
  url.searchParams.set('GEO_OBJECT', 'DEP');
  url.searchParams.set('SEX', '_T');
  url.searchParams.set('TIME_PERIOD', REFERENCE_YEAR);
  return url.toString();
}

function stableSourceVersion(departments) {
  const payload = [...departments.values()]
    .sort((a, b) => a.departmentCode.localeCompare(b.departmentCode, 'fr', { numeric: true }))
    .map((item) => ({
      departmentCode: item.departmentCode,
      populationTotal: item.populationTotal,
      population15To29: item.population15To29,
      referenceYear: item.referenceYear,
    }));

  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

async function fetchPopulationRows() {
  const url = sourceUrl();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ApprentiFR population reference importer',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`INSEE Melodi HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  return {
    url,
    rows: extractRowsFromMelodiPayload(payload),
  };
}

async function main() {
  if (!/^\d{4}$/.test(REFERENCE_YEAR)) {
    throw new Error(`Invalid INSEE population reference year: ${REFERENCE_YEAR}`);
  }

  const { url, rows } = await fetchPopulationRows();
  const departments = buildDepartmentPopulation(rows, REFERENCE_YEAR);

  if (departments.size < MINIMUM_DEPARTMENTS) {
    throw new Error(
      `INSEE population reference has ${departments.size} complete departments; minimum is ${MINIMUM_DEPARTMENTS}`
    );
  }

  const sourceVersion = stableSourceVersion(departments);
  const importedAt = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  for (const item of departments.values()) {
    batch.set(
      db.collection('departmentPopulationReference').doc(item.departmentCode),
      {
        ...item,
        source: 'INSEE Melodi',
        datasetId: DATASET_ID,
        sourceVersion,
        importedAt,
        schemaVersion: 'departmentPopulationReference.v1',
      },
      { merge: false }
    );
  }

  batch.set(
    db.collection('departmentPopulationReferenceMeta').doc('current'),
    {
      datasetId: DATASET_ID,
      referenceYear: REFERENCE_YEAR,
      departmentsCount: departments.size,
      source: 'INSEE Melodi',
      sourceUrl: url,
      sourceVersion,
      importedAt,
      schemaVersion: 'departmentPopulationReferenceMeta.v1',
    },
    { merge: false }
  );

  await batch.commit();

  console.log(JSON.stringify({
    ok: true,
    datasetId: DATASET_ID,
    referenceYear: REFERENCE_YEAR,
    departmentsCount: departments.size,
    sourceVersion,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
