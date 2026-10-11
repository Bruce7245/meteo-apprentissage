'use strict';

// Read-only statistics; this module must never change published vigilance.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DEPS = [
  ...Array.from({length: 19}, (_, i) => String(i + 1).padStart(2, '0')),
  '2A', '2B',
  ...Array.from({length: 75}, (_, i) => String(i + 21)),
  '971', '972', '973', '974', '976',
];
const DEPARTMENT_SET = new Set(DEPS);
const SEASON_LEVELS = ['high', 'normal', 'low', 'unknown'];

function monthShift(month, offset) {
  if (!MONTH_RE.test(month) || !Number.isSafeInteger(offset)) throw new Error('INVALID_MONTH');
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

function monthDays(month) {
  if (!MONTH_RE.test(month)) throw new Error('INVALID_MONTH');
  const [year, number] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({length: days}, (_, i) =>
    month + '-' + String(i + 1).padStart(2, '0'));
}

function nonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

const MAX_ROME_SUMMARY_ROWS = 120;
const ROME_RE = /^[A-N][0-9]{4}$/;

function normalizeDailyDepartment(data, romeCode = null) {
  if (!data || typeof data !== 'object') return null;
  const strict = data.strictSummary;
  let offers = nonNegative(strict?.totalOffers);
  let openings = nonNegative(strict?.totalOpenings);
  const stored = nonNegative(data.storedOffersCount);
  if (!strict || offers === null || openings === null ||
      (stored !== null && offers > stored)) return null;

  if (romeCode !== null) {
    if (!ROME_RE.test(romeCode) || !Array.isArray(strict.byRome)) return null;
    const row = strict.byRome.find(item => item?.code === romeCode);
    if (row) {
      // A single offer can reference several ROME codes. This is a scoped
      // observation, not an assertion of unique offers across occupations.
      offers = nonNegative(row.offers);
      openings = nonNegative(row.openings);
      if (offers === null || openings === null ||
          offers > strict.totalOffers || openings > strict.totalOpenings) return null;
    } else if (strict.byRome.length < MAX_ROME_SUMMARY_ROWS) {
      // The code is truly absent only when the top-120 result is NOT full.
      offers = 0;
      openings = 0;
    } else {
      // It could exist beyond the capped top-120. Never substitute zero.
      return null;
    }
  }

  // Same precedence as functions/admin-national-stats.cjs.
  const cap = strict.isPossiblySaturated ?? data.summary?.isPossiblySaturated;
  return {
    date: data.date,
    departmentCode: data.departmentCode,
    activeRunId: data.activeRunId,
    qualityStatus: data.qualityStatus,
    offers,
    openings,
    possiblySaturated: typeof cap === 'boolean' ? cap : null,
    qualityMethod: data.qualityMethod || data.sourceRoute || null,
    methodologyBreak: data.methodologyBreak === true,
  };
}

function calculateMonth(month, daily, populations = new Map(), employers = new Map(), today = '2026-10-10', romeCode = null) {
  const dates = monthDays(month);
  const lastObservedDate = today.slice(0, 10);
  const monthComplete = dates.every(date => date < lastObservedDate);
  const rows = [];

  for (const code of DEPS) {
    let daysObserved = 0;
    let offersSum = 0;
    let openingsSum = 0;
    let saturated = false;
    let capMissing = false;
    let breakDetected = false;
    const methods = new Set();
    const dailySamples = [];

    for (const date of dates) {
      // The running day is not finalized.
      if (date >= lastObservedDate) continue;
      const record = daily.get(date)?.get(code);
      const row = record && Object.hasOwn(record, 'offers') ? record : normalizeDailyDepartment(record, romeCode);
      if (!row || row.date !== date || row.departmentCode !== code ||
          !row.activeRunId || row.qualityStatus === 'quarantined' ||
          !DEPARTMENT_SET.has(code) || nonNegative(row.offers) === null ||
          nonNegative(row.openings) === null) continue;

      daysObserved += 1;
      offersSum += row.offers;
      openingsSum += row.openings;
      saturated ||= row.possiblySaturated === true;
      capMissing ||= row.possiblySaturated !== true && row.possiblySaturated !== false;
      breakDetected ||= row.methodologyBreak === true;
      methods.add(row.qualityMethod || 'unknown');
      dailySamples.push({
        date, offers: row.offers, openings: row.openings,
        method: row.qualityMethod || 'unknown',
        possiblySaturated: row.possiblySaturated,
        methodologyBreak: row.methodologyBreak === true,
      });
    }

    const population = nonNegative(populations.get(code));
    const employerCount = nonNegative(employers.get(code));
    const averageOffers = daysObserved ? offersSum / daysObserved : null;
    const complete = monthComplete && daysObserved === dates.length;
    const method = methods.size === 1 ? [...methods][0] : null;
    const homogeneous = method !== null && method !== 'unknown' && !breakDetected;
    const comparisonReady = complete && homogeneous && !saturated && population > 0;
    const quality = !complete ? 'incomplete'
      : !homogeneous ? 'method_change'
        : saturated ? 'saturated'
          : !(population > 0) ? 'missing_population'
            : capMissing ? 'indicative' : 'comparable';

    rows.push({
      departmentCode: code,
      daysObserved,
      daysExpected: dates.length,
      averageOffers,
      averageOpenings: daysObserved ? openingsSum / daysObserved : null,
      population15To29: population,
      activeEmployerEstablishmentsCount: employerCount,
      offersPer10000Young: averageOffers !== null && population > 0
        ? averageOffers / population * 10000 : null,
      offersPer100Employers: averageOffers !== null && employerCount > 0
        ? averageOffers / employerCount * 100 : null,
      quality,
      comparisonReady,
      method,
      capAssessed: !capMissing && complete,
      dailySamples,
    });
  }
  return rows;
}

function compare(current, previous) {
  if (!current || !previous || !current.comparisonReady || !previous.comparisonReady ||
      !current.method || current.method !== previous.method ||
      !current.population15To29 || current.population15To29 !== previous.population15To29) return null;
  const latest = nonNegative(current.offersPer10000Young);
  const baseline = nonNegative(previous.offersPer10000Young);
  if (latest === null || baseline === null || baseline === 0) return null;
  return {
    value: (latest - baseline) / baseline,
    quality: current.quality === 'comparable' && previous.quality === 'comparable'
      ? 'comparable' : 'indicative',
  };
}

function checkSeasonality(input) {
  const months = input?.months;
  if (!Array.isArray(months) || months.length !== 12 ||
      months.some(level => !SEASON_LEVELS.includes(level))) throw new Error('INVALID_SEASONALITY');
  if (typeof input.reason !== 'string' || input.reason.trim().length < 10 ||
      input.reason.length > 1000) throw new Error('INVALID_REASON');
  return {months: [...months], reason: input.reason.trim()};
}

module.exports = {
  DEPS, MONTH_RE, ROME_RE, MAX_ROME_SUMMARY_ROWS,
  monthShift, monthDays, nonNegative, normalizeDailyDepartment,
  calculateMonth, compare, checkSeasonality,
};
