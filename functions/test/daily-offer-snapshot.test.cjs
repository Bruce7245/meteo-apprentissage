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


test('buildOccupationOfferSummary keeps public totals and exact ROME aggregates', () => {
  assert.equal(typeof snapshot.buildOccupationOfferSummary, 'function');

  const summary = snapshot.buildOccupationOfferSummary([
    {
      openingCount: 2,
      romeCodes: ['D1102'],
      sectorCode: 'commerce_vente',
      sectorLabel: 'Commerce / vente',
      nafCode: '1071C',
      nafLabel: 'Boulangerie',
      partnerLabel: 'source-a',
      city: 'Le Mans',
    },
    {
      openingCount: 1,
      romeCodes: ['D1102', 'D1106'],
      sectorCode: 'commerce_vente',
      sectorLabel: 'Commerce / vente',
      nafCode: '1071C',
      nafLabel: 'Boulangerie',
      partnerLabel: 'source-b',
      city: 'Le Mans',
    },
  ]);

  assert.equal(summary.totalOffers, 2);
  assert.equal(summary.totalOpenings, 3);
  assert.deepEqual(
    summary.byRome.find((item) => item.code === 'D1102'),
    { code: 'D1102', label: 'D1102', offers: 2, openings: 3 }
  );
  assert.deepEqual(
    summary.byRome.find((item) => item.code === 'D1106'),
    { code: 'D1106', label: 'D1106', offers: 1, openings: 1 }
  );
});


test('dedupeOccupationOffers keeps one deterministic offer per offerDocId', () => {
  assert.equal(typeof snapshot.dedupeOccupationOffers, 'function');

  const deduped = snapshot.dedupeOccupationOffers([
    {
      offerDocId: 'same',
      openingCount: 1,
      romeCodes: ['D1102'],
      title: 'Boulanger',
    },
    {
      offerDocId: 'same',
      openingCount: 2,
      romeCodes: ['D1102', 'D1106'],
      title: 'Boulanger',
    },
    {
      offerDocId: 'other',
      openingCount: 1,
      romeCodes: ['D1102'],
      title: 'Autre offre',
    },
  ]);

  assert.equal(deduped.length, 2);
  assert.deepEqual(
    deduped.find((offer) => offer.offerDocId === 'same'),
    {
      offerDocId: 'same',
      openingCount: 2,
      romeCodes: ['D1102', 'D1106'],
      title: 'Boulanger',
    }
  );
});


test('buildOccupationOfferSnapshot extracts postal code and city from LBA address text', () => {
  const result = snapshot.buildOccupationOfferSnapshot(
    {
      offerId: 'partner:address',
      openingCount: 1,
      romeCodes: ['D1102'],
      workplaceAddress: '38 RUE DES MINIMES 72000 LE MANS',
    },
    {
      runId: 'run-address',
      targetDate: '2026-10-06',
      departmentCode: '72',
    }
  );

  assert.equal(result.postalCode, '72000');
  assert.equal(result.city, 'LE MANS');
  assert.equal(result.effectiveDepartmentCode, '72');
  assert.equal(result.locationQuality, 'in_department');
  assert.equal(result.isInRequestedDepartment, true);
});


test('buildHistoricalDepartmentSnapshot excludes recruiter records and deduplicates offers', () => {
  assert.equal(typeof snapshot.buildHistoricalDepartmentSnapshot, 'function');

  const result = snapshot.buildHistoricalDepartmentSnapshot(
    [
      {
        offerId: 'partner:1',
        partnerLabel: 'source-a',
        openingCount: 1,
        romeCodes: ['D1102'],
        workplaceZipcode: '72000',
      },
      {
        offerId: 'partner:1',
        partnerLabel: 'source-a',
        openingCount: 2,
        romeCodes: ['D1102', 'D1106'],
        workplaceZipcode: '72000',
      },
      {
        offerId: 'recruiter:1',
        partnerLabel: 'recruteurs_lba',
        openingCount: 1,
        romeCodes: ['D1102'],
        workplaceZipcode: '72000',
      },
    ],
    {
      runId: 'historical_2026-10-04_test',
      targetDate: '2026-10-04',
      departmentCode: '72',
    }
  );

  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].openingCount, 2);
  assert.deepEqual(result.offers[0].romeCodes, ['D1102', 'D1106']);
  assert.equal(result.summary.totalOffers, 1);
  assert.equal(result.summary.totalOpenings, 2);
  assert.equal(result.strictSummary.totalOffers, 1);
});
