'use strict';

/**
 * Decisions for resuming a Sirene collection.
 * The existence of an aggregate is NOT proof that the source was fully paged.
 * No Firestore dependency: every branch is testable without production access.
 */

function isWrittenCompleteImport(record) {
  return Boolean(
    record &&
    record.write === true &&
    record.complete === true &&
    record.employerOnly !== false &&
    record.activeOnly !== true
  );
}

function resumableCursor(record) {
  if (!record || record.write !== true || record.complete === true) return '';
  const value = typeof record.nextCursor === 'string'
    ? record.nextCursor.trim()
    : '';
  if (!value || value === '*' || value === 'null') return '';
  return value;
}

function chooseDepartmentAction({
  importRecord = null,
  statsAvailable = false,
  nafStatsAvailable = false,
  currentCursor = '',
  skipExistingStats = true,
} = {}) {
  if (currentCursor) {
    return { action: 'import', cursor: currentCursor, resumed: true };
  }

  if (isWrittenCompleteImport(importRecord) && skipExistingStats) {
    if (statsAvailable && nafStatsAvailable) {
      return { action: 'skip', cursor: '', resumed: false };
    }
    return { action: 'aggregate', cursor: '', resumed: false };
  }

  const cursor = resumableCursor(importRecord);
  return {
    action: 'import',
    cursor: cursor || '*',
    resumed: Boolean(cursor),
  };
}

function classifyDepartment({ importRecord = null, statsAvailable = false, nafStatsAvailable = false } = {}) {
  const importComplete = isWrittenCompleteImport(importRecord);
  const aggregateComplete = statsAvailable && nafStatsAvailable;

  return {
    importAvailable: Boolean(importRecord),
    importComplete,
    statsAvailable: Boolean(statsAvailable),
    nafStatsAvailable: Boolean(nafStatsAvailable),
    ready: importComplete && aggregateComplete,
    resumable: Boolean(resumableCursor(importRecord)),
    status: importComplete
      ? (aggregateComplete ? 'ready' : 'needs_aggregation')
      : importRecord
        ? 'partial'
        : 'not_started',
  };
}

module.exports = {
  isWrittenCompleteImport,
  resumableCursor,
  chooseDepartmentAction,
  classifyDepartment,
};
