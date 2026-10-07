const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activateOccupationVigilanceDraft,
  bearerToken,
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
