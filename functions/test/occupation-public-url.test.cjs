const test = require('node:test');
const assert = require('node:assert/strict');

let utilsPromise;

async function utils() {
  if (!utilsPromise) {
    utilsPromise = import('../../src/utils/occupationUtils.js');
  }
  return utilsPromise;
}

test('normalizeRomeCode returns canonical exact ROME codes and rejects invalid values', async () => {
  const occupation = await utils();

  assert.equal(occupation.normalizeRomeCode('d1108'), 'D1108');
  assert.equal(occupation.normalizeRomeCode(' M1607 '), 'M1607');
  assert.equal(occupation.normalizeRomeCode('D110'), '');
  assert.equal(occupation.normalizeRomeCode('BAD'), '');
});

test('getRomeFromSearchParams reads only a valid rome parameter', async () => {
  const occupation = await utils();

  assert.equal(
    occupation.getRomeFromSearchParams('?foo=1&rome=d1108'),
    'D1108'
  );
  assert.equal(
    occupation.getRomeFromSearchParams('?rome=bad&foo=1'),
    ''
  );
  assert.equal(occupation.getRomeFromSearchParams(''), '');
});

test('occupation URLs preserve a valid ROME and remove invalid ROME state', async () => {
  const occupation = await utils();

  assert.equal(
    occupation.buildOccupationDepartmentUrl('2A', 'd1108'),
    '/departement/2A?rome=D1108'
  );
  assert.equal(
    occupation.buildOccupationDepartmentUrl('72', ''),
    '/departement/72'
  );
  assert.equal(
    occupation.buildOccupationMapUrl('m1607'),
    '/metiers?rome=M1607'
  );
  assert.equal(
    occupation.buildOccupationMapUrl('bad'),
    '/metiers'
  );
});
