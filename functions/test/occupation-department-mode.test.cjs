const test = require('node:test');
const assert = require('node:assert/strict');

let occupationPromise;
let departmentPromise;

async function occupationUtils() {
  if (!occupationPromise) {
    occupationPromise = import('../../src/utils/occupationUtils.js');
  }
  return occupationPromise;
}

async function departmentUtils() {
  if (!departmentPromise) {
    departmentPromise = import('../../src/utils/occupationDepartmentUtils.js');
  }
  return departmentPromise;
}

test('ROME query state distinguishes missing and invalid selections', async () => {
  const occupation = await occupationUtils();

  assert.deepEqual(
    occupation.getRomeSearchState(''),
    { present: false, valid: true, romeCode: '' }
  );
  assert.deepEqual(
    occupation.getRomeSearchState('?rome=bad'),
    { present: true, valid: false, romeCode: '' }
  );
  assert.deepEqual(
    occupation.getRomeSearchState('?rome=d1108'),
    { present: true, valid: true, romeCode: 'D1108' }
  );
});

test('department mode never falls back to global mode when a ROME query is invalid', async () => {
  const department = await departmentUtils();

  assert.deepEqual(
    department.resolveDepartmentPublicMode('?rome=bad'),
    { mode: 'invalid_occupation', romeCode: '' }
  );
  assert.deepEqual(
    department.resolveDepartmentPublicMode('?rome=d1108'),
    { mode: 'occupation', romeCode: 'D1108' }
  );
  assert.deepEqual(
    department.resolveDepartmentPublicMode(''),
    { mode: 'global', romeCode: '' }
  );
});
