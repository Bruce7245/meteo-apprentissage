export function normalizeDepartmentCode(value) {
  const raw = String(value || '').trim().toUpperCase();

  if (!raw) return '';

  if (/^\d$/.test(raw)) return raw.padStart(2, '0');

  return raw;
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
