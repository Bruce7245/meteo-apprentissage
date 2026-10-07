const test = require('node:test');
const assert = require('node:assert/strict');

let precompute = {};
try {
  precompute = require('../occupation-domain-precompute.cjs');
} catch {
  precompute = {};
}

test('resolveDomainOfferRunId uses the active run for a normal published snapshot', () => {
  assert.equal(typeof precompute.resolveDomainOfferRunId, 'function');

  assert.deepEqual(
    precompute.resolveDomainOfferRunId(
      {
        activeRunId: 'daily_offer_2026-10-06_test',
        qualityStatus: null,
      },
      null
    ),
    {
      runId: 'daily_offer_2026-10-06_test',
      sourceMode: 'active_snapshot',
    }
  );
});

test('resolveDomainOfferRunId allows calibration-only historical snapshots via import metadata', () => {
  assert.deepEqual(
    precompute.resolveDomainOfferRunId(
      {
        activeRunId: null,
        qualityStatus: 'calibration_only_quarantined',
      },
      {
        activeRunId: 'historical_recovered_2026-10-05_test',
      }
    ),
    {
      runId: 'historical_recovered_2026-10-05_test',
      sourceMode: 'historical_calibration_snapshot',
    }
  );
});

test('resolveDomainOfferRunId refuses fully quarantined historical snapshots', () => {
  assert.deepEqual(
    precompute.resolveDomainOfferRunId(
      {
        activeRunId: null,
        qualityStatus: 'quarantined',
      },
      {
        activeRunId: 'historical_2026-10-04_bad',
      }
    ),
    {
      runId: null,
      sourceMode: 'quarantined',
    }
  );
});

test('prepareOccupationDomainContexts writes one context per department and official domain', async () => {
  assert.equal(typeof precompute.prepareOccupationDomainContexts, 'function');

  const writes = [];
  let runMeta = null;

  const repository = {
    async loadDomains() {
      return [
        {
          domainCode: 'D11',
          domainLabel: 'Commerce alimentaire et métiers de bouche',
          romeCodes: ['D1108'],
        },
        {
          domainCode: 'G12',
          domainLabel: "Animation d'activités de loisirs",
          romeCodes: ['G1204'],
        },
      ];
    },
    async loadPopulationByDepartment() {
      return new Map([
        [
          '72',
          {
            populationTotal: 570000,
            population15To29: 95000,
            referenceYear: 2026,
            runId: 'population-run',
          },
        ],
      ]);
    },
    async loadOfferDepartments() {
      return [
        {
          departmentCode: '72',
          activeRunId: 'offer-run',
          sourceMode: 'active_snapshot',
          offers: [
            {
              offerDocId: 'o1',
              romeCodes: ['G1204'],
              openingCount: 2,
              locationQuality: 'in_department',
              effectiveDepartmentCode: '72',
            },
          ],
        },
      ];
    },
    async writeContexts(date, rows) {
      writes.push({ date, rows });
    },
    async markContextRunReady(date, meta) {
      runMeta = { date, ...meta };
    },
  };

  const result = await precompute.prepareOccupationDomainContexts({
    date: '2026-10-06',
    repository,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.departmentsProcessed, 1);
  assert.equal(result.contextsCount, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].rows.length, 2);
  assert.equal(
    writes[0].rows.find((row) => row.domainCode === 'G12')
      .activeOffersCount,
    1
  );
  assert.equal(
    writes[0].rows.find((row) => row.domainCode === 'D11')
      .activeOffersCount,
    0
  );
  assert.equal(runMeta.departmentsProcessed, 1);
  assert.equal(runMeta.domainContexts, 2);
});

test('prepareOccupationDomainContexts accepts an explicitly partial historical day', async () => {
  const repository = {
    async loadDomains() {
      return [
        {
          domainCode: 'G12',
          domainLabel: "Animation d'activités de loisirs",
          romeCodes: ['G1204'],
        },
      ];
    },
    async loadPopulationByDepartment() {
      return new Map();
    },
    async loadOfferDepartments() {
      return [
        {
          departmentCode: '75',
          activeRunId: 'historical-run',
          sourceMode: 'historical_calibration_snapshot',
          offers: [],
        },
        {
          departmentCode: '92',
          activeRunId: 'historical-run',
          sourceMode: 'historical_calibration_snapshot',
          offers: [],
        },
      ];
    },
    async writeContexts() {},
    async markContextRunReady() {},
  };

  const result = await precompute.prepareOccupationDomainContexts({
    date: '2026-10-05',
    repository,
  });

  assert.equal(result.departmentsProcessed, 2);
  assert.equal(result.contextsCount, 2);
});

test('prepareOccupationDomainContexts fails closed when no usable daily offer departments exist', async () => {
  const repository = {
    async loadDomains() {
      return [
        {
          domainCode: 'G12',
          domainLabel: "Animation d'activités de loisirs",
          romeCodes: ['G1204'],
        },
      ];
    },
    async loadPopulationByDepartment() {
      return new Map();
    },
    async loadOfferDepartments() {
      return [];
    },
  };

  await assert.rejects(
    () =>
      precompute.prepareOccupationDomainContexts({
        date: '2026-10-04',
        repository,
      }),
    /No usable daily offer department snapshots/
  );
});
