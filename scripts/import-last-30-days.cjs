const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({
  projectId: 'meteo-apprentissage',
});

const db = getFirestore();

const token = process.env.API_APPRENTISSAGE_TOKEN;

if (!token) {
  console.error('API_APPRENTISSAGE_TOKEN manquant.');
  process.exit(1);
}

const API_BASE_URL = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/search';

const ROME_FAMILIES = {
  A: 'Agriculture, pêche, espaces naturels',
  B: 'Arts et façonnage d’ouvrages',
  C: 'Banque, assurance, immobilier',
  D: 'Commerce, vente, grande distribution',
  E: 'Communication, média, multimédia',
  F: 'Construction, bâtiment, travaux publics',
  G: 'Hôtellerie, restauration, tourisme, loisirs',
  H: 'Industrie',
  I: 'Installation et maintenance',
  J: 'Santé',
  K: 'Services à la personne et à la collectivité',
  L: 'Spectacle',
  M: 'Support à l’entreprise',
  N: 'Transport et logistique',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parisDateString(date) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return parisDateString(date);
}

function getJobCreationDate(job) {
  const value = job?.offer?.publication?.creation;

  if (!value) {
    return null;
  }

  return parisDateString(new Date(value));
}

function getJobExpirationDate(job) {
  const value = job?.offer?.publication?.expiration;

  if (!value) {
    return null;
  }

  return parisDateString(new Date(value));
}

function getJobId(job) {
  const identifier = job?.identifier || {};
  return (
    identifier.id ||
    `${identifier.partner_label || 'unknown'}:${identifier.partner_job_id || 'unknown'}`
  );
}

function countOpening(jobs) {
  return jobs.reduce((total, job) => {
    return total + Number(job?.offer?.opening_count || 0);
  }, 0);
}

function increment(counter, key, amount = 1) {
  const cleanKey = key || 'Inconnu';
  counter[cleanKey] = (counter[cleanKey] || 0) + amount;
}

function topFromCounter(counter, limit = 10) {
  return Object.entries(counter)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function aggregateJobs(jobs) {
  const romeCounter = {};
  const romeFamilyCounter = {};
  const nafCounter = {};
  const opcoCounter = {};
  const statusCounter = {};
  const partnerCounter = {};

  jobs.forEach((job) => {
    increment(statusCounter, job?.offer?.status || 'Active');
    increment(partnerCounter, job?.identifier?.partner_label);

    const romes = job?.offer?.rome_codes || [];

    romes.forEach((rome) => {
      increment(romeCounter, rome);

      const familyKey = String(rome || '').charAt(0);
      const familyLabel = ROME_FAMILIES[familyKey] || 'Famille métier inconnue';
      increment(romeFamilyCounter, familyLabel);
    });

    const nafLabel = job?.workplace?.domain?.naf?.label;
    const opco = job?.workplace?.domain?.opco;

    increment(nafCounter, nafLabel);
    increment(opcoCounter, opco);
  });

  return {
    topRomeCodes: topFromCounter(romeCounter).map((item) => ({
      code: item.label,
      count: item.count,
    })),
    topRomeFamilies: topFromCounter(romeFamilyCounter).map((item) => ({
      sector: item.label,
      count: item.count,
    })),
    topNafLabels: topFromCounter(nafCounter),
    topOpcos: topFromCounter(opcoCounter),
    statusBreakdown: statusCounter,
    partnerBreakdown: partnerCounter,
  };
}

async function fetchDepartment(code) {
  const url = new URL(API_BASE_URL);
  url.searchParams.append('departements', code);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }

  return {
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
    recruiters: Array.isArray(data.recruiters) ? data.recruiters : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
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

async function main() {
  const today = parisDateString(new Date());
  const startDate = dateDaysAgo(30);
  const departments = await loadDepartments();

  console.log(`Import 30 jours : ${startDate} -> ${today}`);
  console.log(`${departments.length} départements à traiter.`);

  let successCount = 0;
  let errorCount = 0;

  for (const department of departments) {
    try {
      console.log(`Import ${department.code} - ${department.name}...`);

      const result = await fetchDepartment(department.code);

      const jobsLast30Days = result.jobs.filter((job) => {
        const creationDate = getJobCreationDate(job);
        return creationDate && creationDate >= startDate && creationDate <= today;
      });

      const expiringSoonJobs = result.jobs.filter((job) => {
        const expirationDate = getJobExpirationDate(job);
        return expirationDate && expirationDate >= today && expirationDate <= dateDaysAgo(-7);
      });

      const aggregation = aggregateJobs(jobsLast30Days);

      const document = {
        code: department.code,
        name: department.name,
        period: 'last_30_days',
        periodStart: startDate,
        periodEnd: today,

        returnedActiveJobsCount: result.jobs.length,
        jobsCount: jobsLast30Days.length,
        openingCount: countOpening(jobsLast30Days),
        recruitersCount: result.recruiters.length,
        warningsCount: result.warnings.length,
        expiringSoonCount: expiringSoonJobs.length,

        activeOfferIds: result.jobs.map(getJobId).filter(Boolean),
        periodOfferIds: jobsLast30Days.map(getJobId).filter(Boolean),

        ...aggregation,

        source: 'api-apprentissage-job-v1-search',
        limitedResults: true,
        importedAt: FieldValue.serverTimestamp(),
      };

      await db.collection('departmentStats').doc(department.code).set(document, {
        merge: true,
      });

      console.log(
        `OK ${department.code}: ${document.jobsCount} offres créées sur 30 jours, ${document.openingCount} postes`
      );

      successCount += 1;
    } catch (error) {
      console.error(`Erreur ${department.code}: ${error.message}`);
      errorCount += 1;

      await db.collection('departmentStats').doc(department.code).set(
        {
          code: department.code,
          name: department.name,
          lastError: error.message,
          importedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await sleep(1200);
  }

  await db.collection('apiImports').doc(`last30_${today}`).set({
    type: 'last_30_days_manual_import',
    periodStart: startDate,
    periodEnd: today,
    departmentsCount: departments.length,
    successCount,
    errorCount,
    finishedAt: FieldValue.serverTimestamp(),
  });

  console.log('Import 30 jours terminé.');
  console.log(`Succès : ${successCount}`);
  console.log(`Erreurs : ${errorCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Erreur import 30 jours:', error);
    process.exit(1);
  });
