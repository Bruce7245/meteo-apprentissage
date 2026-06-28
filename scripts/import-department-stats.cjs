const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({
  projectId: 'meteo-apprentissage',
});

const db = getFirestore();

const token = process.env.API_APPRENTISSAGE_TOKEN;

if (!token) {
  console.error('API_APPRENTISSAGE_TOKEN manquant.');
  console.error('Utilise : read -s -p "Jeton API Apprentissage : " API_APPRENTISSAGE_TOKEN');
  process.exit(1);
}

const API_BASE_URL = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/search';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countBy(items, getter) {
  return items.reduce((accumulator, item) => {
    const key = getter(item) || 'inconnu';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function getTopRomeCodes(jobs) {
  const counts = {};

  jobs.forEach((job) => {
    const romeCodes = job?.offer?.rome_codes || [];

    romeCodes.forEach((rome) => {
      counts[rome] = (counts[rome] || 0) + 1;
    });
  });

  return Object.entries(counts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function getOpeningCount(jobs) {
  return jobs.reduce((total, job) => {
    const openingCount = Number(job?.offer?.opening_count || 0);
    return total + openingCount;
  }, 0);
}

async function fetchDepartmentStats(department) {
  const url = new URL(API_BASE_URL);
  url.searchParams.append('departements', department.code);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Réponse non JSON pour ${department.code}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(
      `Erreur API ${response.status} pour ${department.code}: ${JSON.stringify(data).slice(0, 500)}`
    );
  }

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const recruiters = Array.isArray(data.recruiters) ? data.recruiters : [];
  const warnings = Array.isArray(data.warnings) ? data.warnings : [];

  return {
    code: department.code,
    name: department.name,
    jobsCount: jobs.length,
    recruitersCount: recruiters.length,
    warningsCount: warnings.length,
    openingCount: getOpeningCount(jobs),
    partnerBreakdown: countBy(jobs, (job) => job?.identifier?.partner_label),
    topRomeCodes: getTopRomeCodes(jobs),
    warnings,
    source: 'api-apprentissage-job-v1-search',
    limitedResults: true,
    importedAt: FieldValue.serverTimestamp(),
  };
}

async function loadDepartments() {
  const snapshot = await db.collection('departments').get();

  return snapshot.docs
    .map((document) => ({
      code: document.id,
      ...document.data(),
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

async function importStats() {
  const departments = await loadDepartments();

  if (departments.length === 0) {
    throw new Error('Aucun département trouvé dans Firestore.');
  }

  console.log(`${departments.length} départements à importer.`);

  let successCount = 0;
  let errorCount = 0;

  for (const department of departments) {
    try {
      console.log(`Import ${department.code} - ${department.name}...`);

      const stats = await fetchDepartmentStats(department);

      await db.collection('departmentStats').doc(department.code).set(stats, {
        merge: true,
      });

      console.log(
        `OK ${department.code}: ${stats.jobsCount} offres, ${stats.recruitersCount} recruteurs, ${stats.openingCount} postes`
      );

      successCount += 1;
    } catch (error) {
      console.error(`Erreur ${department.code}:`, error.message);

      await db.collection('departmentStats').doc(department.code).set(
        {
          code: department.code,
          name: department.name,
          lastError: error.message,
          importedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      errorCount += 1;
    }

    await sleep(1200);
  }

  await db.collection('apiImports').doc('lba-department-stats-last-run').set(
    {
      source: 'api-apprentissage-job-v1-search',
      departmentsCount: departments.length,
      successCount,
      errorCount,
      finishedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log('');
  console.log('Import terminé.');
  console.log(`Succès : ${successCount}`);
  console.log(`Erreurs : ${errorCount}`);
}

importStats()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur import global :', error);
    process.exit(1);
  });
