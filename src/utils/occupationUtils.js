export function normalizeRomeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][0-9]{4}$/.test(code) ? code : '';
}

export function getRomeFromSearchParams(search = '') {
  const params = new URLSearchParams(String(search || ''));
  return normalizeRomeCode(params.get('rome'));
}

export function buildOccupationDepartmentUrl(departmentCode, romeCode) {
  const department = String(departmentCode || '').trim();
  const encodedDepartment = encodeURIComponent(department);
  const rome = normalizeRomeCode(romeCode);

  return rome
    ? `/departement/${encodedDepartment}?rome=${encodeURIComponent(rome)}`
    : `/departement/${encodedDepartment}`;
}

export function buildOccupationMapUrl(romeCode) {
  const rome = normalizeRomeCode(romeCode);
  return rome
    ? `/metiers?rome=${encodeURIComponent(rome)}`
    : '/metiers';
}
