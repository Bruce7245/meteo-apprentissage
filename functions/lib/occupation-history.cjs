function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function sortedFinite(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function quantile(values, probability) {
  const items = sortedFinite(values);
  const q = Number(probability);

  if (items.length === 0 || !Number.isFinite(q) || q < 0 || q > 1) {
    return null;
  }

  if (items.length === 1) return items[0];

  const position = (items.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;

  if (lowerIndex === upperIndex) return items[lowerIndex];

  return round(
    items[lowerIndex] +
      (items[upperIndex] - items[lowerIndex]) * fraction
  );
}

function median(values) {
  return quantile(values, 0.5);
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
    targetMonth: String(targetMonthNumber).padStart(2, '0'),
    targetMonthSamples: targetValues.length,
    targetMonthMean: round(targetMean),
    targetMonthMedian: round(median(targetValues)),
    normalLow: round(quantile(targetValues, 0.25)),
    normalHigh: round(quantile(targetValues, 0.75)),
    overallMean: round(overallMean),
  };
}

function computeInterannualTrendProfile(monthlyHistory, options = {}) {
  const asOfMonth = normalizeMonth(options.asOfMonth);

  if (!asOfMonth) {
    throw new Error(`Invalid asOfMonth: ${options.asOfMonth}`);
  }

  const minYears = Number.isInteger(options.minYears)
    ? options.minYears
    : 3;
  const stableBand = Number.isFinite(Number(options.stableBand))
    ? Math.abs(Number(options.stableBand))
    : 0.05;
  const weight = Number.isFinite(Number(options.weight))
    ? Number(options.weight)
    : 0.5;
  const minFactor = Number.isFinite(Number(options.minFactor))
    ? Number(options.minFactor)
    : 0.9;
  const maxFactor = Number.isFinite(Number(options.maxFactor))
    ? Number(options.maxFactor)
    : 1.1;

  if (
    minYears < 2 ||
    stableBand < 0 ||
    weight < 0 ||
    weight > 1 ||
    minFactor <= 0 ||
    maxFactor < minFactor
  ) {
    throw new Error('Invalid interannual trend options');
  }

  const asOfIndex = monthIndex(asOfMonth);
  const targetMonthNumber = Number(asOfMonth.slice(5, 7));
  const byMonth = new Map();

  for (const item of Array.isArray(monthlyHistory) ? monthlyHistory : []) {
    const month = normalizeMonth(item?.month);
    if (!month) continue;

    const index = monthIndex(month);
    if (index >= asOfIndex) continue;
    if (Number(month.slice(5, 7)) !== targetMonthNumber) continue;

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

  const observations = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, offersCount]) => ({
      month,
      year: Number(month.slice(0, 4)),
      offersCount,
    }));

  if (observations.length < 2) {
    return {
      status: 'unavailable',
      direction: 'unknown',
      annualTrendRatio: null,
      lastYearChangeRatio: null,
      factor: 1,
      sampleYears: observations.length,
      normalMedian: observations.length ? observations[0].offersCount : null,
      normalLow: observations.length ? observations[0].offersCount : null,
      normalHigh: observations.length ? observations[0].offersCount : null,
    };
  }

  const changes = [];

  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1].offersCount;
    const current = observations[index].offersCount;

    if (previous > 0) {
      changes.push((current - previous) / previous);
    }
  }

  const latest = observations[observations.length - 1];
  const previous = observations[observations.length - 2];
  const lastYearChangeRatio = previous.offersCount > 0
    ? round((latest.offersCount - previous.offersCount) / previous.offersCount)
    : null;
  const annualTrendRatio = changes.length > 0
    ? round(median(changes))
    : null;

  let direction = 'stable';
  if (annualTrendRatio === null) {
    direction = 'unknown';
  } else if (annualTrendRatio <= -stableBand) {
    direction = 'degrading';
  } else if (annualTrendRatio >= stableBand) {
    direction = 'improving';
  }

  const active =
    observations.length >= minYears &&
    annualTrendRatio !== null;

  const factor = active
    ? round(
        Math.max(
          minFactor,
          Math.min(
            maxFactor,
            1 - annualTrendRatio * weight
          )
        )
      )
    : 1;

  const values = observations.map((item) => item.offersCount);

  return {
    status: active ? 'active' : 'descriptive',
    direction,
    annualTrendRatio,
    lastYearChangeRatio,
    factor,
    sampleYears: observations.length,
    latestHistoricalYear: latest.year,
    latestHistoricalOffers: latest.offersCount,
    previousHistoricalOffers: previous.offersCount,
    normalMedian: round(median(values)),
    normalLow: round(quantile(values, 0.25)),
    normalHigh: round(quantile(values, 0.75)),
  };
}

module.exports = {
  computeRecentOfferTrend,
  computeSeasonalityProfile,
  computeInterannualTrendProfile,
};
