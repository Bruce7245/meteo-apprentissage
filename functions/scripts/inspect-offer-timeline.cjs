const admin = require("firebase-admin");

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function pct(delta, previous) {
  if (!previous) return null;
  return (delta / previous) * 100;
}

function round(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = Math.pow(10, digits);
  return Math.round(Number(value) * factor) / factor;
}

function addMap(map, key, label, offers, openings) {
  if (!key && !label) return;
  const id = String(key || label || "inconnu");
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

function takeTop(map, limit = 10) {
  return Array.from(map.values())
    .sort((a, b) => b.openings - a.openings || b.offers - a.offers)
    .slice(0, limit);
}

function getArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function monthLabel(dateId) {
  return String(dateId || "").slice(0, 7);
}

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "meteo-apprentissage",
  });
}

const db = admin.firestore();

async function main() {
  const dateRefs = await db.collection("dailyOfferSnapshots").listDocuments();
  const validDateRefs = dateRefs
    .filter((ref) => /^\d{4}-\d{2}-\d{2}$/.test(ref.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  console.log("");
  console.log("DATES SNAPSHOTS TROUVEES:", validDateRefs.length);

  const dailyRows = [];

  for (const dateRef of validDateRefs) {
    const departmentsSnap = await dateRef.collection("departments").get();

    const sectorMap = new Map();
    const romeMap = new Map();
    const nafMap = new Map();
    const partnerMap = new Map();

    let departments = 0;
    let rawOffers = 0;
    let rawOpenings = 0;
    let strictOffers = 0;
    let strictOpenings = 0;
    let newOffers = 0;
    let newOpenings = 0;
    let saturatedDepartments = 0;
    let geoIssues = 0;

    departmentsSnap.forEach((doc) => {
      const data = doc.data() || {};
      const summary = data.summary || {};
      const strictSummary = data.strictSummary || {};

      departments += 1;

      rawOffers += num(summary.totalOffers ?? data.storedOffersCount);
      rawOpenings += num(summary.totalOpenings ?? data.totalOpenings);

      strictOffers += num(strictSummary.totalOffers);
      strictOpenings += num(strictSummary.totalOpenings);

      newOffers += num(summary.newTodayOffers ?? data.newTodayOffers);
      newOpenings += num(summary.newTodayOpenings ?? data.newTodayOpenings);

      const outOffers = num(summary.locationQuality?.outOfDepartment?.offers);
      const unknownOffers = num(summary.locationQuality?.unknownPostalCode?.offers);
      geoIssues += outOffers + unknownOffers;

      if (summary.isPossiblySaturated || data.isPossiblySaturated) {
        saturatedDepartments += 1;
      }

      for (const item of getArray(strictSummary.bySector, summary.bySector)) {
        addMap(sectorMap, item.code, item.label, item.offers, item.openings);
      }

      for (const item of getArray(strictSummary.byRome, summary.byRome)) {
        addMap(romeMap, item.code, item.label, item.offers, item.openings);
      }

      for (const item of getArray(strictSummary.byNaf, summary.byNaf)) {
        addMap(nafMap, item.code, item.label, item.offers, item.openings);
      }

      for (const item of getArray(strictSummary.byPartner, summary.byPartner, strictSummary.bySource, summary.bySource)) {
        addMap(partnerMap, item.code || item.partner, item.label || item.partner, item.offers, item.openings);
      }
    });

    dailyRows.push({
      date: dateRef.id,
      month: monthLabel(dateRef.id),
      departments,
      rawOffers,
      rawOpenings,
      strictOffers,
      strictOpenings,
      newOffers,
      newOpenings,
      saturatedDepartments,
      geoIssues,
      topSectors: takeTop(sectorMap, 8),
      topRome: takeTop(romeMap, 8),
      topNaf: takeTop(nafMap, 8),
      topPartners: takeTop(partnerMap, 8),
    });
  }

  console.log("");
  console.log("===== TABLE JOURNALIERE =====");
  console.table(dailyRows.map((row) => ({
    date: row.date,
    dep: row.departments,
    offres: row.strictOffers,
    postes: row.strictOpenings,
    nouvelles: row.newOffers,
    nouveauxPostes: row.newOpenings,
    sature: row.saturatedDepartments,
    anomaliesGeo: row.geoIssues,
  })));

  const monthMap = new Map();

  for (const row of dailyRows) {
    const current = monthMap.get(row.month) || {
      month: row.month,
      days: 0,
      departmentsTotal: 0,
      strictOffersTotal: 0,
      strictOpeningsTotal: 0,
      rawOffersTotal: 0,
      rawOpeningsTotal: 0,
      newOffersTotal: 0,
      newOpeningsTotal: 0,
      saturatedDepartmentsMax: 0,
      geoIssuesTotal: 0,
      sectorMap: new Map(),
      romeMap: new Map(),
      partnerMap: new Map(),
    };

    current.days += 1;
    current.departmentsTotal += row.departments;
    current.strictOffersTotal += row.strictOffers;
    current.strictOpeningsTotal += row.strictOpenings;
    current.rawOffersTotal += row.rawOffers;
    current.rawOpeningsTotal += row.rawOpenings;
    current.newOffersTotal += row.newOffers;
    current.newOpeningsTotal += row.newOpenings;
    current.geoIssuesTotal += row.geoIssues;
    current.saturatedDepartmentsMax = Math.max(current.saturatedDepartmentsMax, row.saturatedDepartments);

    for (const item of row.topSectors) addMap(current.sectorMap, item.code, item.label, item.offers, item.openings);
    for (const item of row.topRome) addMap(current.romeMap, item.code, item.label, item.offers, item.openings);
    for (const item of row.topPartners) addMap(current.partnerMap, item.code, item.label, item.offers, item.openings);

    monthMap.set(row.month, current);
  }

  const monthRows = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((month) => ({
      month: month.month,
      days: month.days,
      departmentsAverage: round(month.departmentsTotal / month.days, 1),
      strictOffersAverage: round(month.strictOffersTotal / month.days, 1),
      strictOpeningsAverage: round(month.strictOpeningsTotal / month.days, 1),
      rawOffersAverage: round(month.rawOffersTotal / month.days, 1),
      rawOpeningsAverage: round(month.rawOpeningsTotal / month.days, 1),
      newOffersTotal: month.newOffersTotal,
      newOpeningsTotal: month.newOpeningsTotal,
      saturatedDepartmentsMax: month.saturatedDepartmentsMax,
      geoIssuesTotal: month.geoIssuesTotal,
      topSector: takeTop(month.sectorMap, 1)[0] || null,
      topRome: takeTop(month.romeMap, 1)[0] || null,
      topPartner: takeTop(month.partnerMap, 1)[0] || null,
    }));

  for (let i = 0; i < monthRows.length; i += 1) {
    const previous = monthRows[i - 1];
    const current = monthRows[i];

    if (!previous) {
      current.offersDelta = null;
      current.offersVariationPercent = null;
      current.openingsDelta = null;
      current.openingsVariationPercent = null;
      continue;
    }

    current.offersDelta = round(current.strictOffersAverage - previous.strictOffersAverage, 1);
    current.offersVariationPercent = round(pct(current.offersDelta, previous.strictOffersAverage), 1);
    current.openingsDelta = round(current.strictOpeningsAverage - previous.strictOpeningsAverage, 1);
    current.openingsVariationPercent = round(pct(current.openingsDelta, previous.strictOpeningsAverage), 1);
  }

  console.log("");
  console.log("===== TABLE MENSUELLE =====");
  console.table(monthRows.map((row) => ({
    mois: row.month,
    jours: row.days,
    offresMoy: row.strictOffersAverage,
    postesMoy: row.strictOpeningsAverage,
    nouvellesOffres: row.newOffersTotal,
    nouveauxPostes: row.newOpeningsTotal,
    diffOffres: row.offersDelta,
    varOffresPct: row.offersVariationPercent,
    diffPostes: row.openingsDelta,
    varPostesPct: row.openingsVariationPercent,
    secteurTop: row.topSector?.label || "",
    romeTop: row.topRome?.code || "",
    sourceTop: row.topPartner?.label || "",
  })));

  const latest = dailyRows[dailyRows.length - 1];

  if (latest) {
    console.log("");
    console.log("===== DERNIER SNAPSHOT:", latest.date, "=====");
    console.log("Top secteurs:");
    console.table(latest.topSectors.map((row) => ({
      code: row.code,
      label: row.label,
      offres: row.offers,
      postes: row.openings,
    })));

    console.log("Top ROME:");
    console.table(latest.topRome.map((row) => ({
      code: row.code,
      label: row.label,
      offres: row.offers,
      postes: row.openings,
    })));

    console.log("Top sources:");
    console.table(latest.topPartners.map((row) => ({
      code: row.code,
      label: row.label,
      offres: row.offers,
      postes: row.openings,
    })));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    datesCount: dailyRows.length,
    dailyRows,
    monthRows,
  };

  const fs = require("fs");
  fs.writeFileSync("/tmp/offer-timeline-inspection.json", JSON.stringify(output, null, 2));

  console.log("");
  console.log("JSON complet ecrit dans /tmp/offer-timeline-inspection.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
