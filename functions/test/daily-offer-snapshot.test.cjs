const test = require('node:test');
const assert = require('node:assert/strict');

let snapshot = {};
try {
  snapshot = require('../lib/daily-offer-snapshot.cjs');
} catch {
  snapshot = {};
}

test('buildOccupationOfferSnapshot projects a scheduled offer for ROME vigilance', () => {
  assert.equal(typeof snapshot.buildOccupationOfferSnapshot, 'function');

  const result = snapshot.buildOccupationOfferSnapshot(
    {
      offerId: 'partner:job/123',
      partnerLabel: 'partner',
      partnerJobId: 'job/123',
      title: 'Boulanger / Boulangère',
      status: 'Active',
      openingCount: 2,
      romeCodes: ['D1102'],
      creationDate: '2026-10-05',
      expirationDate: '2026-11-05',
      workplaceName: 'Boulangerie Test',
      workplaceLegalName: 'BOULANGERIE TEST SAS',
      workplaceSiret: '12345678901234',
      workplaceCity: 'Le Mans',
      workplaceZipcode: '72000',
      nafCode: '1071C',
      nafLabel: 'Boulangerie et boulangerie-pâtisserie',
      opco: 'EP',
      idcc: '0843',
    },
    {
      runId: 'daily_offer_2026-10-05_test',
      targetDate: '2026-10-05',
      departmentCode: '72',
    }
  );

  assert.equal(result.runId, 'daily_offer_2026-10-05_test');
  assert.equal(result.date, '2026-10-05');
  assert.equal(result.departmentCode, '72');
  assert.equal(result.offerDocId.includes('/'), false);
  assert.deepEqual(result.romeCodes, ['D1102']);
  assert.equal(result.openingCount, 2);
  assert.equal(result.companyName, 'Boulangerie Test');
  assert.equal(result.companyLegalName, 'BOULANGERIE TEST SAS');
  assert.equal(result.siret, '12345678901234');
  assert.equal(result.city, 'Le Mans');
  assert.equal(result.postalCode, '72000');
  assert.equal(result.effectiveDepartmentCode, '72');
  assert.equal(result.locationQuality, 'in_department');
  assert.equal(result.isInRequestedDepartment, true);
  assert.equal(result.nafCode, '1071C');
});

test('buildOccupationOfferSnapshot preserves out-of-department location quality', () => {
  const result = snapshot.buildOccupationOfferSnapshot(
    {
      offerId: 'partner:other',
      openingCount: 1,
      romeCodes: ['D1102'],
      workplaceZipcode: '75001',
    },
    {
      runId: 'run-1',
      targetDate: '2026-10-05',
      departmentCode: '72',
    }
  );

  assert.equal(result.effectiveDepartmentCode, '75');
  assert.equal(result.locationQuality, 'out_of_department');
  assert.equal(result.isInRequestedDepartment, false);
});
