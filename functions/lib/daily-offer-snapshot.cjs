const { createHash } = require('node:crypto');

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function toPositiveNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeDepartmentCode(value) {
  const code = cleanText(value)?.toUpperCase() || '';
  if (/^\d$/.test(code)) return `0${code}`;
  if (/^(?:\d{2}|2A|2B|97[1-6])$/.test(code)) return code;
  return null;
}

function parseAddressText(value) {
  const address = cleanText(value);

  if (!address) {
    return {
      postalCode: null,
      city: null,
    };
  }

  const match = address.match(/\b(\d{5})\b\s*(.*)$/);

  if (!match) {
    return {
      postalCode: null,
      city: null,
    };
  }

  return {
    postalCode: cleanText(match[1]),
    city: cleanText(match[2]),
  };
}

function departmentFromPostalCode(value) {
  const postalCode = cleanText(value);
  if (!postalCode) return null;

  const compact = postalCode.toUpperCase().replace(/\s+/g, '');

  if (/^97[1-6]\d{2}$/.test(compact)) {
    return compact.slice(0, 3);
  }

  if (/^20\d{3}$/.test(compact)) {
    const numeric = Number(compact);
    if (numeric >= 20000 && numeric <= 20199) return '2A';
    if (numeric >= 20200 && numeric <= 20699) return '2B';
    return null;
  }

  if (/^\d{5}$/.test(compact)) {
    return compact.slice(0, 2);
  }

  return null;
}

function normalizeRomeCodes(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => cleanText(value)?.toUpperCase() || '')
        .filter((value) => /^[A-Z][0-9]{4}$/.test(value))
    )
  ).sort((a, b) => a.localeCompare(b, 'fr'));
}

function sectorFromRomeCodes(romeCodes) {
  const first = normalizeRomeCodes(romeCodes)[0] || '';
  const families = {
    A: ['agriculture', 'Agriculture / pêche / espaces naturels'],
    B: ['arts_faconnage', 'Arts / façonnage / artisanat'],
    C: ['banque_assurance', 'Banque / assurance / immobilier'],
    D: ['commerce_vente', 'Commerce / vente'],
    E: ['numerique_information', 'Communication / média / numérique'],
    F: ['construction_btp', 'Construction / BTP'],
    G: ['restauration_tourisme_loisirs', 'Hôtellerie / restauration / tourisme'],
    H: ['industrie', 'Industrie / production'],
    I: ['installation_maintenance', 'Installation / maintenance'],
    J: ['sante', 'Santé / soins'],
    K: ['services_personne', 'Services à la personne / collectivité'],
    L: ['spectacle', 'Spectacle / culture'],
    M: ['services_entreprises', 'Services aux entreprises'],
    N: ['transport_logistique', 'Transport / logistique'],
  };

  const family = families[first.slice(0, 1)];
  return family
    ? { sectorCode: family[0], sectorLabel: family[1] }
    : { sectorCode: 'inconnu', sectorLabel: 'Inconnu' };
}

function stableOfferDocId(value) {
  return createHash('sha256')
    .update(String(value || ''))
    .digest('hex');
}

function buildOccupationOfferSnapshot(
  observation = {},
  { runId, targetDate, departmentCode } = {}
) {
  const normalizedDepartment = normalizeDepartmentCode(
    departmentCode || observation.departmentCode
  );

  if (!normalizedDepartment) {
    throw new Error(`Invalid snapshot department code: ${departmentCode}`);
  }

  const normalizedRunId = cleanText(runId);
  if (!normalizedRunId) {
    throw new Error('Snapshot runId is required');
  }

  const date = cleanText(targetDate || observation.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    throw new Error(`Invalid snapshot date: ${date}`);
  }

  const offerId = cleanText(
    observation.offerId ||
    observation.offerDocId ||
    observation.partnerJobId
  );

  if (!offerId) {
    throw new Error('Snapshot offerId is required');
  }

  const parsedAddress = parseAddressText(
    observation.workplaceAddress ||
    observation.address
  );

  const postalCode = cleanText(
    observation.postalCode ||
    observation.workplaceZipcode ||
    parsedAddress.postalCode
  );
  const city = cleanText(
    observation.city ||
    observation.workplaceCity ||
    parsedAddress.city
  );

  const effectiveDepartmentCode =
    normalizeDepartmentCode(observation.effectiveDepartmentCode) ||
    departmentFromPostalCode(postalCode);

  const isInRequestedDepartment = effectiveDepartmentCode
    ? effectiveDepartmentCode === normalizedDepartment
    : null;

  const locationQuality = effectiveDepartmentCode
    ? isInRequestedDepartment
      ? 'in_department'
      : 'out_of_department'
    : 'unknown_postal_code';

  const romeCodes = normalizeRomeCodes(observation.romeCodes);
  const sector = observation.sectorCode || observation.sectorLabel
    ? {
        sectorCode: cleanText(observation.sectorCode) || 'inconnu',
        sectorLabel: cleanText(observation.sectorLabel) || 'Inconnu',
      }
    : sectorFromRomeCodes(romeCodes);

  return {
    runId: normalizedRunId,
    date,
    departmentCode: normalizedDepartment,
    offerDocId: stableOfferDocId(offerId),

    partnerLabel: cleanText(observation.partnerLabel),
    partnerJobId: cleanText(observation.partnerJobId),
    lbaId: cleanText(observation.lbaId),

    title: cleanText(observation.title),
    status: cleanText(observation.status) || 'Active',
    openingCount: toPositiveNumber(observation.openingCount, 1),
    romeCodes,

    publicationCreationDate: cleanText(
      observation.publicationCreationDate ||
      observation.creationDate
    ),
    publicationExpirationDate: cleanText(
      observation.publicationExpirationDate ||
      observation.expirationDate
    ),
    contractStartDate: cleanText(observation.contractStartDate),
    contractTypes: Array.isArray(observation.contractTypes)
      ? observation.contractTypes.map(cleanText).filter(Boolean)
      : [],

    companyName: cleanText(
      observation.companyName ||
      observation.workplaceName
    ),
    companyLegalName: cleanText(
      observation.companyLegalName ||
      observation.workplaceLegalName
    ),
    siret: cleanText(
      observation.siret ||
      observation.workplaceSiret
    ),

    city,
    postalCode,
    effectiveDepartmentCode,
    locationQuality,
    isInRequestedDepartment,

    nafCode: cleanText(observation.nafCode),
    nafLabel: cleanText(observation.nafLabel),
    sectorCode: sector.sectorCode,
    sectorLabel: sector.sectorLabel,
    opco: cleanText(observation.opco),
    idcc: cleanText(observation.idcc),

    applyUrl: cleanText(observation.applyUrl),
    source: 'api-apprentissage-job-v1-search',
    schemaVersion: 'dailyOfferSnapshot.offer.v1',
  };
}

function dedupeOccupationOffers(offers = []) {
  const unique = new Map();

  for (const offer of Array.isArray(offers) ? offers : []) {
    const key = cleanText(offer?.offerDocId);
    if (!key) continue;

    const current = unique.get(key);
    if (!current) {
      unique.set(key, {
        ...offer,
        romeCodes: normalizeRomeCodes(offer?.romeCodes),
      });
      continue;
    }

    const currentOpenings = toPositiveNumber(current.openingCount, 1);
    const candidateOpenings = toPositiveNumber(offer?.openingCount, 1);
    const preferred =
      candidateOpenings > currentOpenings ? offer : current;

    unique.set(key, {
      ...preferred,
      openingCount: Math.max(currentOpenings, candidateOpenings),
      romeCodes: normalizeRomeCodes([
        ...(Array.isArray(current.romeCodes) ? current.romeCodes : []),
        ...(Array.isArray(offer?.romeCodes) ? offer.romeCodes : []),
      ]),
    });
  }

  return Array.from(unique.values())
    .sort((a, b) => String(a.offerDocId).localeCompare(String(b.offerDocId)));
}

function applyHistoricalLocationRecovery(
  observation = {},
  recoveredLocation = null
) {
  const recovered = recoveredLocation && typeof recoveredLocation === 'object'
    ? recoveredLocation
    : null;

  if (!recovered) {
    return {
      ...observation,
      locationRecoverySource: null,
    };
  }

  return {
    ...observation,
    workplaceDepartment:
      cleanText(recovered.departmentCode) ||
      observation.workplaceDepartment ||
      null,
    workplaceZipcode:
      cleanText(recovered.postalCode) ||
      observation.workplaceZipcode ||
      null,
    workplaceCity:
      cleanText(recovered.city) ||
      observation.workplaceCity ||
      null,
    locationRecoverySource:
      cleanText(recovered.source) || null,
  };
}

function evaluateHistoricalRecoveryQuality(
  { total = 0, resolved = 0 } = {},
  minimumRecoveryRate = 0.95
) {
  const normalizedTotal = Math.max(0, Number(total) || 0);
  const normalizedResolved = Math.min(
    normalizedTotal,
    Math.max(0, Number(resolved) || 0)
  );
  const normalizedMinimum = Math.min(
    1,
    Math.max(0, Number(minimumRecoveryRate) || 0)
  );
  const unresolved = normalizedTotal - normalizedResolved;
  const recoveryRate = normalizedTotal > 0
    ? Number((normalizedResolved / normalizedTotal).toFixed(4))
    : 0;

  return {
    total: normalizedTotal,
    resolved: normalizedResolved,
    unresolved,
    recoveryRate,
    minimumRecoveryRate: normalizedMinimum,
    eligible:
      normalizedTotal > 0 &&
      recoveryRate >= normalizedMinimum,
  };
}

function buildHistoricalDepartmentSnapshot(
  observations = [],
  { runId, targetDate, departmentCode } = {}
) {
  const offers = dedupeOccupationOffers(
    (Array.isArray(observations) ? observations : [])
      .filter(
        (observation) =>
          cleanText(observation?.partnerLabel) !== 'recruteurs_lba'
      )
      .map((observation) =>
        buildOccupationOfferSnapshot(observation, {
          runId,
          targetDate,
          departmentCode,
        })
      )
  );

  return {
    offers,
    summary: buildOccupationOfferSummary(offers),
    strictSummary: buildOccupationOfferSummary(
      offers.filter(
        (offer) => offer.locationQuality === 'in_department'
      )
    ),
  };
}

function addStat(map, key, label, openingCount) {
  const normalizedKey = cleanText(key);
  if (!normalizedKey) return;

  if (!map.has(normalizedKey)) {
    map.set(normalizedKey, {
      code: normalizedKey,
      label: cleanText(label) || normalizedKey,
      offers: 0,
      openings: 0,
    });
  }

  const item = map.get(normalizedKey);
  item.offers += 1;
  item.openings += toPositiveNumber(openingCount, 1);
}

function sortedStats(map, limit = 120) {
  return Array.from(map.values())
    .sort((a, b) =>
      b.openings - a.openings ||
      b.offers - a.offers ||
      String(a.label).localeCompare(String(b.label), 'fr')
    )
    .slice(0, limit);
}

function buildOccupationOfferSummary(offers = []) {
  const rows = Array.isArray(offers) ? offers : [];
  const byRome = new Map();
  const bySector = new Map();
  const byNaf = new Map();
  const byPartner = new Map();
  const byCommune = new Map();

  const locationQuality = {
    inDepartment: { offers: 0, openings: 0 },
    outOfDepartment: { offers: 0, openings: 0 },
    unknownPostalCode: { offers: 0, openings: 0 },
  };

  let totalOpenings = 0;

  for (const offer of rows) {
    const openings = toPositiveNumber(offer?.openingCount, 1);
    totalOpenings += openings;

    const locationBucket =
      offer?.locationQuality === 'in_department'
        ? locationQuality.inDepartment
        : offer?.locationQuality === 'out_of_department'
          ? locationQuality.outOfDepartment
          : locationQuality.unknownPostalCode;

    locationBucket.offers += 1;
    locationBucket.openings += openings;

    for (const romeCode of normalizeRomeCodes(offer?.romeCodes)) {
      addStat(byRome, romeCode, romeCode, openings);
    }

    addStat(bySector, offer?.sectorCode, offer?.sectorLabel, openings);
    addStat(byNaf, offer?.nafCode, offer?.nafLabel || offer?.nafCode, openings);
    addStat(byPartner, offer?.partnerLabel, offer?.partnerLabel, openings);
    addStat(byCommune, offer?.city || offer?.postalCode, offer?.city || offer?.postalCode, openings);
  }

  return {
    totalOffers: rows.length,
    totalOpenings,
    locationQuality,
    byRome: sortedStats(byRome),
    bySector: sortedStats(bySector, 80),
    byNaf: sortedStats(byNaf),
    byPartner: sortedStats(byPartner, 40),
    byCommune: sortedStats(byCommune),
  };
}

module.exports = {
  buildOccupationOfferSnapshot,
  dedupeOccupationOffers,
  buildOccupationOfferSummary,
  buildHistoricalDepartmentSnapshot,
  applyHistoricalLocationRecovery,
  evaluateHistoricalRecoveryQuality,
};
