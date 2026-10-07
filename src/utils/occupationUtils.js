export function normalizeRomeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][0-9]{4}$/.test(code) ? code : '';
}

export function getRomeSearchState(search = '') {
  const params = new URLSearchParams(String(search || ''));
  const rawRome = params.get('rome');

  if (rawRome === null) {
    return {
      present: false,
      valid: true,
      romeCode: '',
    };
  }

  const romeCode = normalizeRomeCode(rawRome);

  return {
    present: true,
    valid: Boolean(romeCode),
    romeCode,
  };
}

export function getRomeFromSearchParams(search = '') {
  return getRomeSearchState(search).romeCode;
}

export function buildOccupationDepartmentUrl(departmentCode, romeCode) {
  const department = String(departmentCode || '').trim();
  const encodedDepartment = encodeURIComponent(department);
  const rome = normalizeRomeCode(romeCode);

  return rome
    ? '/departement/' + encodedDepartment + '?rome=' + encodeURIComponent(rome)
    : '/departement/' + encodedDepartment;
}

export function buildOccupationMapUrl(romeCode) {
  const rome = normalizeRomeCode(romeCode);
  return rome
    ? '/metiers?rome=' + encodeURIComponent(rome)
    : '/metiers';
}
