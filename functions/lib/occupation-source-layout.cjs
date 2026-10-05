function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function dailyDepartmentSnapshotPath(date, departmentCode) {
  const safeDate = clean(date);
  const safeDepartment = clean(departmentCode).toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) {
    throw new Error(`Invalid daily snapshot date: ${date ?? ''}`);
  }
  if (!/^(?:\d{2}|2A|2B|97[1-6])$/.test(safeDepartment)) {
    throw new Error(`Invalid daily snapshot department: ${departmentCode ?? ''}`);
  }
  return `dailyOfferSnapshots/${safeDate}/departments/${safeDepartment}`;
}

function dailyOccupationContextCollection() {
  return 'occupationContextStats';
}

module.exports = {
  dailyDepartmentSnapshotPath,
  dailyOccupationContextCollection,
};
