const test = require('node:test');
const assert = require('node:assert/strict');

let publicSearch = {};
try {
  publicSearch = require('../lib/public-occupation-search.cjs');
} catch {
  publicSearch = {};
}

test('validatePublicOccupationQuery accepts normalized queries from 2 to 80 input characters', () => {
  assert.equal(typeof publicSearch.validatePublicOccupationQuery, 'function');

  assert.deepEqual(
    publicSearch.validatePublicOccupationQuery('  Développeur web  '),
    {
      ok: true,
      normalizedQuery: 'developpeur web',
    }
  );

  assert.deepEqual(
    publicSearch.validatePublicOccupationQuery('a'),
    {
      ok: false,
      status: 400,
      message: 'Search query must contain between 2 and 80 characters',
    }
  );

  assert.deepEqual(
    publicSearch.validatePublicOccupationQuery('x'.repeat(81)),
    {
      ok: false,
      status: 400,
      message: 'Search query must contain between 2 and 80 characters',
    }
  );
});

test('mergeOccupationSearchResults ranks exact matches before prefix matches', () => {
  assert.equal(typeof publicSearch.mergeOccupationSearchResults, 'function');

  const results = publicSearch.mergeOccupationSearchResults({
    normalizedQuery: 'boulanger',
    occupations: [
      {
        type: 'occupation',
        romeCode: 'D1102',
        label: 'Boulangerie - viennoiserie',
        normalizedLabel: 'boulangerie viennoiserie',
        source: 'france-travail-rome',
        sourceVersion: 'v1',
      },
      {
        type: 'occupation',
        romeCode: 'D1101',
        label: 'Boulanger',
        normalizedLabel: 'boulanger',
        source: 'france-travail-rome',
        sourceVersion: 'v1',
      },
    ],
    trainings: [
      {
        type: 'training',
        publicId: 'rncp_37537',
        rncp: 'RNCP37537',
        label: 'Boulanger',
        normalizedLabel: 'boulanger',
        romeCodes: ['D1101'],
        source: 'formationDetails',
        sourceVersion: 'v2',
      },
    ],
    limit: 12,
  });

  assert.equal(results.length, 3);
  assert.equal(results[0].type, 'occupation');
  assert.equal(results[0].romeCode, 'D1101');
  assert.equal(results[1].type, 'training');
  assert.equal(results[1].publicId, 'rncp_37537');
  assert.equal(results[2].romeCode, 'D1102');
});

test('mergeOccupationSearchResults caps results and removes invalid/private records', () => {
  const occupations = Array.from({ length: 20 }, (_, index) => ({
    type: 'occupation',
    romeCode: `A${String(index).padStart(4, '0')}`,
    label: `Assistant ${index}`,
    normalizedLabel: `assistant ${index}`,
    source: 'rome',
    sourceVersion: 'v1',
    raw: { private: true },
  }));

  occupations.push({
    type: 'occupation',
    romeCode: 'BAD',
    label: 'Assistant invalide',
    normalizedLabel: 'assistant invalide',
  });

  const results = publicSearch.mergeOccupationSearchResults({
    normalizedQuery: 'assistant',
    occupations,
    trainings: [],
    limit: 12,
  });

  assert.equal(results.length, 12);
  assert.equal(results.every((item) => item.type === 'occupation'), true);
  assert.equal(results.some((item) => 'raw' in item), false);
  assert.equal(results.some((item) => item.romeCode === 'BAD'), false);
});

test('mergeOccupationSearchResults keeps all validated ROME choices for a training', () => {
  const results = publicSearch.mergeOccupationSearchResults({
    normalizedQuery: 'bts gestion',
    occupations: [],
    trainings: [
      {
        type: 'training',
        publicId: 'rncp_38363',
        rncp: 'RNCP38363',
        label: 'BTS Gestion de la PME',
        normalizedLabel: 'bts gestion de la pme',
        romeCodes: ['M1604', 'M1607', 'bad'],
        source: 'formationDetails',
        sourceVersion: 'v1',
        siret: '12345678901234',
      },
    ],
  });

  assert.deepEqual(results[0].romeCodes, ['M1604', 'M1607']);
  assert.equal('siret' in results[0], false);
});


test('createPublicRateLimiter limits bursts without persisting request identifiers', () => {
  assert.equal(typeof publicSearch.createPublicRateLimiter, 'function');

  let now = 1000;
  const check = publicSearch.createPublicRateLimiter({
    windowMs: 1000,
    maxRequests: 2,
    now: () => now,
    salt: 'test-salt',
  });

  assert.deepEqual(check('203.0.113.4'), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 0,
  });

  assert.deepEqual(check('203.0.113.4'), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 0,
  });

  assert.deepEqual(check('203.0.113.4'), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 1,
  });

  now = 2001;

  assert.deepEqual(check('203.0.113.4'), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 0,
  });
});
