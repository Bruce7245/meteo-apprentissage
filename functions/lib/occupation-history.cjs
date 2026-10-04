function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function normalizeDate(value) {
  const text = cleanText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function normalizeMonth(value) {
  const text = cleanText(value).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(text)) return null;

  const [year, month] = text.split('-').map(Number);
  if (year < 1900 || year > 2200 || month < 1 || month > 12) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function monthIndex(month) {
  const normalized = normalizeMonth(month);
  if (!normalized) return null;

  const [year, monthNumber] = normalized.split('-').map(Number);
  return year * 12 + (monthNumber - 1);
}

function validOfferCount(value, context) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid ${context} offer count: ${value}`);
  }

  return number;
}

function computeRecentOfferTrend(dailyHistory) {
  const byDate = new Map();

  for (const item of Array.isArray(dailyHistory) ? dailyHistory : []) {
    const date = normalizeDate(item?.date);
    if (!date) continue;

    const rawValue =
      item?.activeOffersCount ??
      item?.offersCount ??
      item?.totalOffers;

    if (rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }

    const count = validOfferCount(rawValue, 'daily');
    byDate.set(date, count);
  }

  const observations = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b));

  if (observations.length < 2) {
    return {
      status: 'unknown',
      changeRatio: null,
      observations: observations.length,
    };
  }

  const first = observations[0][1];
  const latest = observations[observations.length - 1][1];

  if (first === 0) {
    return {
      status: latest > 0 ? 'improving' : 'stable',
      changeRatio: null,
      observations: observations.length,
    };
  }

  const changeRatio = round((latest - first) / first);
  let status = 'stable';

  if (changeRatio >= 0.1) {
    status = 'improving';
  } else if (changeRatio <= -0.1) {
    status = 'degrading';
  }

  return {
    status,
    changeRatio,
    observations: observations.length,
  };
}

function computeSeasonalityProfile(monthlyHistory, options = {}) {
  const asOfMonth = normalizeMonth(options.asOfMonth);

  if (!asOfMonth) {
    throw new Error(`Invalid asOfMonth: ${options.asOfMonth}`);
  }

  const minActiveMonths = Number.isInteger(options.minActiveMonths)
    ? options.minActiveMonths
    : 24;
  const completenessThreshold = Number.isFinite(Number(options.completenessThreshold))
    ? Number(options.completenessThreshold)
    : 0.9;
  const minFactor = Number.isFinite(Number(options.minFactor))
    ? Number(options.minFactor)
    : 0.75;
  const maxFactor = Number.isFinite(Number(options.maxFactor))
    ? Number(options.maxFactor)
    : 1.25;

  if (
    minActiveMonths < 12 ||
    completenessThreshold < 0 ||
    completenessThreshold > 1 ||
    minFactor <= 0 ||
    maxFactor < minFactor
  ) {
    throw new Error('Invalid seasonality options');
  }

  const asOfIndex = monthIndex(asOfMonth);
  const byMonth = new Map();

  for (const item of Array.isArray(monthlyHistory) ? monthlyHistory : []) {
    const month = normalizeMonth(item?.month);
    if (!month) continue;

    const index = monthIndex(month);
    if (index >= asOfIndex) continue;

    const rawValue =
      item?.offersCount ??
      item?.activeOffersCount ??
      item?.totalOffers;

    if (rawValue === null || rawValue === undefined || rawValue === '') {
      continue;
    }

    const count = validOfferCount(rawValue, 'monthly');
    const previous = byMonth.get(month);

    if (previous !== undefined && previous !== count) {
      throw new Error(`Conflicting monthly offer count for ${month}`);
    }

    byMonth.set(month, count);
  }

  const months = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b));

  const sampleMonths = months.length;

  if (sampleMonths === 0) {
    return {
      status: 'unavailable',
      factor: 1,
      sampleMonths: 0,
      completeness: 0,
    };
  }

  const firstIndex = monthIndex(months[0][0]);
  const lastIndex = monthIndex(months[months.length - 1][0]);
  const expectedMonths = Math.max(1, lastIndex - firstIndex + 1);
  const completeness = sampleMonths / expectedMonths;

  if (sampleMonths < 12) {
    return {
      status: 'unavailable',
      factor: 1,
      sampleMonths,
      completeness,
    };
  }

  if (
    sampleMonths < minActiveMonths ||
    completeness < completenessThreshold
  ) {
    return {
      status: 'descriptive',
      factor: 1,
      sampleMonths,
      completeness,
    };
  }

  const targetMonthNumber = Number(asOfMonth.slice(5, 7));
  const targetValues = months
    .filter(([month]) => Number(month.slice(5, 7)) === targetMonthNumber)
    .map(([, count]) => count);

  const allValues = months.map(([, count]) => count);
  const overallMean = allValues.reduce((sum, value) => sum + value, 0) / allValues.length;

  if (targetValues.length < 2 || overallMean <= 0) {
    return {
      status: 'descriptive',
      factor: 1,
      sampleMonths,
      completeness,
    };
  }

  const targetMean =
    targetValues.reduce((sum, value) => sum + value, 0) /
    targetValues.length;
  const rawFactor = targetMean / overallMean;
  const factor = round(
    Math.max(minFactor, Math.min(maxFactor, rawFactor))
  );

  return {
    status: 'active',
    factor,
    sampleMonths,
    completeness,
  };
}

module.exports = {
  computeRecentOfferTrend,
  computeSeasonalityProfile,
};
