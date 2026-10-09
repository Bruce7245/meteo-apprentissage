'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  departmentFromPostalCode, normalizeLbaAddress, isoParisDate,
  stableExportIdentity, normalizeExportOffer, patchExistingOffer,
  planReconciliation,
} = require('../lib/lba-export-reconciliation.cjs');

function job({
  id = 'lba-demo-id', source = 'France Travail', partnerId = 'offre-1',
  address = '38 RUE DES MINIMES 72000 LE MANS', rome = 'D1102',
  creation = '2026-10-08T12:00:00.000Z', opening = 1,
} = {}) {
  return {
    identifier: { id, partner_label: source, partner_job_id: partnerId },
    offer: {
      title: 'Boulangerie', status: 'Active', opening_count: opening,
      rome_codes: [rome],
      publication: { creation, expiration: '2026-11-08T18:00:00.000Z' },
    },
    workplace: {
      name: 'Entreprise exemple',
      location: { address },
      domain: { naf: { code: '1071C', label: 'Boulangerie' } },
    },
    contract: { type: ['Apprentissage'], start: '2026-11-01' },
  };
}

test('Ville et CP : extraction du format adresse textuelle LBA', () => {
  const loc = normalizeLbaAddress({
    address: '38 RUE DES MINIMES 72000 LE MANS',
    geopoint: { coordinates: [0.2, 48], type: 'Point' },
  });
  assert.equal(loc.postalCode, '72000');
  assert.equal(loc.city, 'LE MANS');
  assert.equal(loc.departmentCode, '72');
  assert.equal(loc.quality, 'parsed_unverified');
  assert.equal(loc.banVerified, false);
  assert.equal(loc.cityInseeCode, null);
});

test('DROM, Corse, Francilien : departements valides', () => {
  for (const [postal, expected] of [
    ['75005', '75'], ['20190', '2A'], ['20200', '2B'],
    ['97410', '974'], ['97110', '971'], ['97300', '973'],
    ['97600', '976'], ['97000', null], ['97500', null],
    ['99000', null], ['not postal', null],
  ]) {
    assert.equal(departmentFromPostalCode(postal), expected, postal);
  }
});

test('CEDEX : ne pas transformer le complement en commune certifiee', () => {
  const loc = normalizeLbaAddress({ address: '79000 NIORT CEDEX 9' });
  assert.equal(loc.postalCode, '79000');
  assert.equal(loc.city, null);
  assert.equal(loc.quality, 'postal_only');
});

test('Adresse vide ou postale multiple : rester prudent', () => {
  const missing = normalizeLbaAddress({});
  assert.equal(missing.quality, 'unresolved');
  const ambiguous = normalizeLbaAddress({
    address: '75001 PARIS / 69001 LYON',
  });
  assert.equal(ambiguous.quality, 'needs_review');
  assert.equal(ambiguous.departmentCode, null);
  assert.ok(ambiguous.conflicts.includes('address_multiple_postal_codes'));
});

test('Contradiction du code postal explicite et du texte : revue requise', () => {
  const loc = normalizeLbaAddress({
    zipcode: '75001', city: 'Paris', address: '69001 LYON',
  });
  assert.equal(loc.quality, 'needs_review');
  assert.deepEqual(loc.conflicts.sort(), ['city', 'postalCode']);
  assert.equal(normalizeExportOffer(job({ address: '69001 LYON' }), {
    snapshotDate: '2026-10-09', runId: 'run-9',
  }).eligible, true);
});

test('Identifiant durable : SHA256 compatible avec import historique', () => {
  const src = job({ id: null });
  const identity = stableExportIdentity(src);
  assert.equal(identity.offerDocId,
    createHash('sha256').update('France Travail:offre-1').digest('hex'));
  assert.equal(identity.source, 'France Travail');
  assert.equal(stableExportIdentity(job({ id: null, partnerId: null })), null);
  assert.equal(stableExportIdentity(job({ source: 'recruteurs_lba' })), null);
});

test('Projection : meme schema de snapshot et ROME valides', () => {
  const result = normalizeExportOffer(job(), {
    snapshotDate: '2026-10-09', runId: 'export_run_9',
  });
  assert.equal(result.eligible, true);
  assert.equal(result.projected.runId, 'export_run_9');
  assert.equal(result.projected.date, '2026-10-09');
  assert.equal(result.projected.departmentCode, '72');
  assert.equal(result.projected.effectiveDepartmentCode, '72');
  assert.equal(result.projected.locationQuality, 'in_department');
  assert.deepEqual(result.projected.romeCodes, ['D1102']);
  assert.equal(result.projected.city, 'LE MANS');
  assert.equal(result.projected.postalCode, '72000');
  assert.equal(result.projected.publicationCreationDate, '2026-10-08');
  assert.equal(result.projected.companyName, 'Entreprise exemple');
  assert.equal(result.projected.locationNormalization.banVerified, false);
  assert.equal(result.projected.source, 'api-apprentissage-job-v1-export');
});

test('Projection : rejette geo non localisable sans inventer un departement', () => {
  const candidate = normalizeExportOffer(job({ address: 'SANS CODE POSTAL' }), {
    snapshotDate: '2026-10-09', runId: 'run-9',
  });
  assert.equal(candidate.eligible, false);
  assert.equal(candidate.reason, 'location_not_territorially_verified');
});

test('Date Paris : passage UTC vers fuseau local sans ambiguite', () => {
  assert.equal(isoParisDate('2026-10-08T21:59:00Z'), '2026-10-08');
  assert.equal(isoParisDate('2026-10-08T22:30:00Z'), '2026-10-09');
});

test('Enrichissement : remplit les trous, ne modifie pas l identite', () => {
  const result = normalizeExportOffer(job(), {
    snapshotDate: '2026-10-09', runId: 'test-run',
  });
  const existing = {
    offerDocId: result.projected.offerDocId,
    runId: 'historical-run',
    date: '2026-10-09', departmentCode: '72',
    firstObservedAt: '2026-10-08T23:00:00Z',
    partnerLabel: 'France Travail',
    city: null, postalCode: null, effectiveDepartmentCode: null,
    locationQuality: 'unknown_postal_code',
    romeCodes: [], publicationCreationDate: '2026-10-06',
    openingCount: 1, title: 'Boulangerie',
  };
  const patch = patchExistingOffer(existing, result);
  assert.equal(patch.changed, true);
  assert.equal(patch.patch.city, 'LE MANS');
  assert.equal(patch.patch.postalCode, '72000');
  assert.equal(patch.patch.locationQuality, 'in_department');
  assert.deepEqual(patch.patch.romeCodes, ['D1102']);
  assert.equal('runId' in patch.patch, false);
  assert.equal('date' in patch.patch, false);
  assert.equal('firstObservedAt' in patch.patch, false);
  assert.equal('publicationCreationDate' in patch.patch, false);
  assert.deepEqual(patch.conflicts.includes('publicationCreationDate'), true);
  assert.equal(existing.city, null);
});

test('Conflit sur une localisation deja fiable : aucun ecrasement', () => {
  const result = normalizeExportOffer(job(), {
    snapshotDate: '2026-10-09', runId: 'test-run',
  });
  const existing = {
    offerDocId: result.projected.offerDocId,
    date: '2026-10-09', departmentCode: '72',
    city: 'La Flèche', postalCode: '72200', effectiveDepartmentCode: '72',
    locationQuality: 'in_department', openingCount: 2,
  };
  const patch = patchExistingOffer(existing, result);
  assert.equal(patch.patch.city, undefined);
  assert.equal(patch.patch.postalCode, undefined);
  assert.ok(patch.conflicts.includes('city'));
  assert.ok(patch.conflicts.includes('postalCode'));
  assert.equal(patch.openingCountChanged, true);
});

test('Refuse la fusion de deux identifiants differents', () => {
  const result = normalizeExportOffer(job(), {
    snapshotDate: '2026-10-09', runId: 'test-run',
  });
  assert.throws(() => patchExistingOffer({ offerDocId: 'autre' }, result),
    /identifiants differents/);
});

test('Plan : doublon export, nouveau, existant, non localisable', () => {
  const first = job({ id: 'a' });
  const second = job({ id: 'b', address: '75001 PARIS', rome: 'M1805' });
  const bad = job({ id: 'c', address: 'SANS ADRESSE' });
  const projected = normalizeExportOffer(first, {
    snapshotDate: '2026-10-09', runId: 'a',
  }).projected;
  const plan = planReconciliation({
    snapshotDate: '2026-10-09',
    exportObservationDate: '2026-10-09',
    exportOffers: [first, first, second, bad],
    existingOffers: [projected],
  });
  assert.equal(plan.canPromote, true);
  assert.equal(plan.counts.match, 1);
  assert.equal(plan.counts.candidateAdditions, 1);
  assert.equal(plan.counts.duplicatesWithinExport, 1);
  assert.equal(plan.counts.quarantinedLocation, 1);
});

test('Plan : ne promeut jamais comme historique un export du lendemain', () => {
  const plan = planReconciliation({
    snapshotDate: '2026-10-08',
    exportObservationDate: '2026-10-09',
    exportOffers: [job({id: 'n1'})],
    existingOffers: [],
  });
  assert.equal(plan.canPromote, false);
  assert.equal(plan.status, 'historical_reference_only_no_writes');
});

test('Plan : aucune annonce creee apres la date du snapshot ne passe', () => {
  const plan = planReconciliation({
    snapshotDate: '2026-10-08',
    exportObservationDate: '2026-10-08',
    exportOffers: [job({ creation: '2026-10-09T12:00:00Z' })],
  });
  assert.equal(plan.counts.createdAfterSnapshot, 1);
  assert.equal(plan.counts.candidateAdditions, 0);
});
