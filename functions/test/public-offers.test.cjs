const test = require('node:test');
const assert = require('node:assert/strict');

let publicOffers = {};
try {
  publicOffers = require('../lib/public-offers.cjs');
} catch {
  publicOffers = {};
}

test('sanitizePublicOffer exposes only approved public fields', () => {
  assert.equal(typeof publicOffers.sanitizePublicOffer, 'function');

  const result = publicOffers.sanitizePublicOffer({
    title: 'Assistant commercial H/F',
    companyName: 'Entreprise Exemple',
    city: 'Bourg-en-Bresse',
    sectorLabel: 'Commerce / vente',
    openingCount: 2,
    publicationCreationDate: '2026-10-03',
    publicationExpirationDate: '2026-11-03',
    contractStartDate: '2026-11-15',
    contractTypes: ['Apprentissage'],
    applyUrl: 'https://example.test/candidature',
    locationQuality: 'in_department',
    siret: '12345678901234',
    applyPhone: '0102030405',
    applyRecipientId: 'private-recipient',
    address: '1 rue Exemple',
    geopoint: { lat: 1, lon: 2 },
    raw: { secret: true },
    runId: 'internal-run',
    partnerJobId: 'internal-id',
  });

  assert.deepEqual(result, {
    title: 'Assistant commercial H/F',
    companyName: 'Entreprise Exemple',
    city: 'Bourg-en-Bresse',
    sectorLabel: 'Commerce / vente',
    openingCount: 2,
    publicationCreationDate: '2026-10-03',
    publicationExpirationDate: '2026-11-03',
    contractStartDate: '2026-11-15',
    contractTypes: ['Apprentissage'],
    applyUrl: 'https://example.test/candidature',
  });

  for (const forbidden of [
    'siret',
    'applyPhone',
    'applyRecipientId',
    'address',
    'geopoint',
    'raw',
    'runId',
    'partnerJobId',
    'locationQuality',
  ]) {
    assert.equal(forbidden in result, false, `${forbidden} must stay private`);
  }
});

test('buildPublicOffersPayload keeps only in-department offers and caps the public list', () => {
  assert.equal(typeof publicOffers.buildPublicOffersPayload, 'function');

  const offers = Array.from({ length: 25 }, (_, index) => ({
    title: `Offre ${index + 1}`,
    companyName: `Entreprise ${index + 1}`,
    city: 'Bourg-en-Bresse',
    sectorLabel: 'Commerce',
    openingCount: index + 1,
    publicationCreationDate: '2026-10-03',
    publicationExpirationDate: '2026-11-03',
    contractStartDate: null,
    contractTypes: ['Apprentissage'],
    applyUrl: `https://example.test/${index + 1}`,
    locationQuality: index === 0 ? 'out_of_department' : 'in_department',
  }));

  const payload = publicOffers.buildPublicOffersPayload({
    date: '2026-10-04',
    departmentCode: '01',
    strictSummary: {
      totalOffers: 24,
      totalOpenings: 324,
    },
    offers,
    limit: 20,
  });

  assert.equal(payload.date, '2026-10-04');
  assert.equal(payload.departmentCode, '01');
  assert.equal(payload.totalOffers, 24);
  assert.equal(payload.totalOpenings, 324);
  assert.equal(payload.offers.length, 20);
  assert.equal(payload.offers[0].title, 'Offre 25');
  assert.equal(payload.offers.some((offer) => offer.title === 'Offre 1'), false);
});


test('buildRecentDateCandidates returns newest dates first for snapshot fallback', () => {
  assert.equal(typeof publicOffers.buildRecentDateCandidates, 'function');

  assert.deepEqual(
    publicOffers.buildRecentDateCandidates('2026-10-04', 3),
    ['2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01']
  );
});


test('sanitizePublicOffer rejects non-http application links', () => {
  const result = publicOffers.sanitizePublicOffer({
    title: 'Offre test',
    openingCount: 1,
    locationQuality: 'in_department',
    applyUrl: 'javascript:alert(1)',
  });

  assert.equal(result.applyUrl, null);
});
