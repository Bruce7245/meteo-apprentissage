const { authenticateAdminRequest } = require('./lib/admin-auth.cjs');
const { DEPARTMENT_CODES } = require('./admin-national-stats.cjs');

const VALID_DEPARTMENTS = new Set(DEPARTMENT_CODES);
const ROME_CODE = /^[A-Z][0-9]{4}$/;
const numberOrNull = value =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value) : null;
const departmentCode = value => String(value || '').trim().toUpperCase().padStart(2, '0');

function catalogueFromSnapshots(date, documents, labels = new Map()) {
  const occupations = new Map();
  const coverage = new Set();
  for (const document of documents) {
    const data = document.data() || {};
    const department = departmentCode(document.id);
    const strict = data.strictSummary;
    if (!VALID_DEPARTMENTS.has(department) || departmentCode(data.departmentCode) !== department ||
      data.date !== date || !data.activeRunId || data.qualityStatus === 'quarantined' ||
      !strict || numberOrNull(strict.totalOffers) === null ||
      (numberOrNull(data.storedOffersCount) !== null && Number(strict.totalOffers) > Number(data.storedOffersCount))) continue;
    coverage.add(department);
    const seen = new Set();
    for (const row of Array.isArray(strict.byRome) ? strict.byRome : []) {
      const code = String(row?.code || '').trim().toUpperCase();
      const offers = numberOrNull(row?.offers);
      const openings = numberOrNull(row?.openings);
      if (!ROME_CODE.test(code) || offers === null || offers <= 0 || seen.has(code)) continue;
      seen.add(code);
      if (!occupations.has(code)) {
        occupations.set(code, { romeCode: code, label: labels.get(code) || code, observedOffers: 0, observedOpenings: 0, departments: 0 });
      }
      const item = occupations.get(code);
      item.observedOffers += offers;
      item.observedOpenings += openings ?? 0;
      item.departments += 1;
    }
  }
  return {
    date,
    coveredDepartments: coverage.size,
    totalDepartments: DEPARTMENT_CODES.length,
    occupations: [...occupations.values()].sort((a, b) =>
      b.observedOffers - a.observedOffers || a.label.localeCompare(b.label, 'fr') || a.romeCode.localeCompare(b.romeCode)),
  };
}

function parisDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function previousDate(date, offset) {
  const value = new Date(date + 'T12:00:00.000Z');
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

async function loadReferenceLabels(db) {
  const metaDoc = await db.collection('occupationReferenceMeta').doc('current').get();
  const runId = metaDoc.exists ? String(metaDoc.data()?.runId || '') : '';
  if (!runId) return new Map();
  const snapshot = await db.collection('occupationReference').where('importRunId', '==', runId).get();
  return new Map(snapshot.docs.map(doc => {
    const data = doc.data() || {};
    return [String(data.romeCode || '').toUpperCase(), String(data.label || '').trim()];
  }).filter(([code, label]) => ROME_CODE.test(code) && label));
}

async function loadEditorialOccupationCatalogue(db, { today = parisDate() } = {}) {
  const dates = Array.from({ length: 7 }, (_, offset) => previousDate(today, offset));
  const snapshots = await Promise.all(dates.map(async date => ({
    date,
    docs: (await db.collection('dailyOfferSnapshots').doc(date).collection('departments').get()).docs,
  })));
  const candidates = snapshots.map(({ date, docs }) => catalogueFromSnapshots(date, docs));
  // Prefer broad territorial coverage; the latest date wins a tie.
  candidates.sort((a, b) => b.coveredDepartments - a.coveredDepartments || b.date.localeCompare(a.date));
  const best = candidates[0];
  if (!best || best.coveredDepartments === 0) {
    return { ok: true, date: null, coveredDepartments: 0, totalDepartments: DEPARTMENT_CODES.length, occupations: [], count: 0 };
  }
  const labels = await loadReferenceLabels(db).catch(() => new Map());
  const source = snapshots.find(item => item.date === best.date);
  const result = catalogueFromSnapshots(best.date, source.docs, labels);
  return { ok: true, ...result, count: result.occupations.length, coverageNote: 'Volumes observés non exhaustifs ; une annonce peut relever de plusieurs codes ROME. Aucun total national certifié.' };
}

async function handleEditorialOccupationCatalogue({ request, response, auth, db } = {}) {
  if (request?.method !== 'POST') {
    response.set?.('Allow', 'POST');
    response.status(405).json({ ok: false, error: 'Méthode non autorisée' });
    return;
  }
  const account = await authenticateAdminRequest({ request, response, auth, db });
  if (!account) return;
  try {
    const result = await loadEditorialOccupationCatalogue(db);
    response.set?.('Cache-Control', 'private, no-store');
    response.status(200).json(result);
  } catch (error) {
    console.error('Editorial occupation catalogue failed', String(error?.message || error).slice(0, 200));
    response.status(500).json({ ok: false, error: 'Catalogue métiers indisponible' });
  }
}

module.exports = { catalogueFromSnapshots, loadEditorialOccupationCatalogue, handleEditorialOccupationCatalogue };
