const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const OpenAI = require('openai');

admin.initializeApp();

const db = admin.firestore();
const API_APPRENTISSAGE_TOKEN = defineSecret('API_APPRENTISSAGE_TOKEN');
const INSEE_API_KEY = defineSecret('INSEE_API_KEY');
const BACKFILL_ADMIN_KEY = defineSecret('BACKFILL_ADMIN_KEY');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

const API_BASE_URL = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/search';
const API_OFFER_DETAIL_BASE_URL = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/offer';

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


const PUBLIC_VIGILANCE_LEVELS = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

const PUBLIC_VIGILANCE_LABELS = {
  0: 'green',
  1: 'yellow',
  2: 'orange',
  3: 'red',
};

function clampPublicVigilanceLevel(value) {
  return Math.max(0, Math.min(3, value));
}

function publicVigilanceLevelValue(level) {
  return PUBLIC_VIGILANCE_LEVELS[level] ?? 0;
}

function publicVigilanceLevelLabel(value) {
  return PUBLIC_VIGILANCE_LABELS[clampPublicVigilanceLevel(value)] || 'green';
}

function dateWithOffsetFromDateString(dateString, offsetDays) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function averagePublicRawLevel(history, days) {
  const slice = history.slice(0, days);

  if (slice.length === 0) return 0;

  const total = slice.reduce((sum, item) => {
    return sum + publicVigilanceLevelValue(item.rawLevel);
  }, 0);

  return total / slice.length;
}

function countRecentPublicRawLevel(history, level, days) {
  return history
    .slice(0, days)
    .filter((item) => item.rawLevel === level)
    .length;
}

function detectPublicVigilanceTrend(history) {
  const avg3 = averagePublicRawLevel(history, 3);
  const avg7 = averagePublicRawLevel(history, 7);
  const delta = avg3 - avg7;

  if (delta >= 0.5) return 'degrading';
  if (delta <= -0.5) return 'improving';

  return 'stable';
}

function stabilizePublicVigilance({
  rawLevelToday,
  previousPublishedLevel,
  history,
  confidenceScore,
}) {
  const raw = publicVigilanceLevelValue(rawLevelToday);
  const previous = publicVigilanceLevelValue(previousPublishedLevel);
  const trend = detectPublicVigilanceTrend(history);

  const reasons = [];
  const blockers = [];

  const redCount3d = countRecentPublicRawLevel(history, 'red', 3);
  const orangeOrRedCount3d = history
    .slice(0, 3)
    .filter((item) => ['orange', 'red'].includes(item.rawLevel))
    .length;

  const greenCount3d = countRecentPublicRawLevel(history, 'green', 3);
  const yellowOrGreenCount3d = history
    .slice(0, 3)
    .filter((item) => ['green', 'yellow'].includes(item.rawLevel))
    .length;

  let published = previous;

  if (confidenceScore < 40) {
    published = Math.max(previous, 1);
    reasons.push('Confiance faible : impossible de publier un retour au vert.');
  } else if (raw > previous) {
    const maxRise = raw === PUBLIC_VIGILANCE_LEVELS.red ? 2 : 1;
    published = Math.min(raw, previous + maxRise);
    reasons.push('Dégradation détectée : montée rapide autorisée.');
  } else if (raw === previous) {
    published = previous;
    reasons.push('Signal brut stable : maintien du niveau publié.');
  } else {
    const improvementConfirmed =
      greenCount3d >= 2 ||
      yellowOrGreenCount3d >= 3 ||
      trend === 'improving';

    if (!improvementConfirmed) {
      published = previous;
      blockers.push('Amélioration trop récente : maintien du niveau par prudence.');
    } else {
      published = Math.max(raw, previous - 1);
      reasons.push('Amélioration confirmée : désescalade progressive limitée à un niveau.');
    }
  }

  if (previous >= PUBLIC_VIGILANCE_LEVELS.orange && raw <= PUBLIC_VIGILANCE_LEVELS.green && greenCount3d < 2) {
    published = Math.max(published, previous - 1);
    blockers.push('Retour au vert interdit après un niveau élevé sans confirmation sur plusieurs jours.');
  }

  if (redCount3d >= 2) {
    published = Math.max(published, PUBLIC_VIGILANCE_LEVELS.red);
    reasons.push('Rouge observé plusieurs fois récemment : maintien ou passage en rouge.');
  } else if (orangeOrRedCount3d >= 2) {
    published = Math.max(published, PUBLIC_VIGILANCE_LEVELS.orange);
    reasons.push('Signaux orange/rouge répétés : maintien au moins orange.');
  }

  return {
    publishedLevel: publicVigilanceLevelLabel(published),
    trend,
    reasons,
    blockers,
  };
}

function rawPublicVigilanceFromDailyStats(data) {
  const returnedActiveJobsCount = Number(data.returnedActiveJobsCount || 0);
  const notSeenSinceYesterdayCount = Number(data.notSeenSinceYesterdayCount || 0);
  const expiringSoonCount = Number(data.expiringSoonCount || 0);
  const warningsCount = Number(data.warningsCount || 0);

  const statusDetailSummary = data.statusDetailSummary || null;
  const activeStatusSample = statusDetailSummary?.activeSample || null;
  const todayStatusSummary = statusDetailSummary?.today || null;
  const notSeenStatusSummary = statusDetailSummary?.notSeenSinceYesterday || null;

  let score = 0;
  const reasons = [];

  if (returnedActiveJobsCount <= 10) {
    score += 45;
    reasons.push('Volume d’offres actives très faible.');
  } else if (returnedActiveJobsCount <= 30) {
    score += 32;
    reasons.push('Volume d’offres actives faible.');
  } else if (returnedActiveJobsCount <= 75) {
    score += 20;
    reasons.push('Volume d’offres actives limité.');
  } else if (returnedActiveJobsCount <= 150) {
    score += 10;
    reasons.push('Volume d’offres actives modéré.');
  }

  const notSeenRatio = returnedActiveJobsCount > 0
    ? notSeenSinceYesterdayCount / returnedActiveJobsCount
    : 0;

  if (notSeenSinceYesterdayCount >= 20 || notSeenRatio >= 0.15) {
    score += 25;
    reasons.push('Forte disparition d’offres depuis la veille.');
  } else if (notSeenSinceYesterdayCount >= 10 || notSeenRatio >= 0.08) {
    score += 15;
    reasons.push('Disparition notable d’offres depuis la veille.');
  } else if (notSeenSinceYesterdayCount >= 5) {
    score += 8;
    reasons.push('Disparition légère d’offres depuis la veille.');
  }

  const expiringRatio = returnedActiveJobsCount > 0
    ? expiringSoonCount / returnedActiveJobsCount
    : 0;

  if (expiringSoonCount >= 30 || expiringRatio >= 0.12) {
    score += 18;
    reasons.push('Part élevée d’offres expirant bientôt.');
  } else if (expiringSoonCount >= 10 || expiringRatio >= 0.06) {
    score += 10;
    reasons.push('Offres expirant bientôt à surveiller.');
  }

  if (warningsCount > 0) {
    score += Math.min(10, warningsCount);
    reasons.push('Présence de warnings dans les offres.');
  }

  if (activeStatusSample?.total > 0) {
    const cancelledShare = Number(activeStatusSample.cancelledShare || 0);
    const expiredShare = Number(activeStatusSample.expiredShare || 0);
    const closedShare = Number(activeStatusSample.closedShare || 0);
    const inactiveShare = Number(activeStatusSample.inactiveShare || 0);
    const unreachableShare = Number(activeStatusSample.unreachableShare || 0);
    const weightedDemand = Number(activeStatusSample.weightedDemand || 0);
    const total = Number(activeStatusSample.total || 0);
    const weightedDemandRatio = total > 0 ? weightedDemand / total : 1;

    if (cancelledShare >= 0.2) {
      score += 18;
      reasons.push('Part importante d’offres annulées dans l’échantillon enrichi.');
    } else if (cancelledShare >= 0.1) {
      score += 10;
      reasons.push('Part notable d’offres annulées dans l’échantillon enrichi.');
    }

    if (expiredShare + closedShare + inactiveShare >= 0.25) {
      score += 12;
      reasons.push('Plusieurs offres enrichies ne sont plus pleinement actives.');
    } else if (expiredShare + closedShare + inactiveShare >= 0.12) {
      score += 6;
      reasons.push('Certaines offres enrichies ne sont plus pleinement actives.');
    }

    if (weightedDemandRatio < 0.65) {
      score += 15;
      reasons.push('La demande pondérée par statut est faible.');
    } else if (weightedDemandRatio < 0.8) {
      score += 8;
      reasons.push('La demande pondérée par statut est à surveiller.');
    }

    if (unreachableShare >= 0.25) {
      reasons.push('Une part importante des détails d’offres est inaccessible.');
    }
  }

  if (notSeenStatusSummary?.total > 0) {
    const notSeenCancelled = Number(notSeenStatusSummary.statusBreakdown?.Cancelled || 0);
    const notSeenExpired = Number(notSeenStatusSummary.statusBreakdown?.Expired || 0);
    const notSeenClosed = Number(notSeenStatusSummary.statusBreakdown?.Closed || 0);
    const notSeenInactive = Number(notSeenStatusSummary.statusBreakdown?.Inactive || 0);
    const notSeenTotal = Number(notSeenStatusSummary.total || 0);
    const notSeenInactiveLikeShare = notSeenTotal > 0
      ? (notSeenCancelled + notSeenExpired + notSeenClosed + notSeenInactive) / notSeenTotal
      : 0;

    if (notSeenInactiveLikeShare >= 0.6 && notSeenTotal >= 5) {
      score += 10;
      reasons.push('Les offres disparues sont majoritairement annulées, expirées, closes ou inactives.');
    }
  }

  if (todayStatusSummary?.total > 0) {
    const todayActiveShare = Number(todayStatusSummary.activeShare || 0);

    if (todayActiveShare < 0.7 && todayStatusSummary.total >= 5) {
      score += 8;
      reasons.push('Les nouvelles offres enrichies ne sont pas toutes actives.');
    }
  }

  const apiMayBeCapped = returnedActiveJobsCount >= 445;

  let confidenceScore = 80;

  if (apiMayBeCapped) confidenceScore -= 25;
  if (returnedActiveJobsCount === 0) confidenceScore -= 25;

  if (activeStatusSample?.total > 0) {
    const unreachableShare = Number(activeStatusSample.unreachableShare || 0);
    const coverage = statusDetailSummary?.coverage || {};
    const activeSampleIds = Number(coverage.activeSampleIds || 0);
    const activeSampleDetails = Number(coverage.activeSampleDetails || 0);

    if (unreachableShare >= 0.25) confidenceScore -= 15;
    if (activeSampleIds > 0 && activeSampleDetails / activeSampleIds < 0.7) confidenceScore -= 10;
  }

  confidenceScore = Math.max(0, Math.min(100, confidenceScore));

  let rawLevel = 'green';

  if (score >= 70) rawLevel = 'red';
  else if (score >= 45) rawLevel = 'orange';
  else if (score >= 20) rawLevel = 'yellow';

  return {
    rawScore: score,
    rawLevel,
    confidenceScore,
    apiMayBeCapped,
    reasons,
    metrics: {
      returnedActiveJobsCount,
      notSeenSinceYesterdayCount,
      expiringSoonCount,
      warningsCount,
      notSeenRatio,
      expiringRatio,
    },
  };
}

function normalizePublicVigilanceLevelLabel(level) {
  if (level === 'yellow') return 'jaune';
  if (level === 'orange') return 'orange';
  if (level === 'red') return 'rouge';
  if (level === 'green') return 'verte';
  return level;
}

function normalizePublicVigilanceTrendLabel(trend) {
  if (trend === 'stable') return 'stable';
  if (trend === 'improving') return 'en amélioration';
  if (trend === 'degrading') return 'en dégradation';
  return trend || 'stable';
}

function publicReasonFromTechnicalReason(reason) {
  if (reason.includes('Volume d’offres actives faible')) {
    return 'Le volume d’offres disponibles est faible.';
  }

  if (reason.includes('Volume d’offres actives limité')) {
    return 'Le volume d’offres disponibles reste limité.';
  }

  if (reason.includes('Volume d’offres actives modéré')) {
    return 'Le volume d’offres disponibles est modéré.';
  }

  if (reason.includes('Disparition notable')) {
    return 'Plusieurs offres ont disparu du flux récent.';
  }

  if (reason.includes('Disparition légère')) {
    return 'Quelques offres ont disparu du flux récent.';
  }

  if (reason.includes('Forte disparition')) {
    return 'Une forte baisse du nombre d’offres observées est détectée.';
  }

  if (reason.includes('Offres expirant bientôt')) {
    return 'Certaines offres arrivent bientôt à expiration.';
  }

  if (reason.includes('Part élevée d’offres expirant bientôt')) {
    return 'Une part importante des offres arrive bientôt à expiration.';
  }

  return reason;
}

function buildPublicVigilanceAdvice(level) {
  if (level === 'yellow') {
    return 'Il est conseillé d’élargir légèrement la recherche, de candidater rapidement aux offres récentes et de surveiller les départements voisins.';
  }

  if (level === 'orange') {
    return 'Il est conseillé d’élargir la recherche à plusieurs secteurs ou départements proches et de ne pas attendre pour candidater.';
  }

  if (level === 'red') {
    return 'La recherche peut être difficile dans ce périmètre. Il est conseillé d’élargir fortement la zone, de mobiliser un CFA ou un accompagnement, et de suivre les nouvelles offres chaque jour.';
  }

  return 'Aucune vigilance particulière publiée.';
}

function buildPublicVigilanceSummary(doc, publicReasons) {
  const levelFr = normalizePublicVigilanceLevelLabel(doc.publishedLevel);
  const trendFr = normalizePublicVigilanceTrendLabel(doc.trend);

  if (publicReasons.length === 0) {
    return `Vigilance ${levelFr} apprentissage. La situation est ${trendFr}.`;
  }

  return `Vigilance ${levelFr} apprentissage, tendance ${trendFr}. ${publicReasons.join(' ')}`;
}


function averageNumbers(values) {
  const cleanValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (cleanValues.length === 0) {
    return 0;
  }

  return cleanValues.reduce((total, value) => total + value, 0) / cleanValues.length;
}

function roundPublicMetric(value, digits = 4) {
  if (!Number.isFinite(Number(value))) {
    return 0;
  }

  return Number(Number(value).toFixed(digits));
}

function getDailyCreatedOffersCount(data) {
  return Number(
    data?.jobsCount ||
      data?.returnedActiveJobsCount ||
      data?.metrics?.returnedActiveJobsCount ||
      0
  );
}

function getForecastStatusSignals(data) {
  const statusDetailSummary = data?.statusDetailSummary || {};
  const activeSample = statusDetailSummary.activeSample || {};
  const enriched = data?.enrichedDetailSummary || {};
  const statusBreakdown = enriched.statusBreakdown || {};

  const activeTotal = Number(activeSample.total || enriched.totalDetails || 0);

  const cancelledShare =
    activeSample.cancelledShare !== undefined
      ? Number(activeSample.cancelledShare || 0)
      : activeTotal > 0
        ? Number(statusBreakdown.Cancelled || 0) / activeTotal
        : 0;

  const expiredShare =
    activeSample.expiredShare !== undefined
      ? Number(activeSample.expiredShare || 0)
      : activeTotal > 0
        ? Number(statusBreakdown.Expired || 0) / activeTotal
        : 0;

  const closedShare =
    activeSample.closedShare !== undefined
      ? Number(activeSample.closedShare || 0)
      : activeTotal > 0
        ? Number(statusBreakdown.Closed || 0) / activeTotal
        : 0;

  const inactiveShare =
    activeSample.inactiveShare !== undefined
      ? Number(activeSample.inactiveShare || 0)
      : activeTotal > 0
        ? Number(statusBreakdown.Inactive || 0) / activeTotal
        : 0;

  const unreachableShare =
    activeSample.unreachableShare !== undefined
      ? Number(activeSample.unreachableShare || 0)
      : activeTotal > 0
        ? Number(enriched.unreachableDetailsCount || 0) / activeTotal
        : 0;

  const detailCoverageQuality =
    enriched.detailCoverageQuality !== undefined && enriched.detailCoverageQuality !== null
      ? Number(enriched.detailCoverageQuality || 0)
      : statusDetailSummary.coverage?.activeSampleIds > 0
        ? Number(statusDetailSummary.coverage.activeSampleDetails || 0) /
          Math.max(Number(statusDetailSummary.coverage.activeSampleIds || 0), 1)
        : null;

  return {
    activeTotal,
    cancelledShare,
    expiredShare,
    closedShare,
    inactiveShare,
    unreachableShare,
    inactiveLikeShare: cancelledShare + expiredShare + closedShare + inactiveShare,
    detailCoverageQuality,
  };
}

function shiftPublicVigilanceLevel(level, delta) {
  const levels = ['green', 'yellow', 'orange', 'red'];
  const currentIndex = Math.max(0, levels.indexOf(level));
  const nextIndex = Math.max(0, Math.min(levels.length - 1, currentIndex + delta));

  return levels[nextIndex];
}

function buildForecastPublicSentence({
  direction,
  createdJobsDeltaVs7Days,
  expiringSoonRatio,
  inactiveLikeShare,
  confidence,
}) {
  if (confidence === 'low') {
    return 'La projection à trois jours reste prudente : la couverture des détails est insuffisante pour confirmer une évolution fiable.';
  }

  if (direction === 'worsening') {
    if (createdJobsDeltaVs7Days < -0.15 && expiringSoonRatio >= 0.15) {
      return 'Les créations d’offres passent sous leur moyenne récente tandis que les échéances proches pèsent sur le stock. La situation pourrait rester tendue ou se renforcer dans les trois prochains jours.';
    }

    if (inactiveLikeShare >= 0.2) {
      return 'Une part notable des offres enrichies n’est plus pleinement active. La vigilance pourrait rester élevée dans les trois prochains jours.';
    }

    return 'Les signaux récents indiquent un risque de tension accrue dans les trois prochains jours.';
  }

  if (direction === 'improving') {
    return 'Les créations d’offres se situent au-dessus de leur moyenne récente et les signaux de fragilité restent contenus. Une amélioration est possible dans les trois prochains jours.';
  }

  return 'Les indicateurs récents ne montrent pas de bascule nette. La vigilance devrait rester globalement stable dans les trois prochains jours.';
}

function buildPublicForecast3Days({
  date,
  dailyData,
  historyItems,
  publishedLevel,
}) {
  const rows = historyItems
    .map((item) => item.dailyData || item.data || null)
    .filter(Boolean)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .slice(-7);

  const currentData =
    rows.find((item) => item.date === date) ||
    dailyData ||
    rows[rows.length - 1] ||
    {};

  const createdValues = rows.map(getDailyCreatedOffersCount);
  const createdJobsLatest = getDailyCreatedOffersCount(currentData);
  const createdJobsAverage7Days = averageNumbers(createdValues);
  const createdJobsAverage3Days = averageNumbers(createdValues.slice(-3));
  const createdJobsDeltaVs7Days =
    createdJobsAverage7Days > 0
      ? (createdJobsLatest - createdJobsAverage7Days) / createdJobsAverage7Days
      : 0;
  const createdJobsAverage3DeltaVs7Days =
    createdJobsAverage7Days > 0
      ? (createdJobsAverage3Days - createdJobsAverage7Days) / createdJobsAverage7Days
      : 0;

  const activeOffers = Number(currentData.returnedActiveJobsCount || createdJobsLatest || 0);
  const expiringSoonLatest = Number(currentData.expiringSoonCount || 0);
  const expiringSoonRatio = activeOffers > 0 ? expiringSoonLatest / activeOffers : 0;

  const notSeenValues = rows.map((item) => Number(item.notSeenSinceYesterdayCount || 0));
  const notSeenLatest = Number(currentData.notSeenSinceYesterdayCount || 0);
  const notSeenAverage7Days = averageNumbers(notSeenValues);
  const notSeenDeltaVs7Days =
    notSeenAverage7Days > 0
      ? (notSeenLatest - notSeenAverage7Days) / notSeenAverage7Days
      : 0;

  const statusSignals = getForecastStatusSignals(currentData);

  let negativeSignals = 0;
  let positiveSignals = 0;

  if (createdJobsDeltaVs7Days <= -0.35 || createdJobsAverage3DeltaVs7Days <= -0.35) {
    negativeSignals += 2;
  } else if (createdJobsDeltaVs7Days <= -0.15 || createdJobsAverage3DeltaVs7Days <= -0.15) {
    negativeSignals += 1;
  } else if (createdJobsDeltaVs7Days >= 0.15 && createdJobsAverage3DeltaVs7Days >= 0.05) {
    positiveSignals += 1;
  }

  if (expiringSoonRatio >= 0.25) {
    negativeSignals += 2;
  } else if (expiringSoonRatio >= 0.15) {
    negativeSignals += 1;
  }

  if (notSeenDeltaVs7Days >= 0.35 || (activeOffers > 0 && notSeenLatest / activeOffers >= 0.15)) {
    negativeSignals += 1;
  }

  if (statusSignals.inactiveLikeShare >= 0.25) {
    negativeSignals += 2;
  } else if (statusSignals.inactiveLikeShare >= 0.12) {
    negativeSignals += 1;
  }

  if (statusSignals.cancelledShare >= 0.1) {
    negativeSignals += 1;
  }

  const hasLowCoverage =
    rows.length < 3 ||
    (
      statusSignals.detailCoverageQuality !== null &&
      statusSignals.detailCoverageQuality < 0.45
    );

  const confidence = hasLowCoverage
    ? 'low'
    : statusSignals.detailCoverageQuality !== null && statusSignals.detailCoverageQuality < 0.75
      ? 'medium'
      : rows.length < 5
        ? 'medium'
        : 'high';

  let direction = 'stable';

  if (confidence === 'low' && rows.length < 3) {
    direction = 'uncertain';
  } else if (negativeSignals - positiveSignals >= 2) {
    direction = 'worsening';
  } else if (
    positiveSignals > negativeSignals &&
    expiringSoonRatio < 0.15 &&
    statusSignals.inactiveLikeShare < 0.12
  ) {
    direction = 'improving';
  }

  const projectedLevel =
    direction === 'worsening'
      ? shiftPublicVigilanceLevel(publishedLevel, 1)
      : direction === 'improving'
        ? shiftPublicVigilanceLevel(publishedLevel, -1)
        : publishedLevel;

  const labelByDirection = {
    worsening: 'Risque de tension accrue',
    improving: 'Amélioration possible',
    stable: 'Situation probablement stable',
    uncertain: 'Projection prudente',
  };

  const timeline = Array.from({ length: 7 }, (_, index) => {
    const dayOffset = index + 1;
    let level = publishedLevel;

    if (direction === 'worsening' && dayOffset >= 3) {
      level = projectedLevel;
    } else if (direction === 'improving' && dayOffset >= 3) {
      level = projectedLevel;
    } else if (direction === 'uncertain') {
      level = publishedLevel;
    }

    return {
      dayOffset,
      level,
      signal:
        dayOffset < 3
          ? 'short_term'
          : direction,
    };
  });

  return {
    horizonDays: 3,
    direction,
    label: labelByDirection[direction] || labelByDirection.stable,
    currentPublishedLevel: publishedLevel,
    projectedLevel,
    confidence,
    createdJobsLatest: roundPublicMetric(createdJobsLatest, 2),
    createdJobsAverage7Days: roundPublicMetric(createdJobsAverage7Days, 2),
    createdJobsAverage3Days: roundPublicMetric(createdJobsAverage3Days, 2),
    createdJobsDeltaVs7Days: roundPublicMetric(createdJobsDeltaVs7Days, 4),
    expiringSoonLatest: roundPublicMetric(expiringSoonLatest, 2),
    expiringSoonRatio: roundPublicMetric(expiringSoonRatio, 4),
    notSeenLatest: roundPublicMetric(notSeenLatest, 2),
    notSeenAverage7Days: roundPublicMetric(notSeenAverage7Days, 2),
    notSeenDeltaVs7Days: roundPublicMetric(notSeenDeltaVs7Days, 4),
    inactiveLikeShare: roundPublicMetric(statusSignals.inactiveLikeShare, 4),
    cancelledShare: roundPublicMetric(statusSignals.cancelledShare, 4),
    detailCoverageQuality:
      statusSignals.detailCoverageQuality === null
        ? null
        : roundPublicMetric(statusSignals.detailCoverageQuality, 4),
    timeline,
    publicSentence: buildForecastPublicSentence({
      direction,
      createdJobsDeltaVs7Days,
      expiringSoonRatio,
      inactiveLikeShare: statusSignals.inactiveLikeShare,
      confidence,
    }),
    schemaVersion: 'forecast3Days.v1',
  };
}


function buildPublicVigilanceDocument({
  date,
  dailyData,
  raw,
  previousRawLevel,
  stabilized,
  forecast3Days,
}) {
  const publicReasons = raw.reasons.map(publicReasonFromTechnicalReason);
  const departmentCode = dailyData.code || dailyData.departmentCode;
  const departmentName = dailyData.name || dailyData.departmentName || `Département ${departmentCode}`;

  const doc = {
    date,
    departmentCode,
    departmentName,

    rawLevel: raw.rawLevel,
    rawScore: raw.rawScore,
    previousRawLevel,
    publishedLevel: stabilized.publishedLevel,
    trend: stabilized.trend,
    confidenceScore: raw.confidenceScore,

    isPublished: stabilized.publishedLevel !== 'green',
    audience: 'candidate',

    metrics: {
      activeOffers: raw.metrics.returnedActiveJobsCount,
      notSeenSinceYesterday: raw.metrics.notSeenSinceYesterdayCount,
      notSeenRatio: Number(raw.metrics.notSeenRatio.toFixed(4)),
      expiringSoon: raw.metrics.expiringSoonCount,
      expiringRatio: Number(raw.metrics.expiringRatio.toFixed(4)),
      apiMayBeCapped: raw.apiMayBeCapped,
      statusDetailSummary: dailyData.statusDetailSummary || null,
      enrichedDetailSummary: dailyData.enrichedDetailSummary || null,
    },

    forecast3Days: forecast3Days || null,

    reasons: publicReasons,
    technicalReasons: raw.reasons,
    stabilizationReasons: stabilized.reasons,
    stabilizationBlockers: stabilized.blockers,

    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'departmentDailyStats',
    schemaVersion: 'departmentVigilanceDaily.v2',
  };

  doc.publicTitle = `Vigilance ${normalizePublicVigilanceLevelLabel(doc.publishedLevel)} apprentissage - ${doc.departmentName}`;
  doc.publicSummary = buildPublicVigilanceSummary(doc, publicReasons);
  doc.publicAdvice = buildPublicVigilanceAdvice(doc.publishedLevel);

  return doc;
}

async function publishDepartmentVigilanceDaily(date) {
  const dates = Array.from({ length: 7 }, (_, index) =>
    dateWithOffsetFromDateString(date, -index)
  );

  const [
    currentDailySnapshot,
    previousPublishedSnapshot,
    ...dailyHistorySnapshots
  ] = await Promise.all([
    db.collection('departmentDailyStats').where('date', '==', date).get(),
    db.collection('departmentVigilanceDaily').where('date', '==', dateWithOffsetFromDateString(date, -1)).get(),
    ...dates.map((itemDate) =>
      db.collection('departmentDailyStats').where('date', '==', itemDate).get()
    ),
  ]);

  const rawHistoryByCode = {};

  dailyHistorySnapshots.forEach((snapshot) => {
    snapshot.docs.forEach((document) => {
      const data = document.data();

      if (data.lastError) return;

      const code = data.code || data.departmentCode || String(document.id || '').split('_').pop();

      if (!rawHistoryByCode[code]) {
        rawHistoryByCode[code] = [];
      }

      rawHistoryByCode[code].push({
        date: data.date || String(document.id || '').split('_')[0],
        raw: rawPublicVigilanceFromDailyStats(data),
        dailyData: data,
      });
    });
  });

  Object.values(rawHistoryByCode).forEach((items) => {
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  });

  const previousPublishedByCode = {};

  previousPublishedSnapshot.docs.forEach((document) => {
    const data = document.data();
    const code = data.departmentCode || String(document.id || '').split('_').pop();

    previousPublishedByCode[code] = data;
  });

  const publishableDocs = [];

  currentDailySnapshot.docs.forEach((document) => {
    const dailyData = document.data();

    if (dailyData.lastError) return;

    const code = dailyData.code || dailyData.departmentCode || String(document.id || '').split('_').pop();
    const historyItems = rawHistoryByCode[code] || [];
    const currentHistory = historyItems.find((item) => item.date === date);
    const previousHistory = historyItems.find((item) => item.date !== date);

    const raw = currentHistory?.raw || rawPublicVigilanceFromDailyStats(dailyData);
    const previousRawLevel = previousHistory?.raw?.rawLevel || raw.rawLevel;
    const previousPublishedLevel =
      previousPublishedByCode[code]?.publishedLevel ||
      previousRawLevel ||
      'green';

    const history = historyItems.map((item) => ({
      date: item.date,
      rawLevel: item.raw.rawLevel,
      rawScore: item.raw.rawScore,
    }));

    const stabilized = stabilizePublicVigilance({
      rawLevelToday: raw.rawLevel,
      previousPublishedLevel,
      history,
      confidenceScore: raw.confidenceScore,
    });

    if (stabilized.publishedLevel === 'green') {
      return;
    }

    const forecast3Days = buildPublicForecast3Days({
      date,
      dailyData,
      historyItems,
      publishedLevel: stabilized.publishedLevel,
    });

    publishableDocs.push(
      buildPublicVigilanceDocument({
        date,
        dailyData,
        raw,
        previousRawLevel,
        stabilized,
        forecast3Days,
      })
    );
  });

  const existingSnapshot = await db
    .collection('departmentVigilanceDaily')
    .where('date', '==', date)
    .get();

  const publishableIds = new Set(
    publishableDocs.map((doc) => `${doc.date}_${doc.departmentCode}`)
  );

  const batch = db.batch();

  publishableDocs.forEach((doc) => {
    const id = `${doc.date}_${doc.departmentCode}`;
    batch.set(db.collection('departmentVigilanceDaily').doc(id), doc, { merge: true });
  });

  let deletedCount = 0;

  existingSnapshot.docs.forEach((document) => {
    if (!publishableIds.has(document.id)) {
      batch.delete(document.ref);
      deletedCount += 1;
    }
  });

  if (publishableDocs.length > 0 || deletedCount > 0) {
    await batch.commit();
  }

  await db.collection('apiImports').doc(`vigilance_${date}`).set(
    {
      type: 'daily_public_vigilance_publication',
      date,
      sourceCollection: 'departmentDailyStats',
      targetCollection: 'departmentVigilanceDaily',
      publishedCount: publishableDocs.length,
      deletedStaleCount: deletedCount,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 'daily_public_vigilance_publication.v1',
    },
    { merge: true }
  );

  console.log(
    `Vigilance publique ${date}: ${publishableDocs.length} document(s), ${deletedCount} ancien(s) supprimé(s).`
  );

  return publishableDocs;
}

async function publishVigilancePublicIndexLatest(date) {
  const snapshot = await db
    .collection('departmentVigilanceDaily')
    .where('date', '==', date)
    .get();

  const docs = snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));

  const levels = {
    yellow: 0,
    orange: 0,
    red: 0,
  };

  docs.forEach((doc) => {
    if (Object.prototype.hasOwnProperty.call(levels, doc.publishedLevel)) {
      levels[doc.publishedLevel] += 1;
    }
  });

  const departments = docs
    .map((doc) => ({
      departmentCode: doc.departmentCode,
      departmentName: doc.departmentName,
      publishedLevel: doc.publishedLevel,
      rawScore: doc.rawScore,
      confidenceScore: doc.confidenceScore,
      publicTitle: doc.publicTitle,
    }))
    .sort((a, b) => {
      const levelOrder = { red: 3, orange: 2, yellow: 1, green: 0 };

      return (levelOrder[b.publishedLevel] || 0) - (levelOrder[a.publishedLevel] || 0)
        || Number(b.rawScore || 0) - Number(a.rawScore || 0)
        || String(a.departmentCode).localeCompare(String(b.departmentCode));
    });

  const indexDoc = {
    latestDate: date,
    sourceCollection: 'departmentVigilanceDaily',
    publishedCount: docs.length,
    levels,
    departments,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'vigilancePublicIndex.latest.v1',
  };

  await db.collection('vigilancePublicIndex').doc('latest').set(indexDoc, { merge: true });

  console.log(`Index vigilance latest mis à jour pour ${date}: ${docs.length} document(s).`);

  return indexDoc;
}


exports.importDailyOffers = onSchedule(
  {
    schedule: '59 23 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [API_APPRENTISSAGE_TOKEN, BACKFILL_ADMIN_KEY],
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

      const offerObservations = result.jobs
        .map((job) => normalizeJobOfferObservation(job, department, targetDate))
        .filter((item) => item.offerId);
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

    await publishDepartmentVigilanceDaily(today);
    await publishVigilancePublicIndexLatest(today);

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




const OFFER_STATUS_COEFFICIENTS = {
  Active: 1,
  Expired: 0.45,
  Closed: 0.3,
  Inactive: 0.35,
  Cancelled: 0.1,
  Unknown: 0.25,
  Unreachable: 0.15,
};

const JOB_DETAIL_MAX_FETCHES_PER_RUN = 350;
const JOB_DETAIL_REFRESH_HOURS = 36;

function normalizeOfferStatus(status) {
  const cleanStatus = String(status || '').trim();

  if (!cleanStatus) return 'Unknown';

  const knownStatuses = ['Active', 'Expired', 'Closed', 'Inactive', 'Cancelled'];

  return knownStatuses.includes(cleanStatus) ? cleanStatus : 'Unknown';
}

function getOfferStatusCoefficient(status) {
  return OFFER_STATUS_COEFFICIENTS[normalizeOfferStatus(status)] ?? OFFER_STATUS_COEFFICIENTS.Unknown;
}

function incrementStatusCounter(counter, status, amount = 1) {
  const cleanStatus = normalizeOfferStatus(status);
  counter[cleanStatus] = (counter[cleanStatus] || 0) + amount;
}

function computeStatusSummaryFromDetails(details) {
  const statusBreakdown = {};
  let weightedDemand = 0;
  let reachableCount = 0;
  let unreachableCount = 0;

  details.forEach((detail) => {
    const status = detail?.detailFetchStatus === 'ok'
      ? normalizeOfferStatus(detail.offerStatus)
      : 'Unreachable';

    incrementStatusCounter(statusBreakdown, status);

    if (status === 'Unreachable') {
      unreachableCount += 1;
    } else {
      reachableCount += 1;
    }

    weightedDemand += getOfferStatusCoefficient(status);
  });

  const total = details.length || 0;

  return {
    total,
    reachableCount,
    unreachableCount,
    statusBreakdown,
    weightedDemand: Number(weightedDemand.toFixed(2)),
    activeShare: total ? Number(((statusBreakdown.Active || 0) / total).toFixed(4)) : 0,
    cancelledShare: total ? Number(((statusBreakdown.Cancelled || 0) / total).toFixed(4)) : 0,
    expiredShare: total ? Number(((statusBreakdown.Expired || 0) / total).toFixed(4)) : 0,
    closedShare: total ? Number(((statusBreakdown.Closed || 0) / total).toFixed(4)) : 0,
    inactiveShare: total ? Number(((statusBreakdown.Inactive || 0) / total).toFixed(4)) : 0,
    unreachableShare: total ? Number((unreachableCount / total).toFixed(4)) : 0,
    coefficientVersion: 'offer-status-coefficients.v1',
  };
}

function getOfferDetailDocFromApiPayload(offerId, payload, targetDate) {
  const identifier = payload?.identifier || {};
  const offer = payload?.offer || {};
  const workplace = payload?.workplace || {};
  const contract = payload?.contract || {};
  const apply = payload?.apply || {};

  const stableId = identifier.id || offerId;

  return {
    offerId: stableId,
    sourceRequestedOfferId: offerId,

    partnerLabel: identifier.partner_label || null,
    partnerJobId: identifier.partner_job_id || null,

    offerStatus: normalizeOfferStatus(offer.status),
    offerTitle: offer.title || null,
    romeCodes: Array.isArray(offer.rome_codes) ? offer.rome_codes : [],
    targetDiploma: offer.target_diploma || null,
    openingCount: Number(offer.opening_count || 0),

    publicationCreation: offer?.publication?.creation || null,
    publicationExpiration: offer?.publication?.expiration || null,

    contractStart: contract.start || null,
    contractDuration: contract.duration || null,
    contractType: contract.type || null,
    contractRemote: contract.remote ?? null,

    workplaceName: workplace.name || null,
    workplaceSiret: workplace.siret || null,
    workplaceBrand: workplace.brand || null,
    workplaceLegalName: workplace.legal_name || null,
    workplaceCity: workplace?.location?.city || null,
    workplaceZipcode: workplace?.location?.zipcode || null,
    workplaceDepartment: workplace?.location?.department || null,

    nafCode: workplace?.domain?.naf?.code || null,
    nafLabel: workplace?.domain?.naf?.label || null,
    opco: workplace?.domain?.opco || null,
    idcc: workplace?.domain?.idcc || null,

    applyUrl: apply.url || null,
    applyRecipientId: apply.recipient_id || null,
    applyPhone: apply.phone || null,

    isDelegated: payload?.is_delegated ?? null,

    detailFetchStatus: 'ok',
    detailLastFetchedDate: targetDate,
    detailFetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    detailSource: 'api-apprentissage-job-v1-offer',
    schemaVersion: 'jobOfferDetails.v1',
  };
}

async function fetchOfferDetail(offerId, token) {
  const url = `${API_OFFER_DETAIL_BASE_URL}/${encodeURIComponent(offerId)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
    error.httpStatus = response.status;
    error.responseData = data;
    throw error;
  }

  return data;
}

async function getExistingOfferDetailFreshness(offerIds) {
  const freshness = {};

  for (let index = 0; index < offerIds.length; index += 30) {
    const chunk = offerIds.slice(index, index + 30);
    const refs = chunk.map((offerId) => db.collection('jobOfferDetails').doc(offerId));
    const snapshots = await db.getAll(...refs);

    snapshots.forEach((snapshot) => {
      if (!snapshot.exists) return;

      const data = snapshot.data();
      freshness[snapshot.id] = {
        exists: true,
        detailLastFetchedDate: data.detailLastFetchedDate || null,
        detailFetchStatus: data.detailFetchStatus || null,
      };
    });
  }

  return freshness;
}

function shouldRefreshOfferDetail(existing, targetDate) {
  if (!existing?.exists) return true;
  if (existing.detailFetchStatus !== 'ok') return true;
  if (!existing.detailLastFetchedDate) return true;

  const lastDate = new Date(`${existing.detailLastFetchedDate}T12:00:00.000Z`);
  const currentDate = new Date(`${targetDate}T12:00:00.000Z`);
  const ageHours = Math.abs(currentDate.getTime() - lastDate.getTime()) / 36e5;

  return ageHours >= JOB_DETAIL_REFRESH_HOURS;
}

function collectOfferIdsForDetailEnrichment(dailyRows) {
  const priority = new Map();

  function add(id, score, reason) {
    const cleanId = String(id || '').trim();

    if (!cleanId) return;

    const current = priority.get(cleanId) || {
      offerId: cleanId,
      score: 0,
      reasons: [],
    };

    current.score += score;
    current.reasons.push(reason);

    priority.set(cleanId, current);
  }

  dailyRows.forEach((row) => {
    (row.todayOfferIds || []).forEach((id) => add(id, 100, 'todayOfferIds'));
    (row.notSeenSinceYesterdayIds || []).forEach((id) => add(id, 90, 'notSeenSinceYesterdayIds'));

    const activeIds = Array.isArray(row.activeOfferIds) ? row.activeOfferIds : [];

    activeIds.slice(0, 25).forEach((id) => add(id, 25, 'activeOfferIds_sample'));
  });

  return Array.from(priority.values())
    .sort((a, b) => b.score - a.score || String(a.offerId).localeCompare(String(b.offerId)));
}


function incrementCleanCounter(counter, value, amount = 1) {
  const cleanValue = String(value || '').trim();

  if (!cleanValue) {
    increment(counter, 'Inconnu', amount);
    return;
  }

  increment(counter, cleanValue, amount);
}

function bucketDateFromTarget(value, targetDate) {
  if (!value) return 'unknown';

  const normalizedValue = String(value).slice(0, 10);
  const date = new Date(`${normalizedValue}T12:00:00.000Z`);
  const base = new Date(`${targetDate}T12:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || Number.isNaN(base.getTime())) {
    return 'unknown';
  }

  const diffDays = Math.round((date.getTime() - base.getTime()) / 86400000);

  if (diffDays < 0) return 'past';
  if (diffDays <= 7) return 'next7Days';
  if (diffDays <= 30) return 'next30Days';

  return 'later';
}

function safeTopCounter(counter, limit = 8) {
  return topFromCounter(counter, limit).filter((item) => item.label !== 'Inconnu' || item.count > 0);
}


const ROME_PUBLIC_SECTOR_META = {
  A: { sectorCode: 'agriculture', sectorLabel: 'Agriculture / espaces naturels', icon: 'agriculture' },
  B: { sectorCode: 'artisanat_arts', sectorLabel: 'Artisanat / arts', icon: 'arts' },
  C: { sectorCode: 'banque_immobilier', sectorLabel: 'Banque / assurance / immobilier', icon: 'bank' },
  D: { sectorCode: 'commerce_vente', sectorLabel: 'Commerce / vente', icon: 'commerce' },
  E: { sectorCode: 'communication_media', sectorLabel: 'Communication / médias / numérique', icon: 'communication' },
  F: { sectorCode: 'btp', sectorLabel: 'Bâtiment / travaux publics', icon: 'btp' },
  G: { sectorCode: 'restauration_tourisme_loisirs', sectorLabel: 'Hôtellerie / restauration / tourisme / loisirs', icon: 'restaurant' },
  H: { sectorCode: 'industrie', sectorLabel: 'Industrie', icon: 'industry' },
  I: { sectorCode: 'maintenance', sectorLabel: 'Installation / maintenance', icon: 'maintenance' },
  J: { sectorCode: 'sante', sectorLabel: 'Santé', icon: 'health' },
  K: { sectorCode: 'services_social', sectorLabel: 'Services / social / collectivité', icon: 'services' },
  L: { sectorCode: 'spectacle', sectorLabel: 'Spectacle', icon: 'culture' },
  M: { sectorCode: 'support_entreprise', sectorLabel: 'Support administratif / entreprise', icon: 'admin' },
  N: { sectorCode: 'transport_logistique', sectorLabel: 'Transport / logistique', icon: 'transport' },
};

function getRomeFamilyCode(romeCode) {
  return String(romeCode || '').trim().charAt(0).toUpperCase() || 'unknown';
}

function getRomePublicSectorMeta(romeCode) {
  const familyCode = getRomeFamilyCode(romeCode);

  return ROME_PUBLIC_SECTOR_META[familyCode] || {
    sectorCode: 'autres_metiers',
    sectorLabel: 'Autres métiers',
    icon: 'default',
  };
}

function normalizeSectorVigilanceItemLabel(value, fallback) {
  const cleanValue = String(value || '').trim();

  return cleanValue || fallback;
}

function summarizeOfferTitles(details, limit = 3) {
  const titles = {};

  details.forEach((detail) => {
    const title = String(detail?.offerTitle || '').trim();

    if (!title) return;

    increment(titles, title);
  });

  return safeTopCounter(titles, limit).map((item) => item.label);
}

function computeVigilanceMetricsForDetailGroup(details, targetDate) {
  const statusBreakdown = {};
  const expirationBuckets = {
    past: 0,
    next7Days: 0,
    next30Days: 0,
    later: 0,
    unknown: 0,
  };

  let weightedDemand = 0;
  let openingCountTotal = 0;
  let okDetailsCount = 0;
  let unreachableDetailsCount = 0;

  details.forEach((detail) => {
    const detailOk = detail?.detailFetchStatus === 'ok';

    if (detailOk) okDetailsCount += 1;
    else unreachableDetailsCount += 1;

    const status = detailOk ? normalizeOfferStatus(detail.offerStatus) : 'Unreachable';
    incrementStatusCounter(statusBreakdown, status);
    weightedDemand += getOfferStatusCoefficient(status);
    openingCountTotal += Number(detail?.openingCount || 0);

    expirationBuckets[bucketDateFromTarget(detail?.publicationExpiration, targetDate)] += 1;
  });

  const total = details.length || 0;
  const inactiveLike =
    Number(statusBreakdown.Cancelled || 0) +
    Number(statusBreakdown.Expired || 0) +
    Number(statusBreakdown.Closed || 0) +
    Number(statusBreakdown.Inactive || 0);

  const cancelledShare = total ? Number(((statusBreakdown.Cancelled || 0) / total).toFixed(4)) : 0;
  const inactiveLikeShare = total ? Number((inactiveLike / total).toFixed(4)) : 0;
  const unreachableShare = total ? Number((unreachableDetailsCount / total).toFixed(4)) : 0;
  const weightedDemandRatio = total ? Number((weightedDemand / total).toFixed(4)) : 0;
  const expiringSoonShare = total
    ? Number(((expirationBuckets.next7Days + expirationBuckets.next30Days) / total).toFixed(4))
    : 0;

  let score = 0;
  const reasons = [];

  if (total <= 0) {
    return {
      level: 'green',
      score: 0,
      confidenceScore: 0,
      reasons: [],
      statusBreakdown,
      weightedDemand: 0,
      weightedDemandRatio: 0,
      openingCountTotal: 0,
      expirationBuckets,
      detailCoverageQuality: 0,
    };
  }

  if (weightedDemandRatio < 0.55) {
    score += 32;
    reasons.push('La demande pondérée par statut est faible.');
  } else if (weightedDemandRatio < 0.75) {
    score += 22;
    reasons.push('La demande pondérée par statut est à surveiller.');
  } else if (weightedDemandRatio < 0.9) {
    score += 10;
    reasons.push('Plusieurs offres présentent un statut moins favorable.');
  }

  if (cancelledShare >= 0.2) {
    score += 22;
    reasons.push('La part d’offres annulées est élevée.');
  } else if (cancelledShare >= 0.1) {
    score += 12;
    reasons.push('La part d’offres annulées est notable.');
  }

  if (inactiveLikeShare >= 0.35) {
    score += 22;
    reasons.push('Une part importante des offres n’est plus pleinement active.');
  } else if (inactiveLikeShare >= 0.18) {
    score += 12;
    reasons.push('Plusieurs offres ne sont plus pleinement actives.');
  }

  if (expiringSoonShare >= 0.4) {
    score += 12;
    reasons.push('Plusieurs offres arrivent bientôt à expiration.');
  } else if (expiringSoonShare >= 0.25) {
    score += 7;
    reasons.push('Des offres arrivent prochainement à expiration.');
  }

  if (total <= 2 && score > 0) {
    score = Math.max(20, score - 5);
    reasons.push('Signal observé sur un faible volume : à interpréter avec prudence.');
  }

  let level = 'green';

  if (score >= 70) level = 'red';
  else if (score >= 45) level = 'orange';
  else if (score >= 20) level = 'yellow';

  let confidenceScore = 80;

  if (total < 3) confidenceScore -= 20;
  if (unreachableShare >= 0.25) confidenceScore -= 15;

  confidenceScore = Math.max(0, Math.min(100, confidenceScore));

  return {
    level,
    score,
    confidenceScore,
    reasons,
    statusBreakdown,
    weightedDemand: Number(weightedDemand.toFixed(2)),
    weightedDemandRatio,
    openingCountTotal,
    expirationBuckets,
    cancelledShare,
    inactiveLikeShare,
    unreachableShare,
    expiringSoonShare,
    detailCoverageQuality: total ? Number((okDetailsCount / total).toFixed(4)) : 0,
  };
}

function buildSectorVigilanceReason(metrics) {
  if (!metrics?.reasons?.length) {
    return 'Aucun signal sectoriel significatif.';
  }

  return metrics.reasons.slice(0, 2).join(' ');
}

function buildSectorPublicAdvice(level) {
  if (level === 'red') {
    return 'Élargir fortement la recherche à des métiers proches, à d’autres secteurs ou aux départements voisins.';
  }

  if (level === 'orange') {
    return 'Élargir la recherche et candidater rapidement aux offres récentes encore actives.';
  }

  if (level === 'yellow') {
    return 'Surveiller les nouvelles offres du secteur et préparer plusieurs candidatures ciblées.';
  }

  return 'Maintenir une veille régulière.';
}

function computeSectorVigilanceItemsFromDetails(details, targetDate) {
  const sectorMap = {};

  details.forEach((detail) => {
    const romeCodes = Array.isArray(detail?.romeCodes) ? detail.romeCodes : [];

    if (romeCodes.length === 0) return;

    romeCodes.forEach((romeCode) => {
      const meta = getRomePublicSectorMeta(romeCode);

      if (!sectorMap[meta.sectorCode]) {
        sectorMap[meta.sectorCode] = {
          sectorCode: meta.sectorCode,
          sectorLabel: meta.sectorLabel,
          icon: meta.icon,
          detailsById: {},
          romeMap: {},
          nafMap: {},
        };
      }

      const sector = sectorMap[meta.sectorCode];
      const detailKey = detail.offerId || detail.sourceRequestedOfferId || `${romeCode}_${Object.keys(sector.detailsById).length}`;

      sector.detailsById[detailKey] = detail;

      if (!sector.romeMap[romeCode]) {
        sector.romeMap[romeCode] = {
          code: romeCode,
          label: `Code ROME ${romeCode}`,
          familyCode: getRomeFamilyCode(romeCode),
          familyLabel: ROME_FAMILIES[getRomeFamilyCode(romeCode)] || 'Famille métier inconnue',
          icon: meta.icon,
          details: [],
        };
      }

      sector.romeMap[romeCode].details.push(detail);

      const nafCode = String(detail.nafCode || '').trim();
      const nafLabel = String(detail.nafLabel || '').trim();

      if (nafCode || nafLabel) {
        const nafKey = `${nafCode || 'unknown'}_${nafLabel || 'Inconnu'}`;

        if (!sector.nafMap[nafKey]) {
          sector.nafMap[nafKey] = {
            code: nafCode || 'unknown',
            label: nafLabel || 'Activité inconnue',
            icon: meta.icon,
            details: [],
          };
        }

        sector.nafMap[nafKey].details.push(detail);
      }
    });
  });

  return Object.values(sectorMap)
    .map((sector) => {
      const detailsForSector = Object.values(sector.detailsById);
      const sectorMetrics = computeVigilanceMetricsForDetailGroup(detailsForSector, targetDate);

      const romeItems = Object.values(sector.romeMap)
        .map((item) => {
          const metrics = computeVigilanceMetricsForDetailGroup(item.details, targetDate);

          return {
            code: item.code,
            label: item.label,
            familyCode: item.familyCode,
            familyLabel: item.familyLabel,
            icon: item.icon,
            level: metrics.level,
            rawScore: metrics.score,
            confidenceScore: metrics.confidenceScore,
            count: item.details.length,
            weightedDemandRatio: metrics.weightedDemandRatio,
            statusBreakdown: metrics.statusBreakdown,
            reason: buildSectorVigilanceReason(metrics),
            exampleTitles: summarizeOfferTitles(item.details, 3),
          };
        })
        .filter((item) => item.level !== 'green')
        .sort((a, b) => publicVigilanceLevelValue(b.level) - publicVigilanceLevelValue(a.level)
          || b.rawScore - a.rawScore
          || b.count - a.count)
        .slice(0, 8);

      const nafItems = Object.values(sector.nafMap)
        .map((item) => {
          const metrics = computeVigilanceMetricsForDetailGroup(item.details, targetDate);

          return {
            code: item.code,
            label: normalizeSectorVigilanceItemLabel(item.label, 'Activité inconnue'),
            icon: item.icon,
            level: metrics.level,
            rawScore: metrics.score,
            confidenceScore: metrics.confidenceScore,
            count: item.details.length,
            weightedDemandRatio: metrics.weightedDemandRatio,
            statusBreakdown: metrics.statusBreakdown,
            reason: buildSectorVigilanceReason(metrics),
          };
        })
        .filter((item) => item.level !== 'green')
        .sort((a, b) => publicVigilanceLevelValue(b.level) - publicVigilanceLevelValue(a.level)
          || b.rawScore - a.rawScore
          || b.count - a.count)
        .slice(0, 8);

      return {
        sectorCode: sector.sectorCode,
        sectorLabel: sector.sectorLabel,
        icon: sector.icon,
        level: sectorMetrics.level,
        rawScore: sectorMetrics.score,
        confidenceScore: sectorMetrics.confidenceScore,
        reason: buildSectorVigilanceReason(sectorMetrics),
        publicAdvice: buildSectorPublicAdvice(sectorMetrics.level),
        metrics: {
          totalDetails: detailsForSector.length,
          weightedDemand: sectorMetrics.weightedDemand,
          weightedDemandRatio: sectorMetrics.weightedDemandRatio,
          statusBreakdown: sectorMetrics.statusBreakdown,
          openingCountTotal: sectorMetrics.openingCountTotal,
          expirationBuckets: sectorMetrics.expirationBuckets,
          detailCoverageQuality: sectorMetrics.detailCoverageQuality,
          cancelledShare: sectorMetrics.cancelledShare,
          inactiveLikeShare: sectorMetrics.inactiveLikeShare,
          unreachableShare: sectorMetrics.unreachableShare,
        },
        romeItems,
        nafItems,
      };
    })
    .filter((sector) => sector.level !== 'green' || sector.romeItems.length > 0 || sector.nafItems.length > 0)
    .sort((a, b) => publicVigilanceLevelValue(b.level) - publicVigilanceLevelValue(a.level)
      || b.rawScore - a.rawScore
      || String(a.sectorLabel).localeCompare(String(b.sectorLabel)))
    .slice(0, 12);
}


function getDefaultSectorMeta() {
  return {
    sectorCode: 'autres_metiers',
    sectorLabel: 'Autres métiers',
    icon: 'default',
  };
}

function getUniqueSectorMetasForDetail(detail) {
  const romeCodes = Array.isArray(detail?.romeCodes) ? detail.romeCodes : [];

  if (romeCodes.length === 0) {
    return [getDefaultSectorMeta()];
  }

  const metasByCode = {};

  romeCodes.forEach((romeCode) => {
    const meta = getRomePublicSectorMeta(romeCode);
    metasByCode[meta.sectorCode] = meta;
  });

  return Object.values(metasByCode);
}

function getStableDetailKey(detail, fallbackPrefix = 'detail') {
  return String(
    detail?.offerId ||
      detail?.sourceRequestedOfferId ||
      detail?.partnerJobId ||
      `${fallbackPrefix}_${detail?.offerTitle || 'unknown'}_${detail?.workplaceCity || 'unknown'}`
  );
}

function ensureSectorDailyGroup(sectorMap, meta, dailyData, targetDate) {
  const departmentCode =
    dailyData.code ||
    dailyData.departmentCode ||
    String(dailyData.id || '').split('_').pop();

  const key = `${departmentCode}_${meta.sectorCode}`;

  if (!sectorMap[key]) {
    sectorMap[key] = {
      date: targetDate,
      departmentCode,
      departmentName:
        dailyData.name ||
        dailyData.departmentName ||
        `Département ${departmentCode}`,
      sectorCode: meta.sectorCode,
      sectorLabel: meta.sectorLabel,
      icon: meta.icon,
      activeDetails: {},
      todayDetails: {},
      notSeenDetails: {},
      allDetails: {},
    };
  }

  return sectorMap[key];
}

function addDetailToSectorDailyGroup(group, bucketName, detail) {
  const key = getStableDetailKey(detail, `${group.departmentCode}_${group.sectorCode}_${bucketName}`);

  group[bucketName][key] = detail;
  group.allDetails[key] = detail;
}

function addDetailsToSectorDailyGroups(sectorMap, dailyData, targetDate, bucketName, details) {
  details.forEach((detail) => {
    const metas = getUniqueSectorMetasForDetail(detail);

    metas.forEach((meta) => {
      const group = ensureSectorDailyGroup(sectorMap, meta, dailyData, targetDate);
      addDetailToSectorDailyGroup(group, bucketName, detail);
    });
  });
}

function sumOpeningCountFromDetails(details) {
  return details.reduce((total, detail) => {
    return total + Number(detail?.openingCount || 0);
  }, 0);
}

function computeWeightedExitsFromStatusBreakdown(statusBreakdown) {
  const cancelled = Number(statusBreakdown?.Cancelled || 0);
  const inactive = Number(statusBreakdown?.Inactive || 0);
  const expired = Number(statusBreakdown?.Expired || 0);
  const closed = Number(statusBreakdown?.Closed || 0);

  return Number((
    cancelled * 1 +
    inactive * 0.85 +
    expired * 0.70 +
    closed * 0.50
  ).toFixed(2));
}

function computeUsefulStockFromStatusBreakdown(statusBreakdown) {
  const active = Number(statusBreakdown?.Active || 0);
  const unknown = Number(statusBreakdown?.Unknown || 0);
  const unreachable = Number(statusBreakdown?.Unreachable || 0);
  const expired = Number(statusBreakdown?.Expired || 0);
  const closed = Number(statusBreakdown?.Closed || 0);
  const inactive = Number(statusBreakdown?.Inactive || 0);
  const cancelled = Number(statusBreakdown?.Cancelled || 0);

  return Number((
    active * 1 +
    unknown * 0.25 +
    unreachable * 0.15 +
    expired * 0.45 +
    closed * 0.30 +
    inactive * 0.35 +
    cancelled * 0.10
  ).toFixed(2));
}

function buildTopCitiesFromDetails(details, limit = 8) {
  const counter = {};

  details.forEach((detail) => {
    incrementCleanCounter(counter, detail?.workplaceCity);
  });

  return safeTopCounter(counter, limit);
}

function buildTopRomeCodesFromDetails(details, limit = 8) {
  const counter = {};

  details.forEach((detail) => {
    const romeCodes = Array.isArray(detail?.romeCodes) ? detail.romeCodes : [];

    romeCodes.forEach((romeCode) => {
      incrementCleanCounter(counter, romeCode);
    });
  });

  return safeTopCounter(counter, limit);
}

function buildTopNafLabelsFromDetails(details, limit = 8) {
  const counter = {};

  details.forEach((detail) => {
    incrementCleanCounter(counter, detail?.nafLabel);
  });

  return safeTopCounter(counter, limit);
}

function buildDepartmentSectorDailyStatsFromDetails({
  dailyData,
  targetDate,
  activeDetails,
  todayDetails,
  notSeenDetails,
}) {
  const sectorMap = {};

  addDetailsToSectorDailyGroups(
    sectorMap,
    dailyData,
    targetDate,
    'activeDetails',
    activeDetails
  );

  addDetailsToSectorDailyGroups(
    sectorMap,
    dailyData,
    targetDate,
    'todayDetails',
    todayDetails
  );

  addDetailsToSectorDailyGroups(
    sectorMap,
    dailyData,
    targetDate,
    'notSeenDetails',
    notSeenDetails
  );

  return Object.values(sectorMap).map((group) => {
    const active = Object.values(group.activeDetails);
    const today = Object.values(group.todayDetails);
    const notSeen = Object.values(group.notSeenDetails);
    const all = Object.values(group.allDetails);

    const activeMetrics = computeVigilanceMetricsForDetailGroup(active, targetDate);
    const todayMetrics = computeVigilanceMetricsForDetailGroup(today, targetDate);
    const notSeenMetrics = computeVigilanceMetricsForDetailGroup(notSeen, targetDate);
    const allMetrics = computeVigilanceMetricsForDetailGroup(all, targetDate);

    const weightedExits = computeWeightedExitsFromStatusBreakdown(
      notSeenMetrics.statusBreakdown
    );

    const replacementRate =
      weightedExits > 0
        ? Number((today.length / weightedExits).toFixed(4))
        : today.length > 0
          ? 999
          : 1;

    const usefulStock = computeUsefulStockFromStatusBreakdown(
      activeMetrics.statusBreakdown
    );

    return {
      date: group.date,
      departmentCode: group.departmentCode,
      departmentName: group.departmentName,

      sectorCode: group.sectorCode,
      sectorLabel: group.sectorLabel,
      icon: group.icon,

      jobsCount: today.length,
      openingCount: sumOpeningCountFromDetails(today),
      activeSampleCount: active.length,
      notSeenSinceYesterdayCount: notSeen.length,

      activeStatusBreakdown: activeMetrics.statusBreakdown,
      todayStatusBreakdown: todayMetrics.statusBreakdown,
      notSeenStatusBreakdown: notSeenMetrics.statusBreakdown,
      statusBreakdown: allMetrics.statusBreakdown,

      weightedExits,
      replacementRate,
      usefulStock,

      weightedDemand: allMetrics.weightedDemand,
      weightedDemandRatio: allMetrics.weightedDemandRatio,

      cancelledShare: allMetrics.cancelledShare,
      inactiveLikeShare: allMetrics.inactiveLikeShare,
      unreachableShare: allMetrics.unreachableShare,
      detailCoverageQuality: allMetrics.detailCoverageQuality,

      topCities: buildTopCitiesFromDetails(all, 8),
      topRomeCodes: buildTopRomeCodesFromDetails(all, 8),
      topNafLabels: buildTopNafLabelsFromDetails(all, 8),

      source: 'departmentDailyStats.enrichedDetailSummary.details',
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 'departmentSectorDailyStats.v1',
    };
  });
}

async function writeDepartmentSectorDailyStatsForDate(targetDate, sectorDocs) {
  const existingSnapshot = await db
    .collection('departmentSectorDailyStats')
    .where('date', '==', targetDate)
    .get();

  const wantedIds = new Set(
    sectorDocs.map((doc) => `${doc.date}_${doc.departmentCode}_${doc.sectorCode}`)
  );

  let batch = db.batch();
  let operationCount = 0;
  let writtenCount = 0;
  let deletedCount = 0;

  async function commitIfNeeded(force = false) {
    if (operationCount === 0) return;

    if (force || operationCount >= 450) {
      await batch.commit();
      batch = db.batch();
      operationCount = 0;
    }
  }

  sectorDocs.forEach((doc) => {
    const id = `${doc.date}_${doc.departmentCode}_${doc.sectorCode}`;
    batch.set(db.collection('departmentSectorDailyStats').doc(id), doc, { merge: true });
    operationCount += 1;
    writtenCount += 1;
  });

  await commitIfNeeded(false);

  existingSnapshot.docs.forEach((document) => {
    if (wantedIds.has(document.id)) return;

    batch.delete(document.ref);
    operationCount += 1;
    deletedCount += 1;
  });

  await commitIfNeeded(true);

  await db.collection('apiImports').doc(`sector_daily_stats_${targetDate}`).set(
    {
      type: 'daily_department_sector_stats',
      date: targetDate,
      sourceCollection: 'departmentDailyStats',
      targetCollection: 'departmentSectorDailyStats',
      writtenCount,
      deletedStaleCount: deletedCount,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 'daily_department_sector_stats.v1',
    },
    { merge: true }
  );

  console.log(
    `Stats secteurs complètes ${targetDate}: ${writtenCount} document(s), ${deletedCount} ancien(s) supprimé(s).`
  );

  return {
    writtenCount,
    deletedCount,
  };
}


function computeEnrichedDetailSummaryFromDetails(details, targetDate) {
  const statusCounter = {};
  const nafLabelCounter = {};
  const nafCodeCounter = {};
  const opcoCounter = {};
  const idccCounter = {};
  const romeCounter = {};
  const romeFamilyCounter = {};
  const contractTypeCounter = {};
  const targetDiplomaCounter = {};
  const partnerCounter = {};
  const cityCounter = {};
  const workplaceDepartmentCounter = {};
  const remoteCounter = {};
  const delegatedCounter = {};
  const contractStartBuckets = {
    past: 0,
    next7Days: 0,
    next30Days: 0,
    later: 0,
    unknown: 0,
  };
  const expirationBuckets = {
    past: 0,
    next7Days: 0,
    next30Days: 0,
    later: 0,
    unknown: 0,
  };

  let okDetailsCount = 0;
  let unreachableDetailsCount = 0;
  let openingCountTotal = 0;
  let weightedDemand = 0;

  details.forEach((detail) => {
    if (!detail) return;

    const detailOk = detail.detailFetchStatus === 'ok';

    if (detailOk) {
      okDetailsCount += 1;
    } else {
      unreachableDetailsCount += 1;
    }

    const status = detailOk ? normalizeOfferStatus(detail.offerStatus) : 'Unreachable';
    incrementStatusCounter(statusCounter, status);
    weightedDemand += getOfferStatusCoefficient(status);

    incrementCleanCounter(partnerCounter, detail.partnerLabel);
    incrementCleanCounter(nafLabelCounter, detail.nafLabel);
    incrementCleanCounter(nafCodeCounter, detail.nafCode);
    incrementCleanCounter(opcoCounter, detail.opco);
    incrementCleanCounter(idccCounter, detail.idcc);
    incrementCleanCounter(contractTypeCounter, detail.contractType);
    incrementCleanCounter(targetDiplomaCounter, detail.targetDiploma);
    incrementCleanCounter(cityCounter, detail.workplaceCity);
    incrementCleanCounter(workplaceDepartmentCounter, detail.workplaceDepartment);

    const remoteKey =
      detail.contractRemote === true
        ? 'remote'
        : detail.contractRemote === false
          ? 'on_site'
          : 'unknown';

    increment(remoteCounter, remoteKey);

    const delegatedKey =
      detail.isDelegated === true
        ? 'delegated'
        : detail.isDelegated === false
          ? 'direct'
          : 'unknown';

    increment(delegatedCounter, delegatedKey);

    const romeCodes = Array.isArray(detail.romeCodes) ? detail.romeCodes : [];

    romeCodes.forEach((rome) => {
      incrementCleanCounter(romeCounter, rome);

      const familyKey = String(rome || '').charAt(0);
      const familyLabel = ROME_FAMILIES[familyKey] || 'Famille métier inconnue';
      incrementCleanCounter(romeFamilyCounter, familyLabel);
    });

    openingCountTotal += Number(detail.openingCount || 0);

    contractStartBuckets[bucketDateFromTarget(detail.contractStart, targetDate)] += 1;
    expirationBuckets[bucketDateFromTarget(detail.publicationExpiration, targetDate)] += 1;
  });

  const totalDetails = details.length || 0;
  const sectorVigilanceItems = computeSectorVigilanceItemsFromDetails(details, targetDate);

  return {
    totalDetails,
    okDetailsCount,
    unreachableDetailsCount,
    detailCoverageQuality: totalDetails
      ? Number((okDetailsCount / totalDetails).toFixed(4))
      : 0,

    statusBreakdown: statusCounter,
    weightedDemand: Number(weightedDemand.toFixed(2)),
    weightedDemandRatio: totalDetails
      ? Number((weightedDemand / totalDetails).toFixed(4))
      : 0,

    openingCountTotal,
    sectorVigilanceItems,

    topNafLabels: safeTopCounter(nafLabelCounter, 8),
    topNafCodes: safeTopCounter(nafCodeCounter, 8),
    topOpcos: safeTopCounter(opcoCounter, 8),
    topIdcc: safeTopCounter(idccCounter, 8),
    topRomeCodes: safeTopCounter(romeCounter, 10),
    topRomeFamilies: safeTopCounter(romeFamilyCounter, 8),
    contractTypeBreakdown: safeTopCounter(contractTypeCounter, 8),
    targetDiplomaBreakdown: safeTopCounter(targetDiplomaCounter, 8),
    partnerBreakdown: safeTopCounter(partnerCounter, 8),
    topCities: safeTopCounter(cityCounter, 8),
    workplaceDepartmentBreakdown: safeTopCounter(workplaceDepartmentCounter, 8),

    remoteBreakdown: remoteCounter,
    remoteShare: totalDetails
      ? Number(((remoteCounter.remote || 0) / totalDetails).toFixed(4))
      : 0,

    delegatedBreakdown: delegatedCounter,
    delegatedShare: totalDetails
      ? Number(((delegatedCounter.delegated || 0) / totalDetails).toFixed(4))
      : 0,

    contractStartBuckets,
    expirationBuckets,

    generatedForDate: targetDate,
    schemaVersion: 'departmentDailyStats.enrichedDetailSummary.v1',
  };
}


async function enrichLatestImportOfferDetailsForDate(targetDate, token) {
  const dailySnapshot = await db
    .collection('departmentDailyStats')
    .where('date', '==', targetDate)
    .get();

  const dailyRows = dailySnapshot.docs
    .map((document) => ({
      id: document.id,
      ref: document.ref,
      ...document.data(),
    }))
    .filter((row) => !row.lastError);

  const candidates = collectOfferIdsForDetailEnrichment(dailyRows);
  const existingFreshness = await getExistingOfferDetailFreshness(candidates.map((item) => item.offerId));

  const selected = candidates
    .filter((item) => shouldRefreshOfferDetail(existingFreshness[item.offerId], targetDate))
    .slice(0, JOB_DETAIL_MAX_FETCHES_PER_RUN);

  console.log(
    `Enrichissement détails offres ${targetDate}: ${dailyRows.length} département(s), ${candidates.length} ID candidat(s), ${selected.length} appel(s) API.`
  );

  let successCount = 0;
  let errorCount = 0;
  const fetchedDetailsById = {};

  for (const candidate of selected) {
    const offerId = candidate.offerId;

    try {
      const payload = await fetchOfferDetail(offerId, token);
      const detailDoc = getOfferDetailDocFromApiPayload(offerId, payload, targetDate);

      await db.collection('jobOfferDetails').doc(offerId).set(
        {
          ...detailDoc,
          detailPriorityScore: candidate.score,
          detailPriorityReasons: Array.from(new Set(candidate.reasons)),
        },
        { merge: true }
      );

      fetchedDetailsById[offerId] = detailDoc;
      successCount += 1;
    } catch (error) {
      const failureDoc = {
        offerId,
        sourceRequestedOfferId: offerId,
        offerStatus: 'Unreachable',
        detailFetchStatus: 'error',
        detailErrorStatus: error.httpStatus || null,
        detailErrorMessage: String(error.message || '').slice(0, 500),
        detailLastFetchedDate: targetDate,
        detailFetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        detailSource: 'api-apprentissage-job-v1-offer',
        schemaVersion: 'jobOfferDetails.v1',
      };

      await db.collection('jobOfferDetails').doc(offerId).set(failureDoc, { merge: true });

      fetchedDetailsById[offerId] = failureDoc;
      errorCount += 1;
    }

    await sleep(250);
  }

  const allRelevantIds = Array.from(
    new Set(
      dailyRows.flatMap((row) => [
        ...(Array.isArray(row.todayOfferIds) ? row.todayOfferIds : []),
        ...(Array.isArray(row.notSeenSinceYesterdayIds) ? row.notSeenSinceYesterdayIds : []),
        ...(Array.isArray(row.activeOfferIds) ? row.activeOfferIds.slice(0, 25) : []),
      ])
    )
  );

  const detailDocsById = { ...fetchedDetailsById };

  for (let index = 0; index < allRelevantIds.length; index += 30) {
    const chunk = allRelevantIds.slice(index, index + 30);
    const refs = chunk.map((offerId) => db.collection('jobOfferDetails').doc(offerId));
    const snapshots = await db.getAll(...refs);

    snapshots.forEach((snapshot) => {
      if (!snapshot.exists) return;
      detailDocsById[snapshot.id] = snapshot.data();
    });
  }

  const updateBatch = db.batch();
  const sectorDailyStatsDocs = [];

  dailyRows.forEach((row) => {
    const activeIds = Array.isArray(row.activeOfferIds) ? row.activeOfferIds.slice(0, 25) : [];
    const todayIds = Array.isArray(row.todayOfferIds) ? row.todayOfferIds : [];
    const notSeenIds = Array.isArray(row.notSeenSinceYesterdayIds) ? row.notSeenSinceYesterdayIds : [];

    const detailIds = Array.from(new Set([...activeIds, ...todayIds, ...notSeenIds]));
    const departmentDetails = detailIds.map((id) => detailDocsById[id]).filter(Boolean);

    const activeDetails = activeIds.map((id) => detailDocsById[id]).filter(Boolean);
    const todayDetails = todayIds.map((id) => detailDocsById[id]).filter(Boolean);
    const notSeenDetails = notSeenIds.map((id) => detailDocsById[id]).filter(Boolean);

    const activeStatusSummary = computeStatusSummaryFromDetails(activeDetails);
    const todayStatusSummary = computeStatusSummaryFromDetails(todayDetails);
    const notSeenStatusSummary = computeStatusSummaryFromDetails(notSeenDetails);
    const enrichedDetailSummary = computeEnrichedDetailSummaryFromDetails(
      departmentDetails,
      targetDate
    );

    sectorDailyStatsDocs.push(
      ...buildDepartmentSectorDailyStatsFromDetails({
        dailyData: row,
        targetDate,
        activeDetails,
        todayDetails,
        notSeenDetails,
      })
    );

    updateBatch.update(row.ref, {
      statusDetailSummary: {
        activeSample: activeStatusSummary,
        today: todayStatusSummary,
        notSeenSinceYesterday: notSeenStatusSummary,
        coverage: {
          activeSampleIds: activeIds.length,
          activeSampleDetails: activeDetails.length,
          todayOfferIds: todayIds.length,
          todayOfferDetails: todayDetails.length,
          notSeenSinceYesterdayIds: notSeenIds.length,
          notSeenSinceYesterdayDetails: notSeenDetails.length,
        },
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 'departmentDailyStats.statusDetailSummary.v1',
      },
      enrichedDetailSummary,
      statusCoefficientVersion: 'offer-status-coefficients.v1',
      statusDetailsEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  if (dailyRows.length > 0) {
    await updateBatch.commit();
  }

  await writeDepartmentSectorDailyStatsForDate(targetDate, sectorDailyStatsDocs);

  await db.collection('apiImports').doc(`job_details_${targetDate}`).set(
    {
      type: 'daily_job_offer_detail_enrichment',
      date: targetDate,
      departmentsCount: dailyRows.length,
      candidateOfferIdsCount: candidates.length,
      selectedOfferIdsCount: selected.length,
      successCount,
      errorCount,
      maxFetchesPerRun: JOB_DETAIL_MAX_FETCHES_PER_RUN,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 'daily_job_offer_detail_enrichment.v1',
    },
    { merge: true }
  );

  console.log(
    `Enrichissement détails terminé ${targetDate}: succès=${successCount}, erreurs=${errorCount}.`
  );

  return {
    targetDate,
    departmentsCount: dailyRows.length,
    candidateOfferIdsCount: candidates.length,
    selectedOfferIdsCount: selected.length,
    successCount,
    errorCount,
  };
}



async function resolveLatestAiTargetDate() {
  const executionDate = parisDateString(new Date());
  const fallbackTargetDate = getPreviousDateFromDateString(executionDate);

  const latestSnapshot = await db.collection('vigilancePublicIndex').doc('latest').get();

  if (!latestSnapshot.exists) {
    return {
      targetDate: fallbackTargetDate,
      analysisDateSource: 'fallback_previous_execution_date',
      latestPublicVigilanceIndex: null,
    };
  }

  const latestPublicVigilanceIndex = latestSnapshot.data();
  const latestDate = latestPublicVigilanceIndex?.latestDate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(latestDate || ''))) {
    return {
      targetDate: fallbackTargetDate,
      analysisDateSource: 'fallback_invalid_vigilance_latest_date',
      latestPublicVigilanceIndex,
    };
  }

  return {
    targetDate: latestDate,
    analysisDateSource: 'vigilancePublicIndex/latest',
    latestPublicVigilanceIndex,
  };
}

async function loadAiInputData(targetDate, analysisDateSource = 'manual') {
  const previousDate = getPreviousDateFromDateString(targetDate);

  const [
    departmentsSnapshot,
    statsSnapshot,
    currentDailySnapshot,
    previousDailySnapshot,
    previousReportSnapshot,
    publishedVigilanceSnapshot,
    latestIndexSnapshot,
  ] = await Promise.all([
    db.collection('departments').get(),
    db.collection('departmentStats').get(),
    db.collection('departmentDailyStats').where('date', '==', targetDate).get(),
    db.collection('departmentDailyStats').where('date', '==', previousDate).get(),
    db.collection('aiReports').doc(previousDate).get(),
    db.collection('departmentVigilanceDaily').where('date', '==', targetDate).get(),
    db.collection('vigilancePublicIndex').doc('latest').get(),
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

  const publishedVigilanceByCode = {};
  publishedVigilanceSnapshot.docs.forEach((document) => {
    const data = document.data();
    const code = data.departmentCode || document.id.split('_')[1];

    publishedVigilanceByCode[code] = {
      id: document.id,
      date: data.date || targetDate,
      departmentCode: code,
      departmentName: data.departmentName || null,
      rawLevel: data.rawLevel || null,
      rawScore: Number(data.rawScore || 0),
      previousRawLevel: data.previousRawLevel || null,
      publishedLevel: data.publishedLevel || null,
      trend: data.trend || null,
      confidenceScore: Number(data.confidenceScore || 0),
      isPublished: data.isPublished === true,
      metrics: data.metrics || {},
      reasons: Array.isArray(data.reasons) ? data.reasons : [],
      technicalReasons: Array.isArray(data.technicalReasons) ? data.technicalReasons : [],
      publicTitle: data.publicTitle || null,
      publicSummary: data.publicSummary || null,
      publicAdvice: data.publicAdvice || null,
    };
  });

  const latestPublicVigilanceIndex = latestIndexSnapshot.exists
    ? latestIndexSnapshot.data()
    : null;

  const departmentsForAi = departments.map((department) => {
    const baseInput = buildDepartmentAiInput(
      department,
      currentDailyByCode[department.code],
      previousDailyByCode[department.code],
      statsByCode[department.code]
    );

    const publishedVigilance = publishedVigilanceByCode[department.code] || {
      date: targetDate,
      departmentCode: department.code,
      departmentName: department.name || department.nom || `Département ${department.code}`,
      rawLevel: 'green',
      rawScore: 0,
      previousRawLevel: null,
      publishedLevel: 'green',
      trend: 'stable',
      confidenceScore: 80,
      isPublished: false,
      metrics: {},
      reasons: [],
      technicalReasons: [],
      publicTitle: null,
      publicSummary: 'Aucune vigilance publique publiée pour ce département à cette date.',
      publicAdvice: null,
    };

    const currentDaily = currentDailyByCode[department.code] || {};

    return {
      ...baseInput,
      statusDetailSummary: currentDaily.statusDetailSummary || null,
      enrichedDetailSummary: currentDaily.enrichedDetailSummary || null,
      publishedVigilance,
    };
  });

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
    analysisDateSource,
    latestPublicVigilanceIndex,
    publishedVigilanceSummary: {
      date: targetDate,
      publishedCount: publishedVigilanceSnapshot.docs.length,
      levels: latestPublicVigilanceIndex?.latestDate === targetDate
        ? latestPublicVigilanceIndex?.levels || null
        : null,
      departments: Object.values(publishedVigilanceByCode).map((item) => ({
        departmentCode: item.departmentCode,
        departmentName: item.departmentName,
        publishedLevel: item.publishedLevel,
        rawScore: item.rawScore,
        confidenceScore: item.confidenceScore,
        publicTitle: item.publicTitle,
      })),
    },
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


function compactTopItems(items, limit = 5) {
  if (!Array.isArray(items)) return [];

  return items.slice(0, limit).map((item) => {
    if (!item || typeof item !== 'object') return item;

    const compact = {};

    [
      'code',
      'label',
      'familyCode',
      'familyLabel',
      'count',
      'level',
      'rawScore',
      'confidenceScore',
      'weightedDemandRatio',
      'reason',
    ].forEach((key) => {
      if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
        compact[key] = item[key];
      }
    });

    return compact;
  });
}

function compactObjectCounter(counter, limit = 8) {
  if (!counter || typeof counter !== 'object' || Array.isArray(counter)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(counter)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, limit)
  );
}

function compactStatusSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;

  return {
    total: summary.total || summary.totalDetails || 0,
    okDetailsCount: summary.okDetailsCount || undefined,
    unreachableDetailsCount: summary.unreachableDetailsCount || undefined,
    statusBreakdown: compactObjectCounter(summary.statusBreakdown, 8),
    weightedDemand: summary.weightedDemand ?? undefined,
    weightedDemandRatio: summary.weightedDemandRatio ?? undefined,
    cancelledShare: summary.cancelledShare ?? undefined,
    inactiveLikeShare: summary.inactiveLikeShare ?? undefined,
    unreachableShare: summary.unreachableShare ?? undefined,
    detailCoverageQuality: summary.detailCoverageQuality ?? undefined,
  };
}

function compactDepartmentStatusDetailSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;

  return {
    activeSample: compactStatusSummary(summary.activeSample),
    today: compactStatusSummary(summary.today),
    notSeenSinceYesterday: compactStatusSummary(summary.notSeenSinceYesterday),
    coverage: summary.coverage || null,
  };
}

function compactSectorVigilanceItems(items, limit = 5) {
  if (!Array.isArray(items)) return [];

  return items.slice(0, limit).map((sector) => ({
    sectorCode: sector.sectorCode || null,
    sectorLabel: sector.sectorLabel || null,
    icon: sector.icon || null,
    level: sector.level || null,
    rawScore: sector.rawScore || 0,
    confidenceScore: sector.confidenceScore || 0,
    reason: sector.reason || null,
    metrics: sector.metrics
      ? {
          totalDetails: sector.metrics.totalDetails || 0,
          weightedDemandRatio: sector.metrics.weightedDemandRatio ?? null,
          statusBreakdown: compactObjectCounter(sector.metrics.statusBreakdown, 8),
          openingCountTotal: sector.metrics.openingCountTotal || 0,
          detailCoverageQuality: sector.metrics.detailCoverageQuality ?? null,
          cancelledShare: sector.metrics.cancelledShare ?? null,
          inactiveLikeShare: sector.metrics.inactiveLikeShare ?? null,
          unreachableShare: sector.metrics.unreachableShare ?? null,
        }
      : null,
    romeItems: compactTopItems(sector.romeItems, 4),
    nafItems: compactTopItems(sector.nafItems, 4),
  }));
}

function compactEnrichedDetailSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;

  return {
    totalDetails: summary.totalDetails || 0,
    okDetailsCount: summary.okDetailsCount || 0,
    unreachableDetailsCount: summary.unreachableDetailsCount || 0,
    detailCoverageQuality: summary.detailCoverageQuality ?? null,
    statusBreakdown: compactObjectCounter(summary.statusBreakdown, 8),
    weightedDemand: summary.weightedDemand ?? null,
    weightedDemandRatio: summary.weightedDemandRatio ?? null,
    openingCountTotal: summary.openingCountTotal || 0,

    topNafLabels: compactTopItems(summary.topNafLabels, 5),
    topNafCodes: compactTopItems(summary.topNafCodes, 5),
    topOpcos: compactTopItems(summary.topOpcos, 5),
    topRomeCodes: compactTopItems(summary.topRomeCodes, 6),
    topRomeFamilies: compactTopItems(summary.topRomeFamilies, 5),

    contractTypeBreakdown: compactTopItems(summary.contractTypeBreakdown, 5),
    targetDiplomaBreakdown: compactTopItems(summary.targetDiplomaBreakdown, 5),
    partnerBreakdown: compactTopItems(summary.partnerBreakdown, 5),

    remoteShare: summary.remoteShare ?? null,
    delegatedShare: summary.delegatedShare ?? null,
    contractStartBuckets: summary.contractStartBuckets || null,
    expirationBuckets: summary.expirationBuckets || null,

    sectorVigilanceItems: compactSectorVigilanceItems(summary.sectorVigilanceItems, 5),
  };
}

function compactPublishedVigilance(publishedVigilance) {
  if (!publishedVigilance || typeof publishedVigilance !== 'object') return null;

  return {
    date: publishedVigilance.date || null,
    departmentCode: publishedVigilance.departmentCode || null,
    departmentName: publishedVigilance.departmentName || null,
    rawLevel: publishedVigilance.rawLevel || null,
    rawScore: publishedVigilance.rawScore || 0,
    previousRawLevel: publishedVigilance.previousRawLevel || null,
    publishedLevel: publishedVigilance.publishedLevel || 'green',
    trend: publishedVigilance.trend || null,
    confidenceScore: publishedVigilance.confidenceScore || 0,
    isPublished: publishedVigilance.isPublished === true,
    reasons: Array.isArray(publishedVigilance.reasons)
      ? publishedVigilance.reasons.slice(0, 4)
      : [],
    technicalReasons: Array.isArray(publishedVigilance.technicalReasons)
      ? publishedVigilance.technicalReasons.slice(0, 4)
      : [],
    publicSummary: publishedVigilance.publicSummary || null,
    publicAdvice: publishedVigilance.publicAdvice || null,
    metrics: publishedVigilance.metrics
      ? {
          activeOffers: publishedVigilance.metrics.activeOffers || 0,
          notSeenSinceYesterday: publishedVigilance.metrics.notSeenSinceYesterday || 0,
          notSeenRatio: publishedVigilance.metrics.notSeenRatio ?? null,
          expiringSoon: publishedVigilance.metrics.expiringSoon || 0,
          expiringRatio: publishedVigilance.metrics.expiringRatio ?? null,
          apiMayBeCapped: publishedVigilance.metrics.apiMayBeCapped === true,
        }
      : {},
  };
}

function compactDepartmentAiInput(department) {
  return {
    code: department.code,
    name: department.name,

    daily: department.daily
      ? {
          jobsCount: department.daily.jobsCount || 0,
          openingCount: department.daily.openingCount || 0,
          recruitersCount: department.daily.recruitersCount || 0,
          previousJobsCount: department.daily.previousJobsCount || 0,
          previousOpeningCount: department.daily.previousOpeningCount || 0,
          jobsAbsoluteChange: department.daily.jobsAbsoluteChange || 0,
          jobsPercentChange: department.daily.jobsPercentChange,
          openingsAbsoluteChange: department.daily.openingsAbsoluteChange || 0,
          openingsPercentChange: department.daily.openingsPercentChange,
          expiringSoonCount: department.daily.expiringSoonCount || 0,
          notSeenSinceYesterdayCount: department.daily.notSeenSinceYesterdayCount || 0,
          warningsCount: department.daily.warningsCount || 0,
        }
      : {},

    rolling30Days: department.rolling30Days
      ? {
          jobsCount: department.rolling30Days.jobsCount || 0,
          openingCount: department.rolling30Days.openingCount || 0,
          recruitersCount: department.rolling30Days.recruitersCount || 0,
          expiringSoonCount: department.rolling30Days.expiringSoonCount || 0,
          warningsCount: department.rolling30Days.warningsCount || 0,
        }
      : {},

    topRomeCodes: compactTopItems(department.topRomeCodes, 6),
    topRomeFamilies: compactTopItems(department.topRomeFamilies, 5),
    topNafLabels: compactTopItems(department.topNafLabels, 5),
    topOpcos: compactTopItems(department.topOpcos, 5),

    statusBreakdown: compactObjectCounter(department.statusBreakdown, 8),
    partnerBreakdown: compactObjectCounter(department.partnerBreakdown, 5),

    statusDetailSummary: compactDepartmentStatusDetailSummary(department.statusDetailSummary),
    enrichedDetailSummary: compactEnrichedDetailSummary(department.enrichedDetailSummary),
    publishedVigilance: compactPublishedVigilance(department.publishedVigilance),
  };
}

function compactAiInputData(inputData) {
  const departments = Array.isArray(inputData.departments)
    ? inputData.departments.map(compactDepartmentAiInput)
    : [];

  return {
    targetDate: inputData.targetDate,
    previousDate: inputData.previousDate,
    analysisDateSource: inputData.analysisDateSource || null,
    calendarContext: inputData.calendarContext,
    seasonalContext: inputData.seasonalContext,
    nationalTotals: inputData.nationalTotals,
    previousReportSummary: inputData.previousReportSummary,
    publishedVigilanceSummary: inputData.publishedVigilanceSummary,
    latestPublicVigilanceIndex: inputData.latestPublicVigilanceIndex
      ? {
          latestDate: inputData.latestPublicVigilanceIndex.latestDate || null,
          publishedCount: inputData.latestPublicVigilanceIndex.publishedCount || 0,
          levels: inputData.latestPublicVigilanceIndex.levels || null,
        }
      : null,
    departments,
  };
}

function estimateJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}


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
- La date analysée doit provenir en priorité de vigilancePublicIndex/latest quand disponible.
- La vigilance publique déterministe déjà publiée est fournie dans publishedVigilance pour chaque département.
- Les champs statusDetailSummary et enrichedDetailSummary contiennent les données enrichies issues du détail des offres.
- Utilise enrichedDetailSummary pour analyser les statuts réels, NAF, OPCO, ROME, types de contrats, dates de début, expirations, partenaires, villes, délégation, remote et couverture de données.
- Signale clairement quand la couverture des détails est faible ou partielle.
- Tu peux commenter, expliquer et signaler les limites, mais tu ne dois pas inventer une vigilance publique différente de la vigilance déterministe publiée.
- Si tu proposes un écart avec la vigilance publiée, présente-le comme une recommandation admin à vérifier, jamais comme un niveau publié.

Contexte calendrier :
${JSON.stringify(inputData.calendarContext, null, 2)}

Contexte saisonnier :
${JSON.stringify(inputData.seasonalContext, null, 2)}

Totaux nationaux :
${JSON.stringify(inputData.nationalTotals, null, 2)}

Rapport précédent :
${JSON.stringify(inputData.previousReportSummary, null, 2)}

Vigilance publique déterministe publiée :
${JSON.stringify(inputData.publishedVigilanceSummary, null, 2)}

Données départementales :
${JSON.stringify(inputData.departments, null, 2)}
`;
}



async function publishDepartmentSectorVigilanceDaily(date) {
  const snapshot = await db
    .collection('departmentDailyStats')
    .where('date', '==', date)
    .get();

  const sectorDocs = [];

  snapshot.docs.forEach((document) => {
    const dailyData = document.data();

    if (dailyData.lastError) return;

    const departmentCode = dailyData.code || dailyData.departmentCode || String(document.id || '').split('_').pop();
    const departmentName = dailyData.name || dailyData.departmentName || `Département ${departmentCode}`;
    const sectorItems = dailyData?.enrichedDetailSummary?.sectorVigilanceItems || [];

    sectorItems.forEach((sector) => {
      if (!sector || sector.level === 'green') return;

      const doc = {
        date,
        departmentCode,
        departmentName,

        sectorCode: sector.sectorCode,
        sectorLabel: sector.sectorLabel,
        sectorLevel: sector.level,
        icon: sector.icon,
        rawScore: sector.rawScore,
        confidenceScore: sector.confidenceScore,

        publicTitle: `${sector.sectorLabel} à surveiller - ${departmentName}`,
        publicSummary: sector.reason || 'Des signaux de vigilance sont observés dans ce secteur.',
        publicAdvice: sector.publicAdvice || buildSectorPublicAdvice(sector.level),

        romeItems: Array.isArray(sector.romeItems) ? sector.romeItems : [],
        nafItems: Array.isArray(sector.nafItems) ? sector.nafItems : [],

        metrics: sector.metrics || {},

        isPublished: true,
        audience: 'candidate',
        source: 'departmentDailyStats.enrichedDetailSummary',
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 'departmentSectorVigilanceDaily.v1',
      };

      sectorDocs.push(doc);
    });
  });

  const existingSnapshot = await db
    .collection('departmentSectorVigilanceDaily')
    .where('date', '==', date)
    .get();

  const wantedIds = new Set(
    sectorDocs.map((doc) => `${doc.date}_${doc.departmentCode}_${doc.sectorCode}`)
  );

  let batch = db.batch();
  let operationCount = 0;
  let writtenCount = 0;
  let deletedCount = 0;

  async function commitIfNeeded(force = false) {
    if (operationCount === 0) return;

    if (force || operationCount >= 450) {
      await batch.commit();
      batch = db.batch();
      operationCount = 0;
    }
  }

  for (const doc of sectorDocs) {
    const id = `${doc.date}_${doc.departmentCode}_${doc.sectorCode}`;
    batch.set(db.collection('departmentSectorVigilanceDaily').doc(id), doc, { merge: true });
    operationCount += 1;
    writtenCount += 1;
    await commitIfNeeded(false);
  }

  for (const document of existingSnapshot.docs) {
    if (wantedIds.has(document.id)) continue;

    batch.delete(document.ref);
    operationCount += 1;
    deletedCount += 1;
    await commitIfNeeded(false);
  }

  await commitIfNeeded(true);

  await db.collection('apiImports').doc(`sector_vigilance_${date}`).set(
    {
      type: 'daily_department_sector_vigilance_publication',
      date,
      sourceCollection: 'departmentDailyStats',
      targetCollection: 'departmentSectorVigilanceDaily',
      publishedCount: writtenCount,
      deletedStaleCount: deletedCount,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 'daily_department_sector_vigilance_publication.v1',
    },
    { merge: true }
  );

  console.log(
    `Vigilance secteurs ${date}: ${writtenCount} document(s), ${deletedCount} ancien(s) supprimé(s).`
  );

  return sectorDocs;
}


exports.enrichLatestImportOfferDetails = onSchedule(
  {
    schedule: '0 2 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [API_APPRENTISSAGE_TOKEN, BACKFILL_ADMIN_KEY],
  },
  async () => {
    const token = API_APPRENTISSAGE_TOKEN.value();
    const executionDate = parisDateString(new Date());
    const targetDate = getPreviousDateFromDateString(executionDate);

    console.log(`Enrichissement détails offres pour ${targetDate}`);

    const result = await enrichLatestImportOfferDetailsForDate(targetDate, token);

    await publishDepartmentSectorVigilanceDaily(targetDate);
    await publishDepartmentVigilanceDaily(targetDate);
    await publishVigilancePublicIndexLatest(targetDate);

    console.log(
      `Enrichissement détails offres ${targetDate} terminé: ${JSON.stringify(result)}`
    );
  }
);



exports.generateDailyAiReport = onSchedule(
  {
    schedule: '0 6 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [OPENAI_API_KEY],
  },
  async () => {
    const date = marketCommentaryParisDateOffset(-2);

    return marketGenerateCommentaryRange({
      date,
      startPosition: 1,
      endPosition: 101,
      onlyReady: true,
      concurrency: 2,
      write: true,
      label: 'scheduled-06h-market-commentary',
    });
  }
);

exports.backfillOfferDetailsForDate = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [API_APPRENTISSAGE_TOKEN, BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const targetDate = String(request.query.date || '').trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        response.status(400).json({
          ok: false,
          error: 'Parametre date requis au format YYYY-MM-DD',
        });
        return;
      }

      const token = API_APPRENTISSAGE_TOKEN.value();

      const result = await enrichLatestImportOfferDetailsForDate(targetDate, token);

      await publishDepartmentSectorVigilanceDaily(targetDate);
      await publishDepartmentVigilanceDaily(targetDate);
      await publishVigilancePublicIndexLatest(targetDate);

      response.json({
        ok: true,
        date: targetDate,
        result,
        published: true,
      });
    } catch (error) {
      console.error('Erreur backfillOfferDetailsForDate', error);
      response.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }
);

function cleanSiret(value) {
  if (!value) return null;
  const siret = String(value).replace(/\D/g, '');
  return /^\d{14}$/.test(siret) ? siret : null;
}

function cleanNafCode(value) {
  if (!value) return null;
  const naf = String(value)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\./g, '');

  return /^[0-9]{4}[A-Z]$/.test(naf) ? naf : null;
}

function getDepartmentFromPostalCode(postalCode) {
  const cp = String(postalCode || '').replace(/\D/g, '');

  if (cp.length < 5) return null;

  if (cp.startsWith('20')) {
    const value = Number(cp);
    if (value >= 20000 && value <= 20199) return '2A';
    if (value >= 20200 && value <= 20699) return '2B';
    return '20';
  }

  return cp.slice(0, 2);
}

function findFirstValueByKeyRegex(obj, regex) {
  if (!obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findFirstValueByKeyRegex(item, regex);
      if (found !== null && found !== undefined && found !== '') return found;
    }
    return null;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (regex.test(key) && value !== null && value !== undefined && value !== '') {
      return value;
    }

    if (value && typeof value === 'object') {
      const found = findFirstValueByKeyRegex(value, regex);
      if (found !== null && found !== undefined && found !== '') return found;
    }
  }

  return null;
}

function extractOfferIdentityForInsee(detail) {
  const siret =
    cleanSiret(detail.siret) ||
    cleanSiret(detail.establishmentSiret) ||
    cleanSiret(detail.employerSiret) ||
    cleanSiret(detail.recruiterSiret) ||
    cleanSiret(findFirstValueByKeyRegex(detail, /siret/i));

  const nafCode =
    cleanNafCode(detail.nafCode) ||
    cleanNafCode(detail.offerNafCode) ||
    cleanNafCode(detail.establishmentNafCode) ||
    cleanNafCode(detail.activitePrincipaleEtablissement) ||
    cleanNafCode(findFirstValueByKeyRegex(detail, /(naf|ape|activitePrincipale)/i));

  const postalCode =
    detail.postalCode ||
    detail.workplacePostalCode ||
    detail.establishmentPostalCode ||
    findFirstValueByKeyRegex(detail, /(postal|codePostal|zip)/i) ||
    null;

  const city =
    detail.city ||
    detail.workplaceCity ||
    detail.establishmentCity ||
    findFirstValueByKeyRegex(detail, /(city|ville|commune)/i) ||
    null;

  return {
    siret,
    nafCode,
    postalCode: postalCode ? String(postalCode).trim() : null,
    city: city ? String(city).trim() : null,
    departmentCode: getDepartmentFromPostalCode(postalCode),
  };
}

async function fetchInseeEtablissementBySiret(siret, inseeApiKey) {
  const url = `https://api.insee.fr/api-sirene/3.11/siret/${encodeURIComponent(siret)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-INSEE-Api-Key-Integration': inseeApiKey,
    },
  });

  const raw = await response.text();

  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (error) {
    payload = { raw: raw.slice(0, 1000) };
  }

  if (!response.ok) {
    const error = new Error(`INSEE HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function mapInseeEtablissementForCross(payload, siret) {
  const etablissement = payload?.etablissement || {};
  const adresse = etablissement.adresseEtablissement || {};
  const uniteLegale = etablissement.uniteLegale || {};

  const periodes = Array.isArray(etablissement.periodesEtablissement)
    ? etablissement.periodesEtablissement
    : [];

  const currentPeriod =
    periodes.find((periode) => !periode.dateFin) ||
    periodes.find((periode) => !periode.dateFinEtablissement) ||
    periodes[0] ||
    {};

  const postalCode = adresse.codePostalEtablissement || null;

  const nafCode =
    cleanNafCode(currentPeriod.activitePrincipaleEtablissement) ||
    cleanNafCode(etablissement.activitePrincipaleEtablissement) ||
    cleanNafCode(uniteLegale.activitePrincipaleUniteLegale);

  const etatAdministratif =
    currentPeriod.etatAdministratifEtablissement ||
    etablissement.etatAdministratifEtablissement ||
    null;

  return {
    siret,
    siren: siret.slice(0, 9),
    active: etatAdministratif === 'A',
    etatAdministratifEtablissement: etatAdministratif,
    nafCode,
    nafNomenclature:
      currentPeriod.nomenclatureActivitePrincipaleEtablissement ||
      etablissement.nomenclatureActivitePrincipaleEtablissement ||
      null,
    postalCode,
    city: adresse.libelleCommuneEtablissement || null,
    departmentCode: getDepartmentFromPostalCode(postalCode),
    codeCommune: adresse.codeCommuneEtablissement || null,
    denominationUniteLegale: uniteLegale.denominationUniteLegale || null,
    categorieJuridiqueUniteLegale: uniteLegale.categorieJuridiqueUniteLegale || null,
    trancheEffectifsEtablissement: etablissement.trancheEffectifsEtablissement || null,
  };
}

function compareOfferAndInseeForCross(offer, insee) {
  let siretMatchStatus = 'missing_siret';

  if (offer.siret && insee.siret && offer.siret === insee.siret && insee.active) {
    siretMatchStatus = 'matched_active';
  } else if (offer.siret && insee.siret && offer.siret === insee.siret && !insee.active) {
    siretMatchStatus = 'matched_closed';
  } else if (offer.siret && insee.siret && offer.siret !== insee.siret) {
    siretMatchStatus = 'siret_mismatch';
  }

  let nafMatchStatus = 'naf_missing';

  if (offer.nafCode && insee.nafCode && offer.nafCode === insee.nafCode) {
    nafMatchStatus = 'naf_exact_match';
  } else if (offer.nafCode && insee.nafCode && offer.nafCode.slice(0, 2) === insee.nafCode.slice(0, 2)) {
    nafMatchStatus = 'naf_same_division';
  } else if (offer.nafCode && insee.nafCode) {
    nafMatchStatus = 'naf_mismatch';
  } else if (!offer.nafCode && insee.nafCode) {
    nafMatchStatus = 'naf_missing_offer';
  } else if (offer.nafCode && !insee.nafCode) {
    nafMatchStatus = 'naf_missing_insee';
  }

  let geoMatchStatus = 'geo_missing';

  if (offer.departmentCode && insee.departmentCode && offer.departmentCode === insee.departmentCode) {
    geoMatchStatus = 'same_department';
  } else if (offer.departmentCode && insee.departmentCode) {
    geoMatchStatus = 'geo_mismatch';
  } else if (!offer.departmentCode && insee.departmentCode) {
    geoMatchStatus = 'offer_location_missing';
  } else if (offer.departmentCode && !insee.departmentCode) {
    geoMatchStatus = 'insee_location_missing';
  }

  const score =
    (siretMatchStatus === 'matched_active' ? 0.5 : 0) +
    (nafMatchStatus === 'naf_exact_match' ? 0.25 : nafMatchStatus === 'naf_same_division' ? 0.15 : 0) +
    (geoMatchStatus === 'same_department' ? 0.25 : 0);

  return {
    siretMatchStatus,
    nafMatchStatus,
    geoMatchStatus,
    dataConfidenceScore: Number(score.toFixed(2)),
  };
}

const crossOneOfferWithInseeLegacyDisabled = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [INSEE_API_KEY, BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const inseeApiKey = INSEE_API_KEY.value();

      if (!inseeApiKey) {
        response.status(500).json({
          ok: false,
          error: 'Secret INSEE_API_KEY absent ou vide',
        });
        return;
      }

      let offerId = String(request.query.offerId || '').trim();
      let offerSnapshot = null;

      if (offerId) {
        offerSnapshot = await db.collection('jobOfferDetails').doc(offerId).get();
      } else {
        const sample = await db.collection('jobOfferDetails')
          .where('detailFetchStatus', '==', 'ok')
          .limit(20)
          .get();

        offerSnapshot = sample.docs.find((doc) => {
          const identity = extractOfferIdentityForInsee(doc.data());
          return Boolean(identity.siret);
        }) || null;

        offerId = offerSnapshot?.id || '';
      }

      if (!offerSnapshot || !offerSnapshot.exists) {
        response.status(404).json({
          ok: false,
          error: 'Aucune offre jobOfferDetails trouvée',
          offerId: offerId || null,
        });
        return;
      }

      const detail = offerSnapshot.data();
      const offerIdentity = extractOfferIdentityForInsee(detail);

      if (!offerIdentity.siret) {
        response.status(400).json({
          ok: false,
          error: 'Aucun SIRET exploitable trouvé dans cette offre',
          offerId,
          offerIdentity,
          availableTopLevelKeys: Object.keys(detail).sort(),
        });
        return;
      }

      const payload = await fetchInseeEtablissementBySiret(offerIdentity.siret, inseeApiKey);
      const insee = mapInseeEtablissementForCross(payload, offerIdentity.siret);
      const checks = compareOfferAndInseeForCross(offerIdentity, insee);

      const shouldWrite = String(request.query.write || '') === '1';
      const employerOnly = String(request.query.employerOnly || '1') !== '0';

      if (shouldWrite) {
        await db.collection('inseeEstablishments').doc(insee.siret).set(
          {
            ...insee,
            source: 'api-sirene-insee-3.11',
            fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'inseeEstablishments.v1',
          },
          { merge: true }
        );

        await db.collection('jobOfferDetails').doc(offerId).set(
          {
            insee: {
              matched: true,
              siret: insee.siret,
              siren: insee.siren,
              active: insee.active,
              nafCode: insee.nafCode,
              nafNomenclature: insee.nafNomenclature,
              postalCode: insee.postalCode,
              city: insee.city,
              departmentCode: insee.departmentCode,
              codeCommune: insee.codeCommune,
              denominationUniteLegale: insee.denominationUniteLegale,
              categorieJuridiqueUniteLegale: insee.categorieJuridiqueUniteLegale,
              trancheEffectifsEtablissement: insee.trancheEffectifsEtablissement,
              source: 'api-sirene-insee-3.11',
              checkedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            checks: {
              ...checks,
              checkedAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'jobOfferDetails.inseeChecks.v1',
            },
            inseeEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      response.json({
        ok: true,
        write: shouldWrite,
        offerId,
        offer: offerIdentity,
        insee,
        checks,
      });
    } catch (error) {
      console.error('crossOneOfferWithInsee error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
        httpStatus: error.httpStatus || null,
        inseePayload: error.payload || null,
      });
    }
  }
);

const crossBatchOffersWithInseeLegacyDisabled = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [INSEE_API_KEY, BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const inseeApiKey = INSEE_API_KEY.value();

      if (!inseeApiKey) {
        response.status(500).json({
          ok: false,
          error: 'Secret INSEE_API_KEY absent ou vide',
        });
        return;
      }

      const limit = Math.min(Math.max(Number(request.query.limit || 50), 1), 100);
      const scanLimit = Math.min(
        Math.max(Number(request.query.scanLimit || limit * 10), limit),
        1000
      );
      const pauseMs = Math.min(Math.max(Number(request.query.pauseMs || 800), 0), 5000);
      const reset = String(request.query.reset || '') === '1';
      const force = String(request.query.force || '') === '1';
      const forceInsee = String(request.query.forceInsee || '') === '1';

      const stateRef = db.collection('apiImports').doc('insee_offer_cross_batch_state');
      const stateSnapshot = reset ? null : await stateRef.get();
      const state = stateSnapshot?.exists ? stateSnapshot.data() : {};
      const lastDocId = !reset && state?.lastDocId ? state.lastDocId : null;

      let query = db
        .collection('jobOfferDetails')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(scanLimit);

      if (lastDocId) {
        query = query.startAfter(lastDocId);
      }

      const snapshot = await query.get();
      const scannedDocsCount = snapshot.size;
      const newLastDocId = snapshot.docs.length
        ? snapshot.docs[snapshot.docs.length - 1].id
        : lastDocId;

      if (snapshot.empty) {
        await stateRef.set(
          {
            complete: true,
            lastDocId: null,
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'insee_offer_cross_batch_state.v1',
          },
          { merge: true }
        );

        response.json({
          ok: true,
          complete: true,
          scannedDocsCount: 0,
          targetsSiretCount: 0,
          linkedOffersCount: 0,
        });
        return;
      }

      const groupsBySiret = new Map();

      let skippedNotOk = 0;
      let skippedNoSiret = 0;
      let skippedAlreadyEnriched = 0;
      let scannedWithSiret = 0;

      snapshot.docs.forEach((document) => {
        const detail = document.data();

        if (detail.detailFetchStatus !== 'ok') {
          skippedNotOk += 1;
          return;
        }

        if (!force && detail.inseeEnrichedAt) {
          skippedAlreadyEnriched += 1;
          return;
        }

        const identity = extractOfferIdentityForInsee(detail);

        if (!identity.siret) {
          skippedNoSiret += 1;
          return;
        }

        scannedWithSiret += 1;

        if (!groupsBySiret.has(identity.siret)) {
          if (groupsBySiret.size >= limit) return;

          groupsBySiret.set(identity.siret, {
            siret: identity.siret,
            offers: [],
          });
        }

        groupsBySiret.get(identity.siret).offers.push({
          offerId: document.id,
          identity,
        });
      });

      const targets = Array.from(groupsBySiret.values());

      let successSiretCount = 0;
      let errorSiretCount = 0;
      let linkedOffersCount = 0;
      let cacheHitCount = 0;
      let apiCallCount = 0;
      let unmatchedSiretCount = 0;

      const errors = [];

      for (const target of targets) {
        const { siret, offers } = target;

        try {
          const inseeRef = db.collection('inseeEstablishments').doc(siret);
          const existing = await inseeRef.get();

          let insee = null;
          let fromCache = false;

          if (existing.exists && !forceInsee) {
            insee = existing.data();
            fromCache = true;
            cacheHitCount += 1;
          } else {
            try {
              const payload = await fetchInseeEtablissementBySiret(siret, inseeApiKey);
              insee = mapInseeEtablissementForCross(payload, siret);

              await inseeRef.set(
                {
                  ...insee,
                  found: true,
                  source: 'api-sirene-insee-3.11',
                  fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
                  schemaVersion: 'inseeEstablishments.v1',
                },
                { merge: true }
              );

              apiCallCount += 1;
              await sleep(pauseMs);
            } catch (error) {
              apiCallCount += 1;
              errorSiretCount += 1;

              const status = error.httpStatus || null;
              const message = String(error.message || error).slice(0, 500);

              await inseeRef.set(
                {
                  siret,
                  siren: siret.slice(0, 9),
                  found: false,
                  active: false,
                  lastErrorStatus: status,
                  lastErrorMessage: message,
                  source: 'api-sirene-insee-3.11',
                  fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
                  schemaVersion: 'inseeEstablishments.v1',
                },
                { merge: true }
              );

              for (const offer of offers) {
                await db.collection('jobOfferDetails').doc(offer.offerId).set(
                  {
                    insee: {
                      matched: false,
                      siret,
                      siren: siret.slice(0, 9),
                      errorStatus: status,
                      errorMessage: message,
                      source: 'api-sirene-insee-3.11',
                      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                    },
                    checks: {
                      siretMatchStatus: status === 404 ? 'unmatched' : 'insee_error',
                      nafMatchStatus: 'naf_unknown',
                      geoMatchStatus: 'geo_unknown',
                      dataConfidenceScore: 0,
                      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                      schemaVersion: 'jobOfferDetails.inseeChecks.v1',
                    },
                    inseeEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  { merge: true }
                );

                linkedOffersCount += 1;
              }

              errors.push({
                siret,
                status,
                message,
              });

              await sleep(pauseMs);
              continue;
            }
          }

          if (!insee || insee.found === false) {
            unmatchedSiretCount += 1;

            for (const offer of offers) {
              await db.collection('jobOfferDetails').doc(offer.offerId).set(
                {
                  insee: {
                    matched: false,
                    siret,
                    siren: siret.slice(0, 9),
                    source: 'api-sirene-insee-3.11',
                    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  checks: {
                    siretMatchStatus: 'unmatched',
                    nafMatchStatus: 'naf_unknown',
                    geoMatchStatus: 'geo_unknown',
                    dataConfidenceScore: 0,
                    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                    schemaVersion: 'jobOfferDetails.inseeChecks.v1',
                  },
                  inseeEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );

              linkedOffersCount += 1;
            }

            continue;
          }

          for (const offer of offers) {
            const checks = compareOfferAndInseeForCross(offer.identity, insee);

            await db.collection('jobOfferDetails').doc(offer.offerId).set(
              {
                insee: {
                  matched: true,
                  siret: insee.siret,
                  siren: insee.siren,
                  active: insee.active,
                  etatAdministratifEtablissement: insee.etatAdministratifEtablissement || null,
                  nafCode: insee.nafCode || null,
                  nafNomenclature: insee.nafNomenclature || null,
                  postalCode: insee.postalCode || null,
                  city: insee.city || null,
                  departmentCode: insee.departmentCode || null,
                  codeCommune: insee.codeCommune || null,
                  denominationUniteLegale: insee.denominationUniteLegale || null,
                  categorieJuridiqueUniteLegale: insee.categorieJuridiqueUniteLegale || null,
                  trancheEffectifsEtablissement: insee.trancheEffectifsEtablissement || null,
                  source: 'api-sirene-insee-3.11',
                  checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                checks: {
                  ...checks,
                  checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                  schemaVersion: 'jobOfferDetails.inseeChecks.v1',
                },
                inseeEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            linkedOffersCount += 1;
          }

          successSiretCount += 1;

          console.log(
            `INSEE ${fromCache ? 'CACHE' : 'API'} ${siret}: offres=${offers.length}, actif=${insee.active}, dep=${insee.departmentCode}, naf=${insee.nafCode}`
          );
        } catch (error) {
          errorSiretCount += 1;
          errors.push({
            siret,
            status: error.httpStatus || null,
            message: String(error.message || error).slice(0, 500),
          });
        }
      }

      const complete = scannedDocsCount < scanLimit;

      await stateRef.set(
        {
          complete,
          lastDocId: complete ? null : newLastDocId,
          lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
          lastResult: {
            scannedDocsCount,
            scannedWithSiret,
            skippedNotOk,
            skippedNoSiret,
            skippedAlreadyEnriched,
            targetsSiretCount: targets.length,
            successSiretCount,
            errorSiretCount,
            unmatchedSiretCount,
            linkedOffersCount,
            cacheHitCount,
            apiCallCount,
            limit,
            scanLimit,
            pauseMs,
            reset,
            force,
            forceInsee,
          },
          schemaVersion: 'insee_offer_cross_batch_state.v1',
        },
        { merge: true }
      );

      response.json({
        ok: true,
        complete,
        lastDocId: complete ? null : newLastDocId,
        scannedDocsCount,
        scannedWithSiret,
        skippedNotOk,
        skippedNoSiret,
        skippedAlreadyEnriched,
        targetsSiretCount: targets.length,
        successSiretCount,
        errorSiretCount,
        unmatchedSiretCount,
        linkedOffersCount,
        cacheHitCount,
        apiCallCount,
        limit,
        scanLimit,
        pauseMs,
        errors: errors.slice(0, 10),
      });
    } catch (error) {
      console.error('crossBatchOffersWithInsee error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

function getPostalPrefixForDepartment(departmentCode) {
  const code = String(departmentCode || '').trim().toUpperCase();

  if (!code) return null;

  if (code === '2A' || code === '2B') {
    return '20';
  }

  return code;
}

function getSectorFromNafCode(nafCode) {
  const naf = cleanNafCode(nafCode);

  if (!naf) {
    return {
      sectorCode: 'unknown',
      sectorLabel: 'Secteur inconnu',
    };
  }

  const division = Number(naf.slice(0, 2));

  if (division >= 1 && division <= 3) {
    return { sectorCode: 'agriculture', sectorLabel: 'Agriculture / espaces naturels' };
  }

  if (division >= 5 && division <= 9) {
    return { sectorCode: 'industrie', sectorLabel: 'Industrie extractive / énergie' };
  }

  if (division >= 10 && division <= 33) {
    return { sectorCode: 'industrie', sectorLabel: 'Industrie' };
  }

  if (division === 33) {
    return { sectorCode: 'maintenance', sectorLabel: 'Installation / maintenance' };
  }

  if (division >= 41 && division <= 43) {
    return { sectorCode: 'btp', sectorLabel: 'Bâtiment / travaux publics' };
  }

  if (division >= 45 && division <= 47) {
    return { sectorCode: 'commerce_vente', sectorLabel: 'Commerce / vente' };
  }

  if (division >= 49 && division <= 53) {
    return { sectorCode: 'transport_logistique', sectorLabel: 'Transport / logistique' };
  }

  if (division >= 55 && division <= 56) {
    return { sectorCode: 'restauration_tourisme_loisirs', sectorLabel: 'Hôtellerie / restauration / tourisme / loisirs' };
  }

  if (division >= 58 && division <= 63) {
    return { sectorCode: 'communication_media', sectorLabel: 'Communication / médias / numérique' };
  }

  if (division >= 64 && division <= 68) {
    return { sectorCode: 'banque_immobilier', sectorLabel: 'Banque / assurance / immobilier' };
  }

  if (division >= 69 && division <= 82) {
    return { sectorCode: 'support_entreprise', sectorLabel: 'Support administratif / entreprise' };
  }

  if (division === 84 || division === 85 || division === 87 || division === 88 || division >= 94) {
    return { sectorCode: 'services_social', sectorLabel: 'Services / social / collectivité' };
  }

  if (division === 86) {
    return { sectorCode: 'sante', sectorLabel: 'Santé' };
  }

  if (division >= 90 && division <= 93) {
    return { sectorCode: 'spectacle', sectorLabel: 'Spectacle / sport / loisirs' };
  }

  return {
    sectorCode: 'unknown',
    sectorLabel: 'Secteur inconnu',
  };
}

async function fetchInseeDepartmentPage({
  departmentCode,
  cursor,
  nombre,
  inseeApiKey,
  employerOnly = true,
}) {
  const postalPrefix = getPostalPrefixForDepartment(departmentCode);

  if (!postalPrefix) {
    throw new Error('departmentCode invalide');
  }

  const periodQuery = employerOnly
    ? 'periode(etatAdministratifEtablissement:A AND caractereEmployeurEtablissement:O)'
    : 'periode(etatAdministratifEtablissement:A)';

  const query = `${periodQuery} AND codePostalEtablissement:${postalPrefix}*`;

  const url = new URL('https://api.insee.fr/api-sirene/3.11/siret');

  url.searchParams.set('q', query);
  url.searchParams.set('nombre', String(nombre));
  url.searchParams.set('curseur', cursor || '*');
  url.searchParams.set('masquerValeursNulles', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-INSEE-Api-Key-Integration': inseeApiKey,
    },
  });

  const raw = await response.text();

  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (error) {
    payload = { raw: raw.slice(0, 1000) };
  }

  if (!response.ok) {
    const error = new Error(`INSEE HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

const importInseeDepartmentPageLegacyDisabled = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [INSEE_API_KEY, BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const inseeApiKey = INSEE_API_KEY.value();

      if (!inseeApiKey) {
        response.status(500).json({
          ok: false,
          error: 'Secret INSEE_API_KEY absent ou vide',
        });
        return;
      }

      const departmentCode = String(request.query.department || '').trim().toUpperCase();
      const cursor = String(request.query.cursor || '*');
      const nombre = Math.min(Math.max(Number(request.query.nombre || 100), 1), 500);
      const shouldWrite = String(request.query.write || '') === '1';
      const employerOnly = String(request.query.employerOnly || '1') !== '0';

      if (!departmentCode) {
        response.status(400).json({
          ok: false,
          error: 'Paramètre department requis, exemple: ?department=72',
        });
        return;
      }

      const payload = await fetchInseeDepartmentPage({
        departmentCode,
        cursor,
        nombre,
        inseeApiKey,
        employerOnly,
      });

      const etablissements = Array.isArray(payload?.etablissements)
        ? payload.etablissements
        : [];

      const batch = db.batch();

      const nafCounter = {};
      const sectorCounter = {};
      const departmentCounter = {};
      const sample = [];

      for (const etablissement of etablissements) {
        const siret = etablissement?.siret;

        if (!siret) continue;

        const insee = mapInseeEtablissementForCross({ etablissement }, siret);
        const sector = getSectorFromNafCode(insee.nafCode);

        const doc = {
          ...insee,
          found: true,
          sectorCode: sector.sectorCode,
          sectorLabel: sector.sectorLabel,
          importDepartmentCode: departmentCode,
          importEmployerOnly: employerOnly,
          source: 'api-sirene-insee-3.11',
          fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
          schemaVersion: 'inseeEstablishments.v1',
        };

        if (doc.active) {
          const naf = doc.nafCode || 'unknown';
          const dep = doc.departmentCode || 'unknown';
          const sec = doc.sectorCode || 'unknown';

          nafCounter[naf] = (nafCounter[naf] || 0) + 1;
          sectorCounter[sec] = (sectorCounter[sec] || 0) + 1;
          departmentCounter[dep] = (departmentCounter[dep] || 0) + 1;
        }

        if (sample.length < 10) {
          sample.push({
            siret: doc.siret,
            active: doc.active,
            nafCode: doc.nafCode,
            sectorCode: doc.sectorCode,
            postalCode: doc.postalCode,
            city: doc.city,
            departmentCode: doc.departmentCode,
          });
        }

        if (shouldWrite) {
          batch.set(db.collection('inseeEstablishments').doc(siret), doc, { merge: true });
        }
      }

      if (shouldWrite && etablissements.length > 0) {
        await batch.commit();
      }

      const header = payload?.header || {};
      const nextCursor =
        header.curseurSuivant ||
        header.cursorSuivant ||
        header.nextCursor ||
        null;

      const complete =
        !nextCursor ||
        nextCursor === cursor ||
        etablissements.length === 0;

      if (shouldWrite) {
        await db.collection('apiImports').doc(`insee_department_${departmentCode}_latest`).set(
          {
            type: 'insee_department_import_page',
            departmentCode,
            cursor,
            nextCursor,
            complete,
            nombre,
            employerOnly,
            receivedCount: etablissements.length,
            writtenCount: etablissements.length,
            nafCounter,
            sectorCounter,
            departmentCounter,
            header,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'insee_department_import_page.v1',
          },
          { merge: true }
        );
      }

      response.json({
        ok: true,
        write: shouldWrite,
        departmentCode,
        cursor,
        nextCursor,
        complete,
        nombre,
        employerOnly,
        receivedCount: etablissements.length,
        nafCounter,
        sectorCounter,
        departmentCounter,
        sample,
        header,
      });
    } catch (error) {
      console.error('importInseeDepartmentPage error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
        httpStatus: error.httpStatus || null,
        inseePayload: error.payload || null,
      });
    }
  }
);

function getDeepValue(source, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => {
      if (current == null) return null;
      return current[key];
    }, source);

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function extractArrayFromFormationSearchPayload(payload) {
  if (Array.isArray(payload?.formations)) return payload.formations;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;

  return [];
}

function summarizeFormationForPreview(formation) {
  const identifiant = getDeepValue(formation, [
    'identifiant.cle_ministere_educatif',
    'identifiant.id',
    'id',
    'cle_ministere_educatif',
  ]);

  const intitule = getDeepValue(formation, [
    'certification.valeur.intitule.cfd.long',
    'certification.valeur.intitule.cfd.court',
    'certification.valeur.intitule.rncp',
    'intitule',
    'title',
  ]);

  const rncp = getDeepValue(formation, [
    'certification.valeur.identifiant.rncp',
    'rncp',
  ]);

  const romes =
    getDeepValue(formation, [
      'certification.valeur.domaines.rome.rncp',
      'domaines.rome.rncp',
      'romes',
    ]) || [];

  const session = getDeepValue(formation, [
    'session',
    'sessions.0',
  ]);

  const lieuSiret = getDeepValue(formation, [
    'lieu.siret',
    'lieu.etablissement.siret',
    'etablissement.siret',
    'organisme.formateur.organisme.etablissement.siret',
  ]);

  const uai = getDeepValue(formation, [
    'lieu.uai',
    'organisme.formateur.organisme.identifiant.uai',
    'etablissement.uai',
  ]);

  const postalCode = getDeepValue(formation, [
    'lieu.adresse.code_postal',
    'etablissement.adresse.code_postal',
    'adresse.code_postal',
  ]);

  const city = getDeepValue(formation, [
    'lieu.adresse.commune.nom',
    'lieu.adresse.commune',
    'etablissement.adresse.commune.nom',
    'etablissement.adresse.commune',
    'adresse.commune',
  ]);

  const departmentCode = getDeepValue(formation, [
    'lieu.adresse.departement.code',
    'lieu.adresse.departement',
    'etablissement.adresse.departement.code',
    'etablissement.adresse.departement',
    'adresse.departement',
  ]);

  return {
    identifiant,
    statut: getDeepValue(formation, ['statut.catalogue', 'statut']),
    intitule,
    rncp,
    romes: Array.isArray(romes)
      ? romes.slice(0, 8).map((item) => item?.code || item)
      : romes,
    session: session
      ? {
          debut: session.debut || null,
          fin: session.fin || null,
          capacite: session.capacite ?? null,
        }
      : null,
    lieu: {
      siret: lieuSiret,
      uai,
      postalCode,
      city,
      departmentCode,
    },
  };
}

async function fetchLbaFormationSearch({
  token,
  longitude,
  latitude,
  radius,
  romes,
  rncp,
  targetDiplomaLevel,
  page,
  limit,
}) {
  const url = new URL('https://api.apprentissage.beta.gouv.fr/api/formation/v1/search');

  if (longitude != null && latitude != null) {
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('radius', String(radius || 100));
  }

  if (romes) {
    url.searchParams.set('romes', String(romes));
  }

  if (rncp) {
    url.searchParams.set('rncp', String(rncp));
  }

  if (targetDiplomaLevel) {
    url.searchParams.set('target_diploma_level', String(targetDiplomaLevel));
  }

  url.searchParams.set('page', String(page || 1));
  url.searchParams.set('limit', String(limit || 20));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const raw = await response.text();

  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (error) {
    payload = { raw: raw.slice(0, 1000) };
  }

  if (!response.ok) {
    const error = new Error(`LBA formations HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    url: url.toString().replace(token, '[hidden]'),
    payload,
  };
}

exports.previewLbaFormations = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [API_APPRENTISSAGE_TOKEN, BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const token = API_APPRENTISSAGE_TOKEN.value();

      if (!token) {
        response.status(500).json({
          ok: false,
          error: 'Secret API_APPRENTISSAGE_TOKEN absent ou vide',
        });
        return;
      }

      const longitude = request.query.longitude ?? '0.1996';
      const latitude = request.query.latitude ?? '48.0061';
      const radius = Number(request.query.radius || 100);
      const page = Number(request.query.page || 1);
      const limit = Math.min(Math.max(Number(request.query.limit || 20), 1), 50);

      const { url, payload } = await fetchLbaFormationSearch({
        token,
        longitude,
        latitude,
        radius,
        romes: request.query.romes || null,
        rncp: request.query.rncp || null,
        targetDiplomaLevel: request.query.target_diploma_level || null,
        page,
        limit,
      });

      const formations = extractArrayFromFormationSearchPayload(payload);

      response.json({
        ok: true,
        endpoint: '/api/formation/v1/search',
        request: {
          longitude,
          latitude,
          radius,
          page,
          limit,
          romes: request.query.romes || null,
          rncp: request.query.rncp || null,
          target_diploma_level: request.query.target_diploma_level || null,
        },
        payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
        itemsCount: formations.length,
        pagination: payload?.pagination || payload?.meta || null,
        sample: formations.slice(0, 10).map(summarizeFormationForPreview),
        rawFirstItemKeys: formations[0] && typeof formations[0] === 'object'
          ? Object.keys(formations[0])
          : [],
      });
    } catch (error) {
      console.error('previewLbaFormations error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
        httpStatus: error.httpStatus || null,
        lbaPayload: error.payload || null,
      });
    }
  }
);

function makeFirestoreSafeDocId(value) {
  const raw = String(value || '').trim();

  if (!raw) return null;

  return Buffer.from(raw).toString('base64url').slice(0, 900);
}

function normalizeDepartmentCode(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    return value.trim().toUpperCase() || null;
  }

  if (typeof value === 'object') {
    return String(
      value.code_insee ||
      value.code ||
      value.numero ||
      value.id ||
      ''
    ).trim().toUpperCase() || null;
  }

  return null;
}

function normalizeCodeArray(value) {
  if (!value) return [];

  const array = Array.isArray(value) ? value : [value];

  return array
    .map((item) => {
      if (typeof item === 'string') return item.trim().toUpperCase();
      if (item && typeof item === 'object') {
        return String(item.code || item.value || item.id || '').trim().toUpperCase();
      }
      return '';
    })
    .filter(Boolean);
}

function getSectorFromRomeCode(romeCode) {
  const code = String(romeCode || '').trim().toUpperCase();
  const first = code.slice(0, 1);

  if (first === 'A') {
    return { sectorCode: 'agriculture', sectorLabel: 'Agriculture / espaces naturels' };
  }

  if (first === 'B') {
    return { sectorCode: 'spectacle', sectorLabel: 'Spectacle / sport / loisirs' };
  }

  if (first === 'C') {
    return { sectorCode: 'communication_media', sectorLabel: 'Communication / medias / numerique' };
  }

  if (first === 'D') {
    return { sectorCode: 'commerce_vente', sectorLabel: 'Commerce / vente' };
  }

  if (first === 'E') {
    return { sectorCode: 'communication_media', sectorLabel: 'Communication / medias / numerique' };
  }

  if (first === 'F') {
    return { sectorCode: 'btp', sectorLabel: 'Batiment / travaux publics' };
  }

  if (first === 'G') {
    return { sectorCode: 'restauration_tourisme_loisirs', sectorLabel: 'Hotellerie / restauration / tourisme / loisirs' };
  }

  if (first === 'H') {
    return { sectorCode: 'industrie', sectorLabel: 'Industrie' };
  }

  if (first === 'I') {
    return { sectorCode: 'support_entreprise', sectorLabel: 'Support administratif / entreprise' };
  }

  if (first === 'J') {
    return { sectorCode: 'sante', sectorLabel: 'Sante' };
  }

  if (first === 'K') {
    return { sectorCode: 'services_social', sectorLabel: 'Services / social / collectivite' };
  }

  if (first === 'L') {
    return { sectorCode: 'spectacle', sectorLabel: 'Spectacle / sport / loisirs' };
  }

  if (first === 'M') {
    return { sectorCode: 'support_entreprise', sectorLabel: 'Support administratif / entreprise' };
  }

  if (first === 'N') {
    return { sectorCode: 'transport_logistique', sectorLabel: 'Transport / logistique' };
  }

  return { sectorCode: 'unknown', sectorLabel: 'Secteur inconnu' };
}

function getSectorsFromRomeCodes(romeCodes) {
  const seen = new Set();
  const sectors = [];

  for (const romeCode of romeCodes) {
    const sector = getSectorFromRomeCode(romeCode);

    if (!seen.has(sector.sectorCode)) {
      seen.add(sector.sectorCode);
      sectors.push(sector);
    }
  }

  return sectors;
}

function normalizeFormationForImport(formation, importContext) {
  const formationId = getDeepValue(formation, [
    'identifiant.cle_ministere_educatif',
    'identifiant.id',
    'id',
    'cle_ministere_educatif',
  ]);

  const docId = makeFirestoreSafeDocId(formationId);

  const intitule = getDeepValue(formation, [
    'certification.valeur.intitule.cfd.long',
    'certification.valeur.intitule.cfd.court',
    'certification.valeur.intitule.rncp',
    'intitule',
    'title',
  ]);

  const rncp = getDeepValue(formation, [
    'certification.valeur.identifiant.rncp',
    'rncp',
  ]);

  const romeRaw = getDeepValue(formation, [
    'certification.valeur.domaines.rome.rncp',
    'domaines.rome.rncp',
    'romes',
  ]);

  const romeCodes = normalizeCodeArray(romeRaw);
  const sectors = getSectorsFromRomeCodes(romeCodes);
  const primarySector = sectors[0] || { sectorCode: 'unknown', sectorLabel: 'Secteur inconnu' };

  const sessionsRaw = Array.isArray(formation?.sessions)
    ? formation.sessions
    : formation?.session
      ? [formation.session]
      : [];

  const sessions = sessionsRaw.map((session) => {
    const rawCapacity = session?.capacite;
    const capacity =
      rawCapacity === null || rawCapacity === undefined || rawCapacity === ''
        ? null
        : Number(rawCapacity);

    return {
      debut: session?.debut || null,
      fin: session?.fin || null,
      capacite: Number.isFinite(capacity) ? capacity : null,
    };
  });

  const lieuSiret = getDeepValue(formation, [
    'lieu.siret',
    'lieu.etablissement.siret',
    'etablissement.siret',
    'formateur.etablissement.siret',
    'responsable.etablissement.siret',
  ]);

  const uai = getDeepValue(formation, [
    'lieu.uai',
    'etablissement.uai',
    'formateur.identifiant.uai',
    'responsable.identifiant.uai',
  ]);

  const postalCode = getDeepValue(formation, [
    'lieu.adresse.code_postal',
    'etablissement.adresse.code_postal',
    'adresse.code_postal',
  ]);

  const city = getDeepValue(formation, [
    'lieu.adresse.commune.nom',
    'lieu.adresse.commune',
    'etablissement.adresse.commune.nom',
    'etablissement.adresse.commune',
    'adresse.commune',
  ]);

  const departmentValue = getDeepValue(formation, [
    'lieu.adresse.departement',
    'lieu.adresse.departement.code',
    'etablissement.adresse.departement',
    'etablissement.adresse.departement.code',
    'adresse.departement',
  ]);

  const departmentCode = normalizeDepartmentCode(departmentValue);

  return {
    docId,
    data: {
      formationId,
      statut: getDeepValue(formation, ['statut.catalogue', 'statut']) || null,
      intitule: intitule || null,
      rncp: rncp || null,
      romeCodes,
      sectorCode: primarySector.sectorCode,
      sectorLabel: primarySector.sectorLabel,
      sectors,
      sessions,
      primarySession: sessions[0] || null,
      venue: {
        siret: lieuSiret || null,
        uai: uai || null,
        postalCode: postalCode || null,
        city: city || null,
        departmentCode,
      },
      importDepartmentCode: importContext.departmentCode,
      importLatitude: importContext.latitude,
      importLongitude: importContext.longitude,
      importRadius: importContext.radius,
      source: 'api-apprentissage-lba-formation-v1',
      importedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 'formationDetails.v1',
    },
  };
}

async function fetchLbaFormationSearchPage({
  token,
  longitude,
  latitude,
  radius,
  romes,
  rncp,
  targetDiplomaLevel,
  pageIndex,
  pageSize,
}) {
  const url = new URL('https://api.apprentissage.beta.gouv.fr/api/formation/v1/search');

  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('radius', String(radius));

  if (romes) {
    url.searchParams.set('romes', String(romes));
  }

  if (rncp) {
    url.searchParams.set('rncp', String(rncp));
  }

  if (targetDiplomaLevel) {
    url.searchParams.set('target_diploma_level', String(targetDiplomaLevel));
  }

  url.searchParams.set('page_index', String(pageIndex));
  url.searchParams.set('page_size', String(pageSize));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const raw = await response.text();

  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (error) {
    payload = { raw: raw.slice(0, 1000) };
  }

  if (!response.ok) {
    const error = new Error(`LBA formations HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

exports.importLbaFormationsPage = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 300,
    memory: '1GiB',
    secrets: [API_APPRENTISSAGE_TOKEN, BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const token = API_APPRENTISSAGE_TOKEN.value();

      if (!token) {
        response.status(500).json({
          ok: false,
          error: 'Secret API_APPRENTISSAGE_TOKEN absent ou vide',
        });
        return;
      }

      const departmentCode = String(request.query.department || '72').trim().toUpperCase();
      const longitude = request.query.longitude ?? '0.1996';
      const latitude = request.query.latitude ?? '48.0061';
      const radius = Number(request.query.radius || 100);
      const pageIndex = Math.max(Number(request.query.pageIndex ?? request.query.page_index ?? 0), 0);
      const pageSize = Math.min(Math.max(Number(request.query.pageSize ?? request.query.page_size ?? 100), 1), 100);
      const shouldWrite = String(request.query.write || '') === '1';
      const filterDepartment = String(request.query.filterDepartment || '1') !== '0';

      const payload = await fetchLbaFormationSearchPage({
        token,
        longitude,
        latitude,
        radius,
        romes: request.query.romes || null,
        rncp: request.query.rncp || null,
        targetDiplomaLevel: request.query.target_diploma_level || null,
        pageIndex,
        pageSize,
      });

      const formations = extractArrayFromFormationSearchPayload(payload);

      const batch = db.batch();

      let writtenCount = 0;
      let skippedNoId = 0;
      let skippedOutsideDepartment = 0;

      const sectorCounter = {};
      const romeCounter = {};
      const rncpCounter = {};
      const sessionStartCounter = {};
      const sample = [];

      const importContext = {
        departmentCode,
        latitude,
        longitude,
        radius,
      };

      for (const formation of formations) {
        const normalized = normalizeFormationForImport(formation, importContext);

        if (!normalized.docId || !normalized.data.formationId) {
          skippedNoId += 1;
          continue;
        }

        const formationDepartmentCode = normalized.data.venue.departmentCode;

        if (filterDepartment && formationDepartmentCode !== departmentCode) {
          skippedOutsideDepartment += 1;
          continue;
        }

        const sectorCode = normalized.data.sectorCode || 'unknown';

        sectorCounter[sectorCode] = (sectorCounter[sectorCode] || 0) + 1;

        for (const romeCode of normalized.data.romeCodes || []) {
          romeCounter[romeCode] = (romeCounter[romeCode] || 0) + 1;
        }

        if (normalized.data.rncp) {
          rncpCounter[normalized.data.rncp] = (rncpCounter[normalized.data.rncp] || 0) + 1;
        }

        for (const session of normalized.data.sessions || []) {
          const start = session.debut ? String(session.debut).slice(0, 10) : 'unknown';
          sessionStartCounter[start] = (sessionStartCounter[start] || 0) + 1;
        }

        if (sample.length < 10) {
          sample.push({
            formationId: normalized.data.formationId,
            intitule: normalized.data.intitule,
            rncp: normalized.data.rncp,
            romeCodes: normalized.data.romeCodes,
            sectorCode: normalized.data.sectorCode,
            session: normalized.data.primarySession,
            venue: normalized.data.venue,
          });
        }

        if (shouldWrite) {
          batch.set(
            db.collection('formationDetails').doc(normalized.docId),
            normalized.data,
            { merge: true }
          );
        }

        writtenCount += 1;
      }

      if (shouldWrite && writtenCount > 0) {
        await batch.commit();

        await db.collection('apiImports').doc(`lba_formations_${departmentCode}_page_${pageIndex}`).set(
          {
            type: 'lba_formations_import_page',
            departmentCode,
            longitude,
            latitude,
            radius,
            pageIndex,
            pageSize,
            filterDepartment,
            receivedCount: formations.length,
            writtenCount,
            skippedNoId,
            skippedOutsideDepartment,
            pagination: payload?.pagination || null,
            sectorCounter,
            romeCounter,
            rncpCounter,
            sessionStartCounter,
            finishedAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'lba_formations_import_page.v1',
          },
          { merge: true }
        );
      }

      const pagination = payload?.pagination || null;

      response.json({
        ok: true,
        write: shouldWrite,
        departmentCode,
        longitude,
        latitude,
        radius,
        pageIndex,
        pageSize,
        filterDepartment,
        receivedCount: formations.length,
        writtenCount,
        skippedNoId,
        skippedOutsideDepartment,
        pagination,
        sectorCounter,
        sessionStartCounter,
        sample,
      });
    } catch (error) {
      console.error('importLbaFormationsPage error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
        httpStatus: error.httpStatus || null,
        lbaPayload: error.payload || null,
      });
    }
  }
);

function mvNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mvRound(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(mvNumber(value) * factor) / factor;
}

function mvDateMinus(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function mvLevelRank(level) {
  const ranks = {
    'Donnees insuffisantes': -1,
    'Vert': 0,
    'Jaune': 1,
    'Orange': 2,
    'Rouge': 3,
  };

  return ranks[level] ?? -1;
}

function mvSectorFromDocId(id, date, departmentCode) {
  const prefix = `${date}_${departmentCode}_`;

  if (id.startsWith(prefix)) {
    return id.slice(prefix.length);
  }

  const prefix2 = `${departmentCode}_`;

  if (id.startsWith(prefix2)) {
    return id.slice(prefix2.length);
  }

  return null;
}

function mvInferOfferRow(doc, data, wantedDate, wantedDepartmentCode) {
  const id = doc.id;

  const date =
    data.date ||
    data.statDate ||
    data.day ||
    data.snapshotDate ||
    (String(id).match(/\d{4}-\d{2}-\d{2}/) || [null])[0];

  if (date !== wantedDate) return null;

  const departmentCode =
    data.departmentCode ||
    data.department ||
    data.depCode ||
    data.codeDepartement ||
    (String(id).includes(`_${wantedDepartmentCode}_`) ? wantedDepartmentCode : null);

  if (String(departmentCode || '').toUpperCase() !== wantedDepartmentCode) {
    return null;
  }

  const sectorCode =
    data.sectorCode ||
    data.sector ||
    data.sectorKey ||
    data.category ||
    mvSectorFromDocId(String(id), wantedDate, wantedDepartmentCode);

  if (!sectorCode) return null;

  const activeOffersCount = mvNumber(
    data.activeOffersCount ??
    data.offersCount ??
    data.jobsCount ??
    data.activeJobsCount ??
    data.returnedActiveJobsCount ??
    data.returnedJobsCount ??
    data.count ??
    (Array.isArray(data.offerIds) ? data.offerIds.length : undefined)
  );

  const openingsCount = mvNumber(
    data.openingsCount ??
    data.openingCount ??
    data.positionsCount ??
    data.placesCount ??
    data.jobsCount ??
    activeOffersCount
  );

  const recruitersCount = mvNumber(
    data.recruitersCount ??
    data.distinctRecruiterSiretCount ??
    data.distinctCompaniesCount
  );

  return {
    sectorCode,
    activeOffersCount,
    openingsCount,
    recruitersCount,
    sourceDocId: id,
  };
}

async function mvLoadSectorMap(collectionName, departmentCode) {
  const snapshot = await db.collection(collectionName)
    .where('departmentCode', '==', departmentCode)
    .get();

  const map = new Map();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const sectorCode = data.sectorCode || String(doc.id).replace(`${departmentCode}_`, '');

    if (sectorCode) {
      map.set(sectorCode, {
        id: doc.id,
        ...data,
      });
    }
  });

  return map;
}

async function mvLoadOfferMap(date, departmentCode) {
  const output = new Map();
  const collections = [
    'departmentSectorDailyStats',
    'departmentSectorStats',
  ];

  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).get();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const row = mvInferOfferRow(doc, data, date, departmentCode);

      if (!row) return;

      const previous = output.get(row.sectorCode) || {
        activeOffersCount: 0,
        openingsCount: 0,
        recruitersCount: 0,
        sourceCollections: [],
        sourceDocIds: [],
      };

      previous.activeOffersCount += row.activeOffersCount;
      previous.openingsCount += row.openingsCount;
      previous.recruitersCount += row.recruitersCount;
      previous.sourceCollections.push(collectionName);
      previous.sourceDocIds.push(row.sourceDocId);

      output.set(row.sectorCode, previous);
    });
  }

  return output;
}

async function mvLoadPreviousSnapshotMap(date, departmentCode) {
  const snapshot = await db.collection('departmentSectorMarketSnapshots')
    .where('departmentCode', '==', departmentCode)
    .where('date', '==', date)
    .get();

  const map = new Map();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();

    if (data.sectorCode) {
      map.set(data.sectorCode, data);
    }
  });

  return map;
}

function mvComputeRawVigilance({ insee, formation, offers, offerD7 }) {
  const employers = mvNumber(insee.activeEmployerEstablishmentsCount);
  const need = mvNumber(formation.estimatedNeedToSecure);

  const reasons = [];
  const caveats = [];

  if (!offers) {
    return {
      level: 'Donnees insuffisantes',
      score: null,
      reasons: ['Les offres du jour ne sont pas disponibles ou pas encore correctement mappees.'],
      caveats: ['La vigilance finale ne doit pas etre publiee sans donnees offres exploitables.'],
      ratios: {
        offerCoverageRatio: null,
        openingCoverageRatio: null,
        offersPer100Employers: null,
        needPer100Employers: employers > 0 ? mvRound((need / employers) * 100, 2) : null,
      },
    };
  }

  const activeOffers = mvNumber(offers.activeOffersCount);
  const openings = mvNumber(offers.openingsCount);

  let score = 0;

  const offerCoverageRatio = need > 0 ? activeOffers / need : null;
  const openingCoverageRatio = need > 0 ? openings / need : null;
  const offersPer100Employers = employers > 0 ? (activeOffers / employers) * 100 : null;
  const needPer100Employers = employers > 0 ? (need / employers) * 100 : null;

  if (need >= 300) {
    score += 20;
    reasons.push('Pression formation tres elevee.');
  } else if (need >= 150) {
    score += 15;
    reasons.push('Pression formation elevee.');
  } else if (need >= 75) {
    score += 10;
    reasons.push('Pression formation moderee.');
  } else if (need >= 25) {
    score += 5;
    reasons.push('Pression formation presente mais limitee.');
  }

  if (need > 0) {
    if (activeOffers === 0 && need >= 25) {
      score += 65;
      reasons.push('Aucune offre visible malgre un besoin formation estime.');
    } else if (offerCoverageRatio < 0.25) {
      score += 55;
      reasons.push('Les offres visibles couvrent moins de 25 % du besoin estime.');
    } else if (offerCoverageRatio < 0.50) {
      score += 40;
      reasons.push('Les offres visibles couvrent moins de 50 % du besoin estime.');
    } else if (offerCoverageRatio < 0.80) {
      score += 25;
      reasons.push('Les offres visibles couvrent partiellement le besoin estime.');
    } else if (offerCoverageRatio < 1.20) {
      score += 10;
      reasons.push('Les offres visibles couvrent presque le besoin estime.');
    } else {
      reasons.push('Les offres visibles semblent couvrir le besoin estime.');
    }
  }

  const days = formation.nearestSessionDaysBeforeStart;

  if (typeof days === 'number') {
    if (days >= 0 && days <= 15) {
      score += 20;
      reasons.push('Une session proche augmente fortement l urgence.');
    } else if (days > 15 && days <= 30) {
      score += 15;
      reasons.push('Une session demarre prochainement.');
    } else if (days > 30 && days <= 60) {
      score += 10;
      reasons.push('La prochaine session est a surveiller a court terme.');
    } else if (days > 60 && days <= 90) {
      score += 5;
      reasons.push('La prochaine session entre dans la periode d anticipation.');
    } else if (days < 0 && days >= -30) {
      score += 15;
      reasons.push('Une session a recemment demarre, replacement possible.');
    }
  }

  if (employers >= 1000 && activeOffers <= 20 && need >= 100) {
    score += 15;
    reasons.push('Potentiel employeur important mais faible volume d offres visibles.');
  } else if (employers >= 500 && activeOffers <= 10 && need >= 75) {
    score += 10;
    reasons.push('Potentiel employeur significatif mais peu d offres visibles.');
  }

  if (offerD7 && mvNumber(offerD7.activeOffersCount) > 0) {
    const variation = (activeOffers - mvNumber(offerD7.activeOffersCount)) / mvNumber(offerD7.activeOffersCount);

    if (variation <= -0.30) {
      score += 10;
      reasons.push('Les offres visibles sont en forte baisse sur 7 jours.');
    } else if (variation <= -0.15) {
      score += 5;
      reasons.push('Les offres visibles baissent sur 7 jours.');
    } else if (variation >= 0.20) {
      score -= 5;
      reasons.push('Les offres visibles progressent sur 7 jours.');
    }
  }

  if (mvNumber(formation.knownCapacityTotal) === 0 && need > 0) {
    caveats.push('Capacites de session non renseignees, estimation par defaut utilisee.');
  }

  if (employers < 100 && score >= 70) {
    score = 69;
    caveats.push('Niveau plafonne car le potentiel employeur local est faible.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level = 'Vert';

  if (score >= 70) level = 'Rouge';
  else if (score >= 45) level = 'Orange';
  else if (score >= 20) level = 'Jaune';

  return {
    level,
    score,
    reasons,
    caveats,
    ratios: {
      offerCoverageRatio: offerCoverageRatio === null ? null : mvRound(offerCoverageRatio, 3),
      openingCoverageRatio: openingCoverageRatio === null ? null : mvRound(openingCoverageRatio, 3),
      offersPer100Employers: offersPer100Employers === null ? null : mvRound(offersPer100Employers, 2),
      needPer100Employers: needPer100Employers === null ? null : mvRound(needPer100Employers, 2),
    },
  };
}

function mvStabilizeVigilance(raw, previousD1, previousD2) {
  if (raw.level === 'Donnees insuffisantes') {
    return {
      level: raw.level,
      score: raw.score,
      stabilityStatus: 'not_publishable',
      stabilityReason: 'Donnees offres insuffisantes.',
    };
  }

  if (!previousD1?.publishedVigilance?.level) {
    return {
      level: raw.level,
      score: raw.score,
      stabilityStatus: 'initial',
      stabilityReason: 'Premier calcul disponible.',
    };
  }

  const previousLevel = previousD1.publishedVigilance.level;
  const previousScore = mvNumber(previousD1.publishedVigilance.score ?? previousD1.rawVigilance?.score);
  const rawRank = mvLevelRank(raw.level);
  const previousRank = mvLevelRank(previousLevel);

  if (rawRank > previousRank) {
    if (raw.score - previousScore >= 15 || rawRank - previousRank >= 2) {
      return {
        level: raw.level,
        score: raw.score,
        stabilityStatus: 'increased',
        stabilityReason: 'Degradation significative confirmee par l ecart de score.',
      };
    }

    return {
      level: previousLevel,
      score: raw.score,
      stabilityStatus: 'increase_pending',
      stabilityReason: 'Hausse recente a confirmer.',
    };
  }

  if (rawRank < previousRank) {
    const d1RawRank = mvLevelRank(previousD1.rawVigilance?.level);
    const d2RawRank = mvLevelRank(previousD2?.rawVigilance?.level);

    if (d1RawRank <= rawRank && d2RawRank <= rawRank) {
      return {
        level: raw.level,
        score: raw.score,
        stabilityStatus: 'decreased_confirmed',
        stabilityReason: 'Amelioration confirmee sur deux jours.',
      };
    }

    return {
      level: previousLevel,
      score: raw.score,
      stabilityStatus: 'decrease_pending',
      stabilityReason: 'Amelioration a confirmer avant baisse du niveau publie.',
    };
  }

  return {
    level: raw.level,
    score: raw.score,
    stabilityStatus: 'stable',
    stabilityReason: 'Niveau stable.',
  };
}

exports.runMarketVigilanceSnapshot = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const departmentCode = String(request.query.department || '72').trim().toUpperCase();
      const snapshotDate = String(request.query.date || '2026-06-30');

      const d1 = mvDateMinus(snapshotDate, 1);
      const d2 = mvDateMinus(snapshotDate, 2);
      const d7 = mvDateMinus(snapshotDate, 7);

      const inseeMap = await mvLoadSectorMap('inseeDepartmentSectorStats', departmentCode);
      const formationMap = await mvLoadSectorMap('formationDepartmentSectorStats', departmentCode);
      const offerMap = await mvLoadOfferMap(snapshotDate, departmentCode);
      const offerMapD7 = await mvLoadOfferMap(d7, departmentCode);
      const previousD1Map = await mvLoadPreviousSnapshotMap(d1, departmentCode);
      const previousD2Map = await mvLoadPreviousSnapshotMap(d2, departmentCode);

      const allSectorCodes = new Set([
        ...inseeMap.keys(),
        ...formationMap.keys(),
        ...offerMap.keys(),
      ]);

      const rows = [];
      const writes = [];

      for (const sectorCode of allSectorCodes) {
        const insee = inseeMap.get(sectorCode) || {};
        const formation = formationMap.get(sectorCode) || {};
        const offers = offerMap.get(sectorCode) || null;
        const offerD7 = offerMapD7.get(sectorCode) || null;

        const raw = mvComputeRawVigilance({
          insee,
          formation,
          offers,
          offerD7,
        });

        const published = mvStabilizeVigilance(
          raw,
          previousD1Map.get(sectorCode),
          previousD2Map.get(sectorCode)
        );

        const sectorLabel = formation.sectorLabel || insee.sectorLabel || sectorCode;

        const doc = {
          date: snapshotDate,
          departmentCode,
          sectorCode,
          sectorLabel,

          insee: {
            activeEmployerEstablishmentsCount: mvNumber(insee.activeEmployerEstablishmentsCount),
            dataStatus: insee.activeEmployerEstablishmentsCount != null ? 'available' : 'missing',
          },

          formations: {
            formationsCount: mvNumber(formation.formationsCount),
            sessionsCount: mvNumber(formation.sessionsCount),
            upcomingSessionsCount: mvNumber(formation.upcomingSessionsCount),
            recentStartedSessionsCount: mvNumber(formation.recentStartedSessionsCount),
            knownCapacityTotal: mvNumber(formation.knownCapacityTotal),
            estimatedCapacityTotal: mvNumber(formation.estimatedCapacityTotal),
            estimatedNeedToSecure: mvNumber(formation.estimatedNeedToSecure),
            nearestSessionStartDate: formation.nearestSessionStartDate || null,
            nearestSessionDaysBeforeStart: formation.nearestSessionDaysBeforeStart ?? null,
            defaultCapacity: formation.defaultCapacity ?? null,
            dataStatus: formation.estimatedNeedToSecure != null ? 'available' : 'missing',
          },

          offers: {
            activeOffersCount: offers ? mvNumber(offers.activeOffersCount) : null,
            openingsCount: offers ? mvNumber(offers.openingsCount) : null,
            recruitersCount: offers ? mvNumber(offers.recruitersCount) : null,
            activeOffersCountD7: offerD7 ? mvNumber(offerD7.activeOffersCount) : null,
            sourceCollections: offers?.sourceCollections || [],
            sourceDocIds: offers?.sourceDocIds || [],
            dataStatus: offers ? 'available' : 'missing_or_unmatched',
          },

          ratios: raw.ratios,

          rawVigilance: {
            level: raw.level,
            score: raw.score,
            reasons: raw.reasons,
            caveats: raw.caveats,
          },

          publishedVigilance: published,

          computedAt: admin.firestore.FieldValue.serverTimestamp(),
          schemaVersion: 'departmentSectorMarketSnapshots.v2',
        };

        writes.push({
          ref: db.collection('departmentSectorMarketSnapshots').doc(`${snapshotDate}_${departmentCode}_${sectorCode}`),
          data: doc,
        });

        rows.push({
          sectorCode,
          sectorLabel,
          employeurs: doc.insee.activeEmployerEstablishmentsCount,
          besoin: doc.formations.estimatedNeedToSecure,
          offres: doc.offers.activeOffersCount,
          couverture: doc.ratios.offerCoverageRatio,
          brut: doc.rawVigilance.level,
          publie: doc.publishedVigilance.level,
          score: doc.rawVigilance.score,
          dataOffres: doc.offers.dataStatus,
        });
      }

      let batch = db.batch();
      let count = 0;

      for (const write of writes) {
        batch.set(write.ref, write.data, { merge: true });
        count += 1;

        if (count >= 450) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      const significant = rows.filter((row) =>
        mvNumber(row.besoin) >= 25 ||
        mvNumber(row.offres) >= 5 ||
        mvNumber(row.employeurs) >= 100
      );

      const publishable = significant.filter((row) => row.publie !== 'Donnees insuffisantes');

      const globalLevel = publishable.length
        ? publishable.sort((a, b) => mvLevelRank(b.publie) - mvLevelRank(a.publie) || mvNumber(b.score) - mvNumber(a.score))[0].publie
        : 'Donnees insuffisantes';

      const sortedRows = rows.sort((a, b) => mvNumber(b.score) - mvNumber(a.score));

      await db.collection('departmentMarketSnapshots').doc(`${snapshotDate}_${departmentCode}`).set(
        {
          date: snapshotDate,
          departmentCode,
          sectorsCount: rows.length,
          significantSectorsCount: significant.length,
          globalPublishedLevel: globalLevel,
          sectors: sortedRows,
          computedAt: admin.firestore.FieldValue.serverTimestamp(),
          schemaVersion: 'departmentMarketSnapshots.v1',
        },
        { merge: true }
      );

      response.json({
        ok: true,
        date: snapshotDate,
        departmentCode,
        sectorsCount: rows.length,
        significantSectorsCount: significant.length,
        globalPublishedLevel: globalLevel,
        rows: sortedRows,
      });
    } catch (error) {
      console.error('runMarketVigilanceSnapshot error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

async function fetchGeoApiJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  const raw = await response.text();

  let payload = null;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (error) {
    payload = { raw: raw.slice(0, 1000) };
  }

  if (!response.ok) {
    const error = new Error(`Geo API HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function getDepartmentFormationRadiusKm(departmentCode) {
  const code = String(departmentCode || '').toUpperCase();

  if (code === '75') return 50;
  if (code === '92' || code === '93' || code === '94') return 50;
  if (code === '2A' || code === '2B') return 120;
  if (code === '973') return 200;
  if (code === '971' || code === '972' || code === '974' || code === '976') return 120;

  return 100;
}

function extractCommuneCenter(commune) {
  const coordinates = commune?.centre?.coordinates;

  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function findMainCommune(communes) {
  const candidates = Array.isArray(communes)
    ? communes
        .map((commune) => ({
          ...commune,
          population: Number(commune.population || 0),
          center: extractCommuneCenter(commune),
        }))
        .filter((commune) => commune.center)
    : [];

  candidates.sort((a, b) => b.population - a.population);

  return candidates[0] || null;
}

function buildDepartmentDocFromGeoApi({ department, regionMap, communes }) {
  const departmentCode = String(department.code || '').toUpperCase();
  const regionCode = String(department.codeRegion || '');
  const regionName = regionMap.get(regionCode) || null;
  const mainCommune = findMainCommune(communes);
  const radiusKm = getDepartmentFormationRadiusKm(departmentCode);

  const center = mainCommune
    ? {
        latitude: mainCommune.center.latitude,
        longitude: mainCommune.center.longitude,
        source: 'geo.api.gouv.fr_most_populated_commune',
        communeCode: mainCommune.code || null,
        communeName: mainCommune.nom || null,
        communePopulation: mainCommune.population || null,
      }
    : {
        latitude: null,
        longitude: null,
        source: 'missing',
        communeCode: null,
        communeName: null,
        communePopulation: null,
      };

  return {
    departmentCode,
    name: department.nom || null,
    regionCode,
    regionName,

    enabled: true,

    center,

    formationSearch: {
      enabled: Boolean(center.latitude && center.longitude),
      latitude: center.latitude,
      longitude: center.longitude,
      radiusKm,
      filterDepartment: true,
    },

    insee: {
      enabled: true,
      employerOnly: true,
      importFrequency: 'monthly',
    },

    vigilance: {
      enabled: true,
      dailySnapshotEnabled: true,
      latestPublishEnabled: true,
    },

    source: 'geo.api.gouv.fr',
    seededAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'departments.v1',
  };
}

exports.seedDepartmentsFromGeoApi = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const shouldWrite = String(request.query.write || '') === '1';
      const limit = Math.min(Math.max(Number(request.query.limit || 10), 1), 120);
      const offset = Math.max(Number(request.query.offset || 0), 0);
      const onlyCode = request.query.department
        ? String(request.query.department).trim().toUpperCase()
        : null;

      const departmentsUrl = new URL('https://geo.api.gouv.fr/departements');
      departmentsUrl.searchParams.set('fields', 'nom,code,codeRegion');
      departmentsUrl.searchParams.set('format', 'json');

      const regionsUrl = new URL('https://geo.api.gouv.fr/regions');
      regionsUrl.searchParams.set('fields', 'nom,code');
      regionsUrl.searchParams.set('format', 'json');

      const [departmentsPayload, regionsPayload] = await Promise.all([
        fetchGeoApiJson(departmentsUrl.toString()),
        fetchGeoApiJson(regionsUrl.toString()),
      ]);

      const regionMap = new Map();

      if (Array.isArray(regionsPayload)) {
        regionsPayload.forEach((region) => {
          regionMap.set(String(region.code || ''), region.nom || null);
        });
      }

      let departments = Array.isArray(departmentsPayload) ? departmentsPayload : [];

      departments = departments
        .filter((department) => department?.code)
        .sort((a, b) => String(a.code).localeCompare(String(b.code), 'fr'));

      if (onlyCode) {
        departments = departments.filter((department) => String(department.code).toUpperCase() === onlyCode);
      } else {
        departments = departments.slice(offset, offset + limit);
      }

      const rows = [];
      const errors = [];

      let writtenCount = 0;

      const batch = db.batch();

      for (const department of departments) {
        const departmentCode = String(department.code || '').toUpperCase();

        try {
          const communesUrl = new URL(`https://geo.api.gouv.fr/departements/${encodeURIComponent(departmentCode)}/communes`);
          communesUrl.searchParams.set('fields', 'nom,code,population,centre');
          communesUrl.searchParams.set('format', 'json');
          communesUrl.searchParams.set('geometry', 'centre');

          const communesPayload = await fetchGeoApiJson(communesUrl.toString());
          const communes = Array.isArray(communesPayload) ? communesPayload : [];

          const doc = buildDepartmentDocFromGeoApi({
            department,
            regionMap,
            communes,
          });

          rows.push({
            departmentCode: doc.departmentCode,
            name: doc.name,
            regionCode: doc.regionCode,
            regionName: doc.regionName,
            center: doc.center,
            formationSearch: doc.formationSearch,
            communesCount: communes.length,
          });

          if (shouldWrite) {
            batch.set(
              db.collection('departments').doc(doc.departmentCode),
              doc,
              { merge: true }
            );
            writtenCount += 1;
          }
        } catch (error) {
          errors.push({
            departmentCode,
            error: String(error.message || error),
            httpStatus: error.httpStatus || null,
          });
        }
      }

      if (shouldWrite && writtenCount > 0) {
        await batch.commit();
      }

      response.json({
        ok: true,
        write: shouldWrite,
        offset,
        limit,
        requestedDepartment: onlyCode,
        processedCount: rows.length,
        writtenCount,
        errorsCount: errors.length,
        rows,
        errors,
      });
    } catch (error) {
      console.error('seedDepartmentsFromGeoApi error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
        httpStatus: error.httpStatus || null,
        payload: error.payload || null,
      });
    }
  }
);

exports.inspectDepartmentsSeed = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const snapshot = await db.collection('departments').get();

      const rows = snapshot.docs
        .map((doc) => {
          const data = doc.data();

          return {
            id: doc.id,
            departmentCode: data.departmentCode || data.code || doc.id,
            name: data.name || data.nom || null,
            regionCode: data.regionCode || null,
            regionName: data.regionName || null,
            enabled: data.enabled ?? null,
            formationEnabled: data.formationSearch?.enabled ?? null,
            latitude: data.formationSearch?.latitude ?? data.center?.latitude ?? null,
            longitude: data.formationSearch?.longitude ?? data.center?.longitude ?? null,
            radiusKm: data.formationSearch?.radiusKm ?? null,
            communeName: data.center?.communeName ?? null,
          };
        })
        .sort((a, b) => String(a.departmentCode).localeCompare(String(b.departmentCode), 'fr'));

      const missingGeo = rows.filter((row) => !row.latitude || !row.longitude);
      const disabledFormation = rows.filter((row) => row.formationEnabled !== true);

      response.json({
        ok: true,
        count: rows.length,
        missingGeoCount: missingGeo.length,
        disabledFormationCount: disabledFormation.length,
        first: rows.slice(0, 10),
        sarthe: rows.find((row) => row.departmentCode === '72') || null,
        drom: rows.filter((row) => ['971', '972', '973', '974', '976'].includes(row.departmentCode)),
        missingGeo,
        disabledFormation,
      });
    } catch (error) {
      console.error('inspectDepartmentsSeed error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

function bfdsNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bfdsRound(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(bfdsNumber(value) * factor) / factor;
}

function bfdsDaysBetween(dateString, asOfDateString) {
  if (!dateString || !asOfDateString) return null;

  const start = new Date(`${String(dateString).slice(0, 10)}T00:00:00.000Z`);
  const asOf = new Date(`${String(asOfDateString).slice(0, 10)}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(asOf.getTime())) {
    return null;
  }

  return Math.round((start.getTime() - asOf.getTime()) / 86400000);
}

function bfdsTimeCoefficient(daysBeforeStart) {
  if (daysBeforeStart === null || daysBeforeStart === undefined) return 0;

  const days = Number(daysBeforeStart);

  if (!Number.isFinite(days)) return 0;

  if (days > 180) return 0.10;
  if (days > 120) return 0.20;
  if (days > 90) return 0.35;
  if (days > 60) return 0.50;
  if (days > 30) return 0.70;
  if (days > 15) return 0.85;
  if (days >= 0) return 1.00;
  if (days >= -30) return 0.60;
  if (days >= -90) return 0.25;

  return 0;
}

function bfdsEmptySectorStats(departmentCode, sectorCode, sectorLabel, asOfDate, defaultCapacity) {
  return {
    departmentCode,
    sectorCode,
    sectorLabel: sectorLabel || sectorCode,
    asOfDate,
    defaultCapacity,

    formationsCount: 0,
    sessionsCount: 0,
    upcomingSessionsCount: 0,
    recentStartedSessionsCount: 0,

    knownCapacityTotal: 0,
    estimatedDefaultCapacityTotal: 0,
    estimatedCapacityTotal: 0,
    estimatedNeedToSecure: 0,

    nearestSessionStartDate: null,
    nearestSessionDaysBeforeStart: null,
  };
}

function bfdsApplySessionToSectorStats(stats, session, asOfDate, defaultCapacity) {
  const startDate = session?.debut || session?.startDate || session?.dateDebut || null;
  const days = bfdsDaysBetween(startDate, asOfDate);
  const coefficient = bfdsTimeCoefficient(days);

  stats.sessionsCount += 1;

  if (typeof days === 'number') {
    if (days >= 0) {
      stats.upcomingSessionsCount += 1;
    } else if (days >= -90) {
      stats.recentStartedSessionsCount += 1;
    }

    if (
      stats.nearestSessionDaysBeforeStart === null ||
      Math.abs(days) < Math.abs(stats.nearestSessionDaysBeforeStart)
    ) {
      stats.nearestSessionDaysBeforeStart = days;
      stats.nearestSessionStartDate = startDate ? String(startDate).slice(0, 10) : null;
    }
  }

  const rawCapacity = session?.capacite ?? session?.capacity ?? null;
  const capacity = bfdsNumber(rawCapacity, 0);

  let retainedCapacity = 0;

  if (capacity > 0) {
    retainedCapacity = capacity;
    stats.knownCapacityTotal += capacity;
  } else {
    retainedCapacity = defaultCapacity;
    stats.estimatedDefaultCapacityTotal += defaultCapacity;
  }

  if (coefficient > 0) {
    stats.estimatedCapacityTotal += retainedCapacity;
    stats.estimatedNeedToSecure += retainedCapacity * coefficient;
  }
}

exports.buildFormationDepartmentStatsHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const departmentCode = String(request.query.department || '').trim().toUpperCase();
      const asOfDate = String(request.query.date || new Date().toISOString().slice(0, 10));
      const defaultCapacity = Math.max(1, Math.min(50, bfdsNumber(request.query.defaultCapacity, 8)));
      const shouldWrite = String(request.query.write || '1') === '1';

      if (!departmentCode) {
        response.status(400).json({
          ok: false,
          error: 'Missing department',
        });
        return;
      }

      const snapshot = await db.collection('formationDetails')
        .where('importDepartmentCode', '==', departmentCode)
        .get();

      const sectorMap = new Map();
      const seenFormationsBySector = new Map();

      let scannedCount = 0;

      snapshot.docs.forEach((doc) => {
        scannedCount += 1;

        const data = doc.data();
        const sectorCode = data.sectorCode || 'unknown';
        const sectorLabel = data.sectorLabel || sectorCode;
        const formationId = data.formationId || doc.id;

        if (!sectorMap.has(sectorCode)) {
          sectorMap.set(
            sectorCode,
            bfdsEmptySectorStats(departmentCode, sectorCode, sectorLabel, asOfDate, defaultCapacity)
          );
          seenFormationsBySector.set(sectorCode, new Set());
        }

        const stats = sectorMap.get(sectorCode);
        const seen = seenFormationsBySector.get(sectorCode);

        if (!seen.has(formationId)) {
          stats.formationsCount += 1;
          seen.add(formationId);
        }

        const sessions = Array.isArray(data.sessions) ? data.sessions : [];

        sessions.forEach((session) => {
          bfdsApplySessionToSectorStats(stats, session, asOfDate, defaultCapacity);
        });
      });

      const sectors = Array.from(sectorMap.values())
        .map((stats) => ({
          ...stats,
          estimatedCapacityTotal: bfdsRound(stats.estimatedCapacityTotal, 2),
          estimatedDefaultCapacityTotal: bfdsRound(stats.estimatedDefaultCapacityTotal, 2),
          estimatedNeedToSecure: bfdsRound(stats.estimatedNeedToSecure, 2),
        }))
        .sort((a, b) => b.estimatedNeedToSecure - a.estimatedNeedToSecure);

      const totals = sectors.reduce((acc, stats) => {
        acc.formationsCount += stats.formationsCount;
        acc.sessionsCount += stats.sessionsCount;
        acc.upcomingSessionsCount += stats.upcomingSessionsCount;
        acc.recentStartedSessionsCount += stats.recentStartedSessionsCount;
        acc.knownCapacityTotal += stats.knownCapacityTotal;
        acc.estimatedDefaultCapacityTotal += stats.estimatedDefaultCapacityTotal;
        acc.estimatedCapacityTotal += stats.estimatedCapacityTotal;
        acc.estimatedNeedToSecure += stats.estimatedNeedToSecure;
        return acc;
      }, {
        formationsCount: 0,
        sessionsCount: 0,
        upcomingSessionsCount: 0,
        recentStartedSessionsCount: 0,
        knownCapacityTotal: 0,
        estimatedDefaultCapacityTotal: 0,
        estimatedCapacityTotal: 0,
        estimatedNeedToSecure: 0,
      });

      Object.keys(totals).forEach((key) => {
        totals[key] = bfdsRound(totals[key], 2);
      });

      if (shouldWrite) {
        const batch = db.batch();

        sectors.forEach((stats) => {
          batch.set(
            db.collection('formationDepartmentSectorStats').doc(`${departmentCode}_${stats.sectorCode}`),
            {
              ...stats,
              computedAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'formationDepartmentSectorStats.v2',
            },
            { merge: true }
          );
        });

        batch.set(
          db.collection('formationDepartmentStats').doc(departmentCode),
          {
            departmentCode,
            asOfDate,
            defaultCapacity,
            ...totals,
            sectorsCount: sectors.length,
            computedAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'formationDepartmentStats.v2',
          },
          { merge: true }
        );

        await batch.commit();
      }

      response.json({
        ok: true,
        write: shouldWrite,
        departmentCode,
        asOfDate,
        defaultCapacity,
        scannedCount,
        sectorsCount: sectors.length,
        totals,
        topSectors: sectors.slice(0, 15),
      });
    } catch (error) {
      console.error('buildFormationDepartmentStatsHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

exports.inspectNationalFormationStats = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 180,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const departmentsSnapshot = await db.collection('departments').get();
      const statsSnapshot = await db.collection('formationDepartmentStats').get();

      const departments = departmentsSnapshot.docs
        .map((doc) => ({
          id: doc.id,
          departmentCode: doc.data().departmentCode || doc.id,
          name: doc.data().name || null,
          regionCode: doc.data().regionCode || null,
          regionName: doc.data().regionName || null,
          enabled: doc.data().enabled !== false,
        }))
        .sort((a, b) => String(a.departmentCode).localeCompare(String(b.departmentCode), 'fr'));

      const statsMap = new Map();

      statsSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const departmentCode = data.departmentCode || doc.id;

        statsMap.set(departmentCode, {
          id: doc.id,
          departmentCode,
          asOfDate: data.asOfDate || null,
          formationsCount: Number(data.formationsCount || 0),
          sessionsCount: Number(data.sessionsCount || 0),
          upcomingSessionsCount: Number(data.upcomingSessionsCount || 0),
          estimatedNeedToSecure: Number(data.estimatedNeedToSecure || 0),
          sectorsCount: Number(data.sectorsCount || 0),
          defaultCapacity: data.defaultCapacity ?? null,
        });
      });

      const rows = departments.map((department) => {
        const stats = statsMap.get(department.departmentCode) || null;

        return {
          departmentCode: department.departmentCode,
          name: department.name,
          regionCode: department.regionCode,
          regionName: department.regionName,
          enabled: department.enabled,
          hasStats: Boolean(stats),
          asOfDate: stats?.asOfDate || null,
          formationsCount: stats?.formationsCount || 0,
          sessionsCount: stats?.sessionsCount || 0,
          upcomingSessionsCount: stats?.upcomingSessionsCount || 0,
          estimatedNeedToSecure: stats?.estimatedNeedToSecure || 0,
          sectorsCount: stats?.sectorsCount || 0,
          defaultCapacity: stats?.defaultCapacity ?? null,
        };
      });

      const missingStats = rows.filter((row) => row.enabled && !row.hasStats);
      const emptyStats = rows.filter((row) => row.enabled && row.hasStats && row.formationsCount === 0);

      const totals = rows.reduce((acc, row) => {
        if (!row.enabled) return acc;

        acc.formationsCount += row.formationsCount;
        acc.sessionsCount += row.sessionsCount;
        acc.upcomingSessionsCount += row.upcomingSessionsCount;
        acc.estimatedNeedToSecure += row.estimatedNeedToSecure;

        return acc;
      }, {
        formationsCount: 0,
        sessionsCount: 0,
        upcomingSessionsCount: 0,
        estimatedNeedToSecure: 0,
      });

      totals.estimatedNeedToSecure = Math.round(totals.estimatedNeedToSecure * 100) / 100;

      response.json({
        ok: true,
        departmentsCount: departments.length,
        statsCount: statsSnapshot.size,
        enabledDepartmentsCount: departments.filter((department) => department.enabled).length,
        coveredDepartmentsCount: rows.filter((row) => row.enabled && row.hasStats).length,
        missingStatsCount: missingStats.length,
        emptyStatsCount: emptyStats.length,
        totals,
        missingStats,
        emptyStats,
        topNeedDepartments: rows
          .filter((row) => row.hasStats)
          .sort((a, b) => b.estimatedNeedToSecure - a.estimatedNeedToSecure)
          .slice(0, 20),
        lowestNeedDepartments: rows
          .filter((row) => row.hasStats)
          .sort((a, b) => a.estimatedNeedToSecure - b.estimatedNeedToSecure)
          .slice(0, 20),
      });
    } catch (error) {
      console.error('inspectNationalFormationStats error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

function bisNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bisNormalizeCode(value, fallback = 'unknown') {
  const text = String(value || '').trim();

  return text || fallback;
}

function bisEmptySectorStats(departmentCode, sectorCode, sectorLabel) {
  return {
    departmentCode,
    sectorCode,
    sectorLabel: sectorLabel || sectorCode,

    establishmentsCount: 0,
    activeEstablishmentsCount: 0,
    activeEmployerEstablishmentsCount: 0,

    nafCodesCount: 0,
    topCities: {},
    topNafCodes: {},
  };
}

function bisEmptyNafStats(departmentCode, nafCode) {
  return {
    departmentCode,
    nafCode,

    establishmentsCount: 0,
    activeEstablishmentsCount: 0,
    activeEmployerEstablishmentsCount: 0,

    sectorCode: 'unknown',
    sectorLabel: 'Secteur inconnu',
    topCities: {},
  };
}

function bisIncrementMapObject(object, key, increment = 1) {
  const safeKey = bisNormalizeCode(key, 'unknown');
  object[safeKey] = bisNumber(object[safeKey]) + increment;
}

function bisTopEntries(object, limit = 20) {
  return Object.entries(object || {})
    .map(([key, count]) => ({ key, count: bisNumber(count) }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key), 'fr'))
    .slice(0, limit);
}

async function bisLoadInseeDocsForDepartment(departmentCode) {
  const docs = new Map();

  const byImportDepartment = await db.collection('inseeEstablishments')
    .where('importDepartmentCode', '==', departmentCode)
    .get();

  byImportDepartment.docs.forEach((doc) => {
    docs.set(doc.id, doc);
  });

  if (docs.size === 0) {
    const byDepartment = await db.collection('inseeEstablishments')
      .where('departmentCode', '==', departmentCode)
      .get();

    byDepartment.docs.forEach((doc) => {
      docs.set(doc.id, doc);
    });
  }

  return Array.from(docs.values());
}

exports.buildInseeDepartmentStatsHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const departmentCode = String(request.query.department || '').trim().toUpperCase();
      const shouldWrite = String(request.query.write || '1') === '1';

      if (!departmentCode) {
        response.status(400).json({
          ok: false,
          error: 'Missing department',
        });
        return;
      }

      const docs = await bisLoadInseeDocsForDepartment(departmentCode);

      const sectorMap = new Map();
      const nafMap = new Map();

      const totals = {
        establishmentsCount: 0,
        activeEstablishmentsCount: 0,
        activeEmployerEstablishmentsCount: 0,
      };

      for (const doc of docs) {
        const data = doc.data();

        const active = data.active !== false && data.etatAdministratifEtablissement !== 'F';
        const employer = data.importEmployerOnly !== false;

        const sectorCode = bisNormalizeCode(data.sectorCode, 'unknown');
        const sectorLabel = data.sectorLabel || sectorCode;
        const nafCode = bisNormalizeCode(data.nafCode, 'unknown');
        const city = data.city || data.commune || data.codeCommune || 'unknown';

        totals.establishmentsCount += 1;

        if (active) {
          totals.activeEstablishmentsCount += 1;
        }

        if (active && employer) {
          totals.activeEmployerEstablishmentsCount += 1;
        }

        if (!sectorMap.has(sectorCode)) {
          sectorMap.set(
            sectorCode,
            bisEmptySectorStats(departmentCode, sectorCode, sectorLabel)
          );
        }

        const sectorStats = sectorMap.get(sectorCode);

        sectorStats.establishmentsCount += 1;

        if (active) {
          sectorStats.activeEstablishmentsCount += 1;
        }

        if (active && employer) {
          sectorStats.activeEmployerEstablishmentsCount += 1;
        }

        if (active && employer) {
          bisIncrementMapObject(sectorStats.topCities, city);
          bisIncrementMapObject(sectorStats.topNafCodes, nafCode);
        }

        if (!nafMap.has(nafCode)) {
          nafMap.set(
            nafCode,
            {
              ...bisEmptyNafStats(departmentCode, nafCode),
              sectorCode,
              sectorLabel,
            }
          );
        }

        const nafStats = nafMap.get(nafCode);

        nafStats.establishmentsCount += 1;

        if (active) {
          nafStats.activeEstablishmentsCount += 1;
        }

        if (active && employer) {
          nafStats.activeEmployerEstablishmentsCount += 1;
        }

        if (active && employer) {
          bisIncrementMapObject(nafStats.topCities, city);
        }
      }

      const sectors = Array.from(sectorMap.values())
        .map((stats) => ({
          ...stats,
          nafCodesCount: Object.keys(stats.topNafCodes || {}).length,
          topCities: bisTopEntries(stats.topCities, 15),
          topNafCodes: bisTopEntries(stats.topNafCodes, 20),
        }))
        .sort((a, b) =>
          b.activeEmployerEstablishmentsCount - a.activeEmployerEstablishmentsCount ||
          String(a.sectorCode).localeCompare(String(b.sectorCode), 'fr')
        );

      const nafs = Array.from(nafMap.values())
        .map((stats) => ({
          ...stats,
          topCities: bisTopEntries(stats.topCities, 15),
        }))
        .sort((a, b) =>
          b.activeEmployerEstablishmentsCount - a.activeEmployerEstablishmentsCount ||
          String(a.nafCode).localeCompare(String(b.nafCode), 'fr')
        );

      if (shouldWrite) {
        let batch = db.batch();
        let count = 0;

        for (const stats of sectors) {
          batch.set(
            db.collection('inseeDepartmentSectorStats').doc(`${departmentCode}_${stats.sectorCode}`),
            {
              ...stats,
              computedAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'inseeDepartmentSectorStats.v2',
            },
            { merge: true }
          );

          count += 1;

          if (count >= 450) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }
        }

        for (const stats of nafs) {
          batch.set(
            db.collection('inseeDepartmentNafStats').doc(`${departmentCode}_${stats.nafCode}`),
            {
              ...stats,
              computedAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'inseeDepartmentNafStats.v2',
            },
            { merge: true }
          );

          count += 1;

          if (count >= 450) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }
        }

        batch.set(
          db.collection('inseeDepartmentStats').doc(departmentCode),
          {
            departmentCode,
            ...totals,
            sectorsCount: sectors.length,
            nafCodesCount: nafs.length,
            employerOnly: true,
            source: 'inseeEstablishments',
            computedAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'inseeDepartmentStats.v2',
          },
          { merge: true }
        );

        count += 1;

        if (count > 0) {
          await batch.commit();
        }
      }

      response.json({
        ok: true,
        write: shouldWrite,
        departmentCode,
        scannedCount: docs.length,
        totals,
        sectorsCount: sectors.length,
        nafCodesCount: nafs.length,
        topSectors: sectors.slice(0, 15).map((sector) => ({
          sectorCode: sector.sectorCode,
          sectorLabel: sector.sectorLabel,
          activeEmployerEstablishmentsCount: sector.activeEmployerEstablishmentsCount,
          nafCodesCount: sector.nafCodesCount,
          topNafCodes: sector.topNafCodes.slice(0, 5),
        })),
        topNafCodes: nafs.slice(0, 20).map((naf) => ({
          nafCode: naf.nafCode,
          sectorCode: naf.sectorCode,
          sectorLabel: naf.sectorLabel,
          activeEmployerEstablishmentsCount: naf.activeEmployerEstablishmentsCount,
        })),
      });
    } catch (error) {
      console.error('buildInseeDepartmentStatsHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

const bislSectorLabels = {
  agriculture: 'Agriculture / espaces naturels',
  banque_immobilier: 'Banque / assurance / immobilier',
  btp: 'Bâtiment / travaux publics',
  commerce_vente: 'Commerce / vente',
  communication_media: 'Communication / médias / numérique',
  industrie: 'Industrie',
  restauration_tourisme_loisirs: 'Hôtellerie / restauration / tourisme / loisirs',
  sante: 'Santé',
  services_social: 'Services / social / collectivité',
  spectacle: 'Spectacle / sport / loisirs',
  support_entreprise: 'Support administratif / entreprise',
  transport_logistique: 'Transport / logistique',
  unknown: 'Secteur inconnu',
};

async function bislCount(queryRef) {
  const snapshot = await queryRef.count().get();
  return Number(snapshot.data().count || 0);
}

exports.buildInseeDepartmentStatsLightHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const departmentCode = String(request.query.department || '').trim().toUpperCase();
      const shouldWrite = String(request.query.write || '1') === '1';

      if (!departmentCode) {
        response.status(400).json({
          ok: false,
          error: 'Missing department',
        });
        return;
      }

      const collectionRef = db.collection('inseeEstablishments');

      const baseQuery = collectionRef
        .where('importDepartmentCode', '==', departmentCode);

      const activeQuery = baseQuery
        .where('active', '==', true);

      const activeEmployerQuery = activeQuery
        .where('importEmployerOnly', '==', true);

      const establishmentsCount = await bislCount(baseQuery);
      const activeEstablishmentsCount = await bislCount(activeQuery);
      const activeEmployerEstablishmentsCount = await bislCount(activeEmployerQuery);

      const sectorCodes = Object.keys(bislSectorLabels);
      const sectors = [];

      for (const sectorCode of sectorCodes) {
        const sectorBaseQuery = baseQuery.where('sectorCode', '==', sectorCode);
        const sectorActiveQuery = sectorBaseQuery.where('active', '==', true);
        const sectorActiveEmployerQuery = sectorActiveQuery.where('importEmployerOnly', '==', true);

        const sectorStats = {
          departmentCode,
          sectorCode,
          sectorLabel: bislSectorLabels[sectorCode],
          establishmentsCount: await bislCount(sectorBaseQuery),
          activeEstablishmentsCount: await bislCount(sectorActiveQuery),
          activeEmployerEstablishmentsCount: await bislCount(sectorActiveEmployerQuery),
          aggregationMode: 'count_light',
          computedAt: admin.firestore.FieldValue.serverTimestamp(),
          schemaVersion: 'inseeDepartmentSectorStats.v3.light',
        };

        sectors.push(sectorStats);
      }

      sectors.sort((a, b) =>
        b.activeEmployerEstablishmentsCount - a.activeEmployerEstablishmentsCount ||
        String(a.sectorCode).localeCompare(String(b.sectorCode), 'fr')
      );

      if (shouldWrite) {
        let batch = db.batch();
        let count = 0;

        for (const sector of sectors) {
          batch.set(
            db.collection('inseeDepartmentSectorStats').doc(`${departmentCode}_${sector.sectorCode}`),
            sector,
            { merge: true }
          );

          count += 1;

          if (count >= 450) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }
        }

        batch.set(
          db.collection('inseeDepartmentStats').doc(departmentCode),
          {
            departmentCode,
            establishmentsCount,
            activeEstablishmentsCount,
            activeEmployerEstablishmentsCount,
            sectorsCount: sectors.length,
            nafCodesCount: null,
            employerOnly: true,
            aggregationMode: 'count_light',
            source: 'inseeEstablishments',
            computedAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'inseeDepartmentStats.v3.light',
          },
          { merge: true }
        );

        await batch.commit();
      }

      response.json({
        ok: true,
        write: shouldWrite,
        departmentCode,
        aggregationMode: 'count_light',
        scannedCount: establishmentsCount,
        totals: {
          establishmentsCount,
          activeEstablishmentsCount,
          activeEmployerEstablishmentsCount,
        },
        sectorsCount: sectors.length,
        topSectors: sectors.slice(0, 15).map((sector) => ({
          sectorCode: sector.sectorCode,
          sectorLabel: sector.sectorLabel,
          establishmentsCount: sector.establishmentsCount,
          activeEstablishmentsCount: sector.activeEstablishmentsCount,
          activeEmployerEstablishmentsCount: sector.activeEmployerEstablishmentsCount,
        })),
      });
    } catch (error) {
      console.error('buildInseeDepartmentStatsLightHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// MARKET_SNAPSHOT_SCHEDULE_V1
const { onSchedule: marketOnSchedule } = require('firebase-functions/v2/scheduler');

function marketSnapshotParisDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}


function marketSnapshotParisDateOffset(daysOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + Number(daysOffset || 0));

  return marketSnapshotParisDate(date);
}

async function marketSnapshotSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function marketSnapshotMapLimit(items, concurrency, worker) {
  const results = [];
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;

      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (error) {
        results[currentIndex] = {
          ok: false,
          error: String(error.message || error),
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => runWorker()
  );

  await Promise.all(workers);

  return results;
}

async function marketSnapshotLoadDepartments({ startPosition, endPosition, onlyReady }) {
  const [departmentsSnapshot, formationSnapshot, inseeSnapshot] = await Promise.all([
    db.collection('departments').get(),
    db.collection('formationDepartmentStats').get(),
    db.collection('inseeDepartmentStats').get(),
  ]);

  const formationCodes = new Set(
    formationSnapshot.docs.map((document) =>
      String(document.data().departmentCode || document.id || '').trim().toUpperCase()
    )
  );

  const inseeCodes = new Set(
    inseeSnapshot.docs.map((document) =>
      String(document.data().departmentCode || document.id || '').trim().toUpperCase()
    )
  );

  const departments = departmentsSnapshot.docs
    .map((document) => {
      const data = document.data();

      return {
        departmentCode: String(data.departmentCode || document.id || '').trim().toUpperCase(),
        name: data.name || data.nom || document.id,
        enabled: data.enabled !== false,
      };
    })
    .filter((department) => department.departmentCode && department.enabled)
    .sort((a, b) => a.departmentCode.localeCompare(b.departmentCode, 'fr'));

  const selected = departments.slice(startPosition - 1, endPosition);

  return selected.map((department) => {
    const hasFormation = formationCodes.has(department.departmentCode);
    const hasInsee = inseeCodes.has(department.departmentCode);

    return {
      ...department,
      hasFormation,
      hasInsee,
      ready: hasFormation && hasInsee,
      skipped: onlyReady && (!hasFormation || !hasInsee),
    };
  });
}

async function marketRunSnapshotRange({
  date,
  startPosition,
  endPosition,
  onlyReady = true,
  concurrency = 3,
  label = 'manual',
}) {
  const selectedDepartments = await marketSnapshotLoadDepartments({
    startPosition,
    endPosition,
    onlyReady,
  });

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'meteo-apprentissage';
  const endpoint = `https://europe-west1-${projectId}.cloudfunctions.net/runMarketVigilanceSnapshot`;
  const adminKey = BACKFILL_ADMIN_KEY.value();

  if (!adminKey) {
    throw new Error('BACKFILL_ADMIN_KEY empty');
  }

  const toProcess = selectedDepartments.filter((department) => !department.skipped);
  const skipped = selectedDepartments.filter((department) => department.skipped);

  const results = await marketSnapshotMapLimit(toProcess, concurrency, async (department) => {
    const url = new URL(endpoint);
    url.searchParams.set('department', department.departmentCode);
    url.searchParams.set('date', date);

    const startedAt = Date.now();

    const fetchResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-admin-key': adminKey,
      },
    });

    const body = await fetchResponse.text();

    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      parsed = {
        ok: false,
        parseError: String(error.message || error),
        body: body.slice(0, 500),
      };
    }

    await marketSnapshotSleep(100);

    return {
      ok: fetchResponse.ok && parsed?.ok !== false,
      departmentCode: department.departmentCode,
      name: department.name,
      status: fetchResponse.status,
      durationMs: Date.now() - startedAt,
      level:
        parsed?.globalPublishedLevel ||
        parsed?.publishedLevel ||
        parsed?.global?.level ||
        null,
      error: fetchResponse.ok ? parsed?.error || null : body.slice(0, 500),
    };
  });

  const okResults = results.filter((result) => result?.ok);
  const failedResults = results.filter((result) => !result?.ok);

  const summary = {
    ok: failedResults.length === 0,
    label,
    date,
    startPosition,
    endPosition,
    onlyReady,
    concurrency,
    selectedCount: selectedDepartments.length,
    processedCount: toProcess.length,
    skippedCount: skipped.length,
    successCount: okResults.length,
    errorCount: failedResults.length,
    skipped: skipped.map((department) => ({
      departmentCode: department.departmentCode,
      name: department.name,
      hasFormation: department.hasFormation,
      hasInsee: department.hasInsee,
    })),
    errors: failedResults.slice(0, 20),
    results: results.map((result) => ({
      departmentCode: result.departmentCode,
      ok: result.ok,
      status: result.status,
      level: result.level,
      durationMs: result.durationMs,
      error: result.error,
    })),
  };

  console.log('marketRunSnapshotRange summary', JSON.stringify({
    label: summary.label,
    date: summary.date,
    startPosition: summary.startPosition,
    endPosition: summary.endPosition,
    processedCount: summary.processedCount,
    skippedCount: summary.skippedCount,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
  }));

  return summary;
}

exports.runMarketSnapshotsRangeHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const date = String(request.query.date || marketSnapshotParisDate()).trim();
      const startPosition = Math.max(1, Number.parseInt(String(request.query.start || '1'), 10));
      const endPosition = Math.max(startPosition, Number.parseInt(String(request.query.end || '30'), 10));
      const onlyReady = String(request.query.onlyReady || '1') !== '0';
      const concurrency = Math.max(1, Math.min(Number.parseInt(String(request.query.concurrency || '3'), 10), 6));

      const result = await marketRunSnapshotRange({
        date,
        startPosition,
        endPosition,
        onlyReady,
        concurrency,
        label: 'http',
      });

      response.json(result);
    } catch (error) {
      console.error('runMarketSnapshotsRangeHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

exports.runMarketSnapshotsNightBatch01 = marketOnSchedule(
  {
    schedule: '0 1 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async () => {
    return marketRunSnapshotRange({
      date: marketSnapshotParisDateOffset(-2),
      startPosition: 1,
      endPosition: 30,
      onlyReady: true,
      concurrency: 3,
      label: 'scheduled-01h-positions-1-30',
    });
  }
);

exports.runMarketSnapshotsNightBatch02 = marketOnSchedule(
  {
    schedule: '0 2 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async () => {
    return marketRunSnapshotRange({
      date: marketSnapshotParisDateOffset(-2),
      startPosition: 31,
      endPosition: 75,
      onlyReady: true,
      concurrency: 3,
      label: 'scheduled-02h-positions-31-75',
    });
  }
);

exports.runMarketSnapshotsNightBatch03 = marketOnSchedule(
  {
    schedule: '0 3 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async () => {
    return marketRunSnapshotRange({
      date: marketSnapshotParisDateOffset(-2),
      startPosition: 76,
      endPosition: 101,
      onlyReady: true,
      concurrency: 3,
      label: 'scheduled-03h-positions-76-101',
    });
  }
);

// MARKET_COMMENTARY_AI_V1

function marketCommentaryParisDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function marketCommentaryParisDateOffset(daysOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + Number(daysOffset || 0));

  return marketCommentaryParisDate(date);
}

function marketCommentaryNormalizeLevel(value) {
  const raw = String(value || '').trim().toLowerCase();

  if (raw === 'rouge' || raw === 'red') return 'Rouge';
  if (raw === 'orange') return 'Orange';
  if (raw === 'jaune' || raw === 'yellow') return 'Jaune';
  if (raw === 'vert' || raw === 'green') return 'Vert';
  if (raw.includes('insuffisante') || raw.includes('insuffisant')) return 'Données insuffisantes';

  return 'Non calculé';
}

function marketCommentaryNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function marketCommentaryGetSectorLevel(sector) {
  return marketCommentaryNormalizeLevel(
    sector?.publishedVigilance?.level ||
      sector?.rawVigilance?.level ||
      sector?.publishedLevel ||
      sector?.level
  );
}

function marketCommentaryGetSectorPayload(sector) {
  const formations = sector.formations || {};
  const offers = sector.offers || {};
  const insee = sector.insee || {};
  const ratios = sector.ratios || {};

  const need = marketCommentaryNumber(formations.estimatedNeedToSecure);
  const activeOffers = offers.activeOffersCount;
  const employers = marketCommentaryNumber(insee.activeEmployerEstablishmentsCount);

  let offerCoverageRatio = null;

  if (ratios.offerCoverageRatio !== undefined && ratios.offerCoverageRatio !== null) {
    offerCoverageRatio = Number(ratios.offerCoverageRatio);
  } else if (need > 0 && activeOffers !== undefined && activeOffers !== null) {
    offerCoverageRatio = marketCommentaryNumber(activeOffers) / need;
  }

  return {
    sectorCode: sector.sectorCode || 'unknown',
    sectorLabel: sector.sectorLabel || sector.sectorCode || 'Secteur non renseigné',
    level: marketCommentaryGetSectorLevel(sector),
    score: marketCommentaryNumber(
      sector?.publishedVigilance?.score ||
        sector?.rawVigilance?.score
    ),
    formationNeed: need,
    activeOffers:
      activeOffers === undefined || activeOffers === null
        ? null
        : marketCommentaryNumber(activeOffers),
    offerCoverageRatio,
    activeEmployerEstablishmentsCount: employers,
    reasons: Array.isArray(sector?.rawVigilance?.reasons)
      ? sector.rawVigilance.reasons
      : [],
    caveats: Array.isArray(sector?.rawVigilance?.caveats)
      ? sector.rawVigilance.caveats
      : [],
  };
}

function marketCommentaryPublicText(value) {
  let text = String(value || '').trim();

  text = text
    .replace(/\b\d+([,.]\d+)?\s*(%|offres?|employeurs?|établissements?|formations?|sessions?|points?)?\b/gi, 'des données internes')
    .replace(/besoin pondéré/gi, 'pression formation')
    .replace(/score/gi, 'niveau')
    .replace(/ratio/gi, 'indicateur')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}

function marketCommentaryCleanPublic(publicCommentary) {
  const publicBlock = publicCommentary || {};

  return {
    title: marketCommentaryPublicText(publicBlock.title),
    summary: marketCommentaryPublicText(publicBlock.summary),
    formationPressure: marketCommentaryPublicText(publicBlock.formationPressure),
    marketHealth: marketCommentaryPublicText(publicBlock.marketHealth),
    blockedSectors: Array.isArray(publicBlock.blockedSectors)
      ? publicBlock.blockedSectors.map((item) => marketCommentaryPublicText(item)).filter(Boolean).slice(0, 6)
      : [],
    sectorComment: marketCommentaryPublicText(publicBlock.sectorComment),
    advice: marketCommentaryPublicText(publicBlock.advice),
    caution: marketCommentaryPublicText(publicBlock.caution),
  };
}

function marketCommentaryFallback({ departmentSnapshot, sectors }) {
  const level = marketCommentaryNormalizeLevel(
    departmentSnapshot.globalPublishedLevel ||
      departmentSnapshot.publishedLevel ||
      departmentSnapshot.level
  );

  const blocked = sectors
    .filter((sector) => ['Rouge', 'Orange'].includes(sector.level))
    .sort((a, b) => {
      const priority = { Rouge: 0, Orange: 1, Jaune: 2, Vert: 3 };
      return (priority[a.level] ?? 9) - (priority[b.level] ?? 9) || b.formationNeed - a.formationNeed;
    })
    .slice(0, 5);

  const publicBlocked = blocked.map((sector) => sector.sectorLabel);

  const publicTitle =
    level === 'Rouge'
      ? 'Recherche d’apprentissage difficile'
      : level === 'Orange'
        ? 'Situation à surveiller'
        : level === 'Jaune'
          ? 'Signal modéré sur le marché'
          : level === 'Vert'
            ? 'Situation plus favorable'
            : 'Lecture non consolidée';

  const publicSummary =
    level === 'Données insuffisantes' || level === 'Non calculé'
      ? 'La situation ne peut pas être qualifiée de manière fiable avec les données disponibles.'
      : publicBlocked.length > 0
        ? `La situation semble plus difficile dans certains secteurs, notamment ${publicBlocked.join(', ')}.`
        : 'Aucune tension majeure ne ressort dans les secteurs observés.';

  return {
    observatory: {
      title: `Commentaire automatique - ${level}`,
      summary: 'Lecture générée automatiquement à partir du snapshot marché. Vérifier les signaux avant publication.',
      formationReading: 'La pression formation est analysée à partir des formations, sessions et besoins pondérés disponibles.',
      marketHealthReading: 'La santé du marché est analysée à partir des offres visibles et du potentiel employeur local.',
      blockedSectors: blocked.map((sector) => ({
        sectorLabel: sector.sectorLabel,
        level: sector.level,
        reading: 'Secteur prioritaire dans la lecture du snapshot.',
      })),
      healthierSectors: sectors
        .filter((sector) => ['Vert', 'Jaune'].includes(sector.level))
        .slice(0, 3)
        .map((sector) => ({
          sectorLabel: sector.sectorLabel,
          level: sector.level,
          reading: 'Secteur moins tendu dans le snapshot.',
        })),
      caveats: [
        'Commentaire de secours généré sans réponse IA exploitable.',
      ],
      recommendedAction: 'Vérifier les secteurs prioritaires et la disponibilité des offres avant publication.',
    },
    public: {
      title: publicTitle,
      summary: publicSummary,
      formationPressure: 'La période de formation peut renforcer la concurrence entre candidats.',
      marketHealth: 'Le marché local semble plus ou moins favorable selon les secteurs observés.',
      blockedSectors: publicBlocked,
      sectorComment: publicBlocked.length > 0
        ? `Les secteurs les plus difficiles semblent être ${publicBlocked.join(', ')}.`
        : 'Aucun secteur particulièrement difficile ne ressort de manière consolidée.',
      advice: 'Les candidats concernés peuvent élargir leurs recherches vers des secteurs proches, des communes voisines ou des départements limitrophes.',
      caution: 'Cette lecture repose sur les données disponibles et peut évoluer.',
    },
  };
}

function marketCommentaryBuildPromptPayload({ date, departmentSnapshot, sectors }) {
  const level = marketCommentaryNormalizeLevel(
    departmentSnapshot.globalPublishedLevel ||
      departmentSnapshot.publishedLevel ||
      departmentSnapshot.level
  );

  const sortedSectors = sectors
    .slice()
    .sort((a, b) => {
      const priority = {
        Rouge: 0,
        Orange: 1,
        Jaune: 2,
        Vert: 3,
        'Données insuffisantes': 4,
        'Non calculé': 5,
      };

      return (priority[a.level] ?? 9) - (priority[b.level] ?? 9) || b.formationNeed - a.formationNeed;
    });

  return {
    date,
    departmentCode: departmentSnapshot.departmentCode,
    departmentName: departmentSnapshot.departmentName || departmentSnapshot.name || '',
    globalLevel: level,
    globalScore: departmentSnapshot.score || departmentSnapshot.rawScore || null,
    interpretationRules: {
      formationPressure: 'Mesure la pression liée aux formations, sessions proches et besoins pondérés.',
      marketHealth: 'Mesure la capacité du marché local à absorber les recherches, à partir des offres visibles et du potentiel employeur.',
      publicRule: 'Le commentaire public peut citer les secteurs, mais ne doit jamais citer les chiffres, scores, ratios, volumes, seuils ou formules.',
    },
    sectors: sortedSectors.slice(0, 12).map((sector) => ({
      sectorLabel: sector.sectorLabel,
      level: sector.level,
      formationNeed: sector.formationNeed,
      activeOffers: sector.activeOffers,
      offerCoverageRatio: sector.offerCoverageRatio,
      activeEmployerEstablishmentsCount: sector.activeEmployerEstablishmentsCount,
      reasons: sector.reasons,
      caveats: sector.caveats,
    })),
  };
}

function marketCommentaryParseJson(text) {
  const raw = String(text || '').trim();

  try {
    return JSON.parse(raw);
  } catch (error) {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');

    if (first >= 0 && last > first) {
      return JSON.parse(raw.slice(first, last + 1));
    }

    throw error;
  }
}

async function marketCommentaryLoadDepartmentSnapshot(date, departmentCode) {
  const direct = await db
    .collection('departmentMarketSnapshots')
    .doc(`${date}_${departmentCode}`)
    .get();

  if (direct.exists) {
    return {
      id: direct.id,
      ...direct.data(),
    };
  }

  const fallback = await db
    .collection('departmentMarketSnapshots')
    .where('date', '==', date)
    .get();

  const found = fallback.docs.find((document) => {
    const data = document.data();
    return String(data.departmentCode || '').toUpperCase() === departmentCode;
  });

  if (!found) return null;

  return {
    id: found.id,
    ...found.data(),
  };
}

async function marketCommentaryLoadSectorSnapshots(date, departmentCode) {
  const snapshot = await db
    .collection('departmentSectorMarketSnapshots')
    .where('date', '==', date)
    .get();

  return snapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .filter((item) => String(item.departmentCode || '').toUpperCase() === departmentCode)
    .map(marketCommentaryGetSectorPayload);
}

async function marketGenerateCommentaryForDepartment({
  date,
  departmentCode,
  write = true,
  sectorSnapshotsByDepartment = null,
}) {
  const normalizedDepartmentCode = String(departmentCode || '').trim().toUpperCase();

  const departmentSnapshot = await marketCommentaryLoadDepartmentSnapshot(date, normalizedDepartmentCode);

  if (!departmentSnapshot) {
    return {
      ok: false,
      departmentCode: normalizedDepartmentCode,
      error: 'Snapshot département introuvable',
    };
  }

  const sectors = sectorSnapshotsByDepartment
    ? sectorSnapshotsByDepartment[normalizedDepartmentCode] || []
    : await marketCommentaryLoadSectorSnapshots(date, normalizedDepartmentCode);

  const fallback = marketCommentaryFallback({
    departmentSnapshot,
    sectors,
  });

  const payload = marketCommentaryBuildPromptPayload({
    date,
    departmentSnapshot,
    sectors,
  });

  let commentary = fallback;
  let provider = 'fallback';

  try {
    const client = new OpenAI({
      apiKey: OPENAI_API_KEY.value(),
    });

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Tu rédiges deux commentaires distincts pour un observatoire du marché de l’apprentissage.',
            '',
            '1. Commentaire observatoire :',
            '- destiné à un usage interne',
            '- peut mentionner les chiffres fournis',
            '- doit analyser la pression formation, la santé du marché, les secteurs sous tension et les limites',
            '- ton factuel, prudent, professionnel',
            '',
            '2. Commentaire public :',
            '- destiné à des candidats, CFA et acteurs locaux',
            '- peut citer les secteurs en tension par leur nom',
            '- ne doit jamais mentionner les chiffres exacts, scores, ratios, seuils, volumes ou formules',
            '- doit expliquer la tendance avec des mots simples',
            '- doit parler à la fois de pression formation et de santé du marché',
            '- ne doit pas présenter la vigilance comme une vérité officielle',
            '- doit rester prudent si les données sont incomplètes',
            '',
            'Tu ne dois pas inventer de données.',
            'Tu ne dois pas contredire le niveau de vigilance fourni.',
            'Tu dois répondre uniquement en JSON valide.',
            '',
            'Format obligatoire :',
            JSON.stringify({
              observatory: {
                title: '',
                summary: '',
                formationReading: '',
                marketHealthReading: '',
                blockedSectors: [
                  {
                    sectorLabel: '',
                    level: '',
                    reading: '',
                  },
                ],
                healthierSectors: [
                  {
                    sectorLabel: '',
                    level: '',
                    reading: '',
                  },
                ],
                caveats: [],
                recommendedAction: '',
              },
              public: {
                title: '',
                summary: '',
                formationPressure: '',
                marketHealth: '',
                blockedSectors: [],
                sectorComment: '',
                advice: '',
                caution: '',
              },
            }),
          ].join('\\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content || '';
    const parsed = marketCommentaryParseJson(content);

    commentary = {
      observatory: {
        title: String(parsed?.observatory?.title || fallback.observatory.title).trim(),
        summary: String(parsed?.observatory?.summary || fallback.observatory.summary).trim(),
        formationReading: String(parsed?.observatory?.formationReading || fallback.observatory.formationReading).trim(),
        marketHealthReading: String(parsed?.observatory?.marketHealthReading || fallback.observatory.marketHealthReading).trim(),
        blockedSectors: Array.isArray(parsed?.observatory?.blockedSectors)
          ? parsed.observatory.blockedSectors.slice(0, 6)
          : fallback.observatory.blockedSectors,
        healthierSectors: Array.isArray(parsed?.observatory?.healthierSectors)
          ? parsed.observatory.healthierSectors.slice(0, 4)
          : fallback.observatory.healthierSectors,
        caveats: Array.isArray(parsed?.observatory?.caveats)
          ? parsed.observatory.caveats.slice(0, 5)
          : fallback.observatory.caveats,
        recommendedAction: String(parsed?.observatory?.recommendedAction || fallback.observatory.recommendedAction).trim(),
      },
      public: marketCommentaryCleanPublic(parsed?.public || fallback.public),
    };

    provider = 'openai';
  } catch (error) {
    console.error('marketGenerateCommentaryForDepartment fallback', {
      date,
      departmentCode: normalizedDepartmentCode,
      error: String(error.message || error),
    });
  }

  if (write) {
    await db
      .collection('departmentMarketSnapshots')
      .doc(departmentSnapshot.id || `${date}_${normalizedDepartmentCode}`)
      .set(
        {
          commentary,
          commentaryProvider: provider,
          commentaryUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          commentarySchemaVersion: 'marketCommentary.v1',
        },
        { merge: true }
      );
  }

  return {
    ok: true,
    date,
    departmentCode: normalizedDepartmentCode,
    level: payload.globalLevel,
    provider,
    blockedSectors: commentary.public.blockedSectors,
    publicTitle: commentary.public.title,
  };
}

async function marketLoadSectorSnapshotsByDepartment(date) {
  const snapshot = await db
    .collection('departmentSectorMarketSnapshots')
    .where('date', '==', date)
    .get();

  return snapshot.docs.reduce((accumulator, document) => {
    const data = document.data();
    const departmentCode = String(data.departmentCode || '').trim().toUpperCase();

    if (!departmentCode) return accumulator;

    if (!accumulator[departmentCode]) {
      accumulator[departmentCode] = [];
    }

    accumulator[departmentCode].push(marketCommentaryGetSectorPayload({
      id: document.id,
      ...data,
    }));

    return accumulator;
  }, {});
}

async function marketGenerateCommentaryRange({
  date,
  startPosition,
  endPosition,
  onlyReady = true,
  concurrency = 2,
  write = true,
  label = 'manual',
}) {
  const selectedDepartments = await marketSnapshotLoadDepartments({
    startPosition,
    endPosition,
    onlyReady,
  });

  const toProcess = selectedDepartments.filter((department) => !department.skipped);
  const skipped = selectedDepartments.filter((department) => department.skipped);

  const sectorSnapshotsByDepartment = await marketLoadSectorSnapshotsByDepartment(date);

  const results = await marketSnapshotMapLimit(toProcess, concurrency, async (department) => {
    return marketGenerateCommentaryForDepartment({
      date,
      departmentCode: department.departmentCode,
      write,
      sectorSnapshotsByDepartment,
    });
  });

  const successCount = results.filter((result) => result?.ok).length;
  const errorResults = results.filter((result) => !result?.ok);

  const summary = {
    ok: errorResults.length === 0,
    label,
    date,
    startPosition,
    endPosition,
    onlyReady,
    concurrency,
    write,
    selectedCount: selectedDepartments.length,
    processedCount: toProcess.length,
    skippedCount: skipped.length,
    successCount,
    errorCount: errorResults.length,
    skipped: skipped.map((department) => ({
      departmentCode: department.departmentCode,
      name: department.name,
      hasFormation: department.hasFormation,
      hasInsee: department.hasInsee,
    })),
    errors: errorResults.slice(0, 20),
    results,
  };

  console.log('marketGenerateCommentaryRange summary', JSON.stringify({
    label: summary.label,
    date: summary.date,
    startPosition: summary.startPosition,
    endPosition: summary.endPosition,
    processedCount: summary.processedCount,
    skippedCount: summary.skippedCount,
    successCount: summary.successCount,
    errorCount: summary.errorCount,
  }));

  return summary;
}

exports.generateMarketCommentaryHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY, OPENAI_API_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const date = String(request.query.date || marketCommentaryParisDateOffset(-2)).trim();
      const departmentCode = String(request.query.department || '').trim().toUpperCase();
      const write = String(request.query.write || '1') !== '0';

      if (!departmentCode) {
        response.status(400).json({
          ok: false,
          error: 'Missing department',
        });
        return;
      }

      const result = await marketGenerateCommentaryForDepartment({
        date,
        departmentCode,
        write,
      });

      response.json(result);
    } catch (error) {
      console.error('generateMarketCommentaryHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

exports.generateMarketCommentaryRangeHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY, OPENAI_API_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const date = String(request.query.date || marketCommentaryParisDateOffset(-2)).trim();
      const startPosition = Math.max(1, Number.parseInt(String(request.query.start || '1'), 10));
      const endPosition = Math.max(startPosition, Number.parseInt(String(request.query.end || '30'), 10));
      const onlyReady = String(request.query.onlyReady || '1') !== '0';
      const concurrency = Math.max(1, Math.min(Number.parseInt(String(request.query.concurrency || '2'), 10), 4));
      const write = String(request.query.write || '1') !== '0';

      const result = await marketGenerateCommentaryRange({
        date,
        startPosition,
        endPosition,
        onlyReady,
        concurrency,
        write,
        label: 'http-market-commentary-range',
      });

      response.json(result);
    } catch (error) {
      console.error('generateMarketCommentaryRangeHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// INSEE_NATIONAL_BACKGROUND_JOB_V1

const INSEE_BACKGROUND_JOB_COLLECTION = 'adminJobs';
const INSEE_BACKGROUND_JOB_ID = 'inseeNationalBackgroundJob';

function inseeBackgroundParisDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function inseeBackgroundParisDateOffset(daysOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + Number(daysOffset || 0));

  return inseeBackgroundParisDate(date);
}

function inseeBackgroundProjectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'meteo-apprentissage';
}

function inseeBackgroundFunctionUrl(functionName) {
  return `https://europe-west1-${inseeBackgroundProjectId()}.cloudfunctions.net/${functionName}`;
}

function inseeBackgroundNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function inseeBackgroundBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;

  const raw = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'oui', 'on'].includes(raw);
}


function inseeBackgroundSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function inseeBackgroundAdminFetch(functionName, params = {}) {
  const adminKey = BACKFILL_ADMIN_KEY.value();

  if (!adminKey) {
    throw new Error('BACKFILL_ADMIN_KEY empty');
  }

  const url = new URL(inseeBackgroundFunctionUrl(functionName));

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const fetchResponse = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-admin-key': adminKey,
    },
  });

  const body = await fetchResponse.text();

  let parsed = null;

  try {
    parsed = JSON.parse(body);
  } catch (error) {
    parsed = {
      ok: false,
      parseError: String(error.message || error),
      body: body.slice(0, 1000),
    };
  }

  if (!fetchResponse.ok || parsed?.ok === false) {
    throw new Error(JSON.stringify({
      functionName,
      status: fetchResponse.status,
      response: parsed,
    }).slice(0, 3000));
  }

  return parsed;
}

async function inseeBackgroundLoadDepartmentCodes() {
  const snapshot = await db.collection('departments').get();

  return snapshot.docs
    .map((document) => {
      const data = document.data();

      return {
        code: String(data.departmentCode || document.id || '').trim().toUpperCase(),
        name: data.name || data.nom || document.id,
        enabled: data.enabled !== false,
      };
    })
    .filter((department) => department.code && department.enabled)
    .sort((a, b) => a.code.localeCompare(b.code, 'fr'));
}

async function inseeBackgroundAcquireJob(source) {
  const jobRef = db.collection(INSEE_BACKGROUND_JOB_COLLECTION).doc(INSEE_BACKGROUND_JOB_ID);
  const nowMs = Date.now();
  const leaseOwner = `${source}-${nowMs}`;

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);

    if (!snapshot.exists) {
      return {
        acquired: false,
        reason: 'missing_job',
      };
    }

    const job = snapshot.data() || {};

    if (job.status !== 'running') {
      return {
        acquired: false,
        reason: `status_${job.status || 'unknown'}`,
        job,
      };
    }

    const leaseUntilMs = Number(job.leaseUntilMs || 0);

    if (leaseUntilMs > nowMs) {
      return {
        acquired: false,
        reason: 'locked',
        leaseUntilMs,
        job,
      };
    }

    transaction.set(
      jobRef,
      {
        leaseOwner,
        leaseUntilMs: nowMs + 9 * 60 * 1000,
        lastLeaseAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      acquired: true,
      job: {
        ...job,
        leaseOwner,
      },
      leaseOwner,
    };
  });
}

async function inseeBackgroundUpdateJob(update) {
  await db
    .collection(INSEE_BACKGROUND_JOB_COLLECTION)
    .doc(INSEE_BACKGROUND_JOB_ID)
    .set(
      {
        ...update,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

async function inseeBackgroundDepartmentHasStats(departmentCode) {
  const snapshot = await db.collection('inseeDepartmentStats').doc(departmentCode).get();

  if (!snapshot.exists) return false;

  const data = snapshot.data() || {};
  return Number(data.activeEmployerEstablishmentsCount || 0) > 0;
}

async function inseeBackgroundPostDepartment({ job, departmentCode }) {
  const actions = [];

  const stats = await inseeBackgroundAdminFetch('buildInseeDepartmentStatsLightHttp', {
    department: departmentCode,
    write: 1,
  });

  actions.push({
    action: 'buildInseeDepartmentStatsLightHttp',
    ok: true,
    activeEmployerEstablishmentsCount:
      stats?.totals?.activeEmployerEstablishmentsCount ??
      stats?.activeEmployerEstablishmentsCount ??
      null,
  });

  if (job.runSnapshots) {
    const snapshotDate = job.snapshotDate || inseeBackgroundParisDateOffset(-2);

    const snapshot = await inseeBackgroundAdminFetch('runMarketVigilanceSnapshot', {
      department: departmentCode,
      date: snapshotDate,
    });

    actions.push({
      action: 'runMarketVigilanceSnapshot',
      ok: true,
      date: snapshotDate,
      level:
        snapshot?.globalPublishedLevel ||
        snapshot?.publishedLevel ||
        snapshot?.global?.level ||
        null,
    });
  }

  if (job.runCommentary) {
    const snapshotDate = job.snapshotDate || inseeBackgroundParisDateOffset(-2);

    const commentary = await inseeBackgroundAdminFetch('generateMarketCommentaryHttp', {
      department: departmentCode,
      date: snapshotDate,
      write: 1,
    });

    actions.push({
      action: 'generateMarketCommentaryHttp',
      ok: true,
      date: snapshotDate,
      provider: commentary?.provider || null,
      publicTitle: commentary?.publicTitle || null,
    });
  }

  return actions;
}

async function inseeBackgroundRunOnce({ source = 'manual' } = {}) {
  const acquired = await inseeBackgroundAcquireJob(source);

  if (!acquired.acquired) {
    return {
      ok: true,
      skipped: true,
      reason: acquired.reason,
      leaseUntilMs: acquired.leaseUntilMs || null,
    };
  }

  const job = acquired.job;
  const departments = await inseeBackgroundLoadDepartmentCodes();

  const startPosition = Math.max(1, inseeBackgroundNumber(job.startPosition, 1));
  const endPosition = Math.min(
    departments.length,
    Math.max(startPosition, inseeBackgroundNumber(job.endPosition, departments.length))
  );

  let currentPosition = Math.max(
    startPosition,
    inseeBackgroundNumber(job.currentPosition, startPosition)
  );

  let cursor = String(job.cursor || '');
  let currentDepartmentPages = inseeBackgroundNumber(job.currentDepartmentPages, 0);
  let currentDepartmentReceived = inseeBackgroundNumber(job.currentDepartmentReceived, 0);

  const nombre = Math.max(100, Math.min(inseeBackgroundNumber(job.nombre, 500), 500));
  const pagesPerRun = Math.max(1, Math.min(inseeBackgroundNumber(job.pagesPerRun, 18), 60));
  const delayMsBetweenPages = Math.max(0, Math.min(inseeBackgroundNumber(job.delayMsBetweenPages, 3000), 15000));
  const maxMsPerRun = Math.max(60000, Math.min(inseeBackgroundNumber(job.maxMsPerRun, 480000), 520000));
  const skipExistingStats = job.skipExistingStats !== false;

  const startedAtMs = Date.now();
  let pagesThisRun = 0;
  let receivedThisRun = 0;
  const events = [];

  try {
    while (
      currentPosition <= endPosition &&
      pagesThisRun < pagesPerRun &&
      Date.now() - startedAtMs < maxMsPerRun
    ) {
      const department = departments[currentPosition - 1];

      if (!department?.code) {
        events.push({
          type: 'skip_missing_department',
          position: currentPosition,
        });

        currentPosition += 1;
        cursor = '';
        currentDepartmentPages = 0;
        currentDepartmentReceived = 0;
        continue;
      }

      const departmentCode = department.code;

      await inseeBackgroundUpdateJob({
        currentPosition,
        currentDepartmentCode: departmentCode,
        currentDepartmentName: department.name,
        cursor,
        currentDepartmentPages,
        currentDepartmentReceived,
        lastHeartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (!cursor && skipExistingStats) {
        const alreadyAggregated = await inseeBackgroundDepartmentHasStats(departmentCode);

        if (alreadyAggregated) {
          let postActions = [];

          if (job.runSnapshots || job.runCommentary) {
            postActions = await inseeBackgroundPostDepartment({
              job,
              departmentCode,
            });
          }

          events.push({
            type: 'skip_existing_stats',
            position: currentPosition,
            departmentCode,
            actions: postActions,
          });

          currentPosition += 1;
          cursor = '';
          currentDepartmentPages = 0;
          currentDepartmentReceived = 0;

          await inseeBackgroundUpdateJob({
            currentPosition,
            cursor,
            currentDepartmentPages,
            currentDepartmentReceived,
            lastCompletedDepartmentCode: departmentCode,
            lastEvent: events[events.length - 1],
          });

          continue;
        }
      }

      const page = await inseeBackgroundAdminFetch('importInseeDepartmentPage', {
        department: departmentCode,
        nombre,
        employerOnly: 1,
        write: 1,
        cursor,
      });

      pagesThisRun += 1;
      currentDepartmentPages += 1;

      const receivedCount = inseeBackgroundNumber(page.receivedCount, 0);
      receivedThisRun += receivedCount;
      currentDepartmentReceived += receivedCount;

      cursor = String(page.nextCursor || '');

      const pageEvent = {
        type: 'import_page',
        position: currentPosition,
        departmentCode,
        page: currentDepartmentPages,
        receivedCount,
        complete: Boolean(page.complete),
      };

      events.push(pageEvent);

      await inseeBackgroundUpdateJob({
        currentPosition,
        currentDepartmentCode: departmentCode,
        currentDepartmentName: department.name,
        cursor,
        currentDepartmentPages,
        currentDepartmentReceived,
        totalPages: admin.firestore.FieldValue.increment(1),
        totalReceived: admin.firestore.FieldValue.increment(receivedCount),
        lastEvent: pageEvent,
        lastHeartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (!page.complete && delayMsBetweenPages > 0) {
        await inseeBackgroundSleep(delayMsBetweenPages);
      }

      if (page.complete) {
        const postActions = await inseeBackgroundPostDepartment({
          job,
          departmentCode,
        });

        const completeEvent = {
          type: 'department_complete',
          position: currentPosition,
          departmentCode,
          pages: currentDepartmentPages,
          received: currentDepartmentReceived,
          actions: postActions,
        };

        events.push(completeEvent);

        currentPosition += 1;
        cursor = '';
        currentDepartmentPages = 0;
        currentDepartmentReceived = 0;

        await inseeBackgroundUpdateJob({
          currentPosition,
          cursor,
          currentDepartmentPages,
          currentDepartmentReceived,
          completedDepartmentsCount: admin.firestore.FieldValue.increment(1),
          lastCompletedDepartmentCode: departmentCode,
          lastEvent: completeEvent,
          lastHeartbeatAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    const done = currentPosition > endPosition;

    await inseeBackgroundUpdateJob({
      status: done ? 'done' : 'running',
      currentPosition,
      cursor,
      currentDepartmentPages,
      currentDepartmentReceived,
      leaseUntilMs: 0,
      leaseOwner: null,
      lastRunSource: source,
      lastRunPages: pagesThisRun,
      lastRunReceived: receivedThisRun,
      lastRunDurationMs: Date.now() - startedAtMs,
      finishedAt: done ? admin.firestore.FieldValue.serverTimestamp() : null,
    });

    return {
      ok: true,
      status: done ? 'done' : 'running',
      source,
      startPosition,
      endPosition,
      currentPosition,
      pagesThisRun,
      receivedThisRun,
      durationMs: Date.now() - startedAtMs,
      events: events.slice(-20),
    };
  } catch (error) {
    const errorMessage = String(error.message || error);
    const retryableRateLimit =
      errorMessage.includes('INSEE HTTP 429') ||
      errorMessage.includes('httpStatus\\":429') ||
      errorMessage.includes('Rate limit exceeded');

    await inseeBackgroundUpdateJob({
      status: retryableRateLimit ? 'running' : 'error',
      leaseUntilMs: 0,
      leaseOwner: null,
      errorMessage,
      retryableRateLimit,
      errorAt: admin.firestore.FieldValue.serverTimestamp(),
      lastRunSource: source,
      lastRunPages: pagesThisRun,
      lastRunReceived: receivedThisRun,
      lastRunDurationMs: Date.now() - startedAtMs,
      lastEvents: events.slice(-20),
    });

    console.error('inseeBackgroundRunOnce error', error);

    return {
      ok: false,
      status: retryableRateLimit ? 'running' : 'error',
      retryableRateLimit,
      source,
      error: errorMessage,
      currentPosition,
      pagesThisRun,
      receivedThisRun,
      events: events.slice(-20),
    };
  }
}

exports.startInseeNationalBackgroundJobHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const departments = await inseeBackgroundLoadDepartmentCodes();

      const startPosition = Math.max(1, inseeBackgroundNumber(request.query.start, 1));
      const endPosition = Math.min(
        departments.length,
        Math.max(startPosition, inseeBackgroundNumber(request.query.end, departments.length))
      );

      const pagesPerRun = Math.max(1, Math.min(inseeBackgroundNumber(request.query.pagesPerRun, 18), 60));
      const delayMsBetweenPages = Math.max(0, Math.min(inseeBackgroundNumber(request.query.delayMsBetweenPages, 3000), 15000));
      const nombre = Math.max(100, Math.min(inseeBackgroundNumber(request.query.nombre, 500), 500));
      const runSnapshots = inseeBackgroundBool(request.query.snapshots, true);
      const runCommentary = inseeBackgroundBool(request.query.commentary, false);
      const snapshotDate = String(request.query.snapshotDate || inseeBackgroundParisDateOffset(-2)).trim();
      const skipExistingStats = request.query.skipExistingStats === undefined
        ? true
        : inseeBackgroundBool(request.query.skipExistingStats, true);

      const selected = departments.slice(startPosition - 1, endPosition);

      await db
        .collection(INSEE_BACKGROUND_JOB_COLLECTION)
        .doc(INSEE_BACKGROUND_JOB_ID)
        .set(
          {
            status: 'running',
            startPosition,
            endPosition,
            currentPosition: startPosition,
            cursor: '',
            currentDepartmentPages: 0,
            currentDepartmentReceived: 0,
            nombre,
            pagesPerRun,
            delayMsBetweenPages,
            maxMsPerRun: 480000,
            runSnapshots,
            runCommentary,
            snapshotDate,
            skipExistingStats,
            totalPages: 0,
            totalReceived: 0,
            completedDepartmentsCount: 0,
            selectedDepartmentCodes: selected.map((department) => department.code),
            leaseUntilMs: 0,
            leaseOwner: null,
            errorMessage: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: false }
        );

      response.json({
        ok: true,
        status: 'running',
        startPosition,
        endPosition,
        selectedCount: selected.length,
        selectedDepartmentCodes: selected.map((department) => department.code),
        pagesPerRun,
        delayMsBetweenPages,
        nombre,
        runSnapshots,
        runCommentary,
        snapshotDate,
        skipExistingStats,
        schedule: '*/5 * * * * Europe/Paris',
      });
    } catch (error) {
      console.error('startInseeNationalBackgroundJobHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

exports.runInseeNationalBackgroundJobOnceHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const result = await inseeBackgroundRunOnce({
        source: 'http',
      });

      response.json(result);
    } catch (error) {
      console.error('runInseeNationalBackgroundJobOnceHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

exports.resumeInseeNationalBackgroundJob = onSchedule(
  {
    schedule: '*/5 * * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async () => {
    return inseeBackgroundRunOnce({
      source: 'schedule-5min',
    });
  }
);

exports.getInseeNationalBackgroundJobStatusHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const snapshot = await db
        .collection(INSEE_BACKGROUND_JOB_COLLECTION)
        .doc(INSEE_BACKGROUND_JOB_ID)
        .get();

      response.json({
        ok: true,
        exists: snapshot.exists,
        job: snapshot.exists ? snapshot.data() : null,
      });
    } catch (error) {
      console.error('getInseeNationalBackgroundJobStatusHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

exports.pauseInseeNationalBackgroundJobHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      await db
        .collection(INSEE_BACKGROUND_JOB_COLLECTION)
        .doc(INSEE_BACKGROUND_JOB_ID)
        .set(
          {
            status: 'paused',
            leaseUntilMs: 0,
            leaseOwner: null,
            pausedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      response.json({
        ok: true,
        status: 'paused',
      });
    } catch (error) {
      console.error('pauseInseeNationalBackgroundJobHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

exports.resumeInseeNationalBackgroundJobHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const update = {
        status: 'running',
        leaseUntilMs: 0,
        leaseOwner: null,
        errorMessage: null,
        retryableRateLimit: null,
        resumedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (request.query.pagesPerRun !== undefined) {
        update.pagesPerRun = Math.max(1, Math.min(inseeBackgroundNumber(request.query.pagesPerRun, 18), 60));
      }

      if (request.query.delayMsBetweenPages !== undefined) {
        update.delayMsBetweenPages = Math.max(0, Math.min(inseeBackgroundNumber(request.query.delayMsBetweenPages, 3000), 15000));
      }

      if (request.query.maxMsPerRun !== undefined) {
        update.maxMsPerRun = Math.max(60000, Math.min(inseeBackgroundNumber(request.query.maxMsPerRun, 480000), 520000));
      }

      await db
        .collection(INSEE_BACKGROUND_JOB_COLLECTION)
        .doc(INSEE_BACKGROUND_JOB_ID)
        .set(update, { merge: true });

      response.json({
        ok: true,
        status: 'running',
        update,
      });
    } catch (error) {
      console.error('resumeInseeNationalBackgroundJobHttp error', error);
      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// LBA_RAW_OFFERS_CAPTURE_V1

const LBA_JOB_SEARCH_URL = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/search';
const LBA_JOB_DETAIL_URL = 'https://api.apprentissage.beta.gouv.fr/api/job/v1/offer';

function lbaRawNormalizeDepartmentCode(value) {
  const raw = String(value || '').trim().toUpperCase();

  if (!raw) return '';
  if (raw === '2A' || raw === '2B') return raw;
  if (/^\d$/.test(raw)) return `0${raw}`;

  return raw;
}

function lbaRawExtractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.offers)) return payload.offers;
  if (Array.isArray(payload?.jobOffers)) return payload.jobOffers;

  return [];
}

function lbaRawValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return null;
}

function lbaRawString(...values) {
  const value = lbaRawValue(...values);
  return value === null ? '' : String(value).trim();
}


function lbaRawArrayFirst(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }

  return value;
}

function lbaRawExtractPostalCodeFromAddress(address) {
  const raw = String(address || '');
  const match = raw.match(/\b(0[1-9]|[1-8][0-9]|9[0-8]|2A|2B|97[1-6])\d{3}\b/i);

  return match ? match[0].toUpperCase() : '';
}

function lbaRawExtractCityFromAddress(address) {
  const raw = String(address || '').trim();
  const postalCode = lbaRawExtractPostalCodeFromAddress(raw);

  if (!postalCode) return '';

  const index = raw.indexOf(postalCode);

  if (index === -1) return '';

  return raw
    .slice(index + postalCode.length)
    .trim()
    .replace(/\s+/g, ' ');
}

function lbaRawGetAddress(item) {
  return lbaRawString(
    item.address,
    item?.workplace?.location?.address,
    item?.location?.address,
    item?.place?.address
  );
}


function lbaRawGetOfferId(item) {
  return lbaRawString(
    item.id,
    item.offerId,
    item.jobId,
    item._id,
    item.ideaType,
    item?.identifier?.id,
    item?.identifier?.partner_job_id,
    item?.job?.id,
    item?.offer?.id
  );
}

function lbaRawGetRomeCode(item) {
  return lbaRawString(
    item.romeCode,
    item.rome_code,
    item.rome,
    lbaRawArrayFirst(item?.offer?.rome_codes),
    item?.job?.romeCode,
    item?.job?.rome_code,
    item?.job?.rome,
    item?.offer?.romeCode,
    item?.offer?.rome_code,
    item?.job?.job?.romeCode,
    item?.diploma?.romeCode
  );
}

function lbaRawGetRomeLabel(item) {
  return lbaRawString(
    item.romeLabel,
    item.rome_label,
    item.romeTitle,
    item.jobLabel,
    item?.job?.romeLabel,
    item?.job?.rome_label,
    item?.job?.title,
    item?.offer?.romeLabel
  );
}

function lbaRawGetTitle(item) {
  return lbaRawString(
    item.title,
    item.jobTitle,
    item.intitule,
    item.label,
    item?.offer?.title,
    item?.job?.title,
    item?.job?.job?.title
  );
}

function lbaRawGetCompanyName(item) {
  return lbaRawString(
    item.companyName,
    item.company_name,
    item.employerName,
    item.establishmentName,
    item?.workplace?.name,
    item?.workplace?.legal_name,
    item?.workplace?.brand,
    item?.company?.name,
    item?.company?.companyName,
    item?.company?.establishmentName,
    item?.employer?.name,
    item?.establishment?.name,
    item?.workplace?.company?.name
  );
}

function lbaRawGetSiret(item) {
  return lbaRawString(
    item.siret,
    item.companySiret,
    item.establishmentSiret,
    item?.workplace?.siret,
    item?.company?.siret,
    item?.company?.companySiret,
    item?.employer?.siret,
    item?.establishment?.siret
  );
}

function lbaRawGetPostalCode(item) {
  const address = lbaRawGetAddress(item);

  return lbaRawString(
    item.postalCode,
    item.zipCode,
    item.codePostal,
    item?.place?.zipCode,
    item?.place?.postalCode,
    item?.location?.zipCode,
    item?.location?.postalCode,
    item?.workplace?.zipCode,
    item?.workplace?.postalCode,
    item?.address?.zipCode,
    item?.address?.postalCode,
    lbaRawExtractPostalCodeFromAddress(address)
  );
}

function lbaRawGetCity(item) {
  const address = lbaRawGetAddress(item);

  return lbaRawString(
    item.city,
    item.commune,
    item.locality,
    item?.place?.city,
    item?.place?.commune,
    item?.location?.city,
    item?.location?.commune,
    item?.workplace?.city,
    item?.workplace?.commune,
    item?.address?.city,
    lbaRawExtractCityFromAddress(address)
  );
}

function lbaRawGetDepartmentFromPostalCode(postalCode) {
  const raw = String(postalCode || '').trim();

  if (!raw) return '';
  if (raw.startsWith('20')) return '';
  if (raw.length >= 2) return raw.slice(0, 2);

  return '';
}

function lbaRawPickNormalized(searchItem, detailItem, observedDate, departmentCode) {
  const merged = {
    ...(searchItem || {}),
    ...(detailItem || {}),
  };

  const postalCode = lbaRawGetPostalCode(merged);
  const siret = lbaRawGetSiret(merged);

  return {
    observedDate,
    departmentCode,
    offerId: lbaRawGetOfferId(merged),
    title: lbaRawGetTitle(merged),
    romeCode: lbaRawGetRomeCode(merged),
    romeLabel: lbaRawGetRomeLabel(merged),
    city: lbaRawGetCity(merged),
    postalCode,
    inferredDepartmentCode: lbaRawNormalizeDepartmentCode(
      merged.departmentCode ||
        merged.departement ||
        lbaRawGetDepartmentFromPostalCode(postalCode)
    ),
    companyName: lbaRawGetCompanyName(merged),
    siret,
    siren: siret ? siret.slice(0, 9) : '',
    partnerLabel: lbaRawString(
      merged?.identifier?.partner_label,
      merged.source,
      merged.origin,
      merged.partner_label,
      merged?.partner?.label
    ),
    partnerJobId: lbaRawString(
      merged?.identifier?.partner_job_id
    ),
    source: lbaRawString(
      merged?.identifier?.partner_label,
      merged.source,
      merged.origin,
      merged.partner_label,
      merged?.partner?.label
    ),
    applyUrl: lbaRawString(merged?.apply?.url),
    applyPhone: lbaRawString(merged?.apply?.phone),
    workplaceAddress: lbaRawGetAddress(merged),
    longitude: Array.isArray(merged?.workplace?.location?.geopoint?.coordinates)
      ? merged.workplace.location.geopoint.coordinates[0]
      : null,
    latitude: Array.isArray(merged?.workplace?.location?.geopoint?.coordinates)
      ? merged.workplace.location.geopoint.coordinates[1]
      : null,
    nafCode: lbaRawString(merged?.workplace?.domain?.naf?.code),
    nafLabel: lbaRawString(merged?.workplace?.domain?.naf?.label),
    opco: lbaRawString(merged?.workplace?.domain?.opco),
    idcc: lbaRawString(merged?.workplace?.domain?.idcc),
    workplaceSize: lbaRawString(merged?.workplace?.size),
    openingCount: Number(merged?.offer?.opening_count || 0),
    status: lbaRawString(merged?.offer?.status),
    contractType: lbaRawString(
      merged.contractType,
      merged.contract_type,
      merged.type,
      Array.isArray(merged?.contract?.type) ? merged.contract.type.join(',') : merged?.contract?.type
    ),
    diplomaLevel: lbaRawString(
      merged.diplomaLevel,
      merged.diploma_level,
      merged?.diploma?.level
    ),
    publicationDate: lbaRawString(
      merged.publicationDate,
      merged.publishedAt,
      merged.createdAt,
      merged.creationDate,
      merged?.offer?.publication?.creation
    ),
    expirationDate: lbaRawString(
      merged.expirationDate,
      merged.expiresAt,
      merged.expiration,
      merged?.offer?.publication?.expiration
    ),
    startDate: lbaRawString(
      merged.startDate,
      merged.jobStartDate,
      merged?.contract?.startDate,
      merged?.contract?.start
    ),
  };
}

async function lbaRawFetchJson(url, token) {
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Accept': 'application/json',
    },
  });

  const body = await response.text();

  let parsed = null;

  try {
    parsed = JSON.parse(body);
  } catch (error) {
    parsed = {
      parseError: String(error.message || error),
      body: body.slice(0, 2000),
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    url: url.toString(),
    payload: parsed,
  };
}

async function lbaRawFetchSearch({ departmentCode, page, limit, token }) {
  const url = new URL(LBA_JOB_SEARCH_URL);

  url.searchParams.set('caller', 'apprentifr');
  url.searchParams.set('departement', departmentCode);
  url.searchParams.set('department', departmentCode);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));

  return lbaRawFetchJson(url, token);
}

async function lbaRawFetchDetail({ offerId, token }) {
  if (!offerId) {
    return {
      ok: false,
      status: 0,
      payload: null,
      error: 'missing_offer_id',
    };
  }

  const url = new URL(`${LBA_JOB_DETAIL_URL}/${encodeURIComponent(offerId)}`);
  url.searchParams.set('caller', 'apprentifr');

  return lbaRawFetchJson(url, token);
}

function lbaRawCollectKeys(value, prefix = '', output = {}) {
  if (!value || typeof value !== 'object') return output;

  Object.entries(value).forEach(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    output[path] = (output[path] || 0) + 1;

    if (child && typeof child === 'object' && !Array.isArray(child)) {
      lbaRawCollectKeys(child, path, output);
    }
  });

  return output;
}

exports.captureLbaOffersRawDepartmentHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY, API_APPRENTISSAGE_TOKEN],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const observedDate = String(request.query.date || '').trim();
      const departmentCode = lbaRawNormalizeDepartmentCode(request.query.department || '72');
      const write = String(request.query.write || '1') !== '0';
      const limit = Math.max(10, Math.min(Number.parseInt(String(request.query.limit || '100'), 10), 100));
      const maxPages = Math.max(1, Math.min(Number.parseInt(String(request.query.maxPages || '20'), 10), 100));
      const detailLimit = Math.max(0, Math.min(Number.parseInt(String(request.query.detailLimit || '500'), 10), 1000));
      const token = API_APPRENTISSAGE_TOKEN.value();

      if (!observedDate) {
        response.status(400).json({
          ok: false,
          error: 'Missing date',
        });
        return;
      }

      const startedAt = Date.now();
      const searchPages = [];
      const searchItems = [];
      const searchErrors = [];

      for (let page = 1; page <= maxPages; page += 1) {
        const result = await lbaRawFetchSearch({
          departmentCode,
          page,
          limit,
          token,
        });

        searchPages.push({
          page,
          ok: result.ok,
          status: result.status,
          url: result.url,
        });

        if (!result.ok) {
          searchErrors.push({
            page,
            status: result.status,
            payload: result.payload,
          });
          break;
        }

        const items = lbaRawExtractArray(result.payload);

        items.forEach((item) => {
          searchItems.push({
            page,
            item,
          });
        });

        if (items.length < limit) {
          break;
        }
      }

      const byOfferId = new Map();

      searchItems.forEach(({ page, item }, index) => {
        const offerId = lbaRawGetOfferId(item) || `no_id_${page}_${index}`;

        if (!byOfferId.has(offerId)) {
          byOfferId.set(offerId, {
            offerId,
            searchPages: [],
            searchItem: item,
          });
        }

        byOfferId.get(offerId).searchPages.push(page);
      });

      const uniqueOffers = Array.from(byOfferId.values());
      const detailErrors = [];
      const detailResults = [];

      for (const offer of uniqueOffers.slice(0, detailLimit)) {
        const detail = await lbaRawFetchDetail({
          offerId: offer.offerId,
          token,
        });

        if (!detail.ok) {
          detailErrors.push({
            offerId: offer.offerId,
            status: detail.status,
            payload: detail.payload,
          });
        }

        detailResults.push({
          offerId: offer.offerId,
          ok: detail.ok,
          status: detail.status,
          payload: detail.payload,
        });
      }

      const detailById = new Map(
        detailResults.map((item) => [item.offerId, item])
      );

      const normalizedItems = uniqueOffers.map((offer) => {
        const detail = detailById.get(offer.offerId);
        const detailPayload = detail?.ok ? detail.payload : null;

        return {
          offerId: offer.offerId,
          searchPages: offer.searchPages,
          hasDetail: Boolean(detail?.ok),
          normalized: lbaRawPickNormalized(
            offer.searchItem,
            detailPayload,
            observedDate,
            departmentCode
          ),
          rawSearch: offer.searchItem,
          rawDetail: detailPayload,
          detailStatus: detail?.status || null,
        };
      });

      const fieldCoverage = normalizedItems.reduce((accumulator, item) => {
        Object.entries(item.normalized).forEach(([key, value]) => {
          if (!accumulator[key]) {
            accumulator[key] = {
              present: 0,
              empty: 0,
            };
          }

          if (value !== undefined && value !== null && String(value).trim() !== '') {
            accumulator[key].present += 1;
          } else {
            accumulator[key].empty += 1;
          }
        });

        return accumulator;
      }, {});

      const rawSearchKeys = {};
      const rawDetailKeys = {};

      normalizedItems.forEach((item) => {
        lbaRawCollectKeys(item.rawSearch, '', rawSearchKeys);
        if (item.rawDetail) {
          lbaRawCollectKeys(item.rawDetail, '', rawDetailKeys);
        }
      });

      const romeStats = {};
      const cityStats = {};
      const siretStats = {};

      normalizedItems.forEach((item) => {
        const normalized = item.normalized;

        const rome = normalized.romeCode || 'unknown';
        const city = normalized.city || 'unknown';
        const siret = normalized.siret || 'unknown';

        romeStats[rome] = (romeStats[rome] || 0) + 1;
        cityStats[city] = (cityStats[city] || 0) + 1;
        siretStats[siret] = (siretStats[siret] || 0) + 1;
      });

      const captureId = `${observedDate}_${departmentCode}`;

      if (write) {
        const captureRef = db.collection('lbaRawOfferCaptures').doc(captureId);

        await captureRef.set(
          {
            captureId,
            observedDate,
            departmentCode,
            source: 'la-bonne-alternance-job-v1',
            searchUrl: LBA_JOB_SEARCH_URL,
            detailUrl: LBA_JOB_DETAIL_URL,
            requestedLimit: limit,
            requestedMaxPages: maxPages,
            requestedDetailLimit: detailLimit,
            pagesFetched: searchPages.length,
            searchPages,
            searchErrors,
            detailErrorsCount: detailErrors.length,
            searchItemsCount: searchItems.length,
            uniqueOffersCount: uniqueOffers.length,
            detailedOffersCount: detailResults.filter((item) => item.ok).length,
            fieldCoverage,
            rawSearchKeys,
            rawDetailKeys,
            romeStats,
            cityStats,
            siretStats,
            sampleNormalized: normalizedItems.slice(0, 10).map((item) => item.normalized),
            durationMs: Date.now() - startedAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'lbaRawOfferCaptures.v1',
          },
          { merge: true }
        );

        let batch = db.batch();
        let batchCount = 0;

        for (const item of normalizedItems) {
          const docId = `${observedDate}_${departmentCode}_${item.offerId}`.replace(/[\/#?]/g, '_');

          batch.set(
            db.collection('lbaRawOfferCaptureItems').doc(docId),
            {
              captureId,
              observedDate,
              departmentCode,
              offerId: item.offerId,
              searchPages: item.searchPages,
              hasDetail: item.hasDetail,
              detailStatus: item.detailStatus,
              normalized: item.normalized,
              rawSearch: item.rawSearch,
              rawDetail: item.rawDetail,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'lbaRawOfferCaptureItems.v1',
            },
            { merge: true }
          );

          batchCount += 1;

          if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }

        if (batchCount > 0) {
          await batch.commit();
        }
      }

      response.json({
        ok: true,
        write,
        captureId,
        observedDate,
        departmentCode,
        pagesFetched: searchPages.length,
        searchItemsCount: searchItems.length,
        uniqueOffersCount: uniqueOffers.length,
        detailedOffersCount: detailResults.filter((item) => item.ok).length,
        detailErrorsCount: detailErrors.length,
        durationMs: Date.now() - startedAt,
        fieldCoverage,
        topRome: Object.entries(romeStats)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([key, count]) => ({ key, count })),
        topCities: Object.entries(cityStats)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([key, count]) => ({ key, count })),
        topSirets: Object.entries(siretStats)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([key, count]) => ({ key, count })),
        sampleNormalized: normalizedItems.slice(0, 5).map((item) => item.normalized),
        sampleRawSearch: normalizedItems.slice(0, 5).map((item) => item.rawSearch),
        sampleRawDetail: normalizedItems
          .filter((item) => item.rawDetail)
          .slice(0, 3)
          .map((item) => item.rawDetail),
        rawSearchKeysPreview: Object.entries(rawSearchKeys)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 120)
          .map(([key, count]) => ({ key, count })),
        rawDetailKeysPreview: Object.entries(rawDetailKeys)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 120)
          .map(([key, count]) => ({ key, count })),
        searchErrors: searchErrors.slice(0, 3),
        detailErrors: detailErrors.slice(0, 3),
      });
    } catch (error) {
      console.error('captureLbaOffersRawDepartmentHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// LBA_CURRENT_OFFERS_IMPORT_V1

const LBA_DEPARTMENT_REGIONS = {
  '01': ['84', 'Auvergne-Rhône-Alpes'],
  '02': ['32', 'Hauts-de-France'],
  '03': ['84', 'Auvergne-Rhône-Alpes'],
  '04': ['93', "Provence-Alpes-Côte d'Azur"],
  '05': ['93', "Provence-Alpes-Côte d'Azur"],
  '06': ['93', "Provence-Alpes-Côte d'Azur"],
  '07': ['84', 'Auvergne-Rhône-Alpes'],
  '08': ['44', 'Grand Est'],
  '09': ['76', 'Occitanie'],
  '10': ['44', 'Grand Est'],
  '11': ['76', 'Occitanie'],
  '12': ['76', 'Occitanie'],
  '13': ['93', "Provence-Alpes-Côte d'Azur"],
  '14': ['28', 'Normandie'],
  '15': ['84', 'Auvergne-Rhône-Alpes'],
  '16': ['75', 'Nouvelle-Aquitaine'],
  '17': ['75', 'Nouvelle-Aquitaine'],
  '18': ['24', 'Centre-Val de Loire'],
  '19': ['75', 'Nouvelle-Aquitaine'],
  '21': ['27', 'Bourgogne-Franche-Comté'],
  '22': ['53', 'Bretagne'],
  '23': ['75', 'Nouvelle-Aquitaine'],
  '24': ['75', 'Nouvelle-Aquitaine'],
  '25': ['27', 'Bourgogne-Franche-Comté'],
  '26': ['84', 'Auvergne-Rhône-Alpes'],
  '27': ['28', 'Normandie'],
  '28': ['24', 'Centre-Val de Loire'],
  '29': ['53', 'Bretagne'],
  '2A': ['94', 'Corse'],
  '2B': ['94', 'Corse'],
  '30': ['76', 'Occitanie'],
  '31': ['76', 'Occitanie'],
  '32': ['76', 'Occitanie'],
  '33': ['75', 'Nouvelle-Aquitaine'],
  '34': ['76', 'Occitanie'],
  '35': ['53', 'Bretagne'],
  '36': ['24', 'Centre-Val de Loire'],
  '37': ['24', 'Centre-Val de Loire'],
  '38': ['84', 'Auvergne-Rhône-Alpes'],
  '39': ['27', 'Bourgogne-Franche-Comté'],
  '40': ['75', 'Nouvelle-Aquitaine'],
  '41': ['24', 'Centre-Val de Loire'],
  '42': ['84', 'Auvergne-Rhône-Alpes'],
  '43': ['84', 'Auvergne-Rhône-Alpes'],
  '44': ['52', 'Pays de la Loire'],
  '45': ['24', 'Centre-Val de Loire'],
  '46': ['76', 'Occitanie'],
  '47': ['75', 'Nouvelle-Aquitaine'],
  '48': ['76', 'Occitanie'],
  '49': ['52', 'Pays de la Loire'],
  '50': ['28', 'Normandie'],
  '51': ['44', 'Grand Est'],
  '52': ['44', 'Grand Est'],
  '53': ['52', 'Pays de la Loire'],
  '54': ['44', 'Grand Est'],
  '55': ['44', 'Grand Est'],
  '56': ['53', 'Bretagne'],
  '57': ['44', 'Grand Est'],
  '58': ['27', 'Bourgogne-Franche-Comté'],
  '59': ['32', 'Hauts-de-France'],
  '60': ['32', 'Hauts-de-France'],
  '61': ['28', 'Normandie'],
  '62': ['32', 'Hauts-de-France'],
  '63': ['84', 'Auvergne-Rhône-Alpes'],
  '64': ['75', 'Nouvelle-Aquitaine'],
  '65': ['76', 'Occitanie'],
  '66': ['76', 'Occitanie'],
  '67': ['44', 'Grand Est'],
  '68': ['44', 'Grand Est'],
  '69': ['84', 'Auvergne-Rhône-Alpes'],
  '70': ['27', 'Bourgogne-Franche-Comté'],
  '71': ['27', 'Bourgogne-Franche-Comté'],
  '72': ['52', 'Pays de la Loire'],
  '73': ['84', 'Auvergne-Rhône-Alpes'],
  '74': ['84', 'Auvergne-Rhône-Alpes'],
  '75': ['11', 'Île-de-France'],
  '76': ['28', 'Normandie'],
  '77': ['11', 'Île-de-France'],
  '78': ['11', 'Île-de-France'],
  '79': ['75', 'Nouvelle-Aquitaine'],
  '80': ['32', 'Hauts-de-France'],
  '81': ['76', 'Occitanie'],
  '82': ['76', 'Occitanie'],
  '83': ['93', "Provence-Alpes-Côte d'Azur"],
  '84': ['93', "Provence-Alpes-Côte d'Azur"],
  '85': ['52', 'Pays de la Loire'],
  '86': ['75', 'Nouvelle-Aquitaine'],
  '87': ['75', 'Nouvelle-Aquitaine'],
  '88': ['44', 'Grand Est'],
  '89': ['27', 'Bourgogne-Franche-Comté'],
  '90': ['27', 'Bourgogne-Franche-Comté'],
  '91': ['11', 'Île-de-France'],
  '92': ['11', 'Île-de-France'],
  '93': ['11', 'Île-de-France'],
  '94': ['11', 'Île-de-France'],
  '95': ['11', 'Île-de-France'],
  '971': ['01', 'Guadeloupe'],
  '972': ['02', 'Martinique'],
  '973': ['03', 'Guyane'],
  '974': ['04', 'La Réunion'],
  '976': ['06', 'Mayotte'],
};

function lbaCurrentTodayParis() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function lbaCurrentMonth(value) {
  const raw = String(value || '').trim();

  if (!raw || raw.length < 7) return '';

  return raw.slice(0, 7);
}

function lbaCurrentNormalizeNaf(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace('.', '');
}

function lbaCurrentNormalizeCity(value) {
  return String(value || '')
    .trim()
    .replace(/^,\s*/, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function lbaCurrentNormalizeTitle(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function lbaCurrentRegionForDepartment(departmentCode) {
  const normalized = lbaRawNormalizeDepartmentCode(departmentCode);
  const region = LBA_DEPARTMENT_REGIONS[normalized] || ['', ''];

  return {
    regionCode: region[0],
    regionName: region[1],
  };
}

function lbaCurrentSanitizeDocId(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[\/#?\[\]]/g, '_')
    .slice(0, 120);
}

function lbaCurrentBuildOfferDocument(normalized, raw, observedDate) {
  const departmentCode = lbaRawNormalizeDepartmentCode(normalized.inferredDepartmentCode);
  const region = lbaCurrentRegionForDepartment(departmentCode);
  const publicationMonth = lbaCurrentMonth(normalized.publicationDate);
  const expirationMonth = lbaCurrentMonth(normalized.expirationDate);
  const startMonth = lbaCurrentMonth(normalized.startDate);
  const observedMonth = lbaCurrentMonth(observedDate);

  return {
    offerId: normalized.offerId,
    observedDate,
    observedMonth,

    title: lbaCurrentNormalizeTitle(normalized.title),
    titleLower: lbaCurrentNormalizeTitle(normalized.title).toLowerCase(),

    romeCodes: normalized.romeCode ? [normalized.romeCode] : [],
    primaryRomeCode: normalized.romeCode || '',
    romeLabel: normalized.romeLabel || '',

    companyName: normalized.companyName || '',
    siret: normalized.siret || '',
    siren: normalized.siren || '',

    nafCode: lbaCurrentNormalizeNaf(normalized.nafCode),
    nafLabel: normalized.nafLabel || '',
    opco: normalized.opco || '',
    idcc: normalized.idcc || '',
    workplaceSize: normalized.workplaceSize || '',

    address: normalized.workplaceAddress || '',
    city: lbaCurrentNormalizeCity(normalized.city),
    postalCode: normalized.postalCode || '',
    departmentCode,
    regionCode: region.regionCode,
    regionName: region.regionName,
    latitude: normalized.latitude ?? null,
    longitude: normalized.longitude ?? null,

    contractType: normalized.contractType || '',
    contractStartDate: normalized.startDate || '',
    contractStartMonth: startMonth,
    durationMonths: raw?.contract?.duration ?? null,
    remote: raw?.contract?.remote ?? null,

    publicationDate: normalized.publicationDate || '',
    publicationMonth,
    expirationDate: normalized.expirationDate || '',
    expirationMonth,
    openingCount: Number(normalized.openingCount || 0),
    status: normalized.status || '',

    applyUrl: normalized.applyUrl || '',
    applyPhone: normalized.applyPhone || '',
    partnerLabel: normalized.partnerLabel || '',
    partnerJobId: normalized.partnerJobId || '',
    source: normalized.source || 'la-bonne-alternance',

    targetDiplomaEuropean: raw?.offer?.target_diploma?.european || '',
    targetDiplomaLabel: raw?.offer?.target_diploma?.label || '',

    description: raw?.offer?.description || '',
    desiredSkills: Array.isArray(raw?.offer?.desired_skills) ? raw.offer.desired_skills : [],
    toBeAcquiredSkills: Array.isArray(raw?.offer?.to_be_acquired_skills) ? raw.offer.to_be_acquired_skills : [],
    accessConditions: Array.isArray(raw?.offer?.access_conditions) ? raw.offer.access_conditions : [],

    isDelegated: Boolean(raw?.is_delegated),
    raw,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'lbaCurrentOffers.v1',
  };
}

function lbaCurrentIncrement(stats, key, amount = 1) {
  const safeKey = String(key || 'unknown');
  stats[safeKey] = (stats[safeKey] || 0) + Number(amount || 0);
}

function lbaCurrentTopFromCounter(counter, limit = 20) {
  return Object.entries(counter || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function lbaCurrentBuildStats(offers) {
  const global = {
    offersCount: offers.length,
    openingsCount: 0,
    byDepartment: {},
    byRegion: {},
    byRome: {},
    byNaf: {},
    byCity: {},
    byMonthDepartment: {},
    byMonthDepartmentRome: {},
    byMonthDepartmentNaf: {},
    byMonthDepartmentCity: {},
  };

  for (const offer of offers) {
    const openings = Number(offer.openingCount || 0) || 1;
    const department = offer.departmentCode || 'unknown';
    const region = offer.regionCode || 'unknown';
    const city = offer.city || 'unknown';
    const naf = offer.nafCode || 'unknown';
    const rome = offer.primaryRomeCode || 'unknown';
    const month = offer.publicationMonth || offer.observedMonth || 'unknown';

    global.openingsCount += openings;

    lbaCurrentIncrement(global.byDepartment, department);
    lbaCurrentIncrement(global.byRegion, region);
    lbaCurrentIncrement(global.byRome, rome);
    lbaCurrentIncrement(global.byNaf, naf);
    lbaCurrentIncrement(global.byCity, `${department}_${city}`);

    lbaCurrentIncrement(global.byMonthDepartment, `${month}_${department}`);
    lbaCurrentIncrement(global.byMonthDepartmentRome, `${month}_${department}_${rome}`);
    lbaCurrentIncrement(global.byMonthDepartmentNaf, `${month}_${department}_${naf}`);
    lbaCurrentIncrement(global.byMonthDepartmentCity, `${month}_${department}_${city}`);
  }

  return global;
}

async function lbaCurrentWriteAggregates({ observedDate, stats }) {
  const observedMonth = lbaCurrentMonth(observedDate);

  const batchLimit = 400;
  let batch = db.batch();
  let count = 0;

  function setDoc(collectionName, docId, data) {
    batch.set(
      db.collection(collectionName).doc(lbaCurrentSanitizeDocId(docId)),
      {
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    count += 1;
  }

  setDoc('lbaOfferStatsDaily', observedDate, {
    observedDate,
    observedMonth,
    offersCount: stats.offersCount,
    openingsCount: stats.openingsCount,
    topDepartments: lbaCurrentTopFromCounter(stats.byDepartment, 30),
    topRegions: lbaCurrentTopFromCounter(stats.byRegion, 30),
    topRome: lbaCurrentTopFromCounter(stats.byRome, 30),
    topNaf: lbaCurrentTopFromCounter(stats.byNaf, 30),
    schemaVersion: 'lbaOfferStatsDaily.v1',
  });

  for (const [key, offersCount] of Object.entries(stats.byMonthDepartment)) {
    const [month, departmentCode] = key.split('_');

    setDoc('lbaOfferStatsByMonthDepartment', key, {
      month,
      departmentCode,
      offersCount,
      schemaVersion: 'lbaOfferStatsByMonthDepartment.v1',
    });

    if (count >= batchLimit) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  for (const [key, offersCount] of Object.entries(stats.byMonthDepartmentRome)) {
    const parts = key.split('_');
    const month = parts[0];
    const departmentCode = parts[1];
    const romeCode = parts.slice(2).join('_');

    setDoc('lbaOfferStatsByMonthDepartmentRome', key, {
      month,
      departmentCode,
      romeCode,
      offersCount,
      schemaVersion: 'lbaOfferStatsByMonthDepartmentRome.v1',
    });

    if (count >= batchLimit) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  for (const [key, offersCount] of Object.entries(stats.byMonthDepartmentNaf)) {
    const parts = key.split('_');
    const month = parts[0];
    const departmentCode = parts[1];
    const nafCode = parts.slice(2).join('_');

    setDoc('lbaOfferStatsByMonthDepartmentNaf', key, {
      month,
      departmentCode,
      nafCode,
      offersCount,
      schemaVersion: 'lbaOfferStatsByMonthDepartmentNaf.v1',
    });

    if (count >= batchLimit) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  for (const [key, offersCount] of Object.entries(stats.byMonthDepartmentCity)) {
    const parts = key.split('_');
    const month = parts[0];
    const departmentCode = parts[1];
    const city = parts.slice(2).join('_');

    setDoc('lbaOfferStatsByMonthDepartmentCity', key, {
      month,
      departmentCode,
      city,
      offersCount,
      schemaVersion: 'lbaOfferStatsByMonthDepartmentCity.v1',
    });

    if (count >= batchLimit) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }
}

exports.importLbaCurrentOffersAllHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '2GiB',
    secrets: [BACKFILL_ADMIN_KEY, API_APPRENTISSAGE_TOKEN],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const observedDate = String(request.query.date || lbaCurrentTodayParis()).trim();
      const write = String(request.query.write || '1') !== '0';
      const limit = Math.max(10, Math.min(Number.parseInt(String(request.query.limit || '100'), 10), 100));
      const maxPages = Math.max(1, Math.min(Number.parseInt(String(request.query.maxPages || '50'), 10), 300));
      const token = API_APPRENTISSAGE_TOKEN.value();

      const startedAt = Date.now();
      const pages = [];
      const rawItems = [];

      for (let page = 1; page <= maxPages; page += 1) {
        const result = await lbaRawFetchSearch({
          departmentCode: '',
          page,
          limit,
          token,
        });

        pages.push({
          page,
          ok: result.ok,
          status: result.status,
        });

        if (!result.ok) {
          break;
        }

        const items = lbaRawExtractArray(result.payload);

        for (const item of items) {
          rawItems.push({
            page,
            item,
          });
        }

        if (items.length === 0) {
          break;
        }
      }

      const byOfferId = new Map();

      for (const row of rawItems) {
        const offerId = lbaRawGetOfferId(row.item);

        if (!offerId) continue;

        if (!byOfferId.has(offerId)) {
          byOfferId.set(offerId, {
            offerId,
            pages: [],
            raw: row.item,
          });
        }

        byOfferId.get(offerId).pages.push(row.page);
      }

      const offers = Array.from(byOfferId.values()).map((entry) => {
        const normalized = lbaRawPickNormalized(entry.raw, null, observedDate, '');
        const doc = lbaCurrentBuildOfferDocument(normalized, entry.raw, observedDate);

        return {
          ...doc,
          searchPages: entry.pages,
        };
      });

      const validOffers = offers.filter((offer) => offer.offerId && offer.status !== 'Inactive');
      const stats = lbaCurrentBuildStats(validOffers);

      if (write) {
        let batch = db.batch();
        let count = 0;

        for (const offer of validOffers) {
          const offerId = lbaCurrentSanitizeDocId(offer.offerId);
          const observationId = lbaCurrentSanitizeDocId(`${observedDate}_${offer.offerId}`);

          batch.set(
            db.collection('lbaCurrentOffers').doc(offerId),
            {
              ...offer,
              lastObservedDate: observedDate,
              lastObservedMonth: lbaCurrentMonth(observedDate),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          batch.set(
            db.collection('lbaOfferObservations').doc(observationId),
            {
              ...offer,
              observedDate,
              observedMonth: lbaCurrentMonth(observedDate),
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'lbaOfferObservations.v1',
            },
            { merge: true }
          );

          if (offer.siret) {
            batch.set(
              db.collection('lbaCompaniesFromOffers').doc(offer.siret),
              {
                siret: offer.siret,
                siren: offer.siren,
                companyName: offer.companyName,
                nafCode: offer.nafCode,
                nafLabel: offer.nafLabel,
                opco: offer.opco,
                idcc: offer.idcc,
                workplaceSize: offer.workplaceSize,
                address: offer.address,
                city: offer.city,
                postalCode: offer.postalCode,
                departmentCode: offer.departmentCode,
                regionCode: offer.regionCode,
                regionName: offer.regionName,
                lastObservedDate: observedDate,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                schemaVersion: 'lbaCompaniesFromOffers.v1',
              },
              { merge: true }
            );
          }

          count += offer.siret ? 3 : 2;

          if (count >= 380) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }
        }

        if (count > 0) {
          await batch.commit();
        }

        await lbaCurrentWriteAggregates({
          observedDate,
          stats,
        });

        await db.collection('lbaOfferImportRuns').doc(observedDate).set(
          {
            observedDate,
            observedMonth: lbaCurrentMonth(observedDate),
            pagesFetched: pages.length,
            rawItemsCount: rawItems.length,
            uniqueOffersCount: byOfferId.size,
            validOffersCount: validOffers.length,
            stats: {
              offersCount: stats.offersCount,
              openingsCount: stats.openingsCount,
              topDepartments: lbaCurrentTopFromCounter(stats.byDepartment, 30),
              topRegions: lbaCurrentTopFromCounter(stats.byRegion, 30),
              topRome: lbaCurrentTopFromCounter(stats.byRome, 30),
              topNaf: lbaCurrentTopFromCounter(stats.byNaf, 30),
            },
            pages,
            durationMs: Date.now() - startedAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'lbaOfferImportRuns.v1',
          },
          { merge: true }
        );
      }

      response.json({
        ok: true,
        write,
        observedDate,
        pagesFetched: pages.length,
        rawItemsCount: rawItems.length,
        uniqueOffersCount: byOfferId.size,
        validOffersCount: validOffers.length,
        durationMs: Date.now() - startedAt,
        stats: {
          offersCount: stats.offersCount,
          openingsCount: stats.openingsCount,
          topDepartments: lbaCurrentTopFromCounter(stats.byDepartment, 20),
          topRegions: lbaCurrentTopFromCounter(stats.byRegion, 20),
          topRome: lbaCurrentTopFromCounter(stats.byRome, 20),
          topNaf: lbaCurrentTopFromCounter(stats.byNaf, 20),
        },
        sampleOffers: validOffers.slice(0, 5).map((offer) => ({
          offerId: offer.offerId,
          title: offer.title,
          primaryRomeCode: offer.primaryRomeCode,
          city: offer.city,
          postalCode: offer.postalCode,
          departmentCode: offer.departmentCode,
          regionName: offer.regionName,
          companyName: offer.companyName,
          siret: offer.siret,
          nafCode: offer.nafCode,
          publicationDate: offer.publicationDate,
          expirationDate: offer.expirationDate,
          contractStartDate: offer.contractStartDate,
        })),
      });
    } catch (error) {
      console.error('importLbaCurrentOffersAllHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// BULK_DELETE_INSEE_ESTABLISHMENTS_V1

function bulkDeleteNormalizeDepartment(value) {
  const raw = String(value || '').trim().toUpperCase();

  if (!raw) return '';
  if (raw === '2A' || raw === '2B') return raw;
  if (/^\d$/.test(raw)) return `0${raw}`;
  if (raw.startsWith('97') && raw.length >= 3) return raw.slice(0, 3);

  return raw.slice(0, 2);
}

function bulkDeleteGetFirst(data, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let current = data;

    for (const part of parts) {
      current = current?.[part];
    }

    if (current !== undefined && current !== null && String(current).trim() !== '') {
      return current;
    }
  }

  return '';
}

function bulkDeleteDepartmentFromPostalCode(postalCode) {
  const raw = String(postalCode || '').trim();

  if (!raw) return '';
  if (raw.startsWith('97')) return raw.slice(0, 3);
  if (raw.startsWith('20')) return '';
  return raw.slice(0, 2);
}

function bulkDeleteExtractInseeFields(data) {
  const postalCode = String(bulkDeleteGetFirst(data, [
    'postalCode',
    'codePostal',
    'codePostalEtablissement',
    'adresseEtablissement.codePostalEtablissement',
    'raw.codePostalEtablissement',
    'raw.adresseEtablissement.codePostalEtablissement',
  ]) || '').trim();

  const departmentCode = bulkDeleteNormalizeDepartment(
    bulkDeleteGetFirst(data, [
      'departmentCode',
      'department',
      'departement',
      'raw.departmentCode',
      'raw.department',
      'raw.departement',
    ]) || bulkDeleteDepartmentFromPostalCode(postalCode)
  );

  const status = String(bulkDeleteGetFirst(data, [
    'status',
    'etatAdministratifEtablissement',
    'raw.etatAdministratifEtablissement',
  ]) || '').trim().toUpperCase();

  const employer = String(bulkDeleteGetFirst(data, [
    'employerCharacter',
    'caractereEmployeurEtablissement',
    'raw.caractereEmployeurEtablissement',
  ]) || '').trim().toUpperCase();

  const siret = String(bulkDeleteGetFirst(data, [
    'siret',
    'raw.siret',
  ]) || '').trim();

  const siren = String(bulkDeleteGetFirst(data, [
    'siren',
    'raw.siren',
  ]) || siret.slice(0, 9)).trim();

  return {
    departmentCode,
    status,
    employer,
    siret,
    siren,
  };
}

function bulkDeleteInseeMatches({ fields, department, status, employer }) {
  if (department && fields.departmentCode !== department) return false;
  if (status && fields.status !== status) return false;
  if (employer && fields.employer !== employer) return false;

  return true;
}

exports.bulkDeleteInseeEstablishmentsHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const department = bulkDeleteNormalizeDepartment(request.query.department || '');
      const status = String(request.query.status || '').trim().toUpperCase();
      const employer = String(request.query.employer || '').trim().toUpperCase();

      const scanLimit = Math.max(
        1,
        Math.min(Number.parseInt(String(request.query.scanLimit || '1000'), 10), 5000)
      );

      const deleteLimit = Math.max(
        1,
        Math.min(Number.parseInt(String(request.query.deleteLimit || '400'), 10), 450)
      );

      const cursor = String(request.query.cursor || '').trim();
      const confirm = String(request.query.confirm || '').trim();

      const dryRun = confirm !== 'DELETE';
      const startedAt = Date.now();

      let firestoreQuery = db
        .collection('inseeEstablishments')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(scanLimit);

      if (cursor) {
        firestoreQuery = firestoreQuery.startAfter(cursor);
      }

      const snapshot = await firestoreQuery.get();

      let scannedCount = 0;
      let matchedCount = 0;
      let deletedCount = 0;
      let lastDocId = cursor || '';
      const samples = [];

      let batch = db.batch();
      let batchCount = 0;

      snapshot.docs.forEach((doc) => {
        scannedCount += 1;
        lastDocId = doc.id;

        const data = doc.data() || {};
        const fields = bulkDeleteExtractInseeFields(data);

        const matches = bulkDeleteInseeMatches({
          fields,
          department,
          status,
          employer,
        });

        if (!matches) return;

        matchedCount += 1;

        if (samples.length < 10) {
          samples.push({
            docId: doc.id,
            ...fields,
          });
        }

        if (!dryRun && deletedCount < deleteLimit) {
          batch.delete(doc.ref);
          batchCount += 1;
          deletedCount += 1;
        }
      });

      if (!dryRun && batchCount > 0) {
        await batch.commit();
      }

      const hasMore = snapshot.docs.length === scanLimit;
      const nextCursor = hasMore ? lastDocId : '';

      response.json({
        ok: true,
        dryRun,
        collection: 'inseeEstablishments',
        filters: {
          department: department || null,
          status: status || null,
          employer: employer || null,
        },
        scanLimit,
        deleteLimit,
        cursor: cursor || null,
        scannedCount,
        matchedCount,
        deletedCount,
        hasMore,
        nextCursor,
        samples,
        durationMs: Date.now() - startedAt,
        warning: dryRun
          ? 'Mode simulation. Ajoute confirm=DELETE pour supprimer réellement.'
          : 'Suppression réelle effectuée sur les documents correspondants.',
      });
    } catch (error) {
      console.error('bulkDeleteInseeEstablishmentsHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// SEED_DEPARTMENTS_STATIC_V2

const APPRENTIFR_DEPARTMENTS = [
  ['01', 'Ain', '84', 'Auvergne-Rhône-Alpes'],
  ['02', 'Aisne', '32', 'Hauts-de-France'],
  ['03', 'Allier', '84', 'Auvergne-Rhône-Alpes'],
  ['04', 'Alpes-de-Haute-Provence', '93', "Provence-Alpes-Côte d'Azur"],
  ['05', 'Hautes-Alpes', '93', "Provence-Alpes-Côte d'Azur"],
  ['06', 'Alpes-Maritimes', '93', "Provence-Alpes-Côte d'Azur"],
  ['07', 'Ardèche', '84', 'Auvergne-Rhône-Alpes'],
  ['08', 'Ardennes', '44', 'Grand Est'],
  ['09', 'Ariège', '76', 'Occitanie'],
  ['10', 'Aube', '44', 'Grand Est'],
  ['11', 'Aude', '76', 'Occitanie'],
  ['12', 'Aveyron', '76', 'Occitanie'],
  ['13', 'Bouches-du-Rhône', '93', "Provence-Alpes-Côte d'Azur"],
  ['14', 'Calvados', '28', 'Normandie'],
  ['15', 'Cantal', '84', 'Auvergne-Rhône-Alpes'],
  ['16', 'Charente', '75', 'Nouvelle-Aquitaine'],
  ['17', 'Charente-Maritime', '75', 'Nouvelle-Aquitaine'],
  ['18', 'Cher', '24', 'Centre-Val de Loire'],
  ['19', 'Corrèze', '75', 'Nouvelle-Aquitaine'],
  ['21', "Côte-d'Or", '27', 'Bourgogne-Franche-Comté'],
  ['22', "Côtes-d'Armor", '53', 'Bretagne'],
  ['23', 'Creuse', '75', 'Nouvelle-Aquitaine'],
  ['24', 'Dordogne', '75', 'Nouvelle-Aquitaine'],
  ['25', 'Doubs', '27', 'Bourgogne-Franche-Comté'],
  ['26', 'Drôme', '84', 'Auvergne-Rhône-Alpes'],
  ['27', 'Eure', '28', 'Normandie'],
  ['28', 'Eure-et-Loir', '24', 'Centre-Val de Loire'],
  ['29', 'Finistère', '53', 'Bretagne'],
  ['2A', 'Corse-du-Sud', '94', 'Corse'],
  ['2B', 'Haute-Corse', '94', 'Corse'],
  ['30', 'Gard', '76', 'Occitanie'],
  ['31', 'Haute-Garonne', '76', 'Occitanie'],
  ['32', 'Gers', '76', 'Occitanie'],
  ['33', 'Gironde', '75', 'Nouvelle-Aquitaine'],
  ['34', 'Hérault', '76', 'Occitanie'],
  ['35', 'Ille-et-Vilaine', '53', 'Bretagne'],
  ['36', 'Indre', '24', 'Centre-Val de Loire'],
  ['37', 'Indre-et-Loire', '24', 'Centre-Val de Loire'],
  ['38', 'Isère', '84', 'Auvergne-Rhône-Alpes'],
  ['39', 'Jura', '27', 'Bourgogne-Franche-Comté'],
  ['40', 'Landes', '75', 'Nouvelle-Aquitaine'],
  ['41', 'Loir-et-Cher', '24', 'Centre-Val de Loire'],
  ['42', 'Loire', '84', 'Auvergne-Rhône-Alpes'],
  ['43', 'Haute-Loire', '84', 'Auvergne-Rhône-Alpes'],
  ['44', 'Loire-Atlantique', '52', 'Pays de la Loire'],
  ['45', 'Loiret', '24', 'Centre-Val de Loire'],
  ['46', 'Lot', '76', 'Occitanie'],
  ['47', 'Lot-et-Garonne', '75', 'Nouvelle-Aquitaine'],
  ['48', 'Lozère', '76', 'Occitanie'],
  ['49', 'Maine-et-Loire', '52', 'Pays de la Loire'],
  ['50', 'Manche', '28', 'Normandie'],
  ['51', 'Marne', '44', 'Grand Est'],
  ['52', 'Haute-Marne', '44', 'Grand Est'],
  ['53', 'Mayenne', '52', 'Pays de la Loire'],
  ['54', 'Meurthe-et-Moselle', '44', 'Grand Est'],
  ['55', 'Meuse', '44', 'Grand Est'],
  ['56', 'Morbihan', '53', 'Bretagne'],
  ['57', 'Moselle', '44', 'Grand Est'],
  ['58', 'Nièvre', '27', 'Bourgogne-Franche-Comté'],
  ['59', 'Nord', '32', 'Hauts-de-France'],
  ['60', 'Oise', '32', 'Hauts-de-France'],
  ['61', 'Orne', '28', 'Normandie'],
  ['62', 'Pas-de-Calais', '32', 'Hauts-de-France'],
  ['63', 'Puy-de-Dôme', '84', 'Auvergne-Rhône-Alpes'],
  ['64', 'Pyrénées-Atlantiques', '75', 'Nouvelle-Aquitaine'],
  ['65', 'Hautes-Pyrénées', '76', 'Occitanie'],
  ['66', 'Pyrénées-Orientales', '76', 'Occitanie'],
  ['67', 'Bas-Rhin', '44', 'Grand Est'],
  ['68', 'Haut-Rhin', '44', 'Grand Est'],
  ['69', 'Rhône', '84', 'Auvergne-Rhône-Alpes'],
  ['70', 'Haute-Saône', '27', 'Bourgogne-Franche-Comté'],
  ['71', 'Saône-et-Loire', '27', 'Bourgogne-Franche-Comté'],
  ['72', 'Sarthe', '52', 'Pays de la Loire'],
  ['73', 'Savoie', '84', 'Auvergne-Rhône-Alpes'],
  ['74', 'Haute-Savoie', '84', 'Auvergne-Rhône-Alpes'],
  ['75', 'Paris', '11', 'Île-de-France'],
  ['76', 'Seine-Maritime', '28', 'Normandie'],
  ['77', 'Seine-et-Marne', '11', 'Île-de-France'],
  ['78', 'Yvelines', '11', 'Île-de-France'],
  ['79', 'Deux-Sèvres', '75', 'Nouvelle-Aquitaine'],
  ['80', 'Somme', '32', 'Hauts-de-France'],
  ['81', 'Tarn', '76', 'Occitanie'],
  ['82', 'Tarn-et-Garonne', '76', 'Occitanie'],
  ['83', 'Var', '93', "Provence-Alpes-Côte d'Azur"],
  ['84', 'Vaucluse', '93', "Provence-Alpes-Côte d'Azur"],
  ['85', 'Vendée', '52', 'Pays de la Loire'],
  ['86', 'Vienne', '75', 'Nouvelle-Aquitaine'],
  ['87', 'Haute-Vienne', '75', 'Nouvelle-Aquitaine'],
  ['88', 'Vosges', '44', 'Grand Est'],
  ['89', 'Yonne', '27', 'Bourgogne-Franche-Comté'],
  ['90', 'Territoire de Belfort', '27', 'Bourgogne-Franche-Comté'],
  ['91', 'Essonne', '11', 'Île-de-France'],
  ['92', 'Hauts-de-Seine', '11', 'Île-de-France'],
  ['93', 'Seine-Saint-Denis', '11', 'Île-de-France'],
  ['94', 'Val-de-Marne', '11', 'Île-de-France'],
  ['95', "Val-d'Oise", '11', 'Île-de-France'],
  ['971', 'Guadeloupe', '01', 'Guadeloupe'],
  ['972', 'Martinique', '02', 'Martinique'],
  ['973', 'Guyane', '03', 'Guyane'],
  ['974', 'La Réunion', '04', 'La Réunion'],
  ['976', 'Mayotte', '06', 'Mayotte'],
];

exports.seedDepartmentsStaticHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const write = String(request.query.write || '1') !== '0';

      if (write) {
        let batch = db.batch();
        let count = 0;

        APPRENTIFR_DEPARTMENTS.forEach(([code, name, regionCode, regionName], index) => {
          const ref = db.collection('departments').doc(code);

          batch.set(
            ref,
            {
              code,
              departmentCode: code,
              name,
              label: name,
              regionCode,
              regionName,
              position: index + 1,
              country: 'France',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'departments.static.v2',
            },
            { merge: true }
          );

          count += 1;
        });

        await batch.commit();
      }

      response.json({
        ok: true,
        write,
        collection: 'departments',
        count: APPRENTIFR_DEPARTMENTS.length,
        sample: APPRENTIFR_DEPARTMENTS.slice(0, 5).map(([code, name, regionCode, regionName]) => ({
          code,
          name,
          regionCode,
          regionName,
        })),
      });
    } catch (error) {
      console.error('seedDepartmentsStaticHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// DEBUG_COMPANY_CONTEXT_V1

exports.debugCompanyContextHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      async function readSample(collectionName) {
        const snapshot = await db.collection(collectionName).limit(10).get();

        return {
          collection: collectionName,
          countSample: snapshot.size,
          docs: snapshot.docs.map((doc) => ({
            id: doc.id,
            data: doc.data(),
          })),
        };
      }

      const [departments, sectorStats, establishments] = await Promise.all([
        readSample('departments'),
        readSample('inseeDepartmentSectorStats'),
        readSample('inseeEstablishments'),
      ]);

      response.json({
        ok: true,
        departments,
        inseeDepartmentSectorStats: sectorStats,
        inseeEstablishments: establishments,
      });
    } catch (error) {
      console.error('debugCompanyContextHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// INSEE_DEPARTMENT_NAF_STATS_V1

function inseeNafNormalizeDepartmentCode(value) {
  const raw = String(value || '').trim().toUpperCase();

  if (!raw) return '';
  if (raw === '2A' || raw === '2B') return raw;
  if (/^\d$/.test(raw)) return `0${raw}`;
  if (raw.startsWith('97') && raw.length >= 3) return raw.slice(0, 3);

  return raw.slice(0, 2);
}

function inseeNafNormalizeNafCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\./g, '');
}

function inseeNafGetFirst(data, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let current = data;

    for (const part of parts) {
      current = current?.[part];
    }

    if (current !== undefined && current !== null && String(current).trim() !== '') {
      return current;
    }
  }

  return '';
}

function inseeNafExtractFields(data) {
  const siret = String(inseeNafGetFirst(data, [
    'siret',
    'raw.siret',
  ]) || '').trim();

  const siren = String(inseeNafGetFirst(data, [
    'siren',
    'raw.siren',
  ]) || siret.slice(0, 9)).trim();

  const departmentCode = inseeNafNormalizeDepartmentCode(inseeNafGetFirst(data, [
    'departmentCode',
    'department',
    'departement',
    'raw.departmentCode',
    'raw.department',
    'raw.departement',
  ]));

  const status = String(inseeNafGetFirst(data, [
    'status',
    'etatAdministratifEtablissement',
    'raw.etatAdministratifEtablissement',
  ]) || '').trim().toUpperCase();

  const employer = String(inseeNafGetFirst(data, [
    'employerCharacter',
    'caractereEmployeurEtablissement',
    'raw.caractereEmployeurEtablissement',
  ]) || '').trim().toUpperCase();

  const active = Boolean(
    data.active === true ||
      data.isActive === true ||
      String(data.active || '').toLowerCase() === 'true' ||
      status === 'A'
  );

  const employerOnlyImport = Boolean(
    data.importEmployerOnly === true ||
      String(data.importEmployerOnly || '').toLowerCase() === 'true'
  );

  const nafCode = inseeNafNormalizeNafCode(inseeNafGetFirst(data, [
    'nafCode',
    'apeCode',
    'activitePrincipaleEtablissement',
    'raw.activitePrincipaleEtablissement',
    'uniteLegale.activitePrincipaleUniteLegale',
    'raw.uniteLegale.activitePrincipaleUniteLegale',
  ]));

  const nafLabel = String(inseeNafGetFirst(data, [
    'nafLabel',
    'apeLabel',
    'libelleNaf',
    'raw.libelleNaf',
    'activitePrincipaleEtablissementLabel',
    'raw.activitePrincipaleEtablissementLabel',
  ]) || '').trim();

  return {
    siret,
    siren,
    departmentCode,
    status,
    employer,
    active,
    employerOnlyImport,
    nafCode: nafCode || 'UNKNOWN',
    nafLabel,
  };
}

function inseeNafSectorFromNafCode(nafCode) {
  const code = inseeNafNormalizeNafCode(nafCode);

  if (!code || code === 'UNKNOWN') {
    return ['unknown', 'Secteur inconnu'];
  }

  const division = code.slice(0, 2);

  if (['01', '02', '03'].includes(division)) {
    return ['agriculture', 'Agriculture / espaces naturels'];
  }

  if (['41', '42', '43'].includes(division)) {
    return ['btp', 'Bâtiment / travaux publics'];
  }

  if (['45', '46', '47'].includes(division)) {
    return ['commerce_vente', 'Commerce / vente'];
  }

  if (['49', '50', '51', '52', '53'].includes(division)) {
    return ['transport_logistique', 'Transport / logistique'];
  }

  if (['55', '56'].includes(division)) {
    return ['restauration_tourisme_loisirs', 'Hôtellerie / restauration / tourisme / loisirs'];
  }

  if (['58', '59', '60', '61', '62', '63'].includes(division)) {
    return ['communication_media', 'Communication / médias / numérique'];
  }

  if (['64', '65', '66', '68'].includes(division)) {
    return ['banque_immobilier', 'Banque / assurance / immobilier'];
  }

  if (['69', '70', '71', '72', '73', '74', '77', '78', '79', '80', '81', '82'].includes(division)) {
    return ['support_entreprise', 'Support administratif / entreprise'];
  }

  if (['86', '87'].includes(division)) {
    return ['sante', 'Santé'];
  }

  if (['84', '85', '88', '94', '96', '97', '98', '99'].includes(division)) {
    return ['services_social', 'Services / social / collectivité'];
  }

  if (['90', '91', '92', '93'].includes(division)) {
    return ['spectacle', 'Spectacle / sport / loisirs'];
  }

  if (
    ['05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16',
      '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27',
      '28', '29', '30', '31', '32', '33', '35', '36', '37', '38', '39'].includes(division)
  ) {
    return ['industrie', 'Industrie'];
  }

  return ['unknown', 'Secteur inconnu'];
}

exports.buildInseeDepartmentNafStatsHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const departmentCode = inseeNafNormalizeDepartmentCode(request.query.department || '');
      const write = String(request.query.write || '1') !== '0';
      const pageSize = Math.max(100, Math.min(Number.parseInt(String(request.query.pageSize || '1000'), 10), 5000));

      if (!departmentCode) {
        response.status(400).json({
          ok: false,
          error: 'Missing department',
        });
        return;
      }

      const startedAt = Date.now();

      let scannedCount = 0;
      let establishmentsCount = 0;
      let activeEstablishmentsCount = 0;
      let activeEmployerEstablishmentsCount = 0;

      const nafStats = new Map();
      let lastDoc = null;
      let hasMore = true;

      while (hasMore) {
        let firestoreQuery = db
          .collection('inseeEstablishments')
          .where('departmentCode', '==', departmentCode)
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(pageSize);

        if (lastDoc) {
          firestoreQuery = firestoreQuery.startAfter(lastDoc);
        }

        const snapshot = await firestoreQuery.get();

        if (snapshot.empty) {
          break;
        }

        snapshot.docs.forEach((doc) => {
          scannedCount += 1;

          const fields = inseeNafExtractFields(doc.data() || {});

          if (fields.departmentCode && fields.departmentCode !== departmentCode) {
            return;
          }

          const [sectorCode, sectorLabel] = inseeNafSectorFromNafCode(fields.nafCode);

          if (!nafStats.has(fields.nafCode)) {
            nafStats.set(fields.nafCode, {
              departmentCode,
              nafCode: fields.nafCode,
              nafLabel: fields.nafLabel || '',
              sectorCode,
              sectorLabel,
              establishmentsCount: 0,
              activeEstablishmentsCount: 0,
              activeEmployerEstablishmentsCount: 0,
              sirets: 0,
              sirens: new Set(),
            });
          }

          const stat = nafStats.get(fields.nafCode);

          if (!stat.nafLabel && fields.nafLabel) {
            stat.nafLabel = fields.nafLabel;
          }

          stat.establishmentsCount += 1;
          establishmentsCount += 1;

          if (fields.siret) {
            stat.sirets += 1;
          }

          if (fields.siren) {
            stat.sirens.add(fields.siren);
          }

          const isActive = fields.active === true || fields.status === 'A';
          const isEmployer = fields.employer === 'O' || fields.employerOnlyImport === true;

          if (isActive) {
            stat.activeEstablishmentsCount += 1;
            activeEstablishmentsCount += 1;
          }

          if (isActive && isEmployer) {
            stat.activeEmployerEstablishmentsCount += 1;
            activeEmployerEstablishmentsCount += 1;
          }
        });

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        hasMore = snapshot.docs.length === pageSize;
      }

      const rows = Array.from(nafStats.values())
        .map((item) => ({
          departmentCode: item.departmentCode,
          nafCode: item.nafCode,
          nafLabel: item.nafLabel,
          sectorCode: item.sectorCode,
          sectorLabel: item.sectorLabel,
          establishmentsCount: item.establishmentsCount,
          activeEstablishmentsCount: item.activeEstablishmentsCount,
          activeEmployerEstablishmentsCount: item.activeEmployerEstablishmentsCount,
          siretsCount: item.sirets,
          sirensCount: item.sirens.size,
        }))
        .sort((a, b) => b.activeEmployerEstablishmentsCount - a.activeEmployerEstablishmentsCount);

      if (write) {
        let batch = db.batch();
        let batchOperations = 0;
        let committedBatches = 0;
        let writtenRows = 0;

        async function commitCurrentBatchIfNeeded(force = false) {
          if (batchOperations === 0) {
            return;
          }

          if (!force && batchOperations < 400) {
            return;
          }

          await batch.commit();

          committedBatches += 1;
          batch = db.batch();
          batchOperations = 0;
        }

        for (const row of rows) {
          const docId = `${departmentCode}_${row.nafCode}`.replace(/[\/#?\[\]]/g, '_');

          batch.set(
            db.collection('inseeDepartmentNafStats').doc(docId),
            {
              ...row,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'inseeDepartmentNafStats.v1',
            },
            { merge: true }
          );

          batchOperations += 1;
          writtenRows += 1;

          await commitCurrentBatchIfNeeded(false);
        }

        await commitCurrentBatchIfNeeded(true);

        await db.collection('inseeDepartmentNafStatsIndex').doc(departmentCode).set(
          {
            departmentCode,
            totals: {
              establishmentsCount,
              activeEstablishmentsCount,
              activeEmployerEstablishmentsCount,
            },
            nafCount: rows.length,
            writtenRows,
            committedBatches,
            topNaf: rows.slice(0, 30),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            schemaVersion: 'inseeDepartmentNafStatsIndex.v1',
          },
          { merge: true }
        );
      }

      response.json({
        ok: true,
        write,
        departmentCode,
        scannedCount,
        totals: {
          establishmentsCount,
          activeEstablishmentsCount,
          activeEmployerEstablishmentsCount,
        },
        nafCount: rows.length,
        topNaf: rows.slice(0, 30),
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.error('buildInseeDepartmentNafStatsHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// DEBUG_FIND_INSEE_ESTABLISHMENT_V1

function debugFindInseeNormalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

exports.debugFindInseeEstablishmentHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 120,
    memory: '512MiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const q = debugFindInseeNormalizeText(request.query.q || '');
      const department = String(request.query.department || '').trim().toUpperCase();
      const nafCode = String(request.query.nafCode || '').trim().toUpperCase();
      const siret = String(request.query.siret || '').trim();
      const limit = Math.max(1, Math.min(Number.parseInt(String(request.query.limit || '1000'), 10), 5000));

      let firestoreQuery = db.collection('inseeEstablishments');

      if (siret) {
        const doc = await firestoreQuery.doc(siret).get();

        response.json({
          ok: true,
          mode: 'siret',
          found: doc.exists,
          docs: doc.exists ? [{ id: doc.id, data: doc.data() }] : [],
        });
        return;
      }

      if (department) {
        firestoreQuery = firestoreQuery.where('departmentCode', '==', department);
      }

      if (nafCode) {
        firestoreQuery = firestoreQuery.where('nafCode', '==', nafCode);
      }

      const snapshot = await firestoreQuery.limit(limit).get();

      const docs = snapshot.docs
        .map((doc) => {
          const data = doc.data() || {};

          const searchable = debugFindInseeNormalizeText([
            doc.id,
            data.siret,
            data.siren,
            data.denominationUniteLegale,
            data.nomUniteLegale,
            data.enseigne1Etablissement,
            data.enseigne2Etablissement,
            data.enseigne3Etablissement,
            data.nomCommercial,
            data.city,
            data.postalCode,
            data.nafCode,
            data.sectorCode,
            data.sectorLabel,
          ].join(' '));

          return {
            id: doc.id,
            searchable,
            data,
          };
        })
        .filter((item) => {
          if (!q) return true;
          return item.searchable.includes(q);
        })
        .slice(0, 50)
        .map((item) => ({
          id: item.id,
          data: item.data,
        }));

      response.json({
        ok: true,
        mode: 'scan',
        query: request.query.q || '',
        normalizedQuery: q,
        department,
        nafCode,
        scannedCount: snapshot.size,
        returnedCount: docs.length,
        docs,
      });
    } catch (error) {
      console.error('debugFindInseeEstablishmentHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// IMPORT_INSEE_DEPARTMENT_ESTABLISHMENTS_V1
// Import riche des établissements Sirene/INSEE par département vers inseeEstablishments.
// Dépendances attendues déjà présentes dans index.js :
// - onRequest
// - admin
// - db
// - sleep
// - INSEE_API_KEY
// - BACKFILL_ADMIN_KEY

const IID_SOURCE = 'api-sirene-insee';
const IID_SCHEMA_VERSION = 'inseeEstablishments.v2';

const IID_NAF_LABEL_FALLBACK = {
  '5610A': 'Restauration traditionnelle',
  '5610B': 'Cafétérias et autres libres-services',
  '5610C': 'Restauration de type rapide',
  '5621Z': 'Services des traiteurs',
  '5629A': 'Restauration collective sous contrat',
  '5629B': 'Autres services de restauration',
  '5630Z': 'Débits de boissons',
  '5510Z': 'Hôtels et hébergement similaire',
  '5520Z': 'Hébergement touristique et autre hébergement de courte durée',
  '5590Z': 'Autres hébergements',
  '9311Z': 'Gestion d’installations sportives',
  '9312Z': 'Activités de clubs de sports',
  '9313Z': 'Activités des centres de culture physique',
  '9319Z': 'Autres activités liées au sport',
  '8551Z': 'Enseignement de disciplines sportives et d’activités de loisirs',
  '4711B': 'Commerce d’alimentation générale',
  '4711C': 'Supérettes',
  '4711D': 'Supermarchés',
  '4711F': 'Hypermarchés',
  '4321A': 'Travaux d’installation électrique dans tous locaux',
  '4322A': 'Travaux d’installation d’eau et de gaz',
  '4332A': 'Travaux de menuiserie bois et PVC',
  '4399C': 'Travaux de maçonnerie générale et gros œuvre de bâtiment',
  '8610Z': 'Activités hospitalières',
  '8621Z': 'Activité des médecins généralistes',
  '8690D': 'Activités des infirmiers et des sages-femmes',
  '8690F': 'Activités de santé humaine non classées ailleurs',
  '4941A': 'Transports routiers de fret interurbains',
  '4941B': 'Transports routiers de fret de proximité',
  '5229A': 'Messagerie, fret express',
  '6201Z': 'Programmation informatique',
  '6202A': 'Conseil en systèmes et logiciels informatiques',
  '6209Z': 'Autres activités informatiques',
  '6311Z': 'Traitement de données, hébergement et activités connexes',
  '7022Z': 'Conseil pour les affaires et autres conseils de gestion',
  '7112B': 'Ingénierie, études techniques',
  '7311Z': 'Activités des agences de publicité',
  '7410Z': 'Activités spécialisées de design',
  '8211Z': 'Services administratifs combinés de bureau',
  '8299Z': 'Autres activités de soutien aux entreprises',
};

function iidString(value) {
  return String(value ?? '').trim();
}

function iidNullableString(value) {
  const clean = iidString(value);
  return clean || '';
}

function iidBooleanQuery(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'oui', 'on'].includes(String(value).toLowerCase());
}

function iidNumberQuery(value, defaultValue, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, Math.floor(number)));
}

function iidIncrement(counter, key, amount = 1) {
  const cleanKey = iidString(key) || 'unknown';
  counter[cleanKey] = (counter[cleanKey] || 0) + amount;
}

function iidCleanSiret(value) {
  const siret = String(value || '').replace(/\D/g, '');
  return /^\d{14}$/.test(siret) ? siret : '';
}

function iidCleanSiren(value) {
  const siren = String(value || '').replace(/\D/g, '');
  return /^\d{9}$/.test(siren) ? siren : '';
}

function iidCleanNafCode(value) {
  const naf = iidString(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\./g, '');

  return /^[0-9]{4}[A-Z]$/.test(naf) ? naf : '';
}

function iidNormalizeRequestedDepartment(value) {
  const raw = iidString(value).toUpperCase();

  if (!raw) return '';

  if (raw === '2A' || raw === '2B') return raw;
  if (/^97[1-6]$/.test(raw)) return raw;
  if (/^[1-9]$/.test(raw)) return `0${raw}`;
  if (/^[0-9]{2}$/.test(raw)) return raw;

  return '';
}

function iidDepartmentFromPostalAndCommune(postalCode, codeCommune) {
  const postal = iidString(postalCode);
  const commune = iidString(codeCommune).toUpperCase();

  if (postal.startsWith('97')) {
    return postal.slice(0, 3);
  }

  if (postal.startsWith('20')) {
    if (commune.startsWith('2A')) return '2A';
    if (commune.startsWith('2B')) return '2B';

    const postalNumber = Number(postal.slice(0, 3));

    if (Number.isFinite(postalNumber)) {
      if (postalNumber >= 200 && postalNumber <= 201) return '2A';
      if (postalNumber >= 202 && postalNumber <= 206) return '2B';
    }

    return '20';
  }

  if (/^[0-9]{5}$/.test(postal)) {
    return postal.slice(0, 2);
  }

  if (commune.startsWith('2A')) return '2A';
  if (commune.startsWith('2B')) return '2B';
  if (/^97[1-6]/.test(commune)) return commune.slice(0, 3);
  if (/^[0-9]{5}$/.test(commune)) return commune.slice(0, 2);

  return '';
}

function iidPostalPrefixForDepartment(departmentCode) {
  const code = iidNormalizeRequestedDepartment(departmentCode);

  if (!code) {
    return '';
  }

  if (code === '2A' || code === '2B') {
    return '20';
  }

  return code;
}

function iidQueryFilterForDepartment(departmentCode, options = {}) {
  const code = iidNormalizeRequestedDepartment(departmentCode);
  const postalPrefix = iidPostalPrefixForDepartment(code);

  if (!code || !postalPrefix) {
    return '';
  }

  const employerOnly = options.employerOnly !== false;
  const activeOnly = options.activeOnly === true;

  const filters = [];

  if (employerOnly) {
    filters.push('periode(etatAdministratifEtablissement:A AND caractereEmployeurEtablissement:O)');
  } else if (activeOnly) {
    filters.push('periode(etatAdministratifEtablissement:A)');
  }

  filters.push(`codePostalEtablissement:${postalPrefix}*`);

  return filters.join(' AND ');
}

function iidSectorFromNafCode(nafCode) {
  const naf = iidCleanNafCode(nafCode);

  if (!naf) {
    return ['unknown', 'Secteur inconnu'];
  }

  const division = Number(naf.slice(0, 2));

  if (division >= 1 && division <= 3) {
    return ['agriculture', 'Agriculture / espaces naturels'];
  }

  if (division >= 5 && division <= 39) {
    return ['industrie', 'Industrie'];
  }

  if (division >= 41 && division <= 43) {
    return ['btp', 'Bâtiment / travaux publics'];
  }

  if (division >= 45 && division <= 47) {
    return ['commerce_vente', 'Commerce / vente'];
  }

  if (division >= 49 && division <= 53) {
    return ['transport_logistique', 'Transport / logistique'];
  }

  if (division >= 55 && division <= 56) {
    return ['restauration_tourisme_loisirs', 'Hôtellerie / restauration / tourisme / loisirs'];
  }

  if (division >= 58 && division <= 63) {
    return ['communication_media', 'Communication / médias / numérique'];
  }

  if ([64, 65, 66, 68].includes(division)) {
    return ['banque_immobilier', 'Banque / assurance / immobilier'];
  }

  if (division >= 69 && division <= 82) {
    return ['support_entreprise', 'Support administratif / entreprise'];
  }

  if (division === 86 || division === 87) {
    return ['sante', 'Santé'];
  }

  if (division >= 90 && division <= 93) {
    return ['spectacle', 'Spectacle / sport / loisirs'];
  }

  if ([84, 85, 88, 94, 95, 96, 97, 98, 99].includes(division)) {
    return ['services_social', 'Services / social / collectivité'];
  }

  return ['unknown', 'Secteur inconnu'];
}

function iidGetNafLabel(etablissement, uniteLegale, nafCode) {
  return (
    iidNullableString(etablissement?.libelleActivitePrincipaleEtablissement) ||
    iidNullableString(etablissement?.libelleNaf) ||
    iidNullableString(etablissement?.nafLabel) ||
    iidNullableString(uniteLegale?.libelleActivitePrincipaleUniteLegale) ||
    iidNullableString(uniteLegale?.libelleNaf) ||
    IID_NAF_LABEL_FALLBACK[nafCode] ||
    ''
  );
}

function iidAddressFromEtablissement(adresse, postalCode, city) {
  return [
    adresse?.numeroVoieEtablissement,
    adresse?.indiceRepetitionEtablissement,
    adresse?.typeVoieEtablissement,
    adresse?.libelleVoieEtablissement,
    postalCode,
    city,
  ]
    .map(iidString)
    .filter(Boolean)
    .join(' ');
}

function iidNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function iidLatitudeFromEtablissement(etablissement, adresse) {
  return iidNumberOrNull(
    etablissement?.latitude ||
    etablissement?.lat ||
    adresse?.latitude ||
    adresse?.lat ||
    adresse?.latitudeEtablissement
  );
}

function iidLongitudeFromEtablissement(etablissement, adresse) {
  return iidNumberOrNull(
    etablissement?.longitude ||
    etablissement?.lon ||
    etablissement?.lng ||
    adresse?.longitude ||
    adresse?.lon ||
    adresse?.lng ||
    adresse?.longitudeEtablissement
  );
}


function iidCurrentPeriodFromEtablissement(etablissement) {
  const periodes = Array.isArray(etablissement?.periodesEtablissement)
    ? etablissement.periodesEtablissement
    : [];

  if (!periodes.length) {
    return {};
  }

  return (
    periodes.find((periode) => !periode.dateFin && !periode.dateFinEtablissement) ||
    periodes.find((periode) => !periode.dateFin) ||
    periodes.find((periode) => !periode.dateFinEtablissement) ||
    periodes[0] ||
    {}
  );
}

function iidCompanyNameFromUniteLegale(uniteLegale) {
  const denomination = iidNullableString(uniteLegale?.denominationUniteLegale);
  const nom = iidNullableString(uniteLegale?.nomUniteLegale);
  const prenom1 = iidNullableString(uniteLegale?.prenom1UniteLegale);
  const prenom2 = iidNullableString(uniteLegale?.prenom2UniteLegale);
  const prenom3 = iidNullableString(uniteLegale?.prenom3UniteLegale);
  const prenom4 = iidNullableString(uniteLegale?.prenom4UniteLegale);

  return (
    denomination ||
    [prenom1, prenom2, prenom3, prenom4, nom].filter(Boolean).join(' ') ||
    nom ||
    ''
  );
}

function iidNormalizeEtablissement(etablissement, options) {
  const requestedDepartmentCode = options.departmentCode;
  const importEmployerOnly = options.employerOnly;
  const importActiveOnly = options.activeOnly;
  const includeRaw = options.includeRaw;

  const adresse = etablissement?.adresseEtablissement || {};
  const uniteLegale = etablissement?.uniteLegale || {};
  const currentPeriod = iidCurrentPeriodFromEtablissement(etablissement);

  const siret = iidCleanSiret(etablissement?.siret);
  const siren = iidCleanSiren(etablissement?.siren || uniteLegale?.siren || siret.slice(0, 9));

  const postalCode = iidNullableString(adresse?.codePostalEtablissement);
  const codeCommune = iidNullableString(adresse?.codeCommuneEtablissement);
  const city = iidNullableString(adresse?.libelleCommuneEtablissement);

  const departmentCode = iidDepartmentFromPostalAndCommune(postalCode, codeCommune);

  const nafCode = iidCleanNafCode(
    currentPeriod?.activitePrincipaleEtablissement ||
    etablissement?.activitePrincipaleEtablissement ||
    uniteLegale?.activitePrincipaleUniteLegale
  );

  const nafNomenclature = iidNullableString(
    currentPeriod?.nomenclatureActivitePrincipaleEtablissement ||
    etablissement?.nomenclatureActivitePrincipaleEtablissement ||
    uniteLegale?.nomenclatureActivitePrincipaleUniteLegale
  );

  const nafLabel = iidGetNafLabel(etablissement, uniteLegale, nafCode);
  const [sectorCode, sectorLabel] = iidSectorFromNafCode(nafCode);

  const etatAdministratifEtablissement = iidNullableString(
    currentPeriod?.etatAdministratifEtablissement ||
    etablissement?.etatAdministratifEtablissement
  );

  const caractereEmployeurEtablissement = iidNullableString(
    currentPeriod?.caractereEmployeurEtablissement ||
    etablissement?.caractereEmployeurEtablissement
  );

  const active = etatAdministratifEtablissement === 'A';

  const denominationUniteLegale = iidNullableString(uniteLegale?.denominationUniteLegale);
  const nomUniteLegale = iidNullableString(uniteLegale?.nomUniteLegale);

  const enseigne1Etablissement = iidNullableString(
    currentPeriod?.enseigne1Etablissement ||
    etablissement?.enseigne1Etablissement
  );

  const enseigne2Etablissement = iidNullableString(
    currentPeriod?.enseigne2Etablissement ||
    etablissement?.enseigne2Etablissement
  );

  const enseigne3Etablissement = iidNullableString(
    currentPeriod?.enseigne3Etablissement ||
    etablissement?.enseigne3Etablissement
  );

  const nomCommercial = (
    iidNullableString(currentPeriod?.nomCommercialEtablissement) ||
    iidNullableString(etablissement?.nomCommercial) ||
    iidNullableString(etablissement?.nomCommercialEtablissement) ||
    iidNullableString(uniteLegale?.nomCommercial) ||
    ''
  );

  const companyName = iidCompanyNameFromUniteLegale(uniteLegale);
  const establishmentName = [enseigne1Etablissement, enseigne2Etablissement, enseigne3Etablissement]
    .filter(Boolean)
    .join(' / ');

  const doc = {
    siret,
    siren,

    departmentCode,
    importDepartmentCode: requestedDepartmentCode,

    postalCode,
    city,
    codeCommune,
    address: iidAddressFromEtablissement(adresse, postalCode, city),
    latitude: iidLatitudeFromEtablissement(etablissement, adresse),
    longitude: iidLongitudeFromEtablissement(etablissement, adresse),

    nafCode,
    nafLabel,
    nafNomenclature,

    sectorCode,
    sectorLabel,

    active,
    etatAdministratifEtablissement,
    caractereEmployeurEtablissement,

    importEmployerOnly,
    importActiveOnly,

    trancheEffectifsEtablissement: iidNullableString(
      etablissement?.trancheEffectifsEtablissement ||
      currentPeriod?.trancheEffectifsEtablissement
    ),

    categorieJuridiqueUniteLegale: iidNullableString(uniteLegale?.categorieJuridiqueUniteLegale),

    denominationUniteLegale,
    nomUniteLegale,
    enseigne1Etablissement,
    enseigne2Etablissement,
    enseigne3Etablissement,
    nomCommercial,

    companyName,
    establishmentName,

    dateCreationEtablissement: iidNullableString(etablissement?.dateCreationEtablissement),
    dateDernierTraitementEtablissement: iidNullableString(etablissement?.dateDernierTraitementEtablissement),

    source: IID_SOURCE,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: IID_SCHEMA_VERSION,
  };

  if (includeRaw) {
    doc.raw = etablissement;
  }

  return doc;
}

function iidShouldKeepDocument(doc, options) {
  if (!doc.siret) {
    return [false, 'missing_siret'];
  }

  if (options.departmentCode && doc.departmentCode && doc.departmentCode !== options.departmentCode) {
    return [false, 'outside_department'];
  }

  if (options.activeOnly && !doc.active) {
    return [false, 'inactive'];
  }

  if (options.employerOnly) {
    // Cas normal : l'API renvoie le champ employeur.
    if (doc.caractereEmployeurEtablissement) {
      return [doc.caractereEmployeurEtablissement === 'O', 'not_employer'];
    }

    // Cas important : si la requête INSEE a déjà filtré employeur,
    // on garde le document même si le champ n'est pas restitué.
    return [doc.importEmployerOnly === true, 'not_employer'];
  }

  return [true, 'kept'];
}

async function iidFetchSirenePage({ inseeApiKey, departmentCode, cursor, pageSize, employerOnly = true, activeOnly = false }) {
  const departmentFilter = iidQueryFilterForDepartment(departmentCode, { employerOnly, activeOnly });

  if (!departmentFilter) {
    throw new Error('Filtre département INSEE invalide');
  }

  const url = new URL('https://api.insee.fr/api-sirene/3.11/siret');
  url.searchParams.set('q', departmentFilter);
  url.searchParams.set('nombre', String(pageSize));
  url.searchParams.set('curseur', cursor || '*');
  url.searchParams.set('masquerValeursNulles', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-INSEE-Api-Key-Integration': inseeApiKey,
    },
  });

  const bodyText = await response.text();

  let json = null;

  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch (parseError) {
    json = null;
  }

  if (!response.ok) {
    const error = new Error(`INSEE HTTP ${response.status}`);
    error.status = response.status;
    error.body = bodyText.slice(0, 1500);
    error.query = {
      q: departmentFilter,
      nombre: pageSize,
      curseur: cursor || '*',
    };
    throw error;
  }

  if (!json || typeof json !== 'object') {
    const error = new Error('Réponse INSEE JSON invalide');
    error.status = response.status;
    error.body = bodyText.slice(0, 1500);
    throw error;
  }

  return json;
}

async function iidCommitDocuments(docs) {
  let writtenCount = 0;

  for (let index = 0; index < docs.length; index += 450) {
    const batch = db.batch();
    const slice = docs.slice(index, index + 450);

    for (const doc of slice) {
      if (!doc.siret) continue;

      batch.set(
        db.collection('inseeEstablishments').doc(doc.siret),
        doc,
        { merge: true }
      );

      writtenCount += 1;
    }

    if (slice.length > 0) {
      await batch.commit();
    }
  }

  return writtenCount;
}

function iidCompactSample(doc) {
  return {
    siret: doc.siret,
    active: doc.active,
    nafCode: doc.nafCode,
    nafLabel: doc.nafLabel,
    sectorCode: doc.sectorCode,
    sectorLabel: doc.sectorLabel,
    postalCode: doc.postalCode,
    city: doc.city,
    departmentCode: doc.departmentCode,
    denominationUniteLegale: doc.denominationUniteLegale,
    enseigne1Etablissement: doc.enseigne1Etablissement,
  };
}

exports.importInseeDepartmentEstablishmentsHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [INSEE_API_KEY, BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const expectedAdminKey = BACKFILL_ADMIN_KEY.value();
      const providedAdminKey =
        request.get('x-admin-key') ||
        request.query.adminKey ||
        '';

      if (!expectedAdminKey || providedAdminKey !== expectedAdminKey) {
        response.status(403).json({
          ok: false,
          error: 'Accès refusé',
        });
        return;
      }

      const inseeApiKey = INSEE_API_KEY.value();

      if (!inseeApiKey) {
        response.status(500).json({
          ok: false,
          error: 'Secret INSEE_API_KEY absent ou vide',
        });
        return;
      }

      const departmentCode = iidNormalizeRequestedDepartment(request.query.department);

      if (!departmentCode) {
        response.status(400).json({
          ok: false,
          error: 'Paramètre department obligatoire ou invalide',
          expected: 'Exemples : 72, 01, 2A, 2B, 971',
        });
        return;
      }

      const write = iidBooleanQuery(request.query.write, false);
      const pageSize = iidNumberQuery(request.query.pageSize ?? request.query.nombre, 500, 1, 1000);
      const initialCursor = iidString(request.query.cursor) || '*';
      const employerOnly = iidBooleanQuery(request.query.employerOnly, true);
      const activeOnly = iidBooleanQuery(request.query.activeOnly, false);
      const maxPages = iidNumberQuery(request.query.maxPages, 1, 1, 250);
      const sleepMs = iidNumberQuery(request.query.sleepMs, 0, 0, 5000);
      const includeRaw = iidBooleanQuery(request.query.raw, false);

      let cursor = initialCursor;
      let nextCursor = initialCursor;
      let complete = false;
      let pagesRead = 0;

      let receivedCount = 0;
      let keptCount = 0;
      let writtenCount = 0;
      let skippedCount = 0;

      const skippedReasons = {};
      const nafCounter = {};
      const sectorCounter = {};
      const departmentCounter = {};
      const sample = [];
      let lastHeader = null;

      while (pagesRead < maxPages) {
        const payload = await iidFetchSirenePage({
          inseeApiKey,
          departmentCode,
          cursor,
          pageSize,
          employerOnly,
          activeOnly,
        });

        const header = payload.header || {};
        const etablissements = Array.isArray(payload.etablissements)
          ? payload.etablissements
          : [];

        lastHeader = {
          statut: header.statut ?? null,
          message: header.message ?? null,
          total: header.total ?? null,
          debut: header.debut ?? null,
          nombre: header.nombre ?? null,
          curseur: header.curseur ?? cursor,
          curseurSuivant: header.curseurSuivant ?? null,
        };

        receivedCount += etablissements.length;

        const docsToWrite = [];

        for (const etablissement of etablissements) {
          const doc = iidNormalizeEtablissement(etablissement, {
            departmentCode,
            employerOnly,
            activeOnly,
            includeRaw,
          });

          iidIncrement(departmentCounter, doc.departmentCode || 'unknown');

          const [keep, reason] = iidShouldKeepDocument(doc, {
            departmentCode,
            employerOnly,
            activeOnly,
          });

          if (!keep) {
            skippedCount += 1;
            iidIncrement(skippedReasons, reason);
            continue;
          }

          keptCount += 1;
          iidIncrement(nafCounter, doc.nafCode || 'UNKNOWN');
          iidIncrement(sectorCounter, doc.sectorCode || 'unknown');

          if (sample.length < 10) {
            sample.push(iidCompactSample(doc));
          }

          docsToWrite.push(doc);
        }

        if (write && docsToWrite.length > 0) {
          writtenCount += await iidCommitDocuments(docsToWrite);
        }

        const headerNextCursor = iidString(header.curseurSuivant);
        pagesRead += 1;

        if (!headerNextCursor || headerNextCursor === cursor || etablissements.length === 0) {
          complete = true;
          nextCursor = headerNextCursor || null;
          break;
        }

        cursor = headerNextCursor;
        nextCursor = headerNextCursor;

        if (pagesRead >= maxPages) {
          complete = false;
          break;
        }

        if (sleepMs > 0) {
          await sleep(sleepMs);
        }
      }

      await db.collection('inseeDepartmentImportIndex').doc(departmentCode).set(
        {
          departmentCode,
          cursor: initialCursor,
          nextCursor,
          complete,
          write,
          pageSize,
          pagesRead,
          maxPages,
          receivedCount,
          keptCount,
          writtenCount,
          skippedCount,
          skippedReasons,
          employerOnly,
          activeOnly,
          rawIncluded: includeRaw,
          nafCounter,
          sectorCounter,
          departmentCounter,
          header: lastHeader,
          source: IID_SOURCE,
          schemaVersion: 'inseeDepartmentImportIndex.v2',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      response.json({
        ok: true,
        write,
        departmentCode,
        cursor: initialCursor,
        nextCursor,
        complete,
        pageSize,
        pagesRead,
        maxPages,
        receivedCount,
        keptCount,
        writtenCount,
        skippedCount,
        skippedReasons,
        employerOnly,
        activeOnly,
        rawIncluded: includeRaw,
        nafCounter,
        sectorCounter,
        departmentCounter,
        sample,
        header: lastHeader,
      });
    } catch (error) {
      console.error('importInseeDepartmentEstablishmentsHttp error', error);

      response.status(500).json({
        ok: false,
        error: error.message,
        status: error.status || null,
        body: error.body || null,
        query: error.query || null,
      });
    }
  }
);

// PURGE_INSEE_COLLECTION_BATCH_V1

const PURGE_INSEE_ALLOWED_COLLECTIONS = new Set([
  'inseeEstablishments',
  'inseeDepartmentStats',
  'inseeDepartmentSectorStats',
  'inseeDepartmentNafStats',
  'inseeDepartmentNafStatsIndex',
  'inseeDepartmentImportIndex',
]);

exports.purgeInseeCollectionBatchHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const collectionName = String(request.query.collection || '').trim();
      const dryRun = String(request.query.dryRun || '0') === '1';
      const limit = Math.max(
        1,
        Math.min(Number.parseInt(String(request.query.limit || '400'), 10), 450)
      );
      const cursor = String(request.query.cursor || '').trim();

      if (!PURGE_INSEE_ALLOWED_COLLECTIONS.has(collectionName)) {
        response.status(400).json({
          ok: false,
          error: 'Collection non autorisée',
          collection: collectionName,
          allowedCollections: Array.from(PURGE_INSEE_ALLOWED_COLLECTIONS).sort(),
        });
        return;
      }

      let query = db
        .collection(collectionName)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(limit);

      if (cursor) {
        query = query.startAfter(cursor);
      }

      const snapshot = await query.get();

      if (snapshot.empty) {
        response.json({
          ok: true,
          dryRun,
          collection: collectionName,
          limit,
          cursor: cursor || null,
          deletedCount: 0,
          matchedCount: 0,
          hasMore: false,
          nextCursor: null,
          sampleIds: [],
        });
        return;
      }

      const docs = snapshot.docs;
      const sampleIds = docs.slice(0, 10).map((doc) => doc.id);
      const lastDoc = docs[docs.length - 1];
      const nextCursor = lastDoc.id;
      const hasMore = docs.length === limit;

      if (!dryRun) {
        const batch = db.batch();

        docs.forEach((doc) => {
          batch.delete(doc.ref);
        });

        await batch.commit();
      }

      response.json({
        ok: true,
        dryRun,
        collection: collectionName,
        limit,
        cursor: cursor || null,
        deletedCount: dryRun ? 0 : docs.length,
        matchedCount: docs.length,
        hasMore,
        nextCursor,
        sampleIds,
      });
    } catch (error) {
      console.error('purgeInseeCollectionBatchHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);

// IMPORT_DAILY_OFFERS_HTTP_V1

function normalizeManualOfferImportDate(value) {
  const clean = String(value || '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }

  return parisDateString(new Date());
}

function parseDepartmentListParam(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}



function safeOfferObservationId(value) {
  return Buffer
    .from(String(value || ''))
    .toString('base64url')
    .slice(0, 500);
}

function daysBetweenDateStrings(startDateString, endDateString) {
  if (!startDateString || !endDateString) return null;

  const start = new Date(`${startDateString}T12:00:00.000Z`);
  const end = new Date(`${endDateString}T12:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function normalizeJobOfferObservation(job, department, targetDate) {
  const identifier = job?.identifier || {};
  const offer = job?.offer || {};
  const workplace = job?.workplace || {};
  const domain = workplace?.domain || {};
  const location = workplace?.location || {};
  const publication = offer?.publication || {};

  const offerId = getJobId(job);

  const creationRaw = publication.creation || null;
  const expirationRaw = publication.expiration || null;

  const creationDate = creationRaw ? parisDateString(new Date(creationRaw)) : null;
  const expirationDate = expirationRaw ? parisDateString(new Date(expirationRaw)) : null;

  const daysUntilExpiration = expirationDate
    ? daysBetweenDateStrings(targetDate, expirationDate)
    : null;

  const publicationDurationDays =
    creationDate && expirationDate
      ? daysBetweenDateStrings(creationDate, expirationDate)
      : null;

  return {
    date: targetDate,
    departmentCode: department.code,
    departmentName: department.name,

    offerId,
    partnerLabel: identifier.partner_label || null,
    partnerJobId: identifier.partner_job_id || null,

    title: offer.title || null,
    status: offer.status || 'Active',
    openingCount: Number(offer.opening_count || 0),
    romeCodes: Array.isArray(offer.rome_codes) ? offer.rome_codes : [],

    creationRaw,
    expirationRaw,
    creationDate,
    expirationDate,
    publicationDurationDays,
    daysUntilExpiration,

    isCreatedToday: creationDate === targetDate,
    expiresWithin7Days:
      typeof daysUntilExpiration === 'number' &&
      daysUntilExpiration >= 0 &&
      daysUntilExpiration <= 7,

    workplaceName: workplace.name || null,
    workplaceSiret: workplace.siret || null,
    workplaceBrand: workplace.brand || null,
    workplaceLegalName: workplace.legal_name || null,
    workplaceCity: location.city || null,
    workplaceZipcode: location.zipcode || null,
    workplaceDepartment: location.department || null,

    nafCode: domain?.naf?.code || null,
    nafLabel: domain?.naf?.label || null,
    opco: domain?.opco || null,
    idcc: domain?.idcc || null,

    source: 'api-apprentissage-job-v1-search',
    observedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'jobOfferObservations.v1',
  };
}


async function importDailyOffersForDepartments({
  targetDate,
  departmentCodes,
  token,
  write = true,
  publish = false,
  delayMs = 1200,
}) {
  const allDepartments = await loadDepartments();
  const wanted = new Set(departmentCodes || []);

  const departments = wanted.size > 0
    ? allDepartments.filter((department) => wanted.has(String(department.code || '').toUpperCase()))
    : allDepartments;

  let successCount = 0;
  let errorCount = 0;
  const rows = [];

  for (const department of departments) {
    try {
      const result = await fetchDepartment(department.code, token);

      const todayJobs = result.jobs.filter((job) => {
        return getJobCreationDate(job) === targetDate;
      });

      const expiringSoonJobs = result.jobs.filter((job) => {
        const expirationDate = getJobExpirationDate(job);
        return (
          expirationDate &&
          expirationDate >= targetDate &&
          expirationDate <= dateWithOffsetFromDateString(targetDate, 7)
        );
      });

      const activeOfferIds = result.jobs.map(getJobId).filter(Boolean);

      const offerObservations = result.jobs
        .map((job) => normalizeJobOfferObservation(job, department, targetDate))
        .filter((item) => item.offerId);

      const previousDate = dateWithOffsetFromDateString(targetDate, -1);
      const previousId = `${previousDate}_${department.code}`;
      const previousSnapshot = await db.collection('departmentDailyStats').doc(previousId).get();
      const previousData = previousSnapshot.exists ? previousSnapshot.data() : {};
      const previousActiveIds = Array.isArray(previousData.activeOfferIds)
        ? previousData.activeOfferIds
        : [];

      const activeSet = new Set(activeOfferIds);
      const notSeenSinceYesterdayIds = previousActiveIds.filter((id) => !activeSet.has(id));

      const aggregation = aggregateJobs(todayJobs);

      const dailyDocument = {
        date: targetDate,
        code: department.code,
        departmentCode: department.code,
        name: department.name,
        departmentName: department.name,

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
        schemaVersion: 'departmentDailyStats.lba.manual.v1',
      };

      const sectorStats = buildDepartmentSectorStats(todayJobs, department, targetDate);

      if (write) {
        await db
          .collection('departmentDailyStats')
          .doc(`${targetDate}_${department.code}`)
          .set(dailyDocument, { merge: true });

        let observationBatch = db.batch();
        let observationBatchCount = 0;

        for (const observation of offerObservations) {
          const docId = `${targetDate}_${department.code}_${safeOfferObservationId(observation.offerId)}`;

          observationBatch.set(
            db.collection('jobOfferObservations').doc(docId),
            observation,
            { merge: true }
          );

          observationBatchCount += 1;

          if (observationBatchCount >= 400) {
            await observationBatch.commit();
            observationBatch = db.batch();
            observationBatchCount = 0;
          }
        }

        if (observationBatchCount > 0) {
          await observationBatch.commit();
        }

        const batch = db.batch();

        sectorStats.forEach((sector) => {
          const documentId = `${department.code}_${sector.sectorCode}`;
          const reference = db.collection('departmentSectorStats').doc(documentId);
          batch.set(reference, sector, { merge: true });
        });

        if (sectorStats.length > 0) {
          await batch.commit();
        }
      }

      successCount += 1;

      rows.push({
        ok: true,
        departmentCode: department.code,
        departmentName: department.name,
        returnedActiveJobsCount: result.jobs.length,
        jobsCount: todayJobs.length,
        openingCount: countOpening(todayJobs),
        recruitersCount: result.recruiters.length,
        warningsCount: result.warnings.length,
        expiringSoonCount: expiringSoonJobs.length,
        notSeenSinceYesterdayCount: notSeenSinceYesterdayIds.length,
        sectorStatsCount: sectorStats.length,
        offerObservationsCount: offerObservations.length,
        createdTodayCount: offerObservations.filter((item) => item.isCreatedToday).length,
        expiresWithin7DaysCount: offerObservations.filter((item) => item.expiresWithin7Days).length,
      });
    } catch (error) {
      errorCount += 1;

      const row = {
        ok: false,
        departmentCode: department.code,
        departmentName: department.name,
        error: String(error.message || error),
      };

      rows.push(row);

      if (write) {
        await db
          .collection('departmentDailyStats')
          .doc(`${targetDate}_${department.code}`)
          .set(
            {
              date: targetDate,
              code: department.code,
              departmentCode: department.code,
              name: department.name,
              departmentName: department.name,
              lastError: row.error,
              importedAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: 'departmentDailyStats.lba.manual.v1',
            },
            { merge: true }
          );
      }
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  if (write) {
    await db.collection('apiImports').doc(`daily_manual_${targetDate}`).set(
      {
        type: 'daily_manual_import',
        date: targetDate,
        source: 'api-apprentissage-job-v1-search',
        departmentsCount: departments.length,
        requestedDepartmentCodes: departmentCodes || [],
        successCount,
        errorCount,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 'daily_manual_import.v1',
      },
      { merge: true }
    );
  }

  if (write && publish) {
    await publishDepartmentVigilanceDaily(targetDate);
    await publishVigilancePublicIndexLatest(targetDate);
  }

  return {
    targetDate,
    write,
    publish,
    departmentsCount: departments.length,
    successCount,
    errorCount,
    rows,
  };
}

exports.importDailyOffersHttp = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [API_APPRENTISSAGE_TOKEN, BACKFILL_ADMIN_KEY],
  },
  async (request, response) => {
    try {
      const adminKey = request.get('x-admin-key') || request.query.key || '';
      const expectedKey = BACKFILL_ADMIN_KEY.value();

      if (!expectedKey || adminKey !== expectedKey) {
        response.status(403).json({
          ok: false,
          error: 'Forbidden',
        });
        return;
      }

      const token = API_APPRENTISSAGE_TOKEN.value();

      if (!token) {
        response.status(500).json({
          ok: false,
          error: 'Secret API_APPRENTISSAGE_TOKEN absent ou vide',
        });
        return;
      }

      const targetDate = normalizeManualOfferImportDate(request.query.date);
      const departmentCodes = parseDepartmentListParam(request.query.departments || request.query.department);
      const write = String(request.query.write || '1') !== '0';
      const publish = String(request.query.publish || '0') === '1';
      const delayMs = Math.max(0, Math.min(Number(request.query.delayMs || 1200), 10000));

      const result = await importDailyOffersForDepartments({
        targetDate,
        departmentCodes,
        token,
        write,
        publish,
        delayMs,
      });

      response.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error('importDailyOffersHttp error', error);

      response.status(500).json({
        ok: false,
        error: String(error.message || error),
      });
    }
  }
);


const lbaDailyOffers = require("./lba-daily-offers");
exports.backfillDailyOffers = lbaDailyOffers.backfillDailyOffers;
exports.adminDailyOffers = lbaDailyOffers.adminDailyOffers;
exports.adminNationalDailyOffers = lbaDailyOffers.adminNationalDailyOffers;
