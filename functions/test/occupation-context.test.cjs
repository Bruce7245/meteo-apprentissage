const test = require('node:test');
const assert = require('node:assert/strict');

let context = {};
try {
  context = require('../lib/occupation-context.cjs');
} catch {
  context = {};
}

test('aggregateOccupationContext counts unique offers, openings, employers and NAFs for one ROME', () => {
  assert.equal(typeof context.aggregateOccupationContext, 'function');

  const result = context.aggregateOccupationContext({
    departmentCode: '72',
    romeCode: 'D1108',
    asOfDate: '2026-10-04',
    offers: [
      {
        offerDocId: 'o1',
        romeCodes: ['D1108'],
        openingCount: 2,
        siret: '11111111111111',
        nafCode: '47.11D',
        locationQuality: 'in_department',
      },
      {
        offerDocId: 'o2',
        romeCodes: ['D1108', 'D1214'],
        openingCount: 1,
        siret: '11111111111111',
        nafCode: '47.11D',
        locationQuality: 'in_department',
      },
      {
        offerDocId: 'o3',
        romeCodes: ['D1108'],
        openingCount: 3,
        siret: '22222222222222',
        nafCode: '10.71C',
        locationQuality: 'in_department',
      },
      {
        offerDocId: 'o4',
        romeCodes: ['M1607'],
        openingCount: 5,
        siret: '33333333333333',
        nafCode: '82.11Z',
        locationQuality: 'in_department',
      },
      {
        offerDocId: 'o5',
        romeCodes: ['D1108'],
        openingCount: 4,
        siret: '44444444444444',
        nafCode: '47.11D',
        locationQuality: 'out_of_department',
      },
    ],
    formations: [],
    population: {
      populationTotal: 570000,
      population15To29: 95000,
      referenceYear: 2026,
    },
  });

  assert.equal(result.activeOffersCount, 3);
  assert.equal(result.openingsCount, 6);
  assert.equal(result.distinctObservedEmployersCount, 2);
  assert.equal(result.distinctObservedNafCount, 2);
  assert.equal(result.employerConcentration, 2 / 3);
  assert.equal(result.employerCoverageRatio, 1);
  assert.equal(result.populationTotal, 570000);
  assert.equal(result.population15To29, 95000);
  assert.equal(result.populationReferenceYear, 2026);
});

test('aggregateOccupationContext deduplicates duplicate offers and formations deterministically', () => {
  const sharedOffer = {
    offerDocId: 'same-offer',
    romeCodes: ['M1607'],
    openingCount: 2,
    siret: '11111111111111',
    nafCode: '82.11Z',
    locationQuality: 'in_department',
  };

  const formation = {
    formationId: 'formation-1',
    rncp: 'RNCP12345',
    romeCodes: ['M1607'],
    sessions: [
      { debut: '2026-11-01' },
      { debut: '2026-09-01' },
    ],
  };

  const result = context.aggregateOccupationContext({
    departmentCode: '72',
    romeCode: 'M1607',
    asOfDate: '2026-10-04',
    offers: [sharedOffer, { ...sharedOffer }],
    formations: [formation, { ...formation }],
    population: {
      populationTotal: 570000,
      population15To29: 95000,
      referenceYear: 2026,
    },
  });

  assert.equal(result.activeOffersCount, 1);
  assert.equal(result.openingsCount, 2);
  assert.equal(result.formationsCount, 1);
  assert.equal(result.sessionsCount, 2);
  assert.equal(result.upcomingSessionsCount, 1);
  assert.equal(result.distinctRncpCount, 1);
});

test('aggregateOccupationContext counts only formations explicitly mapped to the target ROME', () => {
  const result = context.aggregateOccupationContext({
    departmentCode: '44',
    romeCode: 'M1607',
    asOfDate: '2026-10-04',
    offers: [],
    formations: [
      {
        formationId: 'f1',
        rncp: 'RNCP1',
        romeCodes: ['M1607', 'D1401'],
        sessions: [{ debut: '2027-01-10' }],
      },
      {
        formationId: 'f2',
        rncp: 'RNCP2',
        romeCodes: ['D1108'],
        sessions: [{ debut: '2027-01-10' }],
      },
    ],
    population: null,
  });

  assert.equal(result.formationsCount, 1);
  assert.equal(result.sessionsCount, 1);
  assert.equal(result.upcomingSessionsCount, 1);
  assert.equal(result.distinctRncpCount, 1);
  assert.equal(result.populationTotal, null);
  assert.equal(result.population15To29, null);
  assert.equal(result.populationReferenceYear, null);
});

test('aggregateOccupationContext reports missing employer data without treating it as zero concentration', () => {
  const result = context.aggregateOccupationContext({
    departmentCode: '33',
    romeCode: 'M1805',
    asOfDate: '2026-10-04',
    offers: [
      {
        offerDocId: 'o1',
        romeCodes: ['M1805'],
        openingCount: 1,
        siret: null,
        companyName: null,
        nafCode: null,
        locationQuality: 'in_department',
      },
    ],
    formations: [],
    population: null,
  });

  assert.equal(result.activeOffersCount, 1);
  assert.equal(result.distinctObservedEmployersCount, 0);
  assert.equal(result.distinctObservedNafCount, 0);
  assert.equal(result.employerConcentration, null);
  assert.equal(result.employerCoverageRatio, 0);
});

test('aggregateOccupationContext validates department and ROME identifiers', () => {
  assert.throws(
    () => context.aggregateOccupationContext({
      departmentCode: 'bad',
      romeCode: 'M1805',
      offers: [],
      formations: [],
    }),
    /Invalid department code/
  );

  assert.throws(
    () => context.aggregateOccupationContext({
      departmentCode: '72',
      romeCode: 'bad',
      offers: [],
      formations: [],
    }),
    /Invalid ROME code/
  );
});
