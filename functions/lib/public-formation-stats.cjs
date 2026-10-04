function normalizeDepartmentCode(value) {
  const code = String(value || '').trim().toUpperCase();

  if (/^\d{1,2}$/.test(code)) {
    return code.padStart(2, '0');
  }

  return code;
}

function isValidDepartmentCode(value) {
  const code = normalizeDepartmentCode(value);

  return /^\d{2,3}$/.test(code) || code === '2A' || code === '2B';
}

function sanitizePublicFormationStats(source = {}, departmentCode = '') {
  const code = normalizeDepartmentCode(
    departmentCode || source.departmentCode
  );

  return {
    departmentCode: code,
    asOfDate: source.asOfDate || null,
    formationsCount: Number(source.formationsCount || 0),
    sessionsCount: Number(source.sessionsCount || 0),
    upcomingSessionsCount: Number(source.upcomingSessionsCount || 0),
    recentStartedSessionsCount: Number(source.recentStartedSessionsCount || 0),
    sectorsCount: Number(source.sectorsCount || 0),
  };
}

module.exports = {
  normalizeDepartmentCode,
  isValidDepartmentCode,
  sanitizePublicFormationStats,
};
