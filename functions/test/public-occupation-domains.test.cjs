const test = require('node:test');
const assert = require('node:assert/strict');

let publicDomains = {};
try {
  publicDomains = require('../lib/public-occupation-domains.cjs');
} catch {
  publicDomains = {};
}

function repositoryFixture(overrides = {}) {
  const domain = {
    domainCode: 'G12',
    domainLabel: "Animation d'activités de loisirs",
    majorDomainCode: 'G',
    majorDomainLabel:
      'Hôtellerie-Restauration Tourisme Loisirs et Animation',
    occupationsCount: 2,
    occupations: [
      {
        romeCode: 'G1204',
        label: 'Educateur sportif / Educatrice sportive',
      },
      {
        romeCode: 'G1205',
        label: "Opérateur / Opératrice d'attraction",
      },
    ],
    indexRunId: 'index-run',
    generatedAt: 'private',
    sourceUrl: 'private',
    schemaVersion: 'publicOccupationDomainEntry.v1',
  };

  return {
    async loadCurrentIndexPointer() {
      return {
        runId: 'index-run',
        asOfDate: '2026-10-06',
        sourceFingerprint: 'private',
      };
    },
    async loadIndexRun() {
      return {
        runId: 'index-run',
        status: 'ready',
        asOfDate: '2026-10-06',
        sourceVersions: { private: true },
      };
    },
    async loadDomains() {
      return [
        {
          domainCode: 'D11',
          domainLabel: 'Commerce alimentaire et métiers de bouche',
          majorDomainCode: 'D',
          majorDomainLabel: 'Commerce, Vente et Grande distribution',
          occupationsCount: 1,
          occupations: [
            {
              romeCode: 'D1108',
              label: 'Vente en alimentation',
            },
          ],
          indexRunId: 'index-run',
        },
        domain,
      ];
    },
    async loadDomain(runId, domainCode) {
      return domainCode === 'G12' ? domain : null;
    },
    ...overrides,
  };
}

test('normalizePublicOccupationDomainCode accepts only official 3-character shape', () => {
  assert.equal(
    typeof publicDomains.normalizePublicOccupationDomainCode,
    'function'
  );
  assert.equal(
    publicDomains.normalizePublicOccupationDomainCode(' g12 '),
    'G12'
  );
  assert.equal(
    publicDomains.normalizePublicOccupationDomainCode('G1204'),
    null
  );
  assert.equal(
    publicDomains.normalizePublicOccupationDomainCode('12G'),
    null
  );
});

test('getPublicOccupationDomains returns a minimal sorted public list', async () => {
  assert.equal(typeof publicDomains.getPublicOccupationDomains, 'function');

  const result = await publicDomains.getPublicOccupationDomains(
    repositoryFixture()
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    exists: true,
    asOfDate: '2026-10-06',
    domains: [
      {
        domainCode: 'D11',
        domainLabel: 'Commerce alimentaire et métiers de bouche',
        majorDomainCode: 'D',
        majorDomainLabel: 'Commerce, Vente et Grande distribution',
        occupationsCount: 1,
      },
      {
        domainCode: 'G12',
        domainLabel: "Animation d'activités de loisirs",
        majorDomainCode: 'G',
        majorDomainLabel:
          'Hôtellerie-Restauration Tourisme Loisirs et Animation',
        occupationsCount: 2,
      },
    ],
  });

  assert.equal(JSON.stringify(result.body).includes('indexRunId'), false);
  assert.equal(JSON.stringify(result.body).includes('sourceUrl'), false);
  assert.equal(JSON.stringify(result.body).includes('sourceVersions'), false);
});

test('getPublicOccupationDomainOccupations returns only approved occupation fields', async () => {
  assert.equal(
    typeof publicDomains.getPublicOccupationDomainOccupations,
    'function'
  );

  const result =
    await publicDomains.getPublicOccupationDomainOccupations(
      repositoryFixture(),
      'g12'
    );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    exists: true,
    asOfDate: '2026-10-06',
    domainCode: 'G12',
    domainLabel: "Animation d'activités de loisirs",
    majorDomainCode: 'G',
    majorDomainLabel:
      'Hôtellerie-Restauration Tourisme Loisirs et Animation',
    occupations: [
      {
        romeCode: 'G1204',
        label: 'Educateur sportif / Educatrice sportive',
      },
      {
        romeCode: 'G1205',
        label: "Opérateur / Opératrice d'attraction",
      },
    ],
  });
  assert.equal(JSON.stringify(result.body).includes('generatedAt'), false);
  assert.equal(JSON.stringify(result.body).includes('schemaVersion'), false);
});

test('getPublicOccupationDomainOccupations rejects invalid syntax before lookup', async () => {
  let lookupCalled = false;

  const result =
    await publicDomains.getPublicOccupationDomainOccupations(
      repositoryFixture({
        async loadDomain() {
          lookupCalled = true;
          return null;
        },
      }),
      'G1204'
    );

  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'INVALID_DOMAIN');
  assert.equal(lookupCalled, false);
});

test('getPublicOccupationDomainOccupations returns 404 for an unknown official-shaped domain', async () => {
  const result =
    await publicDomains.getPublicOccupationDomainOccupations(
      repositoryFixture({
        async loadDomain() {
          return null;
        },
      }),
      'Z99'
    );

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, {
    ok: false,
    exists: false,
    domainCode: 'Z99',
    data: null,
  });
});

test('public domain services return controlled 503 when no current index exists', async () => {
  const repository = repositoryFixture({
    async loadCurrentIndexPointer() {
      return null;
    },
  });

  const list = await publicDomains.getPublicOccupationDomains(repository);
  const detail =
    await publicDomains.getPublicOccupationDomainOccupations(
      repository,
      'G12'
    );

  assert.equal(list.status, 503);
  assert.equal(
    list.body.error,
    'NO_PUBLISHED_OCCUPATION_DOMAIN_INDEX'
  );
  assert.equal(detail.status, 503);
  assert.equal(
    detail.body.error,
    'NO_PUBLISHED_OCCUPATION_DOMAIN_INDEX'
  );
});

test('public domain services refuse a current index whose run is not ready', async () => {
  const repository = repositoryFixture({
    async loadIndexRun() {
      return {
        runId: 'index-run',
        status: 'building',
      };
    },
  });

  const result = await publicDomains.getPublicOccupationDomains(repository);

  assert.equal(result.status, 503);
  assert.equal(
    result.body.error,
    'OCCUPATION_DOMAIN_INDEX_NOT_READY'
  );
});

test('resolvePublishedOccupationDomainIndex rejects pointer/run mismatch', () => {
  assert.equal(
    typeof publicDomains.resolvePublishedOccupationDomainIndex,
    'function'
  );

  assert.deepEqual(
    publicDomains.resolvePublishedOccupationDomainIndex(
      {
        runId: 'pointer-run',
        asOfDate: '2026-10-06',
      },
      {
        runId: 'different-run',
        status: 'ready',
      }
    ),
    {
      ok: false,
      error: 'OCCUPATION_DOMAIN_INDEX_MISMATCH',
    }
  );
});
