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
    '/departement/2A?domain=D11&rome=D1108'
  );
  assert.equal(
    occupation.buildOccupationDepartmentUrl('72', ''),
    '/departement/72'
  );
  assert.equal(
    occupation.buildOccupationMapUrl('m1607'),
    '/metiers?domain=M16&rome=M1607'
  );
  assert.equal(
    occupation.buildOccupationMapUrl('bad'),
    '/metiers'
  );
});


test('occupation navigation is sector-first and keeps legacy ROME URLs compatible', async () => {
  const occupation = await utils();

  assert.deepEqual(
    occupation.getOccupationNavigationState('?domain=G12'),
    {
      domainPresent: true,
      romePresent: false,
      valid: true,
      domainValid: true,
      romeValid: true,
      domainCode: 'G12',
      romeCode: '',
      inferredDomainCode: '',
      requestedDomainCode: 'G12',
      needsCanonicalization: false,
    }
  );

  const legacy = occupation.getOccupationNavigationState(
    '?rome=G1204'
  );

  assert.equal(legacy.valid, true);
  assert.equal(legacy.domainCode, 'G12');
  assert.equal(legacy.romeCode, 'G1204');
  assert.equal(legacy.domainPresent, false);

  const mismatch = occupation.getOccupationNavigationState(
    '?domain=D11&rome=G1204'
  );

  assert.equal(mismatch.domainCode, 'G12');
  assert.equal(mismatch.needsCanonicalization, true);

  assert.equal(
    occupation.buildOccupationDomainMapUrl('g12'),
    '/metiers?domain=G12'
  );
});
