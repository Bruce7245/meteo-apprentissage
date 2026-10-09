'use strict';

function isPublishedExportForDate(snapshot, targetDate) {
  const date = String(targetDate || '');
  const data = snapshot && typeof snapshot.data === 'function'
    ? (snapshot.exists ? snapshot.data() || {} : {})
    : snapshot || {};
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && data.date === date
    && ['export_published', 'export_complement_published'].includes(data.status)
    && typeof data.publishedExportRunId === 'string'
    && /^lba_export_\d{14}$/.test(data.publishedExportRunId);
}

module.exports = { isPublishedExportForDate };
