'use strict';

// Prototype de reconciliation en lecture seule. Aucun SDK Firebase, aucun I/O.
// La publication (et les operations de rattrapage) sont volontairement separees.
// Voir issue #101: ne pas modifier retrospectivement les instantanes historiques.

const { createHash } = require('node:crypto');
const { buildOccupationOfferSnapshot } = require('./daily-offer-snapshot.cjs');

const VALID_DEPARTMENTS = new Set([
  ...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0'))
    .filter((code) => code !== '20'),
  '2A', '2B', '971', '972', '973', '974', '976',
]);
const ROME = /^[A-Z][0-9]{4}$/;
const POSTAL = /^[0-9]{5}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || null : null;
}

function departmentFromPostalCode(raw) {
  const postal = text(raw);
  if (!postal || !POSTAL.test(postal)) return null;
  if (/^97[1-6]\d{2}$/.test(postal)) {
    const code = postal.slice(0, 3);
    return VALID_DEPARTMENTS.has(code) ? code : null;
  }
  if (/^20\d{3}$/.test(postal)) {
    const code = Number(postal);
    if (code >= 20000 && code <= 20199) return '2A';
    if (code >= 20200 && code <= 20699) return '2B';
    return null;
  }
  const code = postal.slice(0, 2);
  return VALID_DEPARTMENTS.has(code) ? code : null;
}

/**
 * Le format LBA constate au 09/10/2026 utilise surtout un texte d'adresse
 * "38 RUE ... 72000 LE MANS" et un geopoint. Ne jamais inventer une commune INSEE.
 * Un lieu extrait du texte reste non verifie BAN.
 */
function normalizeLbaAddress(location = {}) {
  const loc = location && typeof location === 'object' ? location : {};
  const address = text(loc.address);
  const explicitCity = text(loc.city);
  const directPostal = [loc.zipcode, loc.postal_code, loc.postcode]
    .map(text).find((candidate) => candidate && POSTAL.test(candidate)) || null;

  let parsedPostal = null;
  let parsedCity = null;
  let ambiguousPostal = false;

  if (address) {
    const matches = [...address.matchAll(/\b(\d{5})\b/g)].map((part) => part[1]);
    const distinct = new Set(matches);
    ambiguousPostal = distinct.size > 1;
    if (distinct.size === 1) {
      parsedPostal = matches[0];
      const pattern = new RegExp('\\b' + parsedPostal + '\\b\\s+(.+)$', 'u');
      const found = address.match(pattern);
      const suffix = found ? text(found[1]) : null;
      // CEDEX + chiffres, complements de boite et mentions de pays
      // ne doivent pas etre traites comme une ville certaine.
      if (suffix && /^[\p{L}][\p{L}\s'.()\-]{1,100}$/u.test(suffix) &&
        !/\b(?:CEDEX|BP|BOITE POSTALE|FRANCE)\b/i.test(suffix)) {
        parsedCity = suffix;
      }
    }
  }

  const postalCode = directPostal || (!ambiguousPostal ? parsedPostal : null);
  const city = explicitCity || (!ambiguousPostal ? parsedCity : null);
  const departmentCode = departmentFromPostalCode(postalCode);

  const conflicts = [];
  if (directPostal && parsedPostal && directPostal !== parsedPostal) {
    conflicts.push('postalCode');
  }
  if (explicitCity && parsedCity &&
    explicitCity.toLocaleUpperCase('fr-FR') !== parsedCity.toLocaleUpperCase('fr-FR')) {
    conflicts.push('city');
  }
  if (ambiguousPostal) conflicts.push('address_multiple_postal_codes');

  return {
    postalCode,
    city,
    departmentCode,
    cityInseeCode: null,
    quality: conflicts.length ? 'needs_review'
      : city && postalCode ? (explicitCity && directPostal ? 'explicit_unverified' : 'parsed_unverified')
        : postalCode ? 'postal_only' : 'unresolved',
    origin: city || postalCode ? (explicitCity || directPostal ? 'lba_structured_fields' : 'lba_address_text') : null,
    banVerified: false,
    conflicts,
  };
}

function isoParisDate(iso) {
  if (!text(iso)) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function stableExportIdentity(job = {}) {
  const identifier = job?.identifier || {};
  const source = text(identifier.partner_label);
  if (!source || source === 'recruteurs_lba') return null;
  const id = text(identifier.id);
  const partnerId = text(identifier.partner_job_id);
  if (!id && !partnerId) return null;
  const rawId = id || source + ':' + partnerId;
  return {
    source, partnerId,
    offerDocId: createHash('sha256').update(rawId).digest('hex'),
    // rawId reste prive; ne doit jamais figurer dans des logs ou rapports.
  };
}

function normalizeExportOffer(job, { snapshotDate, runId } = {}) {
  if (!DATE.test(String(snapshotDate || '')) || !text(runId)) {
    throw new Error('snapshotDate et runId requis');
  }
  const identity = stableExportIdentity(job);
  if (!identity) return { eligible: false, reason: 'invalid_or_recruiter_identity' };
  const location = normalizeLbaAddress(job?.workplace?.location);
  if (!location.departmentCode) {
    return { eligible: false, reason: 'location_not_territorially_verified',
      quality: location.quality, identity };
  }
  if (location.conflicts.length) {
    return { eligible: false, reason: 'ambiguous_location', identity };
  }

  const offer = job?.offer || {};
  const work = job?.workplace || {};
  const pub = offer.publication || {};
  const domain = work.domain || {};
  const naf = domain.naf && typeof domain.naf === 'object' ? domain.naf : {};
  const contract = job?.contract || {};
  const created = isoParisDate(pub.creation);
  const expired = isoParisDate(pub.expiration);
  const romes = Array.isArray(offer.rome_codes)
    ? offer.rome_codes.map((c) => text(c)?.toUpperCase()).filter((c) => c && ROME.test(c))
    : [];

  const projected = buildOccupationOfferSnapshot({
    offerId: text(job?.identifier?.id) ||
      identity.source + ':' + identity.partnerId,
    partnerLabel: identity.source,
    partnerJobId: identity.partnerId,
    lbaId: text(job?.identifier?.id),
    title: text(offer.title),
    status: text(offer.status) || 'Active',
    openingCount: offer.opening_count,
    romeCodes: romes,
    creationDate: created,
    expirationDate: expired,
    workplaceName: text(work.name),
    workplaceLegalName: text(work.legal_name),
    workplaceSiret: text(work.siret),
    workplaceCity: location.city,
    workplaceZipcode: location.postalCode,
    nafCode: text(naf.code),
    nafLabel: text(naf.label),
    opco: text(domain.opco),
    idcc: text(domain.idcc),
    contractStartDate: text(contract.start)?.slice(0, 10),
    contractTypes: Array.isArray(contract.type)
      ? contract.type : contract.type ? [contract.type] : [],
    applyUrl: text(job?.apply?.url),
  }, { snapshotDate, targetDate: snapshotDate, runId, departmentCode: location.departmentCode });

  return {
    eligible: true,
    identity,
    location,
    publicationCreationDate: created,
    projected: {
      ...projected,
      source: 'api-apprentissage-job-v1-export',
      schemaVersion: 'dailyOfferSnapshot.offer.v1',
      locationNormalization: {
        origin: location.origin,
        quality: location.quality,
        banVerified: false,
      },
    },
  };
}

function empty(value) {
  return value === null || value === undefined || value === '' ||
    (Array.isArray(value) && value.length === 0) || value === 'inconnu';
}

// Champs que l'export peut completer. Ne jamais toucher a offerDocId,
// runId, date, departmentCode, firstObservedAt et publicationCreationDate existante.
const ENRICHABLE_FIELDS = [
  'title', 'romeCodes', 'city', 'postalCode', 'effectiveDepartmentCode',
  'nafCode', 'nafLabel', 'companyName', 'companyLegalName', 'siret',
  'sectorCode', 'sectorLabel', 'opco', 'idcc', 'applyUrl',
  'contractTypes', 'contractStartDate', 'publicationExpirationDate',
  'publicationCreationDate', 'partnerJobId', 'lbaId',
];

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLocaleUpperCase('fr-FR') === b.trim().toLocaleUpperCase('fr-FR');
  }
  return a === b;
}

function patchExistingOffer(existing, normalized) {
  if (!existing || !normalized?.eligible) {
    throw new Error('Existing offer and eligible normalized export offer required');
  }
  if (existing.offerDocId !== normalized.projected.offerDocId) {
    throw new Error('Refus de reconciliation de deux identifiants differents');
  }
  const patch = {};
  const conflicts = [];
  const candidate = normalized.projected;
  for (const field of ENRICHABLE_FIELDS) {
    if (empty(candidate[field])) continue;
    if (empty(existing[field])) {
      patch[field] = candidate[field];
    } else if (!sameValue(existing[field], candidate[field])) {
      conflicts.push(field);
    }
  }
  // Ne promouvoir une localisation inconnue qu'en respectant le departement.
  const effectiveDept = patch.effectiveDepartmentCode ||
    existing.effectiveDepartmentCode || null;
  if ((!existing.locationQuality || existing.locationQuality === 'unknown_postal_code') &&
    effectiveDept && effectiveDept === existing.departmentCode) {
    patch.locationQuality = 'in_department';
    patch.isInRequestedDepartment = true;
  }
  if (Object.keys(patch).some((key) => [
    'city', 'postalCode', 'effectiveDepartmentCode'].includes(key))) {
    patch.locationNormalization = {
      origin: normalized.location.origin,
      quality: normalized.location.quality,
      banVerified: false,
    };
  }
  return {
    changed: Object.keys(patch).length > 0,
    patch,
    conflicts,
    // Champ openingCount existant : signaler un changement, sans le
    // substituer par un autre comptage en cours d'historique.
    openingCountChanged: !sameValue(existing.openingCount, candidate.openingCount),
  };
}

function planReconciliation({ exportOffers = [], existingOffers = [], snapshotDate,
  exportObservationDate, runId = 'dry_run' } = {}) {
  if (!DATE.test(String(snapshotDate || '')) || !DATE.test(String(exportObservationDate || ''))) {
    throw new Error('snapshotDate / exportObservationDate invalides');
  }
  const existingById = new Map();
  for (const row of existingOffers) {
    if (row?.offerDocId && !existingById.has(row.offerDocId)) {
      existingById.set(row.offerDocId, row);
    }
  }
  const processed = new Set();
  const conflicts = {};
  const counts = {
    examined: 0, unique: 0, match: 0, enriched: 0,
    existingUnchanged: 0, candidateAdditions: 0,
    quarantinedLocation: 0, invalidIdentity: 0,
    duplicatesWithinExport: 0, createdAfterSnapshot: 0,
    departmentConflicts: 0, openingCountConflicts: 0, fieldConflicts: 0,
  };
  // Un export du lendemain ne peut pas etre publie comme historique de la veille.
  const canPromote = snapshotDate === exportObservationDate;

  for (const job of exportOffers) {
    counts.examined++;
    const result = normalizeExportOffer(job, { snapshotDate, runId });
    if (!result.eligible) {
      if (result.reason === 'invalid_or_recruiter_identity') counts.invalidIdentity++;
      else counts.quarantinedLocation++;
      continue;
    }
    const candidate = result.projected;
    if (processed.has(candidate.offerDocId)) {
      counts.duplicatesWithinExport++;
      continue;
    }
    processed.add(candidate.offerDocId);
    counts.unique++;
    if (result.publicationCreationDate && result.publicationCreationDate > snapshotDate) {
      counts.createdAfterSnapshot++;
      continue;
    }
    const previous = existingById.get(candidate.offerDocId);
    if (!previous) {
      counts.candidateAdditions++;
      continue;
    }
    counts.match++;
    if (previous.departmentCode !== candidate.departmentCode) {
      counts.departmentConflicts++;
      continue;
    }
    const enrichment = patchExistingOffer(previous, result);
    if (enrichment.changed) counts.enriched++;
    else counts.existingUnchanged++;
    if (enrichment.openingCountChanged) counts.openingCountConflicts++;
    for (const field of enrichment.conflicts) {
      conflicts[field] = (conflicts[field] || 0) + 1;
      counts.fieldConflicts++;
    }
  }
  return {
    snapshotDate, exportObservationDate, canPromote,
    counts, conflicts,
    status: canPromote ? 'dry_run_only_pending_validation' :
      'historical_reference_only_no_writes',
  };
}

module.exports = {
  departmentFromPostalCode,
  normalizeLbaAddress,
  isoParisDate,
  stableExportIdentity,
  normalizeExportOffer,
  patchExistingOffer,
  planReconciliation,
};
