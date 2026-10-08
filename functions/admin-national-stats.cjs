const { authenticateAdminRequest } = require('./lib/admin-auth.cjs');

const TOTAL_DEPARTMENTS = 101;
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) && valueNumber >= 0 ? valueNumber : null;
}
function count(value) { return numberOrNull(value) ?? 0; }
function dateParis(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function recentDates(days, endDate) {
  const start = new Date(endDate + 'T12:00:00Z');
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
    const current = target.get(code) || { code, label: item.label || code, offers: 0, openings: 0 };
    current.offers += count(item.offers);
    current.openings += count(item.openings);
    target.set(code, current);
  }
}
function summarizeDay(date, documents, references = new Map()) {
  const byDepartment = new Map();
  for (const document of documents) {
    const data = document.data ? document.data() : document;
    const code = String(data.departmentCode || document.id || '').trim().toUpperCase();
    if (!code || data.date !== date || !data.activeRunId || !data.strictSummary) continue;
    byDepartment.set(code, data);
  }
  const sectors = new Map();
  const departments = [];
  let offers = 0, openings = 0, newOffers = 0, saturatedCount = 0;
  for (const [code, row] of byDepartment) {
    const strict = row.strictSummary;
    const totalOffers = numberOrNull(strict.totalOffers);
    const totalOpenings = numberOrNull(strict.totalOpenings);
    if (totalOffers === null || totalOpenings === null) continue;
    offers += totalOffers;
    openings += totalOpenings;
    newOffers += count(strict.newTodayOffers);
    if (strict.isPossiblySaturated) saturatedCount++;
    mergeBreakdown(sectors, strict.bySector);
    const ref = references.get(code) || {};
    departments.push({
      departmentCode: code,
      departmentName: ref.name || ref.departmentName || code,
      regionName: ref.regionName || 'Non renseignée',
      offers: totalOffers,
      openings: totalOpenings,
      newOffers: count(strict.newTodayOffers),
      saturated: !!strict.isPossiblySaturated,
    });
  }
  departments.sort((a, b) => b.offers - a.offers || a.departmentCode.localeCompare(b.departmentCode));
  const isComplete = departments.length === TOTAL_DEPARTMENTS && saturatedCount === 0;
  return {
    date, offers, openings, newOffers,
    coveredDepartments: departments.length,
    expectedDepartments: TOTAL_DEPARTMENTS,
    saturatedDepartments: saturatedCount,
    comparable: isComplete,
    departments,
    sectors: [...sectors.values()].sort((a, b) => b.offers - a.offers || a.code.localeCompare(b.code)).slice(0, 25),
  };
}
function safeChange(latest, previous) {
  if (!latest || !previous || !latest.comparable || !previous.comparable || previous.offers <= 0) return null;
  return {
    absolute: latest.offers - previous.offers,
    ratio: (latest.offers - previous.offers) / previous.offers,
    previousDate: previous.date,
  };
}
async function loadNationalStats(db, { days = 30, today = dateParis() } = {}) {
  const limit = [7, 30, 60].includes(Number(days)) ? Number(days) : 30;
  const refSnap = await db.collection('departments').get();
  const references = new Map(refSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return [String(data.departmentCode || data.code || doc.id).toUpperCase(), data];
  }));
  const dates = recentDates(limit, today);
  const points = [];
  // Sequential bounded reads avoid unbounded Firestore fan-out.
  for (const date of dates) {
    const result = await db.collection('dailyOfferSnapshots').doc(date).collection('departments').get();
    if (!result.empty) {
      const point = summarizeDay(date, result.docs, references);
      if (point.coveredDepartments > 0) points.push(point);
    }
  }
  const latest = points[0] || null;
  const comparison = safeChange(latest, points.slice(1).find((point) => point.comparable));
  const regions = new Map();
  for (const department of latest?.departments || []) {
    const name = department.regionName;
    const row = regions.get(name) || { name, offers: 0, departments: 0 };
    row.offers += department.offers;
    row.departments++;
    regions.set(name, row);
  }
  const formationSnap = await db.collection('formationDepartmentStats').get();
  const formations = { coveredDepartments: 0, formationsByDepartmentTotal: 0, sessionsByDepartmentTotal: 0, upcomingSessionsTotal: 0 };
  for (const doc of formationSnap.docs) {
    const item = doc.data() || {};
    if (!item.asOfDate || numberOrNull(item.formationsCount) === null) continue;
    formations.coveredDepartments++;
    formations.formationsByDepartmentTotal += count(item.formationsCount);
    formations.sessionsByDepartmentTotal += count(item.sessionsCount);
    formations.upcomingSessionsTotal += count(item.upcomingSessionsCount);
  }
  const leanHistory = [...points].reverse().map((point) => ({
    date: point.date, offers: point.offers, openings: point.openings,
    coveredDepartments: point.coveredDepartments,
    saturatedDepartments: point.saturatedDepartments, comparable: point.comparable,
  }));
  return {
    ok: true,
    date: latest?.date || null,
    methodology: 'Somme des offres geolocalisees strictement dans chaque departement par snapshots quotidiens. Les totaux peuvent comporter des doublons interdepartementaux. Les jours incomplets ou plafonnes ne sont pas comparables.',
    latest: latest ? {
      date: latest.date, offers: latest.offers, openings: latest.openings, newOffers: latest.newOffers,
      coveredDepartments: latest.coveredDepartments,
      expectedDepartments: latest.expectedDepartments,
      saturatedDepartments: latest.saturatedDepartments, comparable: latest.comparable,
    } : null,
    change: comparison,
    departments: latest?.departments || [],
    regions: [...regions.values()].sort((a, b) => b.offers - a.offers),
    sectors: latest?.sectors || [],
    history: leanHistory,
    formations,
  };
}
async function handleNationalStats({ request, response, auth, db } = {}) {
  if (request?.method !== 'POST') {
    response.set?.('Allow', 'POST');
    response.status(405).json({ ok: false, error: 'Methode non autorisee' });
    return;
  }
  const user = await authenticateAdminRequest({ request, response, auth, db });
  if (!user) return;
  try {
    const result = await loadNationalStats(db, { days: request?.body?.days });
    response.set?.('Cache-Control', 'no-store');
    response.status(200).json(result);
  } catch (error) {
    console.error('national stats failed', { message: String(error?.message || error).slice(0, 200) });
    response.set?.('Cache-Control', 'no-store');
    response.status(500).json({ ok: false, error: 'Statistiques nationales indisponibles' });
  }
}
module.exports = { TOTAL_DEPARTMENTS, recentDates, summarizeDay, safeChange, loadNationalStats, handleNationalStats };
