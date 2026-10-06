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
