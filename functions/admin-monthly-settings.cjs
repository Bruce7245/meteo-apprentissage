'use strict';

const {authenticateAdminRequest} = require('./lib/admin-auth.cjs');
const {isWrittenCompleteImport} = require('./lib/insee-collection-state.cjs');
const {
  MONTH_RE, DEPS, monthShift, monthDays, nonNegative, normalizeDailyDepartment,
  calculateMonth, compare, checkSeasonality,
} = require('./lib/admin-monthly-settings.cjs');

const DEFAULT = Array(12).fill('unknown');
const MONTH_CACHE = new Map();
const CACHE_LIMIT = 8;

function parisToday(date = new Date()) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function validMonth(month, today = parisToday()) {
  return MONTH_RE.test(month) && month <= today.slice(0, 7) &&
    Number(month.slice(0, 4)) >= 2000;
}

function unauthorizedMethod(request, response) {
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return true;
  }
  if (request.method !== 'POST') {
    response.status(405).json({ok: false, error: 'Méthode non autorisée'});
    return true;
  }
  return false;
}

async function saveSeasonality({input, ref, db, admin, response, FieldValue}) {
  let data;
  try {
    data = checkSeasonality(input);
  } catch {
    response.status(400).json({ok: false, error: 'Calendrier ou justification invalides'});
    return;
  }

  const expectedVersion = input.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    response.status(400).json({ok: false, error: 'Version invalide'});
    return;
  }

  try {
    const version = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const previous = snapshot.exists ? snapshot.data() || {} : {};
      const current = Number(previous.version || 0);
      if (current !== expectedVersion) throw new Error('VERSION_CONFLICT');

      const next = current + 1;
      const updated = {
        months: data.months,
        reason: data.reason,
        version: next,
        updatedBy: admin.uid,
        updatedAt: FieldValue.serverTimestamp(),
        schemaVersion: 'adminMonthlySeasonality.v1',
      };

      tx.set(ref, updated);
      tx.set(
        db.collection('adminMonthlySeasonalityHistory').doc('national_' + String(next).padStart(6, '0')),
        {
          ...updated,
          previousMonths: previous.months || DEFAULT,
          previousVersion: current,
          createdAt: FieldValue.serverTimestamp(),
        }
      );
      return next;
    });
    response.status(200).json({ok: true, version});
  } catch (error) {
    if (error.message === 'VERSION_CONFLICT') {
      response.status(409).json({ok: false, error: 'Configuration modifiée dans une autre session : rechargez la page'});
      return;
    }
    throw error;
  }
}

// Do not scan 90 calendar days if Firestore has only a week of snapshots.
// A small, bounded in-memory cache avoids repeating thousands of reads when
// an administrator switches tabs or refreshes a month.
async function readMonth(db, month, availableDates, today) {
  const now = Date.now();
  const cached = MONTH_CACHE.get(month);
  if (cached && cached.expiresAt > now) return cached.rows;

  const dates = monthDays(month).filter(date =>
    date < today && availableDates.has(date));
  const rows = new Map();
  let cursor = 0;
  const workers = Array.from({length: 5}, async () => {
    while (cursor < dates.length) {
      const date = dates[cursor++];
      const snapshot = await db.collection('dailyOfferSnapshots')
        .doc(date).collection('departments').get();
      const departments = new Map();
      for (const doc of snapshot.docs) {
        if (!DEPS.includes(doc.id)) continue;
        const row = normalizeDailyDepartment(doc.data());
        if (row) departments.set(doc.id, row);
      }
      rows.set(date, departments);
    }
  });
  await Promise.all(workers);
  const expiresAt = now + (month === today.slice(0, 7) ? 5 : 30) * 60_000;
  MONTH_CACHE.set(month, {rows, expiresAt});
  while (MONTH_CACHE.size > CACHE_LIMIT) MONTH_CACHE.delete(MONTH_CACHE.keys().next().value);
  return rows;
}

function populationMap(metaDoc, populationSnap) {
  const meta = metaDoc.exists ? metaDoc.data() || {} : {};
  const referenceYear = Number(meta.referenceYear);
  const ready = Boolean(meta.runId && Number(meta.departmentsCount) === DEPS.length &&
    Number.isInteger(referenceYear));
  const populations = new Map();
  if (ready) {
    for (const doc of populationSnap.docs) {
      const record = doc.data();
      const value = nonNegative(record?.population15To29);
      if (DEPS.includes(doc.id) && value > 0 && record.runId === meta.runId &&
          Number(record.referenceYear) === referenceYear) populations.set(doc.id, value);
    }
  }
  return {populations, referenceYear: ready ? referenceYear : null};
}

function employerMap(importSnap, statsSnap, nafIndexSnap) {
  const stats = new Map(statsSnap.docs.map(doc => [doc.id, doc.data()]));
  const nafAvailable = new Set(nafIndexSnap.docs.map(doc => doc.id));
  const counts = new Map();

  for (const doc of importSnap.docs) {
    const code = doc.id;
    const stat = stats.get(code);
    if (!DEPS.includes(code) || !isWrittenCompleteImport(doc.data()) ||
        !nafAvailable.has(code) || stat?.employerOnly !== true) continue;
    const count = nonNegative(stat.activeEmployerEstablishmentsCount);
    if (count !== null) counts.set(code, count);
  }
  return counts;
}

async function handleRead({input, ref, db, response}) {
  const month = typeof input.month === 'string' ? input.month : '';
  const today = parisToday();
  if (!validMonth(month, today)) {
    response.status(400).json({ok: false, error: 'Mois invalide'});
    return;
  }

  const previousMonth = monthShift(month, -1);
  const previousYear = monthShift(month, -12);
  const months = [month, previousMonth, previousYear];

  const [configSnap, populationMeta, populationSnap, importSnap,
    statsSnap, nafIndexSnap, departmentSnap, allDateRefs] = await Promise.all([
    ref.get(),
    db.collection('departmentPopulationReferenceMeta').doc('current').get(),
    db.collection('departmentPopulationReference').get(),
    db.collection('inseeDepartmentImportIndex').get(),
    db.collection('inseeDepartmentStats').get(),
    db.collection('inseeDepartmentNafStatsIndex').get(),
    db.collection('departments').get(),
    db.collection('dailyOfferSnapshots').listDocuments(),
  ]);
  const availableDates = new Set(allDateRefs.map(ref => ref.id));
  const {populations, referenceYear} = populationMap(populationMeta, populationSnap);
  const employers = employerMap(importSnap, statsSnap, nafIndexSnap);
  const names = new Map(departmentSnap.docs.map(doc => {
    const row = doc.data() || {};
    return [doc.id, String(row.name || row.nom || row.departmentName || doc.id).slice(0, 100)];
  }));

  const daily = await Promise.all(months.map(value =>
    readMonth(db, value, availableDates, today)));
  const results = months.map((value, index) =>
    calculateMonth(value, daily[index], populations, employers, today));

  const byCode = rows => new Map(rows.map(row => [row.departmentCode, row]));
  const monthPrev = byCode(results[1]);
  const yearPrev = byCode(results[2]);
  const departments = results[0].map(row => {
    const pm = monthPrev.get(row.departmentCode);
    const py = yearPrev.get(row.departmentCode);
    return {
      ...row,
      departmentName: names.get(row.departmentCode) || row.departmentCode,
      previousMonthRatio: pm?.offersPer10000Young ?? null,
      previousYearRatio: py?.offersPer10000Young ?? null,
      changeMonth: compare(row, pm),
      changeYear: compare(row, py),
    };
  });

  const config = configSnap.exists ? configSnap.data() || {} : {};
  const summary = {
    departments: departments.length,
    complete: departments.filter(d => d.quality === 'comparable').length,
    indicative: departments.filter(d => d.quality === 'indicative').length,
    incomplete: departments.filter(d => d.quality === 'incomplete').length,
    m1Available: departments.filter(d => d.changeMonth !== null).length,
    m12Available: departments.filter(d => d.changeYear !== null).length,
  };

  response.status(200).json({
    ok: true, month, previousMonth, previousYear,
    departments, summary, populationReferenceYear: referenceYear,
    seasonality: {
      months: Array.isArray(config.months) && config.months.length === 12
        ? config.months : DEFAULT,
      reason: config.reason || '',
      version: Number(config.version || 0),
    },
    methodology: 'Stock journalier strict moyen sur les journées validées. Comparaison mensuelle uniquement entre mois clôturés à méthodologie homogène. Comparaison indicative si la vérification du plafonnement est inconnue. Population INSEE de référence fixe.',
  });
}

async function handler({request, response, auth, db, FieldValue}) {
  response.set('Cache-Control', 'private, no-store');
  if (unauthorizedMethod(request, response)) return;
  try {
    const admin = await authenticateAdminRequest({
      request, response, auth, db, auditAction: 'admin_monthly_settings',
    });
    if (!admin) return;
    const input = request.body || {};
    const ref = db.collection('adminMonthlySeasonality').doc('national');
    if (input.action === 'save') {
      await saveSeasonality({input, ref, db, admin, response, FieldValue});
    } else if (!input.action || input.action === 'read') {
      await handleRead({input, ref, db, response});
    } else {
      response.status(400).json({ok: false, error: 'Action inconnue'});
    }
  } catch (error) {
    console.error('adminMonthlySettings failed', String(error?.code || error?.message).slice(0, 100));
    response.status(503).json({ok: false, error: 'Paramétrage momentanément indisponible'});
  }
}

module.exports = {
  handler, parisToday, validMonth, populationMap, employerMap, readMonth,
};
