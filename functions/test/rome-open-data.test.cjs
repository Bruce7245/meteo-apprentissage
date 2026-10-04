const test = require('node:test');
const assert = require('node:assert/strict');

let romeOpenData = {};
try {
  romeOpenData = require('../lib/rome-open-data.cjs');
} catch {
  romeOpenData = {};
}

test('extractRomeReferenceEntries reads nested official-style JSON records', () => {
  assert.equal(typeof romeOpenData.extractRomeReferenceEntries, 'function');

  const payload = {
    data: [
      { code_rome: 'D1108', libelle_rome: 'Vente en alimentation' },
      {
        fiche: {
          codeRome: 'M1607',
          intitule: 'Secrétariat',
        },
      },
    ],
  };

  assert.deepEqual(
    romeOpenData.extractRomeReferenceEntries(payload, {
      source: 'france-travail-rome',
      sourceVersion: 'sha256:abc',
    }),
    [
      {
        romeCode: 'D1108',
        label: 'Vente en alimentation',
        normalizedLabel: 'vente en alimentation',
        searchTerms: [],
        source: 'france-travail-rome',
        sourceVersion: 'sha256:abc',
      },
      {
        romeCode: 'M1607',
        label: 'Secrétariat',
        normalizedLabel: 'secretariat',
        searchTerms: [],
        source: 'france-travail-rome',
        sourceVersion: 'sha256:abc',
      },
    ]
  );
});

test('extractRomeReferenceEntries supports CSV-shaped rows and rejects invalid records', () => {
  assert.equal(typeof romeOpenData.extractRomeReferenceEntries, 'function');

  const payload = [
    { code_rome: 'I1623', libelle: 'Conseil clientèle en après-vente de véhicules' },
    { code_rome: 'BAD', libelle: 'Invalide' },
    { code_rome: 'G1204', libelle: '' },
    { code_rome: '', libelle: 'Sans code' },
  ];

  const entries = romeOpenData.extractRomeReferenceEntries(payload, {
    source: 'data-gouv-rome',
    sourceVersion: 'sha256:def',
  });

  assert.deepEqual(entries, [
    {
      romeCode: 'I1623',
      label: 'Conseil clientèle en après-vente de véhicules',
      normalizedLabel: 'conseil clientele en apres vente de vehicules',
      searchTerms: [],
      source: 'data-gouv-rome',
      sourceVersion: 'sha256:def',
    },
  ]);
});

test('duplicate ROME records are resolved deterministically to the best label', () => {
  assert.equal(typeof romeOpenData.extractRomeReferenceEntries, 'function');

  const payload = [
    { code_rome: 'D1401', label: 'Assistanat commercial' },
    { code_rome: 'D1401', libelle_rome: 'Assistanat commercial' },
    { code_rome: 'D1401', intitule: 'Assistanat commercial et relation client avec description très longue' },
  ];

  const entries = romeOpenData.extractRomeReferenceEntries(payload, {
    source: 'france-travail-rome',
    sourceVersion: 'v1',
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].romeCode, 'D1401');
  assert.equal(entries[0].label, 'Assistanat commercial');
});

test('validateRomeReference refuses implausibly small imports', () => {
  assert.equal(typeof romeOpenData.validateRomeReference, 'function');

  assert.deepEqual(
    romeOpenData.validateRomeReference(
      [{ romeCode: 'D1108', label: 'Vente en alimentation' }],
      { minimumEntries: 1000 }
    ),
    {
      ok: false,
      count: 1,
      minimumEntries: 1000,
      error: 'ROME reference contains 1 valid entries; minimum is 1000',
    }
  );
});

test('validateRomeReference accepts a sufficiently large unique reference', () => {
  assert.equal(typeof romeOpenData.validateRomeReference, 'function');

  const entries = Array.from({ length: 1000 }, (_, index) => ({
    romeCode: `A${String(index).padStart(4, '0')}`,
    label: `Métier ${index}`,
  }));

  const result = romeOpenData.validateRomeReference(entries, { minimumEntries: 1000 });

  assert.deepEqual(result, {
    ok: true,
    count: 1000,
    minimumEntries: 1000,
    error: null,
  });
});


test('extractRomeReferenceEntries retains official employment aliases as search terms', () => {
  const entries = romeOpenData.extractRomeReferenceEntries({
    code_rome: 'M1805',
    libelle_rome: 'Études et développement informatique',
    emplois: [
      { libelle: 'Développeur web' },
      { libelle: 'Développeuse web' },
      { libelle: 'Études et développement informatique' },
    ],
  }, {
    source: 'france-travail-rome',
    sourceVersion: 'v2',
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].romeCode, 'M1805');
  assert.equal(entries[0].label, 'Études et développement informatique');
  assert.deepEqual(entries[0].searchTerms, [
    'Développeur web',
    'Développeuse web',
  ]);
});
