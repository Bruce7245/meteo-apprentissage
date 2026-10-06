const test = require('node:test');
const assert = require('node:assert/strict');

let daily = {};
try {
  daily = require('../occupation-domain-vigilance-daily.cjs');
} catch {
  daily = {};
}

function config() {
  return {
    version: 'occupationDomainVigilance.v1.cal.test',
    status: 'validated',
    calculationVersion: 'occupationDomainVigilance.v1',
    referencePopulation15To29: 100000,
    expectedOffersFloor: 0.5,
    minimumGreenActiveOffers: 1,
    baselines: {
      G12: {
        expectedOffersAtReferencePopulation: 10,
      },
    },
    factorBounds: {
      population: { min: 0.5, max: 2 },
      diversityFragility: { min: 1, max: 1 },
      seasonality: { min: 1, max: 1 },
    },
    coefficients: {
      lowDiversityConcentrationThreshold: 1,
      lowDiversityFactor: 1,
    },
    thresholds: {
      greenMinRatio: 0.9,
      yellowMinRatio: 0.65,
      orangeMinRatio: 0.4,
    },
    confidence: {
      highMin: 67,
      mediumMin: 34,
      penalties: {
        missingPopulation: 34,
        missingSeasonality: 33,
        missingDiversity: 33,
      },
    },
  };
}

test('buildDailyOccupationDomainVigilanceRun stages every context and marks missing baseline as insufficient', async () => {
  assert.equal(
    typeof daily.buildDailyOccupationDomainVigilanceRun,
    'function'
  );

  const staged = [];
  let createdRun = null;
  let updatedRun = null;

  const repository = {
    async loadDependencies() {
      return {
        contextRun: {
          date: '2026-10-06',
          status: 'ready',
        },
        populationMeta: {
          runId: 'population-run',
          sourceVersion: 'population-v1',
        },
        domainReferenceMeta: {
          runId: 'domain-run',
          sourceVersion: 'domain-v1',
        },
        config: config(),
      };
    },
    async loadContexts() {
      return [
        {
          date: '2026-10-06',
          departmentCode: '72',
          domainCode: 'G12',
          domainLabel: "Animation d'activités de loisirs",
          activeOffersCount: 8,
          openingsCount: 9,
          population15To29: 100000,
          employerConcentration: 0.4,
          sourceVersions: {
            offerRunId: 'offer-run',
          },
        },
        {
          date: '2026-10-06',
          departmentCode: '72',
          domainCode: 'D11',
          domainLabel: 'Commerce alimentaire et métiers de bouche',
          activeOffersCount: 4,
          openingsCount: 4,
          population15To29: 100000,
          employerConcentration: 0.4,
          sourceVersions: {
            offerRunId: 'offer-run',
          },
        },
      ];
    },
    async loadDomainReferences() {
      return new Map([
        [
          'G12',
          {
            domainCode: 'G12',
            domainLabel: "Animation d'activités de loisirs",
          },
        ],
        [
          'D11',
          {
            domainCode: 'D11',
            domainLabel: 'Commerce alimentaire et métiers de bouche',
          },
        ],
      ]);
    },
    async loadDepartmentNames() {
      return new Map([['72', 'Sarthe']]);
    },
    async getRun() {
      return null;
    },
    async createRun(run) {
      createdRun = run;
    },
    async writeStagedResults(runId, chunk) {
      staged.push(...chunk.map((item) => ({ runId, ...item })));
    },
    async updateRun(runId, patch) {
      updatedRun = { runId, ...patch };
    },
    async recordPreflightFailure() {},
  };

  const result =
    await daily.buildDailyOccupationDomainVigilanceRun({
      date: '2026-10-06',
      repository,
    });

  assert.equal(result.status, 'validating');
  assert.equal(createdRun.expectedPairs, 2);
  assert.equal(staged.length, 2);
  assert.equal(updatedRun.computedPairs, 2);
  assert.equal(updatedRun.insufficientDataPairs, 1);

  const g12 = staged.find((item) =>
    item.key.endsWith('_G12')
  );
  const d11 = staged.find((item) =>
    item.key.endsWith('_D11')
  );

  assert.equal(g12.mapEntry.level, 'orange');
  assert.equal(d11.mapEntry.level, 'insufficient_data');
  assert.deepEqual(
    d11.mapEntry.reasonCodes,
    ['DOMAIN_BASELINE_MISSING']
  );
});

test('buildDailyOccupationDomainVigilanceRun fails preflight without a validated config', async () => {
  const failures = [];

  const repository = {
    async loadDependencies() {
      return {
        contextRun: { status: 'ready' },
        populationMeta: { runId: 'population-run' },
        domainReferenceMeta: { runId: 'domain-run' },
        config: { ...config(), status: 'draft' },
      };
    },
    async recordPreflightFailure(value) {
      failures.push(value);
    },
  };

  const result =
    await daily.buildDailyOccupationDomainVigilanceRun({
      date: '2026-10-06',
      repository,
    });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'CONFIG_NOT_VALIDATED');
  assert.equal(failures.length, 1);
});
