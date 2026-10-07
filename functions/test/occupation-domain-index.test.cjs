const test = require('node:test');
const assert = require('node:assert/strict');

let domainIndex = {};
try {
  domainIndex = require('../lib/occupation-domain-index.cjs');
} catch {
  domainIndex = {};
}

function fixture() {
  return {
    asOfDate: '2026-10-06',
    domainMeta: {
      runId: 'domain-run',
      sourceVersion: 'sha256:tree',
      occupationRunId: 'rome-run',
      occupationSourceVersion: 'sha256:rome',
    },
    occupationMeta: {
      runId: 'rome-run',
      sourceVersion: 'sha256:rome',
    },
    domainEntries: [
      {
        domainCode: 'G12',
        domainLabel: "Animation d'activités de loisirs",
        majorDomainCode: 'G',
        majorDomainLabel:
          'Hôtellerie-Restauration Tourisme Loisirs et Animation',
        normalizedLabel: 'animation d activites de loisirs',
        romeCodes: ['G1205', 'G1204'],
        importRunId: 'domain-run',
        occupationRunId: 'rome-run',
        sourceVersion: 'sha256:tree',
        occupationSourceVersion: 'sha256:rome',
      },
      {
        domainCode: 'D11',
        domainLabel: 'Commerce alimentaire et métiers de bouche',
        majorDomainCode: 'D',
        majorDomainLabel: 'Commerce, Vente et Grande distribution',
        normalizedLabel: 'commerce alimentaire et metiers de bouche',
        romeCodes: ['D1108'],
        importRunId: 'domain-run',
        occupationRunId: 'rome-run',
        sourceVersion: 'sha256:tree',
        occupationSourceVersion: 'sha256:rome',
      },
    ],
    occupationEntries: [
      {
        romeCode: 'G1205',
        label: "Opérateur / Opératrice d'attraction",
        normalizedLabel: 'operateur operatrice d attraction',
        importRunId: 'rome-run',
      },
      {
        romeCode: 'D1108',
        label: 'Vente en alimentation',
        normalizedLabel: 'vente en alimentation',
        importRunId: 'rome-run',
      },
      {
        romeCode: 'G1204',
        label: 'Educateur sportif / Educatrice sportive',
        normalizedLabel: 'educateur sportif educatrice sportive',
        importRunId: 'rome-run',
      },
    ],
  };
}

test('buildOccupationDomainIndex builds a deterministic public sector index', () => {
  assert.equal(typeof domainIndex.buildOccupationDomainIndex, 'function');

  const result = domainIndex.buildOccupationDomainIndex(fixture());

  assert.equal(result.eligible, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.asOfDate, '2026-10-06');
  assert.deepEqual(result.sourceVersions, {
    domainRunId: 'domain-run',
    domainSourceVersion: 'sha256:tree',
    occupationRunId: 'rome-run',
    occupationSourceVersion: 'sha256:rome',
  });

  assert.deepEqual(result.domains, [
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
    },
    {
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
    },
  ]);
});

test('buildOccupationDomainIndex rejects a stale domain-to-occupation reference', () => {
  const input = fixture();
  input.domainMeta.occupationRunId = 'older-rome-run';

  const result = domainIndex.buildOccupationDomainIndex(input);

  assert.equal(result.eligible, false);
  assert.equal(
    result.blockers.includes('DOMAIN_OCCUPATION_RUN_MISMATCH'),
    true
  );
  assert.deepEqual(result.domains, []);
});

test('buildOccupationDomainIndex rejects source version mismatch', () => {
  const input = fixture();
  input.domainMeta.occupationSourceVersion = 'sha256:stale';

  const result = domainIndex.buildOccupationDomainIndex(input);

  assert.equal(result.eligible, false);
  assert.equal(
    result.blockers.includes('DOMAIN_OCCUPATION_SOURCE_VERSION_MISMATCH'),
    true
  );
});

test('buildOccupationDomainIndex rejects a domain member missing from current ROME', () => {
  const input = fixture();
  input.domainEntries[1].romeCodes.push('D1199');

  const result = domainIndex.buildOccupationDomainIndex(input);

  assert.equal(result.eligible, false);
  assert.equal(
    result.blockers.includes('DOMAIN_MEMBER_ROME_MISSING:D11:D1199'),
    true
  );
});

test('buildOccupationDomainIndex rejects stale entry run ids', () => {
  const input = fixture();
  input.domainEntries[0].importRunId = 'old-domain-run';
  input.occupationEntries[0].importRunId = 'old-rome-run';

  const result = domainIndex.buildOccupationDomainIndex(input);

  assert.equal(result.eligible, false);
  assert.equal(
    result.blockers.includes('DOMAIN_ENTRY_RUN_MISMATCH:G12'),
    true
  );
  assert.equal(
    result.blockers.includes('OCCUPATION_ENTRY_RUN_MISMATCH:G1205'),
    true
  );
});


test('buildOccupationDomainIndexPublication creates minimal versioned Firestore projections', () => {
  assert.equal(
    typeof domainIndex.buildOccupationDomainIndexPublication,
    'function'
  );

  const index = domainIndex.buildOccupationDomainIndex(fixture());
  const result = domainIndex.buildOccupationDomainIndexPublication(
    index,
    {
      runId: 'occupation_domain_index_2026-10-06_abc123',
      sourceFingerprint: 'sha256:fingerprint',
    }
  );

  assert.equal(result.run.status, 'building');
  assert.equal(result.run.domainsCount, 2);
  assert.equal(
    result.run.schemaVersion,
    'publicOccupationDomainIndex.v1'
  );
  assert.equal(result.meta.runId, result.run.runId);
  assert.equal(result.meta.domainsCount, 2);
  assert.equal(
    result.meta.schemaVersion,
    'publicOccupationDomainIndexMeta.v1'
  );

  assert.deepEqual(
    result.documents.map((document) => ({
      domainCode: document.domainCode,
      occupationsCount: document.occupationsCount,
      schemaVersion: document.schemaVersion,
    })),
    [
      {
        domainCode: 'D11',
        occupationsCount: 1,
        schemaVersion: 'publicOccupationDomainEntry.v1',
      },
      {
        domainCode: 'G12',
        occupationsCount: 2,
        schemaVersion: 'publicOccupationDomainEntry.v1',
      },
    ]
  );

  for (const document of result.documents) {
    assert.equal('sourceUrl' in document, false);
    assert.equal('importRunId' in document, false);
    assert.equal('sourceVersion' in document, false);
  }
});

test('buildOccupationDomainIndexPublication refuses an ineligible index', () => {
  assert.throws(
    () =>
      domainIndex.buildOccupationDomainIndexPublication(
        {
          eligible: false,
          blockers: ['DOMAIN_OCCUPATION_RUN_MISMATCH'],
          domains: [],
        },
        {
          runId: 'run',
          sourceFingerprint: 'sha256:test',
        }
      ),
    /PUBLIC_DOMAIN_INDEX_INELIGIBLE/
  );
});
