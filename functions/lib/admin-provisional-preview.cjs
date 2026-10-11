'use strict';

/**
 * Admin-only PROVISIONAL score input preparation.
 *
 * A running month must not masquerade as a complete period. We pick a bounded
 * set of exact days shared by a cohort of at least 75 departments, using the
 * same observation method for each. Only the shared dates enter national
 * references and the provisional score. No calendar interpolation.
 */
const MIN_PREVIEW_DAYS = 3;
const MAX_PREVIEW_DAYS = 14;
const MIN_PREVIEW_DEPARTMENTS = 75;

const validNumber = value =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function candidate(row) {
  if (!row || !validNumber(row.population15To29) || row.population15To29 <= 0 ||
      !Array.isArray(row.dailySamples)) return null;

  const methods = new Map();
  for (const sample of row.dailySamples) {
    if (!sample || typeof sample.date !== 'string' ||
        !sample.method || sample.method === 'unknown' ||
        sample.possiblySaturated === true || sample.methodologyBreak === true ||
        !validNumber(sample.offers) || !validNumber(sample.openings)) continue;
    if (!methods.has(sample.method)) methods.set(sample.method, new Map());
    methods.get(sample.method).set(sample.date, sample);
  }
  return {row, methods};
}

function findWindow(rows, {
  focusDepartmentCode = null,
  minDays = MIN_PREVIEW_DAYS,
  minDepartments = MIN_PREVIEW_DEPARTMENTS,
  maxDays = MAX_PREVIEW_DAYS,
} = {}) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .map(candidate).filter(Boolean);
  const groups = new Map();
  for (const person of candidates) {
    for (const [method, days] of person.methods) {
      if (days.size < minDays) continue;
      if (!groups.has(method)) groups.set(method, []);
      groups.get(method).push({...person, days});
    }
  }

  let best = null;
  for (const [method, people] of groups) {
    if (people.length < minDepartments) continue;
    if (focusDepartmentCode &&
        !people.some(person => person.row.departmentCode === focusDepartmentCode)) continue;

    const unionDates = [...new Set(people.flatMap(person => [...person.days.keys()]))]
      .sort((a, b) => b.localeCompare(a));

    for (let start = 0; start < unionDates.length; start++) {
      const dates = [];
      let cohort = people;
      for (let i = start; i < unionDates.length && dates.length < maxDays; i++) {
        const day = unionDates[i];
        const sharing = cohort.filter(person => person.days.has(day));
        if (sharing.length < minDepartments) continue;
        if (focusDepartmentCode &&
            !sharing.some(person => person.row.departmentCode === focusDepartmentCode)) continue;
        cohort = sharing;
        dates.push(day);
      }

      if (dates.length < minDays) continue;
      const proposal = {
        method, dates, cohort,
        focusIncluded: !focusDepartmentCode ||
          cohort.some(person => person.row.departmentCode === focusDepartmentCode),
      };
      if (!best ||
          proposal.dates.length > best.dates.length ||
          (proposal.dates.length === best.dates.length &&
           proposal.cohort.length > best.cohort.length) ||
          (proposal.dates.length === best.dates.length &&
           proposal.cohort.length === best.cohort.length &&
           proposal.dates[0] > best.dates[0])) best = proposal;
    }
  }

  return best;
}

function buildAlignedProvisionalRows(rows, opts = {}) {
  const original = Array.isArray(rows) ? rows : [];
  const window = findWindow(original, opts);
  if (!window) {
    return {
      available: false,
      rows: original.map(row => ({...row, comparisonReady: false})),
      basis: {
        mode: 'provisional_aligned_days',
        reason: 'NO_SHARED_REFERENCE_WINDOW',
        explanation:
          'Aucun groupe d’au moins 75 départements n’a trois journées utilisables en commun pour ce métier et cette méthode.',
        sharedDays: [],
        referenceDepartments: 0,
        minimumDays: opts.minDays || MIN_PREVIEW_DAYS,
        minimumDepartments: opts.minDepartments || MIN_PREVIEW_DEPARTMENTS,
      },
    };
  }

  const members = new Map(window.cohort.map(member =>
    [member.row.departmentCode, member]));
  const result = original.map(row => {
    const member = members.get(row.departmentCode);
    if (!member) return {...row, comparisonReady: false, quality: 'unavailable'};
    const selected = window.dates.map(date => member.days.get(date));
    const averageOffers = selected.reduce((sum, item) => sum + item.offers, 0) /
      selected.length;
    const averageOpenings = selected.reduce((sum, item) => sum + item.openings, 0) /
      selected.length;
    const count = row.activeEmployerEstablishmentsCount;
    const capUnknown = selected.some(item =>
      item.possiblySaturated !== true && item.possiblySaturated !== false);
    return {
      ...row,
      averageOffers,
      averageOpenings,
      offersPer10000Young: averageOffers / row.population15To29 * 10000,
      offersPer100Employers: validNumber(count) && count > 0
        ? averageOffers / count * 100 : null,
      quality: capUnknown ? 'indicative' : 'provisional',
      comparisonReady: true,
      isProvisional: true,
      changeMonth: null,
      changeYear: null,
      previewDays: [...window.dates],
      dailySamples: undefined,
    };
  });

  const days = [...window.dates].sort();
  return {
    available: true,
    rows: result,
    basis: {
      mode: 'provisional_aligned_days',
      method: window.method,
      sharedDays: days,
      firstDate: days[0],
      lastDate: days[days.length - 1],
      referenceDepartments: window.cohort.length,
      minimumDepartments: opts.minDepartments || MIN_PREVIEW_DEPARTMENTS,
      minimumDays: opts.minDays || MIN_PREVIEW_DAYS,
      focusDepartmentIncluded: window.focusIncluded,
      caveat: 'Période partielle : uniquement les jours communs, et aucune variation M−1/M−12 inventée.',
    },
  };
}

module.exports = {
  MIN_PREVIEW_DAYS, MIN_PREVIEW_DEPARTMENTS, MAX_PREVIEW_DAYS,
  candidate, findWindow, buildAlignedProvisionalRows,
};
