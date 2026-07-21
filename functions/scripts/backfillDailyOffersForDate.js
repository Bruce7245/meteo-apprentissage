const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "meteo-apprentissage" });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const API_BASE_URL = "https://api.apprentissage.beta.gouv.fr/api/job/v1/search";
const TARGET_DATE = process.env.TARGET_DATE || "2026-06-22";
const TOKEN = process.env.API_APPRENTISSAGE_TOKEN || "";
const WRITE = process.env.WRITE === "1";

const ROME_FAMILIES = {
  A: "Agriculture, pêche, espaces naturels",
  B: "Arts et façonnage d’ouvrages",
  C: "Banque, assurance, immobilier",
  D: "Commerce, vente, grande distribution",
  E: "Communication, média, multimédia",
  F: "Construction, bâtiment, travaux publics",
  G: "Hôtellerie, restauration, tourisme, loisirs",
  H: "Industrie",
  I: "Installation et maintenance",
  J: "Santé",
  K: "Services à la personne et à la collectivité",
  L: "Spectacle",
  M: "Support à l’entreprise",
  N: "Transport et logistique",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parisDateString(date) {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dateWithOffset(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
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
    `${identifier.partner_label || "unknown"}:${identifier.partner_job_id || "unknown"}`
  );
}

function countOpening(jobs) {
  return jobs.reduce((total, job) => {
    return total + Number(job?.offer?.opening_count || 0);
  }, 0);
}

function increment(counter, key, amount = 1) {
  const cleanKey = key || "Inconnu";
  counter[cleanKey] = (counter[cleanKey] || 0) + amount;
}

function topFromCounter(counter, limit = 10) {
  return Object.entries(counter)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
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
    increment(statusCounter, job?.offer?.status || "Active");
    increment(partnerCounter, job?.identifier?.partner_label);

    const romes = Array.isArray(job?.offer?.rome_codes)
      ? job.offer.rome_codes
      : [];

    romes.forEach((rome) => {
      increment(romeCounter, rome);

      const familyKey = String(rome || "").charAt(0);
      const familyLabel = ROME_FAMILIES[familyKey] || "Famille métier inconnue";
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
      const familyKey = String(rome || "").charAt(0);
      const sectorLabel = ROME_FAMILIES[familyKey] || "Famille métier inconnue";
      const openingCount = Number(job?.offer?.opening_count || 0);

      if (!sectorMap[sectorLabel]) {
        sectorMap[sectorLabel] = {
          date,
          departmentCode: department.code,
          departmentName: department.name,
          sectorCode: familyKey || "unknown",
          sectorLabel,
          jobsCount: 0,
          openingCount: 0,
          romeCodes: {},
          source: "api-apprentissage-job-v1-search",
          updatedAt: FieldValue.serverTimestamp(),
        };
      }

      sectorMap[sectorLabel].jobsCount += 1;
      sectorMap[sectorLabel].openingCount += openingCount;
      sectorMap[sectorLabel].romeCodes[rome] =
        (sectorMap[sectorLabel].romeCodes[rome] || 0) + 1;
    });
  });

  return Object.values(sectorMap).map((sector) => {
    const topRomeCodes = Object.entries(sector.romeCodes)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
      .slice(0, 10);

    delete sector.romeCodes;

    let level = "Vert";
    let reason = "Le secteur présente un volume observé sans signal de tension particulier.";

    if (sector.jobsCount === 0) {
      level = "Jaune";
      reason = "Aucune nouvelle offre observée sur la période quotidienne. Signal à confirmer avant toute dégradation.";
    } else if (sector.jobsCount < 3) {
      level = "Jaune";
      reason = "Volume quotidien faible dans ce secteur. Une surveillance est recommandée.";
    }

    return {
      ...sector,
      topRomeCodes,
      level,
      suggestedLevel: level,
      publicLevel: level,
      publicReason: reason,
      confidence: sector.jobsCount >= 10 ? "high" : sector.jobsCount >= 3 ? "medium" : "low",
    };
  });
}

async function fetchDepartment(code) {
  const url = new URL(API_BASE_URL);
  url.searchParams.append("departements", code);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
  });

  const data = await response.json().catch(() => ({}));

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
  const snapshot = await db.collection("departments").get();

  return snapshot.docs
    .map((document) => ({
      code: document.id,
      ...document.data(),
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

async function getPreviousActiveIds(departmentCode) {
  const previousDate = dateWithOffset(TARGET_DATE, -1);
  const previousId = `${previousDate}_${departmentCode}`;
  const snapshot = await db.collection("departmentDailyStats").doc(previousId).get();

  if (!snapshot.exists) return [];

  const data = snapshot.data();
  return Array.isArray(data.activeOfferIds) ? data.activeOfferIds : [];
}

async function main() {
  if (!TOKEN) {
    throw new Error("API_APPRENTISSAGE_TOKEN manquant.");
  }

  const departments = await loadDepartments();

  if (departments.length === 0) {
    throw new Error("Aucun département trouvé dans Firestore. Recrée d’abord la collection departments.");
  }

  console.log("===== BACKFILL DAILY OFFERS =====");
  console.log("TARGET_DATE:", TARGET_DATE);
  console.log("WRITE:", WRITE);
  console.log("departments:", departments.length);

  let successCount = 0;
  let errorCount = 0;
  let totalCreatedJobs = 0;
  let totalOpenings = 0;
  let sectorWriteCount = 0;

  const expiringLimitDate = dateWithOffset(TARGET_DATE, 7);

  for (const department of departments) {
    try {
      const result = await fetchDepartment(department.code);

      const todayJobs = result.jobs.filter((job) => {
        return getJobCreationDate(job) === TARGET_DATE;
      });

      const expiringSoonJobs = result.jobs.filter((job) => {
        const expirationDate = getJobExpirationDate(job);

        return (
          expirationDate &&
          expirationDate >= TARGET_DATE &&
          expirationDate <= expiringLimitDate
        );
      });

      const activeOfferIds = result.jobs.map(getJobId).filter(Boolean);
      const previousActiveIds = await getPreviousActiveIds(department.code);
      const activeSet = new Set(activeOfferIds);

      const notSeenSinceYesterdayIds = previousActiveIds.filter(
        (id) => !activeSet.has(id)
      );

      const aggregation = aggregateJobs(todayJobs);
      const openingCount = countOpening(todayJobs);

      const dailyDocument = {
        date: TARGET_DATE,
        code: department.code,
        name: department.name || `Département ${department.code}`,

        period: "backfill_target_date",
        returnedActiveJobsCount: result.jobs.length,
        jobsCount: todayJobs.length,
        openingCount,
        recruitersCount: result.recruiters.length,
        warningsCount: result.warnings.length,
        expiringSoonCount: expiringSoonJobs.length,

        activeOfferIds,
        todayOfferIds: todayJobs.map(getJobId).filter(Boolean),
        notSeenSinceYesterdayCount: notSeenSinceYesterdayIds.length,
        notSeenSinceYesterdayIds,

        ...aggregation,

        source: "api-apprentissage-job-v1-search",
        limitedResults: true,
        backfilled: true,
        importedAt: FieldValue.serverTimestamp(),
      };

      const sectorStats = buildDepartmentSectorStats(todayJobs, department, TARGET_DATE);

      if (WRITE) {
        await db
          .collection("departmentDailyStats")
          .doc(`${TARGET_DATE}_${department.code}`)
          .set(dailyDocument, { merge: true });

        let batch = db.batch();
        let batchCount = 0;

        sectorStats.forEach((sector) => {
          const currentRef = db
            .collection("departmentSectorStats")
            .doc(`${department.code}_${sector.sectorCode}`);

          const dailyRef = db
            .collection("departmentSectorDailyStats")
            .doc(`${TARGET_DATE}_${department.code}_${sector.sectorCode}`);

          batch.set(currentRef, sector, { merge: true });
          batch.set(dailyRef, {
            ...sector,
            schemaVersion: "departmentSectorDailyStats.backfill.v1",
          }, { merge: true });

          batchCount += 2;
          sectorWriteCount += 1;
        });

        if (batchCount > 0) {
          await batch.commit();
        }
      }

      successCount += 1;
      totalCreatedJobs += todayJobs.length;
      totalOpenings += openingCount;

      console.log(
        `OK ${department.code}: créations=${todayJobs.length}, postes=${openingCount}, actifs=${result.jobs.length}, secteurs=${sectorStats.length}`
      );
    } catch (error) {
      errorCount += 1;
      console.error(`ERREUR ${department.code}:`, error.message);

      if (WRITE) {
        await db.collection("departmentDailyStats").doc(`${TARGET_DATE}_${department.code}`).set(
          {
            date: TARGET_DATE,
            code: department.code,
            name: department.name || `Département ${department.code}`,
            lastError: error.message,
            backfilled: true,
            importedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    await sleep(800);
  }

  if (WRITE) {
    await db.collection("apiImports").doc(`daily_${TARGET_DATE}`).set(
      {
        type: "daily_backfill_import",
        date: TARGET_DATE,
        departmentsCount: departments.length,
        successCount,
        errorCount,
        totalCreatedJobs,
        totalOpenings,
        sectorWriteCount,
        finishedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  console.log("===== FIN BACKFILL =====");
  console.log({
    targetDate: TARGET_DATE,
    successCount,
    errorCount,
    totalCreatedJobs,
    totalOpenings,
    sectorWriteCount,
    write: WRITE,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
