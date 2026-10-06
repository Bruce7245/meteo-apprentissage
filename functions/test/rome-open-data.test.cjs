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


test('extractRomeDomainReferenceEntries reads official-style professional-domain rows', () => {
  assert.equal(typeof romeOpenData.extractRomeDomainReferenceEntries, 'function');

  const payload = [
    {
      code_grand_domaine: 'G',
      libelle_grand_domaine: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
      code_domaine_professionnel: 'G12',
      libelle_domaine_professionnel: "Animation d'activités de loisirs",
      code_rome: 'G1204',
    },
    {
      code_grand_domaine: 'G',
      libelle_grand_domaine: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
      code_domaine_professionnel: 'G12',
      libelle_domaine_professionnel: "Animation d'activités de loisirs",
      code_rome: 'G1205',
    },
    {
      code_grand_domaine: 'D',
      libelle_grand_domaine: 'Commerce, Vente et Grande distribution',
      code_domaine_professionnel: 'D11',
      libelle_domaine_professionnel: 'Commerce alimentaire et métiers de bouche',
      code_rome: 'D1108',
    },
  ];

  const occupationEntries = [
    { romeCode: 'D1108', label: 'Vente en alimentation' },
    { romeCode: 'G1204', label: 'Educateur sportif / Educatrice sportive' },
    { romeCode: 'G1205', label: "Opérateur / Opératrice d'attraction" },
  ];

  assert.deepEqual(
    romeOpenData.extractRomeDomainReferenceEntries(
      payload,
      occupationEntries,
      {
        source: 'france-travail-rome-main-tree',
        sourceVersion: 'sha256:tree',
        occupationSourceVersion: 'sha256:occupations',
      }
    ),
    [
      {
        domainCode: 'D11',
        domainLabel: 'Commerce alimentaire et métiers de bouche',
        majorDomainCode: 'D',
        majorDomainLabel: 'Commerce, Vente et Grande distribution',
        normalizedLabel: 'commerce alimentaire et metiers de bouche',
        romeCodes: ['D1108'],
        source: 'france-travail-rome-main-tree',
        sourceVersion: 'sha256:tree',
        occupationSourceVersion: 'sha256:occupations',
      },
      {
        domainCode: 'G12',
        domainLabel: "Animation d'activités de loisirs",
        majorDomainCode: 'G',
        majorDomainLabel: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
        normalizedLabel: 'animation d activites de loisirs',
        romeCodes: ['G1204', 'G1205'],
        source: 'france-travail-rome-main-tree',
        sourceVersion: 'sha256:tree',
        occupationSourceVersion: 'sha256:occupations',
      },
    ]
  );
});

test('extractRomeDomainReferenceEntries merges duplicate domain rows deterministically', () => {
  const payload = [
    {
      code_domaine_professionnel: 'G12',
      libelle_domaine_professionnel: "Animation d'activités de loisirs",
      code_grand_domaine: 'G',
      libelle_grand_domaine: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
      code_rome: 'G1205',
    },
    {
      code_domaine_professionnel: 'G12',
      libelle_domaine_professionnel: "Animation d'activités de loisirs",
      code_grand_domaine: 'G',
      libelle_grand_domaine: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
      code_rome: 'G1204',
    },
    {
      code_domaine_professionnel: 'G12',
      libelle_domaine_professionnel: '',
      code_grand_domaine: 'G',
      libelle_grand_domaine: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
      code_rome: 'G1206',
    },
  ];

  const result = romeOpenData.extractRomeDomainReferenceEntries(
    payload,
    [
      { romeCode: 'G1204', label: 'A' },
      { romeCode: 'G1205', label: 'B' },
      { romeCode: 'G1206', label: 'C' },
    ],
    {}
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].domainCode, 'G12');
  assert.equal(result[0].domainLabel, "Animation d'activités de loisirs");
  assert.deepEqual(result[0].romeCodes, ['G1204', 'G1205', 'G1206']);
});

test('extractRomeDomainReferenceEntries only attaches occupations to an official extracted domain', () => {
  const result = romeOpenData.extractRomeDomainReferenceEntries(
    [
      {
        code_domaine_professionnel: 'G12',
        libelle_domaine_professionnel: "Animation d'activités de loisirs",
        code_grand_domaine: 'G',
        libelle_grand_domaine: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
      },
    ],
    [
      { romeCode: 'G1204', label: 'Educateur sportif / Educatrice sportive' },
      { romeCode: 'G1299', label: 'Métier test du domaine' },
      { romeCode: 'D1108', label: 'Vente en alimentation' },
    ],
    {}
  );

  assert.deepEqual(result[0].romeCodes, ['G1204', 'G1299']);
  assert.equal(result.some((entry) => entry.domainCode === 'D11'), false);
});

test('validateRomeDomainReference reports unexplained occupation prefixes', () => {
  assert.equal(typeof romeOpenData.validateRomeDomainReference, 'function');

  const result = romeOpenData.validateRomeDomainReference(
    [
      {
        domainCode: 'G12',
        domainLabel: "Animation d'activités de loisirs",
        majorDomainCode: 'G',
        majorDomainLabel: 'Hôtellerie-Restauration Tourisme Loisirs et Animation',
        romeCodes: ['G1204'],
      },
    ],
    [
      { romeCode: 'G1204', label: 'Educateur sportif / Educatrice sportive' },
      { romeCode: 'D1108', label: 'Vente en alimentation' },
    ]
  );

  assert.equal(result.ok, false);
  assert.equal(result.domainsCount, 1);
  assert.deepEqual(result.unmappedRomeCodes, ['D1108']);
});


test('extractRomeDomainReferenceEntries reads the official main-tree workbook matrix', () => {
  const payload = [
    [' ', ' ', ' ', ' ', 'Code OGR'],
    [
      'G',
      ' ',
      ' ',
      'Hôtellerie-Restauration Tourisme Loisirs et Animation',
      ' ',
    ],
    ['G', '12', ' ', "Animation d'activités de loisirs", ' '],
    [
      'G',
      '12',
      '04',
      'Educateur sportif / Educatrice sportive',
      '123',
    ],
    [
      'G',
      '12',
      '05',
      "Opérateur / Opératrice d'attraction",
      '456',
    ],
    [
      'D',
      ' ',
      ' ',
      'Commerce, Vente et Grande distribution',
      ' ',
    ],
    [
      'D',
      '11',
      ' ',
      'Commerce alimentaire et métiers de bouche',
      ' ',
    ],
  ];

  const result = romeOpenData.extractRomeDomainReferenceEntries(
    payload,
    [
      { romeCode: 'D1108', label: 'Vente en alimentation' },
      { romeCode: 'G1204', label: 'Educateur sportif / Educatrice sportive' },
      { romeCode: 'G1205', label: "Opérateur / Opératrice d'attraction" },
    ],
    {
      source: 'france-travail-rome-main-tree',
      sourceVersion: 'sha256:tree',
      occupationSourceVersion: 'sha256:occupations',
    }
  );

  assert.deepEqual(
    result.map((entry) => ({
      domainCode: entry.domainCode,
      domainLabel: entry.domainLabel,
      majorDomainCode: entry.majorDomainCode,
      majorDomainLabel: entry.majorDomainLabel,
      romeCodes: entry.romeCodes,
    })),
    [
      {
        domainCode: 'D11',
        domainLabel: 'Commerce alimentaire et métiers de bouche',
        majorDomainCode: 'D',
        majorDomainLabel: 'Commerce, Vente et Grande distribution',
        romeCodes: ['D1108'],
      },
      {
        domainCode: 'G12',
        domainLabel: "Animation d'activités de loisirs",
        majorDomainCode: 'G',
        majorDomainLabel:
          'Hôtellerie-Restauration Tourisme Loisirs et Animation',
        romeCodes: ['G1204', 'G1205'],
      },
    ]
  );
});
