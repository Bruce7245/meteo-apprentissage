const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidDepartmentCode,
  sanitizePublicFormationStats,
} = require('../lib/public-formation-stats.cjs');

test('sanitizePublicFormationStats exposes only approved aggregate fields', () => {
  const result = sanitizePublicFormationStats({
    departmentCode: '01',
    asOfDate: '2026-10-04',
    formationsCount: 42,
    sessionsCount: 57,
    upcomingSessionsCount: 21,
    recentStartedSessionsCount: 8,
    sectorsCount: 11,
    estimatedNeedToSecure: 999,
    calculationMethod: 'formationNeed.v2',
    secretInternalField: 'hidden',
  });

  assert.deepEqual(result, {
    departmentCode: '01',
    asOfDate: '2026-10-04',
    formationsCount: 42,
    sessionsCount: 57,
    upcomingSessionsCount: 21,
    recentStartedSessionsCount: 8,
    sectorsCount: 11,
  });

  assert.equal('estimatedNeedToSecure' in result, false);
  assert.equal('calculationMethod' in result, false);
  assert.equal('secretInternalField' in result, false);
});

test('department validation supports metropolitan, Corsica and DROM codes', () => {
  assert.equal(isValidDepartmentCode('1'), true);
  assert.equal(isValidDepartmentCode('01'), true);
  assert.equal(isValidDepartmentCode('2A'), true);
  assert.equal(isValidDepartmentCode('2B'), true);
  assert.equal(isValidDepartmentCode('971'), true);
  assert.equal(isValidDepartmentCode('abc'), false);
});
