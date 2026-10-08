const { authenticateAdminRequest } = require('./lib/admin-auth.cjs');

const DEPARTMENT_CODES = Object.freeze([
  ...Array.from({ length: 19 }, (_, index) => String(index + 1).padStart(2, '0')),
  '2A', '2B',
  ...Array.from({ length: 75 }, (_, index) => String(index + 21)),
  '971', '972', '973', '974', '976',
]);
const DEPARTMENT_SET = new Set(DEPARTMENT_CODES);
const TOTAL_DEPARTMENTS = DEPARTMENT_CODES.length;
const CACHE_TTL_MS = 180000;
const cachedResults = new WeakMap();

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function count(value) {
  return numberOrNull(value) ?? 0;
}

function departmentCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^\d$/.test(code) ? code.padStart(2, '0') : code;
}

function dateParis(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function recentDates(days, endDate) {
  const start = new Date(endDate + 'T12:00:00Z');
  if (Number.isNaN(start.getTime())) throw new Error('Invalid reference date');
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() - index);
    return day.toISOString().slice(0, 10);
  });
}

function mergeBreakdown(target, items) {
  for (const item of Array.isArray(items) ? items : []) {
    const code = String(item?.code || '').trim();
    if (!code) continue;
    const previous = target.get(code) || {
      code, label: String(item.label || code).slice(0, 140), offers: 0, openings: 0,
    };
    previous.offers += count(item.offers);
    previous.openings += count(item.openings);
    target.set(code, previous);
  }
}

function summarizeDay(date, documents, references = new Map(), populations = new Map()) {
  const rowsByDepartment = new Map();

  for (const document of documents) {
    const data = typeof document.data === 'function' ? document.data() || {} : document || {};
    const code = departmentCode(document.id || data.departmentCode);
    const declaredCode = departmentCode(data.departmentCode || code);
    const strict = data.strictSummary;

    if (!DEPARTMENT_SET.has(code) || declaredCode !== code ||
        data.date !== date || !data.activeRunId ||
        data.qualityStatus === 'quarantined' || !strict) {
      continue;
    }

    const totalOffers = numberOrNull(strict.totalOffers);
    const totalOpenings = numberOrNull(strict.totalOpenings);
    const storedOffers = numberOrNull(data.storedOffersCount);
    if (totalOffers === null || totalOpenings === null ||
        (storedOffers !== null && totalOffers > storedOffers)) {
      continue;
    }

    const explicitlyCapped = strict.isPossiblySaturated ?? data.summary?.isPossiblySaturated;
    const hasCapAssessment = typeof explicitlyCapped === 'boolean';
    const newTodayOffers = numberOrNull(strict.newTodayOffers);
    const population = populations.get(code) || null;
    const youngPopulation = numberOrNull(population?.population15To29);
    const ref = references.get(code) || {};

    rowsByDepartment.set(code, {
      departmentCode: code,
      departmentName: String(ref.name || ref.nom || ref.departmentName || code).slice(0, 150),
      regionName: String(ref.regionName || 'Non renseignée').slice(0, 150),
      offers: totalOffers,
      openings: totalOpenings,
      newOffers: newTodayOffers,
      saturated: explicitlyCapped === true,
      capAssessed: hasCapAssessment,
      population15To29: youngPopulation !== null && youngPopulation > 0 ? youngPopulation : null,
      offersPer10000Young: youngPopulation !== null && youngPopulation > 0
        ? (totalOffers / youngPopulation) * 10000
        : null,
      sectorStats: strict.bySector,
    });
  }

  const departments = [...rowsByDepartment.values()];
  const sectors = new Map();
  let offers = 0, openings = 0, newOffers = 0;
  let newOffersCoverage = 0, saturatedDepartments = 0;
  let unassessedCapDepartments = 0, populationCoveredDepartments = 0;
  let youngPopulationTotal = 0;

  for (const department of departments) {
    offers += department.offers;
    openings += department.openings;
    if (department.newOffers !== null) {
      newOffers += department.newOffers;
      newOffersCoverage += 1;
    }
    if (department.saturated) saturatedDepartments += 1;
    if (!department.capAssessed) unassessedCapDepartments += 1;
    if (department.population15To29 !== null) {
      populationCoveredDepartments += 1;
      youngPopulationTotal += department.population15To29;
    }
    mergeBreakdown(sectors, department.sectorStats);
    delete department.sectorStats;
  }

  departments.sort((a, b) =>
    b.offers - a.offers || a.departmentCode.localeCompare(b.departmentCode, 'fr')
  );
  const coveredDepartments = departments.length;
  const comparable = coveredDepartments === TOTAL_DEPARTMENTS &&
    saturatedDepartments === 0 && unassessedCapDepartments === 0;
  const hasCompletePopulation = populationCoveredDepartments === TOTAL_DEPARTMENTS;
  const coveredCodes = new Set(departments.map((row) => row.departmentCode));

  return {
    date, offers, openings,
    newOffers: newOffersCoverage === coveredDepartments && coveredDepartments > 0
      ? newOffers : null,
    newOffersCoverage,
    coveredDepartments,
    expectedDepartments: TOTAL_DEPARTMENTS,
    missingDepartments: DEPARTMENT_CODES.filter((code) => !coveredCodes.has(code)),
    saturatedDepartments,
    unassessedCapDepartments,
    populationCoveredDepartments,
    offersPer10000Young: coveredDepartments === TOTAL_DEPARTMENTS && hasCompletePopulation && youngPopulationTotal > 0
      ? (offers / youngPopulationTotal) * 10000
      : null,
    comparable,
    departments,
    sectors: [...sectors.values()]
      .sort((a, b) => b.offers - a.offers || a.code.localeCompare(b.code, 'fr'))
      .slice(0, 25),
  };
}

function safeChange(latest, previous) {
  if (!latest || !previous || !latest.comparable || !previous.comparable ||
      previous.offers <= 0) return null;

  return {
    absolute: latest.offers - previous.offers,
    ratio: (latest.offers - previous.offers) / previous.offers,
    previousDate: previous.date,
  };
}

function indicativeChange(latest, previous) {
  if (!latest || !previous ||
      latest.coveredDepartments !== TOTAL_DEPARTMENTS ||
      previous.coveredDepartments !== TOTAL_DEPARTMENTS ||
      latest.saturatedDepartments > 0 || previous.saturatedDepartments > 0 ||
      previous.offers <= 0) return null;
  return {
    absolute: latest.offers - previous.offers,
    ratio: (latest.offers - previous.offers) / previous.offers,
    previousDate: previous.date,
    caveat: 'Plafonnement non certifie pour toutes les sources',
  };
}

async function loadPopulation(db) {
  const [metaDoc, populationSnap] = await Promise.all([
    db.collection('departmentPopulationReferenceMeta').doc('current').get(),
    db.collection('departmentPopulationReference').get(),
  ]);
  const metadata = metaDoc.exists ? metaDoc.data() || {} : {};
  const validRun = metadata.runId &&
    Number(metadata.departmentsCount) === TOTAL_DEPARTMENTS &&
    Number.isInteger(Number(metadata.referenceYear));
  const populations = new Map();

  if (validRun) {
    for (const doc of populationSnap.docs) {
      const row = doc.data() || {};
      const code = departmentCode(doc.id);
      const young = numberOrNull(row.population15To29);
      if (DEPARTMENT_SET.has(code) && row.runId === metadata.runId &&
          Number(row.referenceYear) === Number(metadata.referenceYear) &&
          young !== null && young > 0) {
        populations.set(code, { population15To29: young });
      }
    }
  }

  return {
    populations,
    referenceYear: validRun ? Number(metadata.referenceYear) : null,
    coverage: populations.size,
  };
}

async function loadHistory(db, dates, references, populations) {
  const results = new Array(dates.length);
  let cursor = 0;
  // A small worker pool bounds request latency and simultaneous Firestore reads.
  const workers = Array.from({ length: Math.min(5, dates.length) }, async () => {
    while (cursor < dates.length) {
      const position = cursor++;
      const date = dates[position];
      const snapshot = await db.collection('dailyOfferSnapshots')
        .doc(date).collection('departments').get();
      if (!snapshot.empty) {
        const summary = summarizeDay(date, snapshot.docs, references, populations);
        if (summary.coveredDepartments > 0) results[position] = summary;
      }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

async function loadNationalStats(db, { days = 30, today = dateParis() } = {}) {
  const limit = [7, 30, 60].includes(Number(days)) ? Number(days) : 30;
  const [referencesSnap, population, formationSnap] = await Promise.all([
    db.collection('departments').get(),
    loadPopulation(db),
    db.collection('formationDepartmentStats').get(),
  ]);
  const references = new Map(referencesSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return [departmentCode(data.departmentCode || data.code || doc.id), data];
  }));
  const points = await loadHistory(
    db, recentDates(limit, today), references, population.populations
  );
  const latest = points[0] || null;
  const previousComparable = latest?.comparable
    ? points.slice(1).find((point) => point.comparable) : null;
  const change = safeChange(latest, previousComparable);
  const previousWhole = latest?.coveredDepartments === TOTAL_DEPARTMENTS
    ? points.slice(1).find((point) =>
        point.coveredDepartments === TOTAL_DEPARTMENTS &&
        point.saturatedDepartments === 0
      )
    : null;
  const indicative = !change ? indicativeChange(latest, previousWhole) : null;

  const regions = new Map();
  for (const department of latest?.departments || []) {
    const name = department.regionName;
    const entry = regions.get(name) || { name, offers: 0, departments: 0 };
    entry.offers += department.offers;
    entry.departments += 1;
    regions.set(name, entry);
  }

  const formationDates = new Set();
  const formations = {
    coveredDepartments: 0,
    formationsByDepartmentTotal: 0,
    sessionsByDepartmentTotal: 0,
    upcomingSessionsTotal: 0,
    asOfDates: [],
  };
  for (const doc of formationSnap.docs) {
    const item = doc.data() || {};
    if (!DEPARTMENT_SET.has(departmentCode(doc.id)) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(item.asOfDate || '')) ||
        numberOrNull(item.formationsCount) === null) continue;

    formations.coveredDepartments += 1;
    formations.formationsByDepartmentTotal += count(item.formationsCount);
    formations.sessionsByDepartmentTotal += count(item.sessionsCount);
    formations.upcomingSessionsTotal += count(item.upcomingSessionsCount);
    formationDates.add(item.asOfDate);
  }
  formations.asOfDates = [...formationDates].sort();

  return {
    ok: true,
    date: latest?.date || null,
    methodology: 'Somme des offres strictement geolocalisees dans les departements couverts. Observations de la collecte, non estimation exhaustive du marche. Le plafonnement n est pas toujours mesure et des doublons interdepartementaux restent possibles.',
    populationReferenceYear: population.referenceYear,
    populationReferenceCoverage: population.coverage,
    latest: latest ? {
      date: latest.date,
      offers: latest.offers, openings: latest.openings, newOffers: latest.newOffers,
      newOffersCoverage: latest.newOffersCoverage,
      coveredDepartments: latest.coveredDepartments,
      expectedDepartments: latest.expectedDepartments,
      saturatedDepartments: latest.saturatedDepartments,
      unassessedCapDepartments: latest.unassessedCapDepartments,
      populationCoveredDepartments: latest.populationCoveredDepartments,
      offersPer10000Young: latest.offersPer10000Young,
      comparable: latest.comparable,
      missingDepartments: latest.missingDepartments,
    } : null,
    change,
    indicativeChange: indicative,
    departments: latest?.departments || [],
    regions: [...regions.values()].sort((a, b) => b.offers - a.offers),
    sectors: latest?.sectors || [],
    history: [...points].reverse().map((point) => ({
      date: point.date,
      offers: point.offers, openings: point.openings,
      coveredDepartments: point.coveredDepartments,
      saturatedDepartments: point.saturatedDepartments,
      unassessedCapDepartments: point.unassessedCapDepartments,
      comparable: point.comparable,
    })),
    formations,
  };
}

async function cachedNationalStats(db, options) {
  const key = String(options.days) + ':' + dateParis();
  const now = Date.now();
  let entries = cachedResults.get(db);
  if (!entries) {
    entries = new Map();
    cachedResults.set(db, entries);
  }
  const existing = entries.get(key);
  if (existing && existing.until > now) return existing.promise;

  const promise = loadNationalStats(db, options);
  entries.set(key, { promise, until: now + CACHE_TTL_MS });
  try {
    return await promise;
  } catch (error) {
    entries.delete(key);
    throw error;
  }
}

async function handleNationalStats({ request, response, auth, db } = {}) {
  if (request?.method !== 'POST') {
    response.set?.('Allow', 'POST');
    response.status(405).json({ ok: false, error: 'Methode non autorisee' });
    return;
  }
  const adminUser = await authenticateAdminRequest({ request, response, auth, db });
  if (!adminUser) return;

  try {
    const days = [7, 30, 60].includes(Number(request?.body?.days))
      ? Number(request.body.days) : 30;
    const result = await cachedNationalStats(db, { days });
    response.set?.('Cache-Control', 'private, max-age=0, no-store');
    response.status(200).json(result);
  } catch (error) {
    console.error('national stats failed', {
      message: String(error?.message || error).slice(0, 200),
    });
    response.set?.('Cache-Control', 'no-store');
    response.status(500).json({ ok: false, error: 'Statistiques nationales indisponibles' });
  }
}

module.exports = {
  DEPARTMENT_CODES, TOTAL_DEPARTMENTS, recentDates, summarizeDay, safeChange,
  loadPopulation, loadNationalStats, cachedNationalStats, handleNationalStats,
  indicativeChange,
};
