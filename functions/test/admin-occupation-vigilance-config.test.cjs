const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activateOccupationVigilanceDraft,
  bearerToken,
  compareOccupationConfigRows,
  manualCandidateFromDraft,
  occupationConfigSummary,
  simulateOccupationRows,
  stableManualVersion,
} = require('../admin-occupation-vigilance-config.cjs');

function validCandidate() {
  return {
    version: 'base-config',
    status: 'draft',
    calculationVersion: 'occupationVigilance.v1.2',
    referencePopulation15To29: 100000,
    expectedOffersFloor: 0.5,
    minimumGreenActiveOffers: 3,
    baselines: {
      D1108: {
        expectedOffersAtReferencePopulation: 20,
      },
    },
    factorBounds: {
      population: { min: 0.5, max: 2 },
      trainingPressure: { min: 1, max: 1.2 },
      diversityFragility: { min: 1, max: 1.15 },
      seasonality: { min: 0.8, max: 1.25 },
    },
    coefficients: {
      trainingPressurePerFormation: 0.02,
      lowDiversityConcentrationThreshold: 0.7,
      lowDiversityFactor: 1.1,
    },
    thresholds: {
      greenMinRatio: 0.9,
      yellowMinRatio: 0.65,
      orangeMinRatio: 0.4,
    },
    historicalTrend: {
      minimumYears: 3,
      weight: 0.5,
      stableBand: 0.05,
      minFactor: 0.9,
      maxFactor: 1.1,
    },
    confidence: {
      highMin: 80,
      mediumMin: 60,
      penalties: {
        missingPopulation: 20,
        missingSeasonality: 10,
        missingDiversity: 10,
        missingTraining: 5,
      },
    },
  };
}

function fakeDb({ activeVersion = 'base-config', draft } = {}) {
  const documents = new Map();
  const writes = [];

  documents.set('occupationVigilanceConfigs/base-config', {
    version: activeVersion,
    status: 'validated',
    validatedAt: new Date('2026-10-07T08:00:00Z'),
    ...validCandidate(),
    version: activeVersion,
    status: 'validated',
  });

  if (draft) {
    documents.set('occupationVigilanceConfigDrafts/draft-1', draft);
  }

  let autoId = 0;

  function makeDoc(path) {
    return {
      path,
      async get() {
        const value = documents.get(path);
        return {
          exists: value !== undefined,
          data: () => value,
          id: path.split('/').at(-1),
        };
      },
    };
  }

  function collection(name) {
    return {
      doc(id) {
        const nextId = id || 'auto-' + String(++autoId);
        return makeDoc(name + '/' + nextId);
      },
      where(field, operator, value) {
        return {
          async get() {
            const docs = [];

            for (const [path, data] of documents.entries()) {
              if (!path.startsWith(name + '/')) continue;
              if (path.slice(name.length + 1).includes('/')) continue;
              if (operator !== '==' || data?.[field] !== value) continue;

              docs.push({
                id: path.split('/').at(-1),
                data: () => data,
              });
            }

            return { docs };
          },
        };
      },
    };
  }

  return {
    writes,
    collection,
    batch() {
      const pending = [];

      return {
        set(ref, data, options) {
          pending.push({ ref, data, options });
        },
        async commit() {
          for (const item of pending) {
            const current = documents.get(item.ref.path) || {};
            const next = item.options?.merge
              ? { ...current, ...item.data }
              : item.data;

            documents.set(item.ref.path, next);
            writes.push({
              path: item.ref.path,
              data: next,
            });
          }
        },
      };
    },
  };
}

test('bearerToken accepts only a Bearer authorization header', () => {
  assert.equal(
    bearerToken({
      get: (name) =>
        name === 'authorization'
          ? 'Bearer abc.def'
          : '',
    }),
    'abc.def'
  );

  assert.equal(
    bearerToken({
      get: () => 'Basic abc',
    }),
    ''
  );
});

test('stableManualVersion is deterministic for the same candidate config', () => {
  const candidate = validCandidate();

  assert.equal(
    stableManualVersion(candidate),
    stableManualVersion({ ...candidate })
  );
  assert.match(
    stableManualVersion(candidate),
    /^occupationVigilance\.manual\.[a-f0-9]{12}$/
  );
});

test('activateOccupationVigilanceDraft validates and writes a new immutable config version', async () => {
  const db = fakeDb({
    draft: {
      status: 'draft',
      baseConfigVersion: 'base-config',
      candidateConfig: validCandidate(),
    },
  });

  const result = await activateOccupationVigilanceDraft({
    draftId: 'draft-1',
    uid: 'admin-1',
    email: 'admin@example.test',
    db,
    FieldValue: {
      serverTimestamp: () => 'timestamp',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.match(
    result.version,
    /^occupationVigilance\.manual\.[a-f0-9]{12}$/
  );

  assert.equal(
    db.writes.some(
      (write) =>
        write.path ===
        'occupationVigilanceConfigs/' + result.version
    ),
    true
  );

  const draftWrite = db.writes.find(
    (write) =>
      write.path ===
      'occupationVigilanceConfigDrafts/draft-1'
  );

  assert.equal(draftWrite.data.status, 'activated');
  assert.equal(draftWrite.data.activatedVersion, result.version);
});

test('activateOccupationVigilanceDraft refuses a stale draft', async () => {
  const db = fakeDb({
    activeVersion: 'newer-config',
    draft: {
      status: 'draft',
      baseConfigVersion: 'older-config',
      candidateConfig: validCandidate(),
    },
  });

  const result = await activateOccupationVigilanceDraft({
    draftId: 'draft-1',
    uid: 'admin-1',
    db,
    FieldValue: {
      serverTimestamp: () => 'timestamp',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.errorCode, 'STALE_DRAFT');
  assert.equal(db.writes.length, 0);
});


test('manualCandidateFromDraft keeps calibrated baselines and population immutable', () => {
  const active = validCandidate();
  active.status = 'validated';

  const candidate = manualCandidateFromDraft(active, {
    referencePopulation15To29: 999999,
    expectedOffersFloor: 999,
    baselines: {
      D1108: {
        expectedOffersAtReferencePopulation: 999,
      },
    },
    thresholds: {
      greenMinRatio: 0.95,
      yellowMinRatio: 0.7,
      orangeMinRatio: 0.45,
    },
    historicalTrend: {
      minimumYears: 3,
      weight: 0.6,
      stableBand: 0.05,
      minFactor: 0.9,
      maxFactor: 1.1,
    },
  });

  assert.equal(candidate.referencePopulation15To29, 100000);
  assert.equal(candidate.expectedOffersFloor, 0.5);
  assert.equal(
    candidate.baselines.D1108.expectedOffersAtReferencePopulation,
    20
  );
  assert.equal(candidate.thresholds.greenMinRatio, 0.95);
  assert.equal(candidate.historicalTrend.weight, 0.6);
});


test('simulateOccupationRows compares the published snapshot with proposed thresholds without writing data', () => {
  const active = validCandidate();
  active.status = 'validated';

  const result = simulateOccupationRows({
    activeConfig: active,
    candidateConfig: {
      thresholds: {
        greenMinRatio: 0.95,
        yellowMinRatio: 0.7,
        orangeMinRatio: 0.45,
      },
      minimumGreenActiveOffers: 3,
      historicalTrend: active.historicalTrend,
      coefficients: active.coefficients,
    },
    romeCode: 'D1108',
    snapshots: [
      {
        departmentCode: '72',
        departmentName: 'Sarthe',
        romeCode: 'D1108',
        romeLabel: 'Vente en alimentation',
        activeOffersCount: 18,
        population15To29: 100000,
        formationsCount: 0,
        employerConcentration: 0.2,
        recentTrend: { status: 'stable', changeRatio: 0 },
        seasonality: { status: 'active', factor: 1 },
        interannualTrend: {
          status: 'active',
          direction: 'stable',
          annualTrendRatio: 0,
        },
        publishedLevel: 'green',
        expectedOffers: 20,
        observedVsExpectedRatio: 0.9,
        effectiveThresholds: {
          greenMinOffers: 18,
          yellowMinOffers: 13,
          orangeMinOffers: 8,
        },
      },
      {
        departmentCode: '44',
        departmentName: 'Loire-Atlantique',
        romeCode: 'D1108',
        romeLabel: 'Vente en alimentation',
        activeOffersCount: 25,
        population15To29: 100000,
        formationsCount: 0,
        employerConcentration: 0.2,
        recentTrend: { status: 'stable', changeRatio: 0 },
        seasonality: { status: 'active', factor: 1 },
        interannualTrend: {
          status: 'active',
          direction: 'stable',
          annualTrendRatio: 0,
        },
        publishedLevel: 'green',
        expectedOffers: 20,
        observedVsExpectedRatio: 1.25,
        effectiveThresholds: {
          greenMinOffers: 18,
          yellowMinOffers: 13,
          orangeMinOffers: 8,
        },
      },
    ],
  });

  assert.equal(result.summary.departmentsCount, 2);
  assert.equal(result.summary.changedCount, 1);
  assert.equal(result.summary.worsenedCount, 1);
  assert.equal(result.summary.improvedCount, 0);
  assert.equal(result.summary.currentLevels.green, 2);
  assert.equal(result.summary.proposedLevels.green, 1);
  assert.equal(result.summary.proposedLevels.yellow, 1);

  const sarthe = result.rows.find(
    (row) => row.departmentCode === '72'
  );

  assert.equal(sarthe.currentLevel, 'green');
  assert.equal(sarthe.proposedLevel, 'yellow');
  assert.equal(sarthe.direction, 'worsened');
  assert.equal(sarthe.proposedExpectedOffers, 20);
  assert.equal(
    sarthe.proposedEffectiveThresholds.greenMinOffers,
    19
  );
});

test('simulateOccupationRows ignores snapshots from other ROME codes', () => {
  const active = validCandidate();
  active.status = 'validated';

  const result = simulateOccupationRows({
    activeConfig: active,
    candidateConfig: {
      thresholds: active.thresholds,
      minimumGreenActiveOffers: active.minimumGreenActiveOffers,
      historicalTrend: active.historicalTrend,
      coefficients: active.coefficients,
    },
    romeCode: 'D1108',
    snapshots: [
      {
        departmentCode: '72',
        romeCode: 'D1108',
        activeOffersCount: 20,
        population15To29: 100000,
        formationsCount: 0,
        employerConcentration: 0.2,
        seasonality: { status: 'active', factor: 1 },
        interannualTrend: {
          status: 'active',
          direction: 'stable',
          annualTrendRatio: 0,
        },
        publishedLevel: 'green',
      },
      {
        departmentCode: '44',
        romeCode: 'M1607',
        activeOffersCount: 1,
        population15To29: 100000,
        formationsCount: 0,
        employerConcentration: 0.2,
        seasonality: { status: 'active', factor: 1 },
        interannualTrend: {
          status: 'active',
          direction: 'stable',
          annualTrendRatio: 0,
        },
        publishedLevel: 'red',
      },
    ],
  });

  assert.equal(result.summary.departmentsCount, 1);
  assert.equal(result.rows[0].departmentCode, '72');
});


test('occupationConfigSummary exposes comparable metadata without full baselines', () => {
  const config = validCandidate();
  config.status = 'validated';
  config.validatedAt = new Date('2026-10-07T10:00:00Z');
  config.validatedBy = {
    uid: 'admin-1',
    email: 'admin@example.test',
  };

  const summary = occupationConfigSummary(config);

  assert.equal(summary.version, 'base-config');
  assert.equal(summary.baselineCount, 1);
  assert.match(summary.baselineFingerprint, /^[a-f0-9]{12}$/);
  assert.equal(summary.baselines, undefined);
  assert.equal(summary.validatedBy.email, 'admin@example.test');
  assert.equal(summary.validatedAt, '2026-10-07T10:00:00.000Z');
});

test('compareOccupationConfigRows replays two validated versions on the same snapshots', () => {
  const leftConfig = validCandidate();
  leftConfig.status = 'validated';
  leftConfig.version = 'v-left';

  const rightConfig = validCandidate();
  rightConfig.status = 'validated';
  rightConfig.version = 'v-right';
  rightConfig.thresholds = {
    greenMinRatio: 0.95,
    yellowMinRatio: 0.7,
    orangeMinRatio: 0.45,
  };

  const result = compareOccupationConfigRows({
    leftConfig,
    rightConfig,
    romeCode: 'D1108',
    snapshots: [
      {
        departmentCode: '72',
        departmentName: 'Sarthe',
        romeCode: 'D1108',
        romeLabel: 'Vente en alimentation',
        activeOffersCount: 18,
        population15To29: 100000,
        formationsCount: 0,
        employerConcentration: 0.2,
        recentTrend: { status: 'stable', changeRatio: 0 },
        seasonality: { status: 'active', factor: 1 },
        interannualTrend: {
          status: 'active',
          direction: 'stable',
          annualTrendRatio: 0,
        },
      },
      {
        departmentCode: '44',
        departmentName: 'Loire-Atlantique',
        romeCode: 'D1108',
        romeLabel: 'Vente en alimentation',
        activeOffersCount: 25,
        population15To29: 100000,
        formationsCount: 0,
        employerConcentration: 0.2,
        recentTrend: { status: 'stable', changeRatio: 0 },
        seasonality: { status: 'active', factor: 1 },
        interannualTrend: {
          status: 'active',
          direction: 'stable',
          annualTrendRatio: 0,
        },
      },
    ],
  });

  assert.equal(result.summary.departmentsCount, 2);
  assert.equal(result.summary.changedCount, 1);
  assert.equal(result.summary.stricterCount, 1);
  assert.equal(result.summary.softerCount, 0);
  assert.equal(result.summary.leftLevels.green, 2);
  assert.equal(result.summary.rightLevels.green, 1);
  assert.equal(result.summary.rightLevels.yellow, 1);

  const sarthe = result.rows.find(
    (row) => row.departmentCode === '72'
  );

  assert.equal(sarthe.leftLevel, 'green');
  assert.equal(sarthe.rightLevel, 'yellow');
  assert.equal(sarthe.direction, 'stricter');
  assert.equal(sarthe.leftExpectedOffers, 20);
  assert.equal(sarthe.rightExpectedOffers, 20);
  assert.equal(sarthe.leftEffectiveThresholds.greenMinOffers, 18);
  assert.equal(sarthe.rightEffectiveThresholds.greenMinOffers, 19);
});

test('compareOccupationConfigRows can reveal a calibration change independently of threshold changes', () => {
  const leftConfig = validCandidate();
  leftConfig.status = 'validated';
  leftConfig.version = 'v-left';

  const rightConfig = validCandidate();
  rightConfig.status = 'validated';
  rightConfig.version = 'v-right';
  rightConfig.baselines = {
    D1108: {
      expectedOffersAtReferencePopulation: 30,
    },
  };

  const result = compareOccupationConfigRows({
    leftConfig,
    rightConfig,
    romeCode: 'D1108',
    snapshots: [
      {
        departmentCode: '72',
        departmentName: 'Sarthe',
        romeCode: 'D1108',
        activeOffersCount: 18,
        population15To29: 100000,
        formationsCount: 0,
        employerConcentration: 0.2,
        recentTrend: { status: 'stable', changeRatio: 0 },
        seasonality: { status: 'active', factor: 1 },
        interannualTrend: {
          status: 'active',
          direction: 'stable',
          annualTrendRatio: 0,
        },
      },
    ],
  });

  assert.equal(result.rows[0].leftExpectedOffers, 20);
  assert.equal(result.rows[0].rightExpectedOffers, 30);
  assert.equal(result.rows[0].leftLevel, 'green');
  assert.equal(result.rows[0].rightLevel, 'orange');
  assert.equal(result.rows[0].direction, 'stricter');
});
