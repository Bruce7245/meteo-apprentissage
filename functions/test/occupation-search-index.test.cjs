const test = require('node:test');
const assert = require('node:assert/strict');

let searchIndex = {};
try {
  searchIndex = require('../lib/occupation-search-index.cjs');
} catch {
  searchIndex = {};
}

test('buildOccupationIndexEntry creates a stable occupation entry with searchable prefixes', () => {
  assert.equal(typeof searchIndex.buildOccupationIndexEntry, 'function');

  const result = searchIndex.buildOccupationIndexEntry({
    romeCode: 'D1108',
    label: 'Vente en alimentation',
    normalizedLabel: 'vente en alimentation',
    source: 'france-travail-rome',
    sourceVersion: 'sha256:abc',
  }, {
    asOfDate: '2026-10-04',
  });

  assert.equal(result.entryId, 'occupation_D1108');
  assert.equal(result.type, 'occupation');
  assert.equal(result.romeCode, 'D1108');
  assert.equal(result.label, 'Vente en alimentation');
  assert.equal(result.source, 'france-travail-rome');
  assert.equal(result.sourceVersion, 'sha256:abc');
  assert.equal(result.asOfDate, '2026-10-04');
  assert.equal(result.searchPrefixes.includes('ve'), true);
  assert.equal(result.searchPrefixes.includes('vente'), true);
  assert.equal(result.searchPrefixes.includes('d1'), true);
  assert.equal(result.searchPrefixes.includes('d1108'), true);
});

test('buildTrainingIndexEntries deduplicates by RNCP and unions validated ROME codes', () => {
  assert.equal(typeof searchIndex.buildTrainingIndexEntries, 'function');

  const results = searchIndex.buildTrainingIndexEntries([
    {
      intitule: 'BTS Gestion de la PME',
      rncp: 'RNCP38363',
      romeCodes: ['M1604', 'M1607', 'bad'],
      venue: { siret: '11111111111111', address: '1 rue privée' },
      raw: { secret: true },
    },
    {
      intitule: 'BTS Gestion de la PME',
      rncp: '38363',
      romeCodes: ['M1607', 'D1401'],
      venue: { uai: '0123456A' },
    },
  ], {
    source: 'formationDetails',
    sourceVersion: 'formation-run-2026-10-04',
    asOfDate: '2026-10-04',
  });

  assert.equal(results.length, 1);

  assert.deepEqual(results[0], {
    entryId: 'training_rncp_38363',
    type: 'training',
    publicId: 'rncp_38363',
    rncp: 'RNCP38363',
    label: 'BTS Gestion de la PME',
    normalizedLabel: 'bts gestion de la pme',
    searchPrefixes: results[0].searchPrefixes,
    romeCodes: ['D1401', 'M1604', 'M1607'],
    source: 'formationDetails',
    sourceVersion: 'formation-run-2026-10-04',
    asOfDate: '2026-10-04',
  });

  assert.equal(results[0].searchPrefixes.includes('bt'), true);
  assert.equal(results[0].searchPrefixes.includes('rn'), true);
  assert.equal(results[0].searchPrefixes.includes('rncp38363'), true);

  for (const forbidden of ['siret', 'uai', 'address', 'venue', 'raw']) {
    assert.equal(forbidden in results[0], false, forbidden);
  }
});

test('buildTrainingIndexEntries falls back to normalized title when RNCP is absent', () => {
  const results = searchIndex.buildTrainingIndexEntries([
    {
      intitule: 'Titre professionnel Développeur web',
      romeCodes: ['M1805'],
    },
    {
      intitule: 'Titre professionnel développeur web',
      romeCodes: ['M1805', 'M1806'],
    },
  ], {
    source: 'formationDetails',
    sourceVersion: 'v1',
    asOfDate: '2026-10-04',
  });

  assert.equal(results.length, 1);
  assert.match(results[0].entryId, /^training_title_[a-f0-9]{16}$/);
  assert.equal(results[0].publicId, results[0].entryId.replace(/^training_/, ''));
  assert.deepEqual(results[0].romeCodes, ['M1805', 'M1806']);
});

test('buildTrainingIndexEntries removes formations without a usable label or ROME mapping', () => {
  const results = searchIndex.buildTrainingIndexEntries([
    { intitule: '', rncp: 'RNCP1', romeCodes: ['M1607'] },
    { intitule: 'Formation sans métier', rncp: 'RNCP2', romeCodes: [] },
    { intitule: 'Formation métier invalide', rncp: 'RNCP3', romeCodes: ['bad'] },
  ], {
    source: 'formationDetails',
    sourceVersion: 'v1',
    asOfDate: '2026-10-04',
  });

  assert.deepEqual(results, []);
});


test('buildOccupationIndexEntry indexes official ROME employment aliases', () => {
  const result = searchIndex.buildOccupationIndexEntry({
    romeCode: 'M1805',
    label: 'Études et développement informatique',
    normalizedLabel: 'etudes et developpement informatique',
    searchTerms: ['Développeur web', 'Développeuse web'],
    source: 'france-travail-rome',
    sourceVersion: 'v2',
  }, {
    asOfDate: '2026-10-04',
  });

  assert.equal(result.searchPrefixes.includes('developpeur web'), true);
  assert.equal(result.searchPrefixes.includes('developpeuse web'), true);
});


test('buildTrainingSearchAliases derives common deterministic training acronyms', () => {
  assert.equal(typeof searchIndex.buildTrainingSearchAliases, 'function');

  assert.deepEqual(
    searchIndex.buildTrainingSearchAliases('BTS Gestion de la PME'),
    ['BTS GPME', 'BTSGPME', 'GPME']
  );

  assert.deepEqual(
    searchIndex.buildTrainingSearchAliases('BPJEPS Activités de la Forme'),
    ['AF', 'BPJEPS AF', 'BPJEPSAF']
  );
});

test('buildTrainingIndexEntries makes BTS GPME searchable from its long title', () => {
  const [result] = searchIndex.buildTrainingIndexEntries([
    {
      intitule: 'BTS Gestion de la PME',
      rncp: 'RNCP38363',
      romeCodes: ['M1604'],
    },
  ], {
    source: 'formationDetails',
    sourceVersion: 'v1',
    asOfDate: '2026-10-04',
  });

  assert.equal(result.searchPrefixes.includes('bts gpme'), true);
  assert.equal(result.searchPrefixes.includes('gpme'), true);
});
