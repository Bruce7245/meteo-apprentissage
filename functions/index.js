const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const OpenAI = require('openai');

admin.initializeApp();

const db = admin.firestore();
const API_APPRENTISSAGE_TOKEN = defineSecret('API_APPRENTISSAGE_TOKEN');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

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

function parisDateWithOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return parisDateString(date);
}

function getJobCreationDate(job) {
  const value = job?.offer?.publication?.creation;
  return value ? parisDateString(new Date(value)) : null;
}

function getJobExpirationDate(job) {
  const value = job?.offer?.publication?.expiration;
  return value ? parisDateString(new Date(value)) : null;
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

    increment(nafCounter, job?.workplace?.domain?.naf?.label);
    increment(opcoCounter, job?.workplace?.domain?.opco);
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


function buildDepartmentSectorStats(jobs, department, date) {
  const sectorMap = {};

  jobs.forEach((job) => {
    const romes = Array.isArray(job?.offer?.rome_codes)
      ? job.offer.rome_codes
      : [];

    romes.forEach((rome) => {
      const familyKey = String(rome || '').charAt(0);
      const sectorLabel = ROME_FAMILIES[familyKey] || 'Famille métier inconnue';
      const openingCount = Number(job?.offer?.opening_count || 0);

      if (!sectorMap[sectorLabel]) {
        sectorMap[sectorLabel] = {
          date,
          departmentCode: department.code,
          departmentName: department.name,
          sectorCode: familyKey || 'unknown',
          sectorLabel,
          jobsCount: 0,
          openingCount: 0,
          romeCodes: {},
          source: 'api-apprentissage-job-v1-search',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }

      sectorMap[sectorLabel].jobsCount += 1;
      sectorMap[sectorLabel].openingCount += openingCount;
      sectorMap[sectorLabel].romeCodes[rome] = (sectorMap[sectorLabel].romeCodes[rome] || 0) + 1;
    });
  });

  return Object.values(sectorMap).map((sector) => {
    const topRomeCodes = Object.entries(sector.romeCodes)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    delete sector.romeCodes;

    let level = 'Vert';
    let reason = 'Le secteur présente un volume observé sans signal de tension particulier.';

    if (sector.jobsCount === 0) {
      level = 'Jaune';
      reason = 'Aucune nouvelle offre observée sur la période quotidienne. Signal à confirmer avant toute dégradation.';
    } else if (sector.jobsCount < 3) {
      level = 'Jaune';
      reason = 'Volume quotidien faible dans ce secteur. Une surveillance est recommandée.';
    }

    return {
      ...sector,
      topRomeCodes,
      level,
      suggestedLevel: level,
      publicLevel: level,
      publicReason: reason,
      confidence: sector.jobsCount >= 10 ? 'high' : sector.jobsCount >= 3 ? 'medium' : 'low',
    };
  });
}

async function fetchDepartment(code, token) {
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

async function getPreviousActiveIds(departmentCode) {
  const previousDate = parisDateWithOffset(-1);
  const previousId = `${previousDate}_${departmentCode}`;
  const snapshot = await db.collection('departmentDailyStats').doc(previousId).get();

  if (!snapshot.exists) {
    return [];
  }

  const data = snapshot.data();
  return Array.isArray(data.activeOfferIds) ? data.activeOfferIds : [];
}

exports.importDailyOffers = onSchedule(
  {
    schedule: '59 23 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [API_APPRENTISSAGE_TOKEN],
  },
  async () => {
    const token = API_APPRENTISSAGE_TOKEN.value();
    const today = parisDateString(new Date());
    const departments = await loadDepartments();

    let successCount = 0;
    let errorCount = 0;

    console.log(`Import quotidien ${today} pour ${departments.length} départements.`);

    for (const department of departments) {
      try {
        const result = await fetchDepartment(department.code, token);

        const todayJobs = result.jobs.filter((job) => {
          return getJobCreationDate(job) === today;
        });

        const expiringSoonJobs = result.jobs.filter((job) => {
          const expirationDate = getJobExpirationDate(job);
          return (
            expirationDate &&
            expirationDate >= today &&
            expirationDate <= parisDateWithOffset(7)
          );
        });

        const activeOfferIds = result.jobs.map(getJobId).filter(Boolean);
        const previousActiveIds = await getPreviousActiveIds(department.code);
        const activeSet = new Set(activeOfferIds);
        const notSeenSinceYesterdayIds = previousActiveIds.filter(
          (id) => !activeSet.has(id)
        );

        const aggregation = aggregateJobs(todayJobs);

        const dailyDocument = {
          date: today,
          code: department.code,
          name: department.name,

          period: 'today',
          returnedActiveJobsCount: result.jobs.length,
          jobsCount: todayJobs.length,
          openingCount: countOpening(todayJobs),
          recruitersCount: result.recruiters.length,
          warningsCount: result.warnings.length,
          expiringSoonCount: expiringSoonJobs.length,

          activeOfferIds,
          todayOfferIds: todayJobs.map(getJobId).filter(Boolean),
          notSeenSinceYesterdayCount: notSeenSinceYesterdayIds.length,
          notSeenSinceYesterdayIds,

          ...aggregation,

          source: 'api-apprentissage-job-v1-search',
          limitedResults: true,
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db
          .collection('departmentDailyStats')
          .doc(`${today}_${department.code}`)
          .set(dailyDocument, { merge: true });

        const sectorStats = buildDepartmentSectorStats(todayJobs, department, today);

        const batch = db.batch();

        sectorStats.forEach((sector) => {
          const documentId = `${department.code}_${sector.sectorCode}`;
          const reference = db.collection('departmentSectorStats').doc(documentId);
          batch.set(reference, sector, { merge: true });
        });

        if (sectorStats.length > 0) {
          await batch.commit();
        }

        successCount += 1;
        console.log(`OK ${department.code}: ${todayJobs.length} offre(s) du jour`);
      } catch (error) {
        errorCount += 1;
        console.error(`Erreur ${department.code}:`, error.message);

        await db
          .collection('departmentDailyStats')
          .doc(`${today}_${department.code}`)
          .set(
            {
              date: today,
              code: department.code,
              name: department.name,
              lastError: error.message,
              importedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      }

      await sleep(1200);
    }

    await db.collection('apiImports').doc(`daily_${today}`).set(
      {
        type: 'daily_scheduled_import',
        date: today,
        departmentsCount: departments.length,
        successCount,
        errorCount,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`Import quotidien terminé. Succès: ${successCount}, erreurs: ${errorCount}`);
  }
);

function compactNumber(value) {
  return Number(value || 0);
}

function _getLevelRank(level) {
  const ranks = {
    Vert: 0,
    Jaune: 1,
    Orange: 2,
    Rouge: 3,
  };

  return ranks[level] ?? 0;
}

function getPreviousDateFromDateString(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return parisDateString(date);
}

function computePercentChange(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);

  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function getSeasonalContext(dateString) {
  const month = Number(String(dateString).split('-')[1]);

  const profiles = {
    1: {
      label: 'Janvier',
      expectedBehavior: 'reprise progressive',
      interpretation: 'Les volumes peuvent redémarrer lentement après la période de fin d’année.',
      alertSensitivity: 'normal',
    },
    2: {
      label: 'Février',
      expectedBehavior: 'préparation progressive',
      interpretation: 'Les premiers signaux de préparation de la campagne d’apprentissage peuvent apparaître.',
      alertSensitivity: 'normal',
    },
    3: {
      label: 'Mars',
      expectedBehavior: 'hausse attendue',
      interpretation: 'Une stagnation ou une baisse en mars peut être plus préoccupante, car la campagne devrait commencer à se renforcer.',
      alertSensitivity: 'increased',
    },
    4: {
      label: 'Avril',
      expectedBehavior: 'hausse attendue',
      interpretation: 'Le marché devrait normalement gagner en activité en préparation de la rentrée.',
      alertSensitivity: 'increased',
    },
    5: {
      label: 'Mai',
      expectedBehavior: 'forte activité attendue',
      interpretation: 'Une baisse ou une faible progression peut signaler un démarrage insuffisant de la campagne.',
      alertSensitivity: 'increased',
    },
    6: {
      label: 'Juin',
      expectedBehavior: 'activité élevée attendue',
      interpretation: 'Le marché est généralement actif ; une baisse confirmée mérite attention.',
      alertSensitivity: 'increased',
    },
    7: {
      label: 'Juillet',
      expectedBehavior: 'activité encore élevée mais hétérogène',
      interpretation: 'Des tensions peuvent apparaître selon les secteurs et territoires.',
      alertSensitivity: 'normal',
    },
    8: {
      label: 'Août',
      expectedBehavior: 'ralentissement partiellement normal',
      interpretation: 'Le ralentissement peut être saisonnier ; éviter de surinterpréter une baisse isolée.',
      alertSensitivity: 'reduced',
    },
    9: {
      label: 'Septembre',
      expectedBehavior: 'baisse souvent normale liée à la rentrée',
      interpretation: 'Une baisse est partiellement attendue ; surveiller surtout les territoires et secteurs encore sans solution.',
      alertSensitivity: 'reduced',
    },
    10: {
      label: 'Octobre',
      expectedBehavior: 'marché résiduel',
      interpretation: 'Les offres restantes peuvent être plus ciblées ; la lecture doit tenir compte du cycle de rentrée déjà passé.',
      alertSensitivity: 'normal',
    },
    11: {
      label: 'Novembre',
      expectedBehavior: 'ralentissement attendu',
      interpretation: 'Le marché peut être moins dynamique ; privilégier l’analyse des secteurs encore actifs.',
      alertSensitivity: 'reduced',
    },
    12: {
      label: 'Décembre',
      expectedBehavior: 'ralentissement attendu',
      interpretation: 'Le ralentissement de fin d’année est souvent normal ; éviter les alertes fortes sans signaux multiples.',
      alertSensitivity: 'reduced',
    },
  };

  return profiles[month] || profiles[1];
}

function classifyVolumeReliability(value) {
  const volume = Number(value || 0);

  if (volume < 5) {
    return 'low';
  }

  if (volume < 25) {
    return 'medium';
  }

  return 'high';
}

function buildDepartmentAiInput(department, currentDaily, previousDaily, currentStats) {
  const jobsToday = compactNumber(currentDaily?.jobsCount);
  const jobsPrevious = compactNumber(previousDaily?.jobsCount);
  const openingsToday = compactNumber(currentDaily?.openingCount);
  const openingsPrevious = compactNumber(previousDaily?.openingCount);

  const jobsDelta = jobsToday - jobsPrevious;
  const openingsDelta = openingsToday - openingsPrevious;

  return {
    code: department.code,
    name: department.name,
    currentPublishedLevel: department.level || 'Vert',
    currentPublicReason: department.reason || '',

    daily: {
      jobsCount: jobsToday,
      previousJobsCount: jobsPrevious,
      jobsAbsoluteChange: jobsDelta,
      jobsPercentChange: computePercentChange(jobsToday, jobsPrevious),
      jobsVolumeReliability: classifyVolumeReliability(Math.max(jobsToday, jobsPrevious)),

      openingCount: openingsToday,
      previousOpeningCount: openingsPrevious,
      openingsAbsoluteChange: openingsDelta,
      openingsPercentChange: computePercentChange(openingsToday, openingsPrevious),
      openingsVolumeReliability: classifyVolumeReliability(Math.max(openingsToday, openingsPrevious)),

      recruitersCount: compactNumber(currentDaily?.recruitersCount),
      expiringSoonCount: compactNumber(currentDaily?.expiringSoonCount),
      notSeenSinceYesterdayCount: compactNumber(currentDaily?.notSeenSinceYesterdayCount),
    },

    rolling30Days: {
      jobsCount: compactNumber(currentStats?.jobsCount),
      openingCount: compactNumber(currentStats?.openingCount),
      recruitersCount: compactNumber(currentStats?.recruitersCount),
      returnedActiveJobsCount: compactNumber(currentStats?.returnedActiveJobsCount),
      topRomeFamilies: Array.isArray(currentStats?.topRomeFamilies)
        ? currentStats.topRomeFamilies.slice(0, 5)
        : [],
      topNafLabels: Array.isArray(currentStats?.topNafLabels)
        ? currentStats.topNafLabels.slice(0, 5)
        : [],
      topOpcos: Array.isArray(currentStats?.topOpcos)
        ? currentStats.topOpcos.slice(0, 5)
        : [],
    },
  };
}


function getEasterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUtc(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function getFrenchPublicHolidays(year) {
  const easter = getEasterDate(year);

  return new Set([
    `${year}-01-01`,
    formatUtcDate(addDaysUtc(easter, 1)),
    `${year}-05-01`,
    `${year}-05-08`,
    formatUtcDate(addDaysUtc(easter, 39)),
    formatUtcDate(addDaysUtc(easter, 50)),
    `${year}-07-14`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-25`,
  ]);
}

function buildCalendarContext(dateString) {
  const date = new Date(`${dateString}T12:00:00+02:00`);
  const day = date.getDay();
  const year = date.getFullYear();

  const isWeekend = day === 0 || day === 6;
  const isFrenchPublicHoliday = getFrenchPublicHolidays(year).has(dateString);

  const dayLabels = {
    0: 'dimanche',
    1: 'lundi',
    2: 'mardi',
    3: 'mercredi',
    4: 'jeudi',
    5: 'vendredi',
    6: 'samedi',
  };

  const expectedPublishingActivity = isWeekend || isFrenchPublicHoliday
    ? 'low'
    : 'normal';

  return {
    date: dateString,
    dayOfWeek: dayLabels[day],
    isWeekend,
    isFrenchPublicHoliday,
    expectedPublishingActivity,
    interpretationRule: isWeekend || isFrenchPublicHoliday
      ? "Activité de publication normalement faible: ne pas dégrader un niveau uniquement sur l'absence ou la forte baisse d'offres créées ce jour-là. Privilégier les tendances 7 jours, 30 jours, les expirations et les signaux répétés."
      : "Jour ouvré: le flux quotidien peut être utilisé comme signal, en restant proportionné aux volumes, à la saisonnalité et à la concentration géographique.",
  };
}


async function loadAiInputData(targetDate) {
  const previousDate = getPreviousDateFromDateString(targetDate);

  const [
    departmentsSnapshot,
    statsSnapshot,
    currentDailySnapshot,
    previousDailySnapshot,
    previousReportSnapshot,
  ] = await Promise.all([
    db.collection('departments').get(),
    db.collection('departmentStats').get(),
    db.collection('departmentDailyStats').where('date', '==', targetDate).get(),
    db.collection('departmentDailyStats').where('date', '==', previousDate).get(),
    db.collection('aiReports').doc(previousDate).get(),
  ]);

  const departments = departmentsSnapshot.docs
    .map((document) => ({
      code: document.id,
      ...document.data(),
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const statsByCode = {};
  statsSnapshot.docs.forEach((document) => {
    statsByCode[document.id] = document.data();
  });

  const currentDailyByCode = {};
  currentDailySnapshot.docs.forEach((document) => {
    const data = document.data();
    currentDailyByCode[data.code || document.id.split('_')[1]] = data;
  });

  const previousDailyByCode = {};
  previousDailySnapshot.docs.forEach((document) => {
    const data = document.data();
    previousDailyByCode[data.code || document.id.split('_')[1]] = data;
  });

  const departmentsForAi = departments.map((department) =>
    buildDepartmentAiInput(
      department,
      currentDailyByCode[department.code],
      previousDailyByCode[department.code],
      statsByCode[department.code]
    )
  );

  const previousReport = previousReportSnapshot.exists
    ? previousReportSnapshot.data()
    : null;

  const nationalTotals = departmentsForAi.reduce(
    (accumulator, department) => {
      accumulator.dailyJobs += department.daily.jobsCount;
      accumulator.dailyOpenings += department.daily.openingCount;
      accumulator.previousDailyJobs += department.daily.previousJobsCount;
      accumulator.previousDailyOpenings += department.daily.previousOpeningCount;
      accumulator.rolling30Jobs += department.rolling30Days.jobsCount;
      accumulator.rolling30Openings += department.rolling30Days.openingCount;
      return accumulator;
    },
    {
      dailyJobs: 0,
      dailyOpenings: 0,
      previousDailyJobs: 0,
      previousDailyOpenings: 0,
      rolling30Jobs: 0,
      rolling30Openings: 0,
    }
  );

  return {
    targetDate,
    previousDate,
    seasonalContext: getSeasonalContext(targetDate),
    calendarContext: buildCalendarContext(targetDate),
    nationalTotals: {
      ...nationalTotals,
      dailyJobsAbsoluteChange: nationalTotals.dailyJobs - nationalTotals.previousDailyJobs,
      dailyJobsPercentChange: computePercentChange(
        nationalTotals.dailyJobs,
        nationalTotals.previousDailyJobs
      ),
      dailyOpeningsAbsoluteChange:
        nationalTotals.dailyOpenings - nationalTotals.previousDailyOpenings,
      dailyOpeningsPercentChange: computePercentChange(
        nationalTotals.dailyOpenings,
        nationalTotals.previousDailyOpenings
      ),
    },
    previousReportSummary: previousReport
      ? {
          date: previousReport.date,
          nationalSuggestedLevel:
            previousReport?.nationalAssessment?.suggestedLevel || null,
          nationalSummary:
            previousReport?.nationalAssessment?.summary || null,
          outlook7Days:
            previousReport?.nationalAssessment?.outlook7Days || null,
          outlook30Days:
            previousReport?.nationalAssessment?.outlook30Days || null,
        }
      : null,
    departments: departmentsForAi,
  };
}

const aiReportJsonSchema = {
  name: 'apprentifr_daily_ai_report',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'date',
      'nationalAssessment',
      'importantSignals',
      'allDepartments',
      'sectorAnalysis',
      'bulletinProposal',
      'methodLimits',
    ],
    properties: {
      date: { type: 'string' },
      nationalAssessment: {
        type: 'object',
        additionalProperties: false,
        required: [
          'suggestedLevel',
          'confidence',
          'summary',
          'outlook7Days',
          'outlook30Days',
          'seasonalInterpretation',
          'continuityWithPreviousReport',
        ],
        properties: {
          suggestedLevel: { enum: ['Vert', 'Jaune', 'Orange', 'Rouge'] },
          confidence: { enum: ['low', 'medium', 'high'] },
          summary: { type: 'string' },
          outlook7Days: { type: 'string' },
          outlook30Days: { type: 'string' },
          seasonalInterpretation: { type: 'string' },
          continuityWithPreviousReport: { type: 'string' },
        },
      },
      importantSignals: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'priority',
            'type',
            'title',
            'departmentCode',
            'departmentName',
            'explanation',
            'dataEvidence',
          ],
          properties: {
            priority: { enum: ['low', 'medium', 'high'] },
            type: {
              enum: [
                'degradation',
                'improvement',
                'stable',
                'sector_alert',
                'method_limit',
              ],
            },
            title: { type: 'string' },
            departmentCode: { type: 'string' },
            departmentName: { type: 'string' },
            explanation: { type: 'string' },
            dataEvidence: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
      allDepartments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'code',
            'name',
            'previousPublishedLevel',
            'suggestedLevel',
            'confidence',
            'changeType',
            'evolution',
            'shortReason',
            'dataEvidence',
            'aggravatingFactors',
            'reassuringFactors',
            'publicReason',
          ],
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
            previousPublishedLevel: {
              enum: ['Vert', 'Jaune', 'Orange', 'Rouge'],
            },
            suggestedLevel: {
              enum: ['Vert', 'Jaune', 'Orange', 'Rouge'],
            },
            confidence: { enum: ['low', 'medium', 'high'] },
            changeType: {
              enum: [
                'maintain',
                'improve',
                'degrade',
                'return_to_normal',
                'watch',
              ],
            },
            evolution: {
              enum: ['stable', 'improving', 'degrading', 'uncertain'],
            },
            shortReason: { type: 'string' },
            dataEvidence: {
              type: 'array',
              items: { type: 'string' },
            },
            aggravatingFactors: {
              type: 'array',
              items: { type: 'string' },
            },
            reassuringFactors: {
              type: 'array',
              items: { type: 'string' },
            },
            publicReason: { type: 'string' },
          },
        },
      },
      sectorAnalysis: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sector', 'trend', 'comment'],
          properties: {
            sector: { type: 'string' },
            trend: { enum: ['stable', 'up', 'down', 'mixed', 'unknown'] },
            comment: { type: 'string' },
          },
        },
      },
      bulletinProposal: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'level',
          'summary',
          'adviceCandidates',
          'adviceCfa',
        ],
        properties: {
          title: { type: 'string' },
          level: { enum: ['Vert', 'Jaune', 'Orange', 'Rouge'] },
          summary: { type: 'string' },
          adviceCandidates: { type: 'string' },
          adviceCfa: { type: 'string' },
        },
      },
      methodLimits: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
  strict: true,
};

function buildAiPrompt(inputData) {
  return `
Tu es l'analyste IA d'ApprentiFR, un observatoire du marché de l'apprentissage.

Objectif :
Produire un rapport admin complet, crédible, traçable et exploitable pour aider à publier un bulletin de vigilance.

Règles obligatoires :
- Analyse TOUS les départements fournis.
- Ne saute aucun département, même stable.
- Pour chaque pourcentage, cite aussi les volumes bruts.
- Ne justifie jamais une couleur uniquement par un pourcentage.
- Si les volumes sont faibles, signale que le pourcentage est peu fiable.
- Distingue situation immédiate, tendance J+7 et perspective J+30.
- Ne change pas fortement la perspective J+30 sur la base d'une seule journée.
- Compare avec le rapport précédent si présent.
- Explique les maintiens en vert.
- Donne une couleur suggérée pour chaque département.
- Ne propose pas Orange ou Rouge uniquement sur une variation d'une seule journée, même forte.
- Une proposition Orange doit être confirmée par au moins deux signaux complémentaires : baisse répétée, tendance 7 jours défavorable, faible volume 30 jours, expirations élevées, recruteurs en recul, secteur local fragile ou anomalie déjà observée récemment.
- Si une rupture forte est observée sur un seul jour sans confirmation, propose au maximum Jaune avec un statut de surveillance dans les textes.
- Si le département global est sous vigilance, ne considère pas automatiquement tous les secteurs comme tendus.
- Le niveau départemental est une lecture globale ; la situation par secteur peut être plus favorable ou plus défavorable.
- L'admin valide toujours : tu ne publies rien.
- Ton texte doit être clair, défendable et professionnel.
- Ne prétends pas que les données couvrent tout le marché : ce sont des données observées via API.
- Tiens compte du contexte calendrier.
- Si calendarContext.isWeekend ou calendarContext.isFrenchPublicHoliday est vrai, une baisse forte ou une absence de nouvelles offres sur la journée ne suffit pas à proposer une dégradation de vigilance.
- Les samedis, dimanches et jours fériés, baisse la confiance des signaux journaliers, privilégie les tendances 7 jours et 30 jours, les expirations, les volumes glissants et les signaux répétés.
- Mentionne explicitement la limite calendrier si elle influence l'analyse.
- La date analysée est ${inputData.targetDate}.

Contexte calendrier :
${JSON.stringify(inputData.calendarContext, null, 2)}

Contexte saisonnier :
${JSON.stringify(inputData.seasonalContext, null, 2)}

Totaux nationaux :
${JSON.stringify(inputData.nationalTotals, null, 2)}

Rapport précédent :
${JSON.stringify(inputData.previousReportSummary, null, 2)}

Données départementales :
${JSON.stringify(inputData.departments, null, 2)}
`;
}

exports.generateDailyAiReport = onSchedule(
  {
    schedule: '20 0 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [OPENAI_API_KEY],
  },
  async () => {
    const executionDate = parisDateString(new Date());
    const targetDate = getPreviousDateFromDateString(executionDate);

    console.log(`Génération rapport IA pour ${targetDate}`);

    const inputData = await loadAiInputData(targetDate);

    const client = new OpenAI({
      apiKey: OPENAI_API_KEY.value(),
    });

    const response = await client.responses.create({
      model: 'gpt-5.5',
      input: buildAiPrompt(inputData),
      text: {
        format: {
          type: 'json_schema',
          name: aiReportJsonSchema.name,
          schema: aiReportJsonSchema.schema,
          strict: true,
        },
      },
    });

    const report = JSON.parse(response.output_text);

    const allDepartmentsCount = Array.isArray(report.allDepartments)
      ? report.allDepartments.length
      : 0;

    if (allDepartmentsCount !== inputData.departments.length) {
      throw new Error(
        `Rapport IA incomplet : ${allDepartmentsCount} départements reçus sur ${inputData.departments.length}`
      );
    }

    await db.collection('aiReports').doc(targetDate).set(
      {
        ...report,
        date: targetDate,
        provider: 'openai',
        model: 'gpt-5.5',
        sourceInputSummary: {
          departmentsCount: inputData.departments.length,
          seasonalContext: inputData.seasonalContext,
          calendarContext: inputData.calendarContext,
          nationalTotals: inputData.nationalTotals,
          previousReportDate: inputData.previousDate,
        },
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await db.collection('apiImports').doc(`ai_${targetDate}`).set(
      {
        type: 'daily_ai_report',
        date: targetDate,
        provider: 'openai',
        model: 'gpt-5.5',
        departmentsCount: inputData.departments.length,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`Rapport IA ${targetDate} généré et sauvegardé.`);
  }
);
