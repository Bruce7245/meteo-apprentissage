const test = require('node:test');
const assert = require('node:assert/strict');

let context = {};
try {
  context = require('../lib/occupation-context.cjs');
} catch {
  context = {};
}

const inputBase = {
  departmentCode: '72',
  romeCode: 'D1401',
  asOfDate: '2026-10-05',
  population: {
    populationTotal: 570000,
    population15To29: 92000,
    referenceYear: '2023',
  },
};

test('aggregateOccupationContext deduplicates offers and computes observed employer diversity', () => {
  assert.equal(typeof context.aggregateOccupationContext, 'function');

  const result = context.aggregateOccupationContext({
    ...inputBase,
    offers: [
      { offerId: 'a', romeCodes: ['D1401'], openingCount: 2, siret: '111', nafCode: '47.11A' },
      { offerId: 'a', romeCodes: ['D1401'], openingCount: 2, siret: '111', nafCode: '47.11A' },
      { offerId: 'b', romeCodes: ['D1401', 'M1607'], openingCount: 1, siret: '222', nafCode: '69.10Z' },
      { offerId: 'c', romeCodes: ['M1607'], openingCount: 9, siret: '333', nafCode: '62.01Z' },
    ],
    formations: [],
  });

  assert.equal(result.activeOffersCount, 2);
  assert.equal(result.openingsCount, 3);
  assert.equal(result.distinctObservedEmployersCount, 2);
  assert.equal(result.distinctObservedNafCount, 2);
  assert.equal(result.knownEmployerOfferCoverage, 1);
  assert.equal(result.employerConcentration, 0.5);
});

test('aggregateOccupationContext computes concentration from known employers without inventing unknown employers', () => {
  const result = context.aggregateOccupationContext({
    ...inputBase,
    offers: [
      { offerId: 'a', romeCodes: ['D1401'], siret: '111', openingCount: 1 },
      { offerId: 'b', romeCodes: ['D1401'], siret: '111', openingCount: 1 },
      { offerId: 'c', romeCodes: ['D1401'], siret: '222', openingCount: 1 },
      { offerId: 'd', romeCodes: ['D1401'], openingCount: 1 },
    ],
    formations: [],
  });

  assert.equal(result.distinctObservedEmployersCount, 2);
  assert.equal(result.knownEmployerOfferCoverage, 0.75);
  assert.equal(result.employerConcentration, 5 / 9);
});

test('aggregateOccupationContext counts only formations explicitly mapped to the selected ROME', () => {
  const result = context.aggregateOccupationContext({
    ...inputBase,
    offers: [],
    formations: [
      {
        formationId: 'f1',
        rncp: 'RNCP1234',
        romeCodes: ['D1401'],
        sessions: [
          { debut: '2026-11-01' },
          { debut: '2026-09-01' },
        ],
      },
      {
        formationId: 'f1',
        rncp: 'RNCP1234',
        romeCodes: ['D1401'],
        sessions: [{ debut: '2026-11-01' }],
      },
      {
        formationId: 'f2',
        rncp: 'RNCP5678',
        romeCodes: ['M1607'],
        sessions: [{ debut: '2026-12-01' }],
      },
    ],
  });

  assert.equal(result.formationsCount, 1);
  assert.equal(result.sessionsCount, 2);
  assert.equal(result.upcomingSessionsCount, 1);
  assert.equal(result.distinctRncpCount, 1);
});

test('aggregateOccupationContext attaches population reference without coercing missing population to zero', () => {
  const complete = context.aggregateOccupationContext({
    ...inputBase,
    offers: [],
    formations: [],
  });
  assert.equal(complete.populationTotal, 570000);
  assert.equal(complete.population15To29, 92000);
  assert.equal(complete.populationReferenceYear, '2023');

  const missing = context.aggregateOccupationContext({
    departmentCode: '72',
    romeCode: 'D1401',
    offers: [],
    formations: [],
    population: null,
  });
  assert.equal(missing.populationTotal, null);
  assert.equal(missing.population15To29, null);
  assert.equal(missing.populationReferenceYear, null);
});

test('aggregateOccupationContext rejects invalid department and ROME keys', () => {
  assert.throws(
    () => context.aggregateOccupationContext({ departmentCode: '', romeCode: 'D1401' }),
    /department/i
  );
  assert.throws(
    () => context.aggregateOccupationContext({ departmentCode: '72', romeCode: 'bad' }),
    /rome/i
  );
});

test('aggregateOccupationContext can use a trusted aggregate offer summary without fabricating employer diversity', () => {
  const result = context.aggregateOccupationContext({
    ...inputBase,
    offerSummary: { activeOffersCount: 12, openingsCount: 15 },
    offers: [],
    formations: [],
  });
  assert.equal(result.activeOffersCount, 12);
  assert.equal(result.openingsCount, 15);
  assert.equal(result.distinctObservedEmployersCount, null);
  assert.equal(result.distinctObservedNafCount, null);
  assert.equal(result.knownEmployerOfferCoverage, null);
  assert.equal(result.employerConcentration, null);
});

test('extractOfferDetailsFromSnapshot only returns explicit offer arrays', () => {
  assert.equal(typeof context.extractOfferDetailsFromSnapshot, 'function');
  const offers = [{ offerId: 'a' }];
  assert.deepEqual(context.extractOfferDetailsFromSnapshot({ offers }), offers);
  assert.deepEqual(context.extractOfferDetailsFromSnapshot({ activeOffers: offers }), offers);
  assert.deepEqual(context.extractOfferDetailsFromSnapshot({ items: offers }), offers);
  assert.deepEqual(context.extractOfferDetailsFromSnapshot({ strictSummary: { totalOffers: 12 } }), []);
});

test('aggregateOccupationContext distinguishes a real zero offer count from missing primary offer data', () => {
  const missing = context.aggregateOccupationContext({
    ...inputBase,
    offers: [],
    formations: [],
  });
  assert.equal(missing.primaryOfferDataStatus, 'missing');

  const realZero = context.aggregateOccupationContext({
    ...inputBase,
    offerSummary: { activeOffersCount: 0, openingsCount: 0 },
    offers: [],
    formations: [],
  });
  assert.equal(realZero.primaryOfferDataStatus, 'available');
  assert.equal(realZero.activeOffersCount, 0);
});

test('aggregateOccupationContext does not fabricate zero openings when aggregate openings are unavailable', () => {
  const result = context.aggregateOccupationContext({
    ...inputBase,
    offerSummary: { activeOffersCount: 12 },
    offers: [],
    formations: [],
  });
  assert.equal(result.activeOffersCount, 12);
  assert.equal(result.openingsCount, null);
});


test('aggregateOccupationContext excludes offers explicitly located outside the requested department', () => {
  const result = context.aggregateOccupationContext({
    ...inputBase,
    offers: [
      { offerId: 'inside', romeCodes: ['D1401'], openingCount: 1, siret: '111', nafCode: '47.11A', locationQuality: 'in_department' },
      { offerId: 'outside', romeCodes: ['D1401'], openingCount: 5, siret: '222', nafCode: '69.10Z', locationQuality: 'out_of_department' },
    ],
    formations: [],
  });

  assert.equal(result.activeOffersCount, 1);
  assert.equal(result.openingsCount, 1);
  assert.equal(result.distinctObservedEmployersCount, 1);
  assert.equal(result.distinctObservedNafCount, 1);
});

test('summarizeStrictOffersByRome builds exact in-department offer and opening totals', () => {
  assert.equal(typeof context.summarizeStrictOffersByRome, 'function');
  const result = context.summarizeStrictOffersByRome([
    { offerId: 'a', romeCodes: ['D1401'], openingCount: 2, locationQuality: 'in_department' },
    { offerId: 'b', romeCodes: ['D1401', 'M1607'], openingCount: 1, locationQuality: 'in_department' },
    { offerId: 'c', romeCodes: ['D1401'], openingCount: 9, locationQuality: 'out_of_department' },
  ]);
  assert.deepEqual(result.get('D1401'), { activeOffersCount: 2, openingsCount: 3 });
  assert.deepEqual(result.get('M1607'), { activeOffersCount: 1, openingsCount: 1 });
});
