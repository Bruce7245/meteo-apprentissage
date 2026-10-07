const test = require('node:test');
const assert = require('node:assert/strict');

let occupationSearch = {};
try {
  occupationSearch = require('../lib/occupation-search.cjs');
} catch {
  occupationSearch = {};
}

test('normalizeOccupationSearchText removes accents, punctuation and duplicate spaces', () => {
  assert.equal(typeof occupationSearch.normalizeOccupationSearchText, 'function');

  assert.equal(
    occupationSearch.normalizeOccupationSearchText('  Développeur  Web / Mobile  '),
    'developpeur web mobile'
  );
});

test('normalizeRomeCode accepts only exact ROME codes', () => {
  assert.equal(typeof occupationSearch.normalizeRomeCode, 'function');

  assert.equal(occupationSearch.normalizeRomeCode(' d1108 '), 'D1108');
  assert.equal(occupationSearch.normalizeRomeCode('D110'), null);
  assert.equal(occupationSearch.normalizeRomeCode('DD108'), null);
  assert.equal(occupationSearch.normalizeRomeCode('D11080'), null);
});

test('buildSearchPrefixes returns deterministic normalized prefixes', () => {
  assert.equal(typeof occupationSearch.buildSearchPrefixes, 'function');

  assert.deepEqual(
    occupationSearch.buildSearchPrefixes([
      'Développeur web',
      'D1108',
      'Développeur web',
    ], { minLength: 2, maxLength: 8 }),
    ['d1', 'd11', 'd110', 'd1108', 'de', 'dev', 'deve', 'devel', 'develo', 'develop', 'developp']
  );
});

test('sanitizePublicOccupationEntry exposes only approved ROME fields', () => {
  assert.equal(typeof occupationSearch.sanitizePublicOccupationEntry, 'function');

  const result = occupationSearch.sanitizePublicOccupationEntry({
    type: 'occupation',
    romeCode: 'D1108',
    label: 'Vente en alimentation',
    normalizedLabel: 'vente en alimentation',
    searchPrefixes: ['ve', 'ven'],
    source: 'france-travail-rome',
    sourceVersion: '2026-10-04',
    secret: 'hidden',
    raw: { private: true },
  });

  assert.deepEqual(result, {
    type: 'occupation',
    romeCode: 'D1108',
    label: 'Vente en alimentation',
    normalizedLabel: 'vente en alimentation',
    source: 'france-travail-rome',
    sourceVersion: '2026-10-04',
  });
});

test('sanitizePublicTrainingEntry retains multiple valid ROME codes and removes private organisation data', () => {
  assert.equal(typeof occupationSearch.sanitizePublicTrainingEntry, 'function');

  const result = occupationSearch.sanitizePublicTrainingEntry({
    type: 'training',
    publicId: 'rncp_38363',
    rncp: 'RNCP38363',
    label: 'BTS Gestion de la PME',
    normalizedLabel: 'bts gestion de la pme',
    romeCodes: ['M1604', 'M1607', 'bad', 'M1604'],
    source: 'catalogue-apprentissage',
    sourceVersion: '2026-10-04',
    siret: '12345678901234',
    uai: '0123456A',
    address: '1 rue privée',
    raw: { private: true },
  });

  assert.deepEqual(result, {
    type: 'training',
    publicId: 'rncp_38363',
    rncp: 'RNCP38363',
    label: 'BTS Gestion de la PME',
    normalizedLabel: 'bts gestion de la pme',
    romeCodes: ['M1604', 'M1607'],
    source: 'catalogue-apprentissage',
    sourceVersion: '2026-10-04',
  });

  for (const forbidden of ['siret', 'uai', 'address', 'raw']) {
    assert.equal(forbidden in result, false, forbidden);
  }
});
