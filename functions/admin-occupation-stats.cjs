const {
  authenticateAdminRequest,
} = require('./lib/admin-auth.cjs');
const {
  enrichOccupationRowsWithPrevious,
  optionalFiniteNumber,
  summarizeOccupationAnalysisRows,
} = require('./admin-occupation-vigilance-config.cjs');

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeRomeCode(value) {
  const code = text(value).toUpperCase();
  return /^[A-Z][0-9]{4}$/.test(code) ? code : '';
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function clampHistoryLimit(value) {
  const number = Math.floor(Number(value) || 30);
  return Math.max(7, Math.min(number, 60));
}

function levelCounts(rows = []) {
  const levels = {
    green: 0,
    yellow: 0,
    orange: 0,
    red: 0,
    insufficient_data: 0,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const level = text(row?.publishedLevel || 'insufficient_data');
    if (level in levels) levels[level] += 1;
  }

  return levels;
}

function percentChange(current, previous) {
  const currentNumber = optionalFiniteNumber(current);
  const previousNumber = optionalFiniteNumber(previous);

  if (
    currentNumber === null ||
    previousNumber === null ||
    previousNumber === 0
  ) {
    return null;
  }

  return (currentNumber - previousNumber) / Math.abs(previousNumber);
}

function compactStatsRow(data = {}, id = null) {
  return {
    id,
    departmentCode: text(data.departmentCode) || null,
    departmentName: text(data.departmentName) || null,
    romeCode: text(data.romeCode) || null,
    romeLabel: text(data.romeLabel) || null,
    publishedLevel: text(data.publishedLevel) || 'insufficient_data',
    confidenceLevel: text(data.confidenceLevel) || 'low',
    activeOffersCount: optionalFiniteNumber(data.activeOffersCount),
    expectedOffers: optionalFiniteNumber(data.expectedOffers),
    observedVsExpectedRatio: optionalFiniteNumber(
      data.observedVsExpectedRatio
    ),
    formationsCount: optionalFiniteNumber(data.formationsCount),
    population15To29: optionalFiniteNumber(data.population15To29),
    recentTrend: data.recentTrend || null,
    interannualTrend: data.interannualTrend || null,
  };
}

async function listPublishedOccupationRuns(db, historyLimit) {
  const snapshot = await db
    .collection('occupationVigilanceRuns')
    .get();

  const runs = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .filter((run) => text(run.status) === 'published')
    .sort((left, right) => {
      const dateCompare = text(right.date).localeCompare(text(left.date));

      if (dateCompare !== 0) return dateCompare;

      return (
        timestampMillis(right.publishedAt || right.updatedAt) -
        timestampMillis(left.publishedAt || left.updatedAt)
      );
    });

  const dailyRuns = [];
  const seenDates = new Set();

  for (const run of runs) {
    const date = text(run.date);
    if (!date || seenDates.has(date)) continue;

    seenDates.add(date);
    dailyRuns.push(run);

    if (dailyRuns.length >= historyLimit) break;
  }

  return dailyRuns;
}

async function loadRomeRowsForRun(db, run, romeCode) {
  const snapshot = await db
    .collection('occupationVigilanceSnapshots')
    .doc(run.id)
    .collection('entries')
    .where('romeCode', '==', romeCode)
    .get();

  return snapshot.docs.map((doc) =>
    compactStatsRow(doc.data() || {}, doc.id)
  );
}

function summarizeHistoryPoint(run, rows) {
  const summary = summarizeOccupationAnalysisRows(rows);
  const levels = levelCounts(rows);

  const totalObserved = optionalFiniteNumber(summary.totalObservedOffers);
  const totalExpected = optionalFiniteNumber(summary.totalExpectedOffers);

  return {
    runId: run.id,
    date: run.date || null,
    configVersion: run.configVersion || null,
    calculationVersion: run.calculationVersion || null,
    departmentsCount: summary.departmentsCount,
    totalObservedOffers: totalObserved,
    totalExpectedOffers: totalExpected,
    observedVsExpectedRatio:
      totalObserved !== null &&
      totalExpected !== null &&
      totalExpected > 0
        ? totalObserved / totalExpected
        : null,
    elevatedDepartments: levels.orange + levels.red,
    levels,
    highConfidenceCount: summary.highConfidenceCount,
  };
}

function buildDepartmentHistory(chronologicalRuns) {
  const output = {};

  for (const item of chronologicalRuns) {
    for (const row of item.rows) {
      const code = text(row.departmentCode);
      if (!code) continue;

      if (!output[code]) output[code] = [];

      output[code].push({
        date: item.run.date || null,
        publishedLevel: row.publishedLevel,
        confidenceLevel: row.confidenceLevel,
        activeOffersCount: row.activeOffersCount,
        expectedOffers: row.expectedOffers,
        observedVsExpectedRatio: row.observedVsExpectedRatio,
      });
    }
  }

  return output;
}

async function getOccupationStatsForAdmin({
  db,
  romeCode,
  historyLimit = 30,
} = {}) {
  const rome = normalizeRomeCode(romeCode);

  if (!rome) {
    return {
      ok: false,
      status: 400,
      errorCode: 'ROME_REQUIRED',
      error: 'Un métier ROME valide est requis.',
    };
  }

  const limit = clampHistoryLimit(historyLimit);
  const runs = await listPublishedOccupationRuns(db, limit);

  if (runs.length === 0) {
    return {
      ok: true,
      status: 200,
      romeCode: rome,
      romeLabel: rome,
      run: null,
      previousRun: null,
      summary: null,
      ranking: [],
      history: [],
      departmentHistory: {},
    };
  }

  const loaded = await Promise.all(
    runs.map(async (run) => ({
      run,
      rows: await loadRomeRowsForRun(db, run, rome),
    }))
  );

  const nonEmpty = loaded.filter((item) => item.rows.length > 0);

  if (nonEmpty.length === 0) {
    return {
      ok: true,
      status: 200,
      romeCode: rome,
      romeLabel: rome,
      run: null,
      previousRun: null,
      summary: null,
      ranking: [],
      history: [],
      departmentHistory: {},
    };
  }

  const current = nonEmpty[0];
  const previous = nonEmpty[1] || null;

  const comparison = enrichOccupationRowsWithPrevious(
    current.rows,
    previous?.rows || []
  );

  const currentSummary = summarizeOccupationAnalysisRows(comparison.rows);
  const currentLevels = levelCounts(comparison.rows);
  const historyDescending = nonEmpty.map((item) =>
    summarizeHistoryPoint(item.run, item.rows)
  );
  const history = [...historyDescending].reverse();
  const chronologicalRuns = [...nonEmpty].reverse();

  const previousHistoryPoint = historyDescending[1] || null;
  const currentHistoryPoint = historyDescending[0] || null;

  const totalObservedDelta =
    currentHistoryPoint?.totalObservedOffers !== null &&
    currentHistoryPoint?.totalObservedOffers !== undefined &&
    previousHistoryPoint?.totalObservedOffers !== null &&
    previousHistoryPoint?.totalObservedOffers !== undefined
      ? currentHistoryPoint.totalObservedOffers -
        previousHistoryPoint.totalObservedOffers
      : null;

  const totalExpectedDelta =
    currentHistoryPoint?.totalExpectedOffers !== null &&
    currentHistoryPoint?.totalExpectedOffers !== undefined &&
    previousHistoryPoint?.totalExpectedOffers !== null &&
    previousHistoryPoint?.totalExpectedOffers !== undefined
      ? currentHistoryPoint.totalExpectedOffers -
        previousHistoryPoint.totalExpectedOffers
      : null;

  return {
    ok: true,
    status: 200,
    romeCode: rome,
    romeLabel:
      comparison.rows.find((row) => row.romeLabel)?.romeLabel ||
      rome,
    run: {
      id: current.run.id,
      date: current.run.date || null,
      status: current.run.status || null,
      configVersion: current.run.configVersion || null,
      calculationVersion: current.run.calculationVersion || null,
    },
    previousRun: previous
      ? {
          id: previous.run.id,
          date: previous.run.date || null,
          status: previous.run.status || null,
          configVersion: previous.run.configVersion || null,
          calculationVersion: previous.run.calculationVersion || null,
        }
      : null,
    summary: {
      ...currentSummary,
      levels: currentLevels,
      transitions: comparison.transitions,
      historyPointsCount: history.length,
      totalObservedDelta,
      totalObservedChangeRatio: percentChange(
        currentHistoryPoint?.totalObservedOffers,
        previousHistoryPoint?.totalObservedOffers
      ),
      totalExpectedDelta,
      totalExpectedChangeRatio: percentChange(
        currentHistoryPoint?.totalExpectedOffers,
        previousHistoryPoint?.totalExpectedOffers
      ),
    },
    ranking: comparison.rows,
    history,
    departmentHistory: buildDepartmentHistory(chronologicalRuns),
  };
}

async function handleOccupationStats({
  request,
  response,
  auth,
  db,
} = {}) {
  if (request?.method !== 'POST') {
    response.status(405).json({
      ok: false,
      error: 'Méthode non autorisée',
    });
    return;
  }

  const decoded = await authenticateAdminRequest({
    request,
    response,
    auth,
    db,
  });

  if (!decoded) return;

  const result = await getOccupationStatsForAdmin({
    db,
    romeCode: request?.body?.romeCode,
    historyLimit: request?.body?.historyLimit,
  });

  response.set?.('Cache-Control', 'no-store');
  response.status(result.status).json(result);
}

module.exports = {
  clampHistoryLimit,
  listPublishedOccupationRuns,
  compactStatsRow,
  summarizeHistoryPoint,
  buildDepartmentHistory,
  getOccupationStatsForAdmin,
  handleOccupationStats,
};
