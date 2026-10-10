import {DEPARTMENT_CODES, normalizeDepartmentCode} from './departmentUtils.js';
import {normalizeDisplayedVigilanceLevel} from './vigilanceDisplayUtils.js';
import {getLevelLabel} from './levelUtils.js';

const VALID_CODES = new Set(DEPARTMENT_CODES);
const COLORS = ['green','yellow','orange','red','unknown'];

function indexRawEntries(raw) {
  if (!raw || typeof raw !== 'object') return [];
  for (const key of ['departments','items','docs','publications','vigilances']) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}

/**
 * Read-only representation of what the existing public map actually displays.
 * The public site paints departments not explicitly published in GREEN:
 * reproduce it here without silently claiming they were measured.
 *
 * With no published index, nothing is green by default.
 */
export function buildAdminPublishedComparisonMap(index) {
  const available = index?.exists === true && Array.isArray(index.departments);
  const byPublishedCode = new Map();
  const explicit = new Set();

  if (available) {
    for (const item of index.departments) {
      const code = normalizeDepartmentCode(item?.code || item?.departmentCode);
      if (VALID_CODES.has(code)) byPublishedCode.set(code, item);
    }
    for (const item of indexRawEntries(index.raw)) {
      const code = normalizeDepartmentCode(
        item?.departmentCode || item?.code || item?.inseeCode || item?.id,
      );
      if (VALID_CODES.has(code)) explicit.add(code);
    }
  }

  const departments = DEPARTMENT_CODES.map(code => {
    const item = byPublishedCode.get(code) || null;
    const level = available
      ? normalizeDisplayedVigilanceLevel(
        item?.publishedLevel || item?.level || 'green',
        'green',
      ) : 'insufficient_data';
    const color = level === 'insufficient_data' ? 'unknown' : level;
    const explicitlyPublished = available && explicit.has(code);
    const defaultGreen = available && !explicitlyPublished && color === 'green';

    return {
      code,
      name: item?.name || item?.departmentName || 'Département ' + code,
      level,
      color,
      label: color === 'unknown' ? 'Indéterminé' : getLevelLabel(level),
      explicitlyPublished,
      defaultGreen,
      date: item?.date || index?.latestDate || null,
      publicSummary: item?.publicSummary || null,
    };
  });

  const levels = Object.fromEntries(COLORS.map(color => [
    color, departments.filter(department => department.color === color).length,
  ]));

  return {
    available,
    latestDate: available ? index.latestDate || null : null,
    publishedCount: available ? index.publishedCount ?? explicit.size : 0,
    departments,
    byCode: new Map(departments.map(department => [department.code, department])),
    summary: {
      total: departments.length,
      ...levels,
      explicit: departments.filter(d => d.explicitlyPublished).length,
      defaultGreen: departments.filter(d => d.defaultGreen).length,
    },
  };
}
