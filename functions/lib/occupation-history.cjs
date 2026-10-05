const { normalizeRomeCode } = require('./occupation-search.cjs');

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function validDateOnly(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text
    ? null
    : text;
}

function validMonth(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? text : null;
}

function monthOrdinal(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return year * 12 + monthNumber - 1;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function extractOfferCount(value) {
  return finiteNonNegative(
    value?.activeOffersCount ??
    value?.offersCount ??
    value?.offers ??
    value?.totalOffers ??
    value?.jobsCount ??
    value?.count
  );
}

function extractMonthlyRomeObservation(data = {}) {
  const month = validMonth(data.month || String(data.date || '').slice(0, 7));
  const romeCode = normalizeRomeCode(data.romeCode || data.code);
  const activeOffersCount = extractOfferCount(data);
  if (!month || !romeCode || activeOffersCount === null) return null;
  return { month, romeCode, activeOffersCount };
}

function extractDailyRomeObservations(data = {}) {
  const date = validDateOnly(data.date || data.asOfDate);
  if (!date) return [];

  const raw = data.byRome ?? data.strictSummary?.byRome ?? data.summary?.byRome;
  const candidates = [];

  if (normalizeRomeCode(data.romeCode || data.code) && extractOfferCount(data) !== null) {
    candidates.push(data);
  }

  if (Array.isArray(raw)) {
    candidates.push(...raw);
  } else if (raw && typeof raw === 'object') {
    for (const [code, value] of Object.entries(raw)) {
      candidates.push(
        value && typeof value === 'object'
          ? { code, ...value }
          : { code, count: value }
      );
    }
  }

  return candidates
    .map((item) => {
      const romeCode = normalizeRomeCode(item?.romeCode || item?.code || item?.label);
      const activeOffersCount = extractOfferCount(item);
      if (!romeCode || activeOffersCount === null) return null;
      const openingsCount = finiteNonNegative(
        item?.openingsCount ?? item?.openings ?? item?.totalOpenings ?? item?.openingCount
      );
      return openingsCount === null
        ? { date, romeCode, activeOffersCount }
        : { date, romeCode, activeOffersCount, openingsCount };
    })
    .filter(Boolean)
    .sort((a, b) => a.romeCode.localeCompare(b.romeCode, 'fr'));
}

function computeRecentOfferTrend(dailyHistory) {
  const observations = (Array.isArray(dailyHistory) ? dailyHistory : [])
    .map((item) => ({
      date: validDateOnly(item?.date),
      value: finiteNonNegative(
        item?.activeOffersCount ?? item?.totalOffers ?? item?.offersCount
      ),
    }))
    .filter((item) => item.date && item.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (observations.length < 2) {
    return {
      status: 'unknown',
      changeRatio: null,
      observations: observations.length,
    };
  }

  const first = observations[0].value;
  const last = observations[observations.length - 1].value;
  let status = 'stable';
  if (last > first) status = 'increasing';
  if (last < first) status = 'decreasing';

  return {
    status,
    changeRatio: first > 0 ? (last - first) / first : null,
    observations: observations.length,
  };
}

function computeSeasonalityProfile(monthlyHistory, options = {}) {
  const asOfMonth = validMonth(options.asOfMonth);
  if (!asOfMonth) throw new Error(`Invalid asOfMonth: ${options.asOfMonth ?? ''}`);

  const minActiveMonths = Number.isInteger(options.minActiveMonths)
    ? options.minActiveMonths
    : 24;
  const completenessThreshold = Number.isFinite(Number(options.completenessThreshold))
    ? Number(options.completenessThreshold)
    : 0.9;
  const minFactor = Number.isFinite(Number(options.minFactor))
    ? Number(options.minFactor)
    : 1;
  const maxFactor = Number.isFinite(Number(options.maxFactor))
    ? Number(options.maxFactor)
    : 1;

  if (minActiveMonths < 24) {
    throw new Error('minActiveMonths cannot be below 24');
  }
  if (completenessThreshold < 0 || completenessThreshold > 1) {
    throw new Error('completenessThreshold must be between 0 and 1');
  }
  if (minFactor <= 0 || maxFactor < minFactor) {
    throw new Error('Invalid seasonality factor bounds');
  }

  const byMonth = new Map();
  for (const item of Array.isArray(monthlyHistory) ? monthlyHistory : []) {
    const month = validMonth(item?.month ?? item?.date);
    const value = finiteNonNegative(
      item?.activeOffersCount ?? item?.totalOffers ?? item?.offersCount
    );
    if (!month || value === null) continue;

    if (byMonth.has(month) && byMonth.get(month) !== value) {
      throw new Error(`Conflicting monthly offer observations for ${month}`);
    }
    byMonth.set(month, value);
  }

  const entries = [...byMonth.entries()]
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const sampleMonths = entries.length;
  const expectedMonths = sampleMonths === 0
    ? 0
    : monthOrdinal(entries[entries.length - 1].month) - monthOrdinal(entries[0].month) + 1;
  const completeness = expectedMonths > 0 ? sampleMonths / expectedMonths : 0;

  const base = {
    status: 'unavailable',
    factor: 1,
    sampleMonths,
    completeness,
  };

  if (sampleMonths < 12) return base;

  if (sampleMonths < minActiveMonths || completeness < completenessThreshold) {
    return { ...base, status: 'descriptive' };
  }

  const targetMonthNumber = asOfMonth.slice(5, 7);
  const targetValues = entries
    .filter((item) => item.month.slice(5, 7) === targetMonthNumber)
    .map((item) => item.value);

  if (targetValues.length < 2) {
    return { ...base, status: 'descriptive' };
  }

  const overallAverage = entries.reduce((sum, item) => sum + item.value, 0) / sampleMonths;
  const targetAverage = targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length;

  if (!(overallAverage > 0)) {
    return { ...base, status: 'descriptive' };
  }

  return {
    status: 'active',
    factor: clamp(targetAverage / overallAverage, minFactor, maxFactor),
    sampleMonths,
    completeness,
  };
}

module.exports = {
  extractMonthlyRomeObservation,
  extractDailyRomeObservations,
  computeRecentOfferTrend,
  computeSeasonalityProfile,
};
