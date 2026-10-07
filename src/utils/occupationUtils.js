export function normalizeRomeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][0-9]{4}$/.test(code) ? code : '';
}

export function normalizeOccupationDomainCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][0-9]{2}$/.test(code) ? code : '';
}

export function inferOccupationDomainFromRome(romeCode) {
  const rome = normalizeRomeCode(romeCode);
  return rome ? rome.slice(0, 3) : '';
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

export function getOccupationNavigationState(search = '') {
  const params = new URLSearchParams(String(search || ''));
  const rawDomain = params.get('domain');
  const rawRome = params.get('rome');

  const domainPresent = rawDomain !== null;
  const romePresent = rawRome !== null;

  const requestedDomainCode =
    normalizeOccupationDomainCode(rawDomain);
  const romeCode = normalizeRomeCode(rawRome);
  const inferredDomainCode =
    inferOccupationDomainFromRome(romeCode);

  const domainValid =
    !domainPresent || Boolean(requestedDomainCode);
  const romeValid =
    !romePresent || Boolean(romeCode);

  const domainCode =
    inferredDomainCode ||
    requestedDomainCode ||
    '';

  return {
    domainPresent,
    romePresent,
    valid: domainValid && romeValid,
    domainValid,
    romeValid,
    domainCode,
    romeCode,
    inferredDomainCode,
    requestedDomainCode,
    needsCanonicalization:
      Boolean(
        romeCode &&
        requestedDomainCode &&
        requestedDomainCode !== inferredDomainCode
      ),
  };
}

export function getRomeFromSearchParams(search = '') {
  return getRomeSearchState(search).romeCode;
}

export function buildOccupationDomainMapUrl(domainCode) {
  const domain = normalizeOccupationDomainCode(domainCode);
  return domain
    ? '/metiers?domain=' + encodeURIComponent(domain)
    : '/metiers';
}

export function buildOccupationDepartmentUrl(
  departmentCode,
  romeCode,
  domainCode = ''
) {
  const department = String(departmentCode || '').trim();
  const encodedDepartment = encodeURIComponent(department);
  const rome = normalizeRomeCode(romeCode);
  const domain =
    normalizeOccupationDomainCode(domainCode) ||
    inferOccupationDomainFromRome(rome);

  const params = new URLSearchParams();

  if (domain) params.set('domain', domain);
  if (rome) params.set('rome', rome);

  const suffix = params.toString();

  return '/departement/' + encodedDepartment + (suffix ? '?' + suffix : '');
}

export function buildOccupationMapUrl(
  romeCode,
  domainCode = ''
) {
  const rome = normalizeRomeCode(romeCode);
  if (!rome) return buildOccupationDomainMapUrl(domainCode);

  const domain =
    normalizeOccupationDomainCode(domainCode) ||
    inferOccupationDomainFromRome(rome);

  const params = new URLSearchParams();
  if (domain) params.set('domain', domain);
  params.set('rome', rome);

  return '/metiers?' + params.toString();
}
