const admin = require("firebase-admin");

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "meteo-apprentissage";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function round(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = Math.pow(10, digits);
  return Math.round(Number(value) * factor) / factor;
}

function pct(delta, previous) {
  if (!previous) return null;
  return round((delta / previous) * 100, 1);
}

function monthId(date) {
  return String(date || "").slice(0, 7);
}

function yearId(value) {
  return String(value || "").slice(0, 4);
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function addStat(map, key, label, offers, openings) {
  const id = String(key || label || "inconnu").trim();
  const current = map.get(id) || {
    code: id,
    label: label || id,
    offers: 0,
    openings: 0,
  };

  current.offers += num(offers);
  current.openings += num(openings);
  map.set(id, current);
}

function top(map, limit) {
  return Array.from(map.values())
    .sort((a, b) => b.openings - a.openings || b.offers - a.offers || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit);
}

function getQualityIssues(summary) {
  return (
    num(summary?.locationQuality?.outOfDepartment?.offers) +
    num(summary?.locationQuality?.unknownPostalCode?.offers)
  );
}

function getSummaryArray(strictSummary, summary, key) {
  if (Array.isArray(strictSummary?.[key])) return strictSummary[key];
  if (Array.isArray(summary?.[key])) return summary[key];
  return [];
}

function emptyMaps() {
  return {
    sectorMap: new Map(),
    romeMap: new Map(),
    nafMap: new Map(),
    partnerMap: new Map(),
    saturationSourceMap: new Map(),
  };
}

function serializeMaps(maps) {
  return {
    bySector: top(maps.sectorMap, 40),
    byRome: top(maps.romeMap, 60),
    byNaf: top(maps.nafMap, 60),
    byPartner: top(maps.partnerMap, 30),
    saturatedSources: top(maps.saturationSourceMap, 30),
  };
}

async function readDepartmentDocs(date) {
  const departmentsCol = db.collection("dailyOfferSnapshots").doc(date).collection("departments");
  const refs = await departmentsCol.listDocuments();

  console.log(`${date} | refs departments=${refs.length}`);

  const docs = [];
  const chunkSize = 10;

  for (let i = 0; i < refs.length; i += chunkSize) {
    const chunk = refs.slice(i, i + chunkSize);
    const snaps = await Promise.all(chunk.map((ref) => ref.get()));

    snaps.forEach((snap) => {
      if (snap.exists) docs.push(snap);
    });

    console.log(`${date} | lus ${Math.min(i + chunkSize, refs.length)}/${refs.length}`);
  }

  return docs;
}

function buildDailyFromDepartmentDocs(date, docs) {
  const maps = emptyMaps();

  let rawOffers = 0;
  let rawOpenings = 0;
  let strictOffers = 0;
  let strictOpenings = 0;
  let newOffers = 0;
  let newOpenings = 0;
  let geoIssues = 0;
  let saturatedDepartments = 0;

  const byDepartment = [];

  docs.forEach((snap) => {
    const data = snap.data() || {};
    const summary = data.summary || {};
    const strictSummary = data.strictSummary || {};

    const department = {
      departmentCode: snap.id,
      rawOffers: num(summary.totalOffers ?? data.storedOffersCount),
      rawOpenings: num(summary.totalOpenings ?? data.totalOpenings),
      strictOffers: num(strictSummary.totalOffers),
      strictOpenings: num(strictSummary.totalOpenings),
      newOffers: num(summary.newTodayOffers ?? data.newTodayOffers),
      newOpenings: num(summary.newTodayOpenings ?? data.newTodayOpenings),
      geoIssues: getQualityIssues(summary),
      isPossiblySaturated: Boolean(summary.isPossiblySaturated || data.isPossiblySaturated),
      saturatedSources: arr(summary.saturatedSources).map((source) => ({
        partner: source.partner || source.label || source.code || "Source inconnue",
        count: num(source.count),
      })),
      topSector: getSummaryArray(strictSummary, summary, "bySector")[0] || null,
      topRome: getSummaryArray(strictSummary, summary, "byRome")[0] || null,
      topNaf: getSummaryArray(strictSummary, summary, "byNaf")[0] || null,
      topPartner: getSummaryArray(strictSummary, summary, "byPartner")[0] || null,
    };

    rawOffers += department.rawOffers;
    rawOpenings += department.rawOpenings;
    strictOffers += department.strictOffers;
    strictOpenings += department.strictOpenings;
    newOffers += department.newOffers;
    newOpenings += department.newOpenings;
    geoIssues += department.geoIssues;

    if (department.isPossiblySaturated) {
      saturatedDepartments += 1;
    }

    for (const item of getSummaryArray(strictSummary, summary, "bySector")) {
      addStat(maps.sectorMap, item.code, item.label, item.offers, item.openings);
    }

    for (const item of getSummaryArray(strictSummary, summary, "byRome")) {
      addStat(maps.romeMap, item.code, item.label, item.offers, item.openings);
    }

    for (const item of getSummaryArray(strictSummary, summary, "byNaf")) {
      addStat(maps.nafMap, item.code, item.label, item.offers, item.openings);
    }

    for (const item of getSummaryArray(strictSummary, summary, "byPartner")) {
      addStat(maps.partnerMap, item.code || item.partner, item.label || item.partner || item.code, item.offers, item.openings);
    }

    for (const source of department.saturatedSources) {
      addStat(maps.saturationSourceMap, source.partner, source.partner, source.count, source.count);
    }

    byDepartment.push(department);
  });

  byDepartment.sort((a, b) => b.strictOpenings - a.strictOpenings || b.strictOffers - a.strictOffers);

  return {
    date,
    month: monthId(date),
    year: yearId(date),
    departmentsCount: byDepartment.length,

    rawOffers,
    rawOpenings,
    strictOffers,
    strictOpenings,
    newOffers,
    newOpenings,

    geoIssues,
    saturatedDepartments,

    ...serializeMaps(maps),

    byDepartment,
  };
}

function buildMonthlyRows(dailyRows) {
  const monthMap = new Map();

  dailyRows.forEach((day) => {
    const id = day.month;

    const month = monthMap.get(id) || {
      month: id,
      year: yearId(id),
      daysCount: 0,

      departmentsTotal: 0,
      rawOffersTotal: 0,
      rawOpeningsTotal: 0,
      strictOffersTotal: 0,
      strictOpeningsTotal: 0,
      newOffersTotal: 0,
      newOpeningsTotal: 0,
      geoIssuesTotal: 0,
      saturatedDepartmentsMax: 0,

      maps: emptyMaps(),
      departmentMap: new Map(),
      daily: [],
    };

    month.daysCount += 1;
    month.departmentsTotal += day.departmentsCount;
    month.rawOffersTotal += day.rawOffers;
    month.rawOpeningsTotal += day.rawOpenings;
    month.strictOffersTotal += day.strictOffers;
    month.strictOpeningsTotal += day.strictOpenings;
    month.newOffersTotal += day.newOffers;
    month.newOpeningsTotal += day.newOpenings;
    month.geoIssuesTotal += day.geoIssues;
    month.saturatedDepartmentsMax = Math.max(month.saturatedDepartmentsMax, day.saturatedDepartments);

    month.daily.push({
      date: day.date,
      strictOffers: day.strictOffers,
      strictOpenings: day.strictOpenings,
      rawOffers: day.rawOffers,
      rawOpenings: day.rawOpenings,
      newOffers: day.newOffers,
      newOpenings: day.newOpenings,
      saturatedDepartments: day.saturatedDepartments,
    });

    day.bySector.forEach((item) => addStat(month.maps.sectorMap, item.code, item.label, item.offers, item.openings));
    day.byRome.forEach((item) => addStat(month.maps.romeMap, item.code, item.label, item.offers, item.openings));
    day.byNaf.forEach((item) => addStat(month.maps.nafMap, item.code, item.label, item.offers, item.openings));
    day.byPartner.forEach((item) => addStat(month.maps.partnerMap, item.code, item.label, item.offers, item.openings));
    day.saturatedSources.forEach((item) => addStat(month.maps.saturationSourceMap, item.code, item.label, item.offers, item.openings));

    day.byDepartment.forEach((dep) => {
      const current = month.departmentMap.get(dep.departmentCode) || {
        departmentCode: dep.departmentCode,
        daysCount: 0,
        strictOffersTotal: 0,
        strictOpeningsTotal: 0,
        rawOffersTotal: 0,
        rawOpeningsTotal: 0,
        newOffersTotal: 0,
        newOpeningsTotal: 0,
        geoIssuesTotal: 0,
        saturatedDays: 0,
        topSector: dep.topSector || null,
        topRome: dep.topRome || null,
        topPartner: dep.topPartner || null,
      };

      current.daysCount += 1;
      current.strictOffersTotal += dep.strictOffers;
      current.strictOpeningsTotal += dep.strictOpenings;
      current.rawOffersTotal += dep.rawOffers;
      current.rawOpeningsTotal += dep.rawOpenings;
      current.newOffersTotal += dep.newOffers;
      current.newOpeningsTotal += dep.newOpenings;
      current.geoIssuesTotal += dep.geoIssues;
      if (dep.isPossiblySaturated) current.saturatedDays += 1;

      if (!current.topSector && dep.topSector) current.topSector = dep.topSector;
      if (!current.topRome && dep.topRome) current.topRome = dep.topRome;
      if (!current.topPartner && dep.topPartner) current.topPartner = dep.topPartner;

      month.departmentMap.set(dep.departmentCode, current);
    });

    monthMap.set(id, month);
  });

  const monthRows = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((month) => {
      const byDepartment = Array.from(month.departmentMap.values())
        .map((dep) => ({
          departmentCode: dep.departmentCode,
          daysCount: dep.daysCount,
          strictOffersAverage: round(dep.strictOffersTotal / dep.daysCount, 1),
          strictOpeningsAverage: round(dep.strictOpeningsTotal / dep.daysCount, 1),
          rawOffersAverage: round(dep.rawOffersTotal / dep.daysCount, 1),
          rawOpeningsAverage: round(dep.rawOpeningsTotal / dep.daysCount, 1),
          newOffersTotal: dep.newOffersTotal,
          newOpeningsTotal: dep.newOpeningsTotal,
          geoIssuesTotal: dep.geoIssuesTotal,
          saturatedDays: dep.saturatedDays,
          topSector: dep.topSector,
          topRome: dep.topRome,
          topPartner: dep.topPartner,
        }))
        .sort((a, b) => b.strictOpeningsAverage - a.strictOpeningsAverage || b.strictOffersAverage - a.strictOffersAverage);

      return {
        month: month.month,
        year: month.year,
        daysCount: month.daysCount,

        departmentsAverage: round(month.departmentsTotal / month.daysCount, 1),

        rawOffersAverage: round(month.rawOffersTotal / month.daysCount, 1),
        rawOpeningsAverage: round(month.rawOpeningsTotal / month.daysCount, 1),
        strictOffersAverage: round(month.strictOffersTotal / month.daysCount, 1),
        strictOpeningsAverage: round(month.strictOpeningsTotal / month.daysCount, 1),

        newOffersTotal: month.newOffersTotal,
        newOpeningsTotal: month.newOpeningsTotal,

        geoIssuesTotal: month.geoIssuesTotal,
        saturatedDepartmentsMax: month.saturatedDepartmentsMax,

        ...serializeMaps(month.maps),

        byDepartment,
        daily: month.daily,
        previousMonthComparison: null,
      };
    });

  for (let i = 1; i < monthRows.length; i += 1) {
    const previous = monthRows[i - 1];
    const current = monthRows[i];

    const offersDelta = round(current.strictOffersAverage - previous.strictOffersAverage, 1);
    const openingsDelta = round(current.strictOpeningsAverage - previous.strictOpeningsAverage, 1);

    current.previousMonthComparison = {
      previousMonth: previous.month,
      offersDelta,
      offersVariationPercent: pct(offersDelta, previous.strictOffersAverage),
      openingsDelta,
      openingsVariationPercent: pct(openingsDelta, previous.strictOpeningsAverage),
    };
  }

  return monthRows;
}

function buildYearRows(monthRows) {
  const years = new Map();

  monthRows.forEach((month) => {
    const year = years.get(month.year) || {
      year: month.year,
      months: [],
    };

    year.months.push({
      month: month.month,
      daysCount: month.daysCount,
      departmentsAverage: month.departmentsAverage,
      strictOffersAverage: month.strictOffersAverage,
      strictOpeningsAverage: month.strictOpeningsAverage,
      newOffersTotal: month.newOffersTotal,
      newOpeningsTotal: month.newOpeningsTotal,
      saturatedDepartmentsMax: month.saturatedDepartmentsMax,
      topSector: month.bySector[0] || null,
      topRome: month.byRome[0] || null,
      previousMonthComparison: month.previousMonthComparison,
    });

    years.set(month.year, year);
  });

  return Array.from(years.values()).sort((a, b) => a.year.localeCompare(b.year));
}

async function writeDocs(dailyRows, monthRows, yearRows) {
  const writes = [];

  dailyRows.forEach((row) => {
    writes.push({
      ref: db.collection("offerAnalyticsDaily").doc(row.date),
      data: {
        ...row,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  });

  monthRows.forEach((row) => {
    writes.push({
      ref: db.collection("offerAnalyticsMonthly").doc(row.month),
      data: {
        ...row,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  });

  yearRows.forEach((row) => {
    writes.push({
      ref: db.collection("offerAnalyticsYears").doc(row.year),
      data: {
        ...row,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  });

  let batch = db.batch();
  let inBatch = 0;
  let total = 0;

  for (const write of writes) {
    batch.set(write.ref, write.data, { merge: true });
    inBatch += 1;
    total += 1;

    if (inBatch >= 450) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  }

  if (inBatch > 0) {
    await batch.commit();
  }

  return total;
}

async function main() {
  console.log("Projet:", PROJECT_ID);
  console.log("Mode:", WRITE ? "ECRITURE" : "SIMULATION");

  const dateRefs = await db.collection("dailyOfferSnapshots").listDocuments();

  const dates = dateRefs
    .map((ref) => ref.id)
    .filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id))
    .sort();

  console.log("Dates:", dates);

  const dailyRows = [];

  for (const date of dates) {
    const docs = await readDepartmentDocs(date);
    const daily = buildDailyFromDepartmentDocs(date, docs);

    console.log(`${date} | dep=${daily.departmentsCount} | offres=${daily.strictOffers} | postes=${daily.strictOpenings} | nouvelles=${daily.newOffers} | sature=${daily.saturatedDepartments}`);

    dailyRows.push(daily);
  }

  const monthRows = buildMonthlyRows(dailyRows);
  const yearRows = buildYearRows(monthRows);

  console.log("");
  console.log("===== TABLE MENSUELLE =====");
  console.table(monthRows.map((month) => ({
    mois: month.month,
    jours: month.daysCount,
    offresMoy: month.strictOffersAverage,
    postesMoy: month.strictOpeningsAverage,
    nouvellesOffres: month.newOffersTotal,
    nouveauxPostes: month.newOpeningsTotal,
    diffOffres: month.previousMonthComparison?.offersDelta ?? null,
    varOffresPct: month.previousMonthComparison?.offersVariationPercent ?? null,
    diffPostes: month.previousMonthComparison?.openingsDelta ?? null,
    varPostesPct: month.previousMonthComparison?.openingsVariationPercent ?? null,
    secteurTop: month.bySector[0]?.label || "",
    romeTop: month.byRome[0]?.code || "",
    sourceTop: month.byPartner[0]?.label || "",
  })));

  console.log("");
  console.log("Documents a ecrire:", dailyRows.length + monthRows.length + yearRows.length);

  if (WRITE) {
    const written = await writeDocs(dailyRows, monthRows, yearRows);
    console.log("Documents ecrits:", written);
  }

  require("fs").writeFileSync(
    "/tmp/offer-analytics-preview.json",
    JSON.stringify({ dailyRows, monthRows, yearRows }, null, 2)
  );

  console.log("Preview:", "/tmp/offer-analytics-preview.json");

  await admin.app().delete();
}

main().catch(async (error) => {
  console.error("ERREUR:", error);
  try {
    await admin.app().delete();
  } catch (_) {}
  process.exit(1);
});
