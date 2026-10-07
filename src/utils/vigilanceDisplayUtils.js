import { getLevelLabel } from './levelUtils.js';

const DISPLAY_LEVELS = new Set([
  'green',
  'yellow',
  'orange',
  'red',
  'insufficient_data',
]);

const LEVEL_ALIASES = {
  vert: 'green',
  jaune: 'yellow',
  rouge: 'red',
};

export function normalizeDisplayedVigilanceLevel(
  value,
  fallback = 'insufficient_data'
) {
  const normalized = String(value || '').trim().toLowerCase();
  const aliased = LEVEL_ALIASES[normalized] || normalized;

  if (DISPLAY_LEVELS.has(aliased)) return aliased;

  return DISPLAY_LEVELS.has(fallback)
    ? fallback
    : 'insufficient_data';
}

export function buildDepartmentVigilanceLabel({
  departmentName,
  departmentCode,
  level,
  contextLabel = '',
} = {}) {
  const name = String(departmentName || departmentCode || 'Département').trim();
  const code = String(departmentCode || '').trim();
  const context = String(contextLabel || '').trim();
  const normalizedLevel = normalizeDisplayedVigilanceLevel(level);

  const identity = code ? name + ' (' + code + ')' : name;
  const contextPart = context ? ' — ' + context : '';

  return identity + contextPart + ' : vigilance ' + getLevelLabel(normalizedLevel);
}
