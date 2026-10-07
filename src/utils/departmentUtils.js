const METROPOLITAN_DEPARTMENT_CODES = [
  ...Array.from({ length: 19 }, (_, index) => String(index + 1).padStart(2, '0')),
  '2A',
  '2B',
  ...Array.from({ length: 75 }, (_, index) => String(index + 21)),
];

const OVERSEAS_DEPARTMENT_CODES = ['971', '972', '973', '974', '976'];

export const DEPARTMENT_CODES = Object.freeze([
  ...METROPOLITAN_DEPARTMENT_CODES,
  ...OVERSEAS_DEPARTMENT_CODES,
]);

const DEPARTMENT_CODE_SET = new Set(DEPARTMENT_CODES);

export function normalizeDepartmentCode(value) {
  const raw = String(value || '').trim().toUpperCase();

  if (!raw) return '';

  if (/^\d$/.test(raw)) return raw.padStart(2, '0');

  return raw;
}

export function isValidDepartmentCode(value) {
  return DEPARTMENT_CODE_SET.has(normalizeDepartmentCode(value));
}

export function getDepartmentName(item) {
  return (
    item?.departmentName ||
    item?.name ||
    item?.label ||
    item?.nom ||
    `Département ${item?.departmentCode || item?.code || ''}`.trim()
  );
}
