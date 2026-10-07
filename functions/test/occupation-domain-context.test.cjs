const test = require('node:test');
const assert = require('node:assert/strict');

let domainContext = {};
try {
  domainContext = require('../lib/occupation-domain-context.cjs');
} catch {
  domainContext = {};
}

function domains() {
  return [
    {
      domainCode: 'D11',
      domainLabel: 'Commerce alimentaire et métiers de bouche',
      romeCodes: ['D1108', 'D1109'],
    },
    {
      domainCode: 'G12',
      domainLabel: "Animation d'activités de loisirs",
      romeCodes: ['G1204', 'G1205'],
    },
  ];
}

test('buildOccupationDomainContexts deduplicates one offer within the same domain', () => {
  assert.equal(
    typeof domainContext.buildOccupationDomainContexts,
    'function'
  );

  const result = domainContext.buildOccupationDomainContexts({
    departmentCode: '72',
    date: '2026-10-06',
    domains: domains(),
    offers: [
      {
        offerDocId: 'o1',
        romeCodes: ['G1204', 'G1205'],
        openingCount: 2,
        siret: '11111111111111',
        nafCode: '93.19Z',
        locationQuality: 'in_department',
        effectiveDepartmentCode: '72',
      },
    ],
    population: {
      populationTotal: 570000,
      population15To29: 95000,
      referenceYear: 2026,
    },
  });

  const g12 = result.contexts.find(
    (item) => item.domainCode === 'G12'
  );

  assert.ok(g12);
  assert.equal(g12.activeOffersCount, 1);
  assert.equal(g12.openingsCount, 2);
  assert.equal(g12.distinctObservedEmployersCount, 1);
  assert.equal(g12.distinctObservedNafCount, 1);
  assert.equal(g12.population15To29, 95000);
});

test('buildOccupationDomainContexts counts a cross-domain offer once in each matching domain', () => {
  const result = domainContext.buildOccupationDomainContexts({
    departmentCode: '72',
    date: '2026-10-06',
    domains: domains(),
    offers: [
      {
        offerDocId: 'o1',
        romeCodes: ['G1204', 'D1108'],
        openingCount: 3,
        siret: '11111111111111',
        nafCode: '93.19Z',
        locationQuality: 'in_department',
        effectiveDepartmentCode: '72',
      },
    ],
    population: null,
  });

  assert.equal(
    result.contexts.find((item) => item.domainCode === 'G12')
      .activeOffersCount,
    1
  );
  assert.equal(
    result.contexts.find((item) => item.domainCode === 'D11')
      .activeOffersCount,
    1
  );
  assert.equal(
    result.contexts.find((item) => item.domainCode === 'G12')
      .openingsCount,
    3
  );
  assert.equal(
    result.contexts.find((item) => item.domainCode === 'D11')
      .openingsCount,
    3
  );
});

test('buildOccupationDomainContexts excludes non-strict offers and reports unknown ROME codes', () => {
  const result = domainContext.buildOccupationDomainContexts({
    departmentCode: '44',
    date: '2026-10-06',
    domains: domains(),
    offers: [
      {
        offerDocId: 'strict',
        romeCodes: ['D1108'],
        openingCount: 1,
        locationQuality: 'in_department',
        effectiveDepartmentCode: '44',
      },
      {
        offerDocId: 'out',
        romeCodes: ['D1108'],
        openingCount: 4,
        locationQuality: 'out_of_department',
        effectiveDepartmentCode: '49',
      },
      {
        offerDocId: 'unknown',
        romeCodes: ['Z9999'],
        openingCount: 5,
        locationQuality: 'in_department',
        effectiveDepartmentCode: '44',
      },
    ],
    population: null,
  });

  const d11 = result.contexts.find(
    (item) => item.domainCode === 'D11'
  );

  assert.equal(d11.activeOffersCount, 1);
  assert.equal(d11.openingsCount, 1);
  assert.deepEqual(result.diagnostics.unknownRomeCodes, ['Z9999']);
});

test('buildOccupationDomainContexts validates department and domain references', () => {
  assert.throws(
    () =>
      domainContext.buildOccupationDomainContexts({
        departmentCode: 'bad',
        date: '2026-10-06',
        domains: domains(),
        offers: [],
      }),
    /Invalid department code/
  );

  assert.throws(
    () =>
      domainContext.buildOccupationDomainContexts({
        departmentCode: '72',
        date: '2026-10-06',
        domains: [
          {
            domainCode: 'G12',
            domainLabel: '',
            romeCodes: ['G1204'],
          },
        ],
        offers: [],
      }),
    /Invalid domain reference/
  );
});
