const {
  normalizeDepartmentCode,
} = require('./insee-population.cjs');
const {
  normalizeRomeCode,
  normalizeOccupationSearchText,
} = require('./occupation-search.cjs');

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeDateOnly(value) {
  if (!value) return null;

  const text = String(value).slice(0, 10);
  const date = new Date(`${text}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : text;
}

function offerKey(offer, index) {
  const explicit = cleanText(
    offer?.offerDocId ||
    offer?.partnerJobId ||
    offer?.lbaId ||
    offer?.id
  );

  if (explicit) return explicit;

  return [
    cleanText(offer?.title),
    cleanText(offer?.siret),
    cleanText(offer?.companyName),
    cleanText(offer?.city),
    cleanText(offer?.publicationCreationDate),
    index,
  ].join('|');
}

function employerKey(offer) {
  const siret = cleanText(offer?.siret);
  if (siret) return `siret:${siret}`;

  const name = normalizeOccupationSearchText(
    offer?.companyLegalName ||
    offer?.companyName
  );

  return name ? `name:${name}` : null;
}

function formationKey(formation, index) {
  const formationId = cleanText(
    formation?.formationId ||
    formation?.id
  );

  if (formationId) return `id:${formationId}`;

  const rncp = cleanText(formation?.rncp).toUpperCase();
  if (rncp) return `rncp:${rncp}`;

  const title = normalizeOccupationSearchText(
    formation?.intitule ||
    formation?.title ||
    formation?.label
  );

  return title ? `title:${title}` : `anonymous:${index}`;
}

function sessionKey(session, index) {
  return [
    normalizeDateOnly(
      session?.debut ||
      session?.startDate ||
      session?.dateDebut
    ) || '',
    normalizeDateOnly(
      session?.fin ||
      session?.endDate ||
      session?.dateFin
    ) || '',
    cleanText(session?.id),
    index,
  ].join('|');
}

function aggregateOccupationContext({
  departmentCode,
  romeCode,
  asOfDate = null,
  offers = [],
  formations = [],
  population = null,
} = {}) {
  const department = normalizeDepartmentCode(departmentCode);
  const rome = normalizeRomeCode(romeCode);

  if (!department) {
    throw new Error(`Invalid department code: ${departmentCode}`);
  }

  if (!rome) {
    throw new Error(`Invalid ROME code: ${romeCode}`);
  }

  const asOf = normalizeDateOnly(asOfDate);
  const uniqueOffers = new Map();

  (Array.isArray(offers) ? offers : []).forEach((offer, index) => {
    const offerRomeCodes = (Array.isArray(offer?.romeCodes) ? offer.romeCodes : [])
      .map(normalizeRomeCode)
      .filter(Boolean);

    if (!offerRomeCodes.includes(rome)) return;
    if (offer?.locationQuality && offer.locationQuality !== 'in_department') return;

    const effectiveDepartment = normalizeDepartmentCode(
      offer?.effectiveDepartmentCode ||
      offer?.departmentCode ||
      department
    );

    if (effectiveDepartment && effectiveDepartment !== department) return;

    const key = offerKey(offer, index);
    const previous = uniqueOffers.get(key);

    if (
      !previous ||
      toNonNegativeNumber(offer?.openingCount, 1) >
        toNonNegativeNumber(previous?.openingCount, 1)
    ) {
      uniqueOffers.set(key, offer);
    }
  });

  let openingsCount = 0;
  let offersWithEmployer = 0;
  const employerCounts = new Map();
  const nafCodes = new Set();

  for (const offer of uniqueOffers.values()) {
    openingsCount += Math.max(1, toNonNegativeNumber(offer?.openingCount, 1));

    const employer = employerKey(offer);
    if (employer) {
      offersWithEmployer += 1;
      employerCounts.set(employer, (employerCounts.get(employer) || 0) + 1);
    }

    const nafCode = cleanText(offer?.nafCode).toUpperCase();
    if (nafCode) nafCodes.add(nafCode);
  }

  const activeOffersCount = uniqueOffers.size;
  const largestEmployerCount = employerCounts.size > 0
    ? Math.max(...employerCounts.values())
    : 0;

  const employerConcentration = offersWithEmployer > 0
    ? largestEmployerCount / offersWithEmployer
    : null;

  const employerCoverageRatio = activeOffersCount > 0
    ? offersWithEmployer / activeOffersCount
    : null;

  const uniqueFormations = new Map();

  (Array.isArray(formations) ? formations : []).forEach((formation, index) => {
    const formationRomeCodes = (Array.isArray(formation?.romeCodes)
      ? formation.romeCodes
      : [])
      .map(normalizeRomeCode)
      .filter(Boolean);

    if (!formationRomeCodes.includes(rome)) return;

    const venueDepartment = normalizeDepartmentCode(
      formation?.venue?.departmentCode ||
      formation?.departmentCode ||
      formation?.importDepartmentCode ||
      department
    );

    if (venueDepartment && venueDepartment !== department) return;

    const key = formationKey(formation, index);

    if (!uniqueFormations.has(key)) {
      uniqueFormations.set(key, {
        rncp: cleanText(formation?.rncp).toUpperCase() || null,
        sessions: new Map(),
      });
    }

    const group = uniqueFormations.get(key);

    if (!group.rncp && cleanText(formation?.rncp)) {
      group.rncp = cleanText(formation.rncp).toUpperCase();
    }

    const sessions = Array.isArray(formation?.sessions) && formation.sessions.length > 0
      ? formation.sessions
      : formation?.primarySession
        ? [formation.primarySession]
        : [];

    sessions.forEach((session, sessionIndex) => {
      const keySession = sessionKey(session, sessionIndex);
      if (!group.sessions.has(keySession)) {
        group.sessions.set(keySession, session);
      }
    });
  });

  let sessionsCount = 0;
  let upcomingSessionsCount = 0;
  const rncpCodes = new Set();

  for (const formation of uniqueFormations.values()) {
    if (formation.rncp) rncpCodes.add(formation.rncp);

    for (const session of formation.sessions.values()) {
      sessionsCount += 1;

      const startDate = normalizeDateOnly(
        session?.debut ||
        session?.startDate ||
        session?.dateDebut
      );

      if (asOf && startDate && startDate >= asOf) {
        upcomingSessionsCount += 1;
      }
    }
  }

  const populationTotal = Number(population?.populationTotal);
  const population15To29 = Number(population?.population15To29);
  const populationReferenceYear = Number(population?.referenceYear);

  return {
    departmentCode: department,
    romeCode: rome,
    activeOffersCount,
    openingsCount,
    distinctObservedEmployersCount: employerCounts.size,
    distinctObservedNafCount: nafCodes.size,
    employerConcentration,
    employerCoverageRatio,
    formationsCount: uniqueFormations.size,
    sessionsCount,
    upcomingSessionsCount,
    distinctRncpCount: rncpCodes.size,
    populationTotal: Number.isFinite(populationTotal) ? populationTotal : null,
    population15To29: Number.isFinite(population15To29) ? population15To29 : null,
    populationReferenceYear:
      Number.isInteger(populationReferenceYear)
        ? populationReferenceYear
        : null,
  };
}

module.exports = {
  aggregateOccupationContext,
};
