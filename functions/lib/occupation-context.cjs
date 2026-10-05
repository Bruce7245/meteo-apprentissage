const { normalizeRomeCode } = require('./occupation-search.cjs');

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeDepartmentCode(value) {
  const raw = clean(value).toUpperCase();
  if (/^(2A|2B)$/.test(raw)) return raw;
  if (/^97[1-6]$/.test(raw)) return raw;
  if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
  return null;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function offerId(offer, index) {
  return clean(
    offer?.offerId ||
    offer?.id ||
    offer?.partnerJobId ||
    offer?.identifier?.id
  ) || `anonymous:${index}`;
}

function offerRomeCodes(offer) {
  const values = Array.isArray(offer?.romeCodes)
    ? offer.romeCodes
    : Array.isArray(offer?.offer?.rome_codes)
      ? offer.offer.rome_codes
      : [];
  return new Set(values.map(normalizeRomeCode).filter(Boolean));
}

function employerKey(offer) {
  return clean(
    offer?.employerId ||
    offer?.siret ||
    offer?.companySiret ||
    offer?.employer?.siret ||
    offer?.workplace?.siret
  ) || null;
}

function nafCode(offer) {
  return clean(
    offer?.nafCode ||
    offer?.employer?.nafCode ||
    offer?.workplace?.domain?.naf?.code
  ) || null;
}

function formationId(formation, index) {
  return clean(
    formation?.formationId ||
    formation?.id ||
    formation?.cleMinistereEducatif ||
    formation?.cle_ministere_educatif
  ) || clean(formation?.rncp) || `anonymous:${index}`;
}

function formationRomeCodes(formation) {
  return new Set(
    (Array.isArray(formation?.romeCodes) ? formation.romeCodes : [])
      .map(normalizeRomeCode)
      .filter(Boolean)
  );
}

function getSessions(formation) {
  if (Array.isArray(formation?.sessions) && formation.sessions.length) {
    return formation.sessions;
  }
  return formation?.primarySession ? [formation.primarySession] : [];
}

function isUpcomingSession(session, asOfDate) {
  if (!asOfDate) return false;
  const raw = session?.debut || session?.startDate || session?.dateDebut;
  if (!raw) return false;
  const start = new Date(`${String(raw).slice(0, 10)}T00:00:00.000Z`);
  const asOf = new Date(`${asOfDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(asOf.getTime())) return false;
  return start.getTime() >= asOf.getTime();
}

function calculateConcentration(counts) {
  const values = [...counts.values()];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  return values.reduce((sum, value) => sum + (value / total) ** 2, 0);
}


function summarizeStrictOffersByRome(offers) {
  const byRome = new Map();
  const seenOffers = new Set();

  for (const [index, offer] of (Array.isArray(offers) ? offers : []).entries()) {
    if (offer?.locationQuality !== 'in_department') continue;
    const id = offerId(offer, index);
    if (seenOffers.has(id)) continue;
    seenOffers.add(id);

    const openings = Math.max(
      0,
      safeNumber(offer?.openingCount ?? offer?.offer?.opening_count, 0)
    );

    for (const romeCode of offerRomeCodes(offer)) {
      const current = byRome.get(romeCode) || {
        activeOffersCount: 0,
        openingsCount: 0,
      };
      current.activeOffersCount += 1;
      current.openingsCount += openings;
      byRome.set(romeCode, current);
    }
  }

  return byRome;
}

function extractOfferDetailsFromSnapshot(data = {}) {
  for (const candidate of [data.offers, data.activeOffers, data.items]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function aggregateOccupationContext({
  departmentCode,
  romeCode,
  asOfDate = null,
  offerSummary = null,
  offers = [],
  formations = [],
  population = null,
} = {}) {
  const department = normalizeDepartmentCode(departmentCode);
  if (!department) throw new Error(`Invalid department code: ${departmentCode ?? ''}`);

  const rome = normalizeRomeCode(romeCode);
  if (!rome) throw new Error(`Invalid ROME code: ${romeCode ?? ''}`);

  const uniqueOffers = new Map();
  for (const [index, offer] of (Array.isArray(offers) ? offers : []).entries()) {
    if (offer?.locationQuality && offer.locationQuality !== 'in_department') continue;
    if (!offerRomeCodes(offer).has(rome)) continue;
    const key = offerId(offer, index);
    if (!uniqueOffers.has(key)) uniqueOffers.set(key, offer);
  }

  const employerCounts = new Map();
  const nafCodes = new Set();
  let openingsCount = 0;
  let knownEmployerOffersCount = 0;

  for (const offer of uniqueOffers.values()) {
    openingsCount += Math.max(0, safeNumber(offer?.openingCount ?? offer?.offer?.opening_count, 0));

    const employer = employerKey(offer);
    if (employer) {
      knownEmployerOffersCount += 1;
      employerCounts.set(employer, (employerCounts.get(employer) || 0) + 1);
    }

    const naf = nafCode(offer);
    if (naf) nafCodes.add(naf);
  }

  const uniqueFormations = new Map();
  for (const [index, formation] of (Array.isArray(formations) ? formations : []).entries()) {
    if (!formationRomeCodes(formation).has(rome)) continue;
    const key = formationId(formation, index);
    if (!uniqueFormations.has(key)) uniqueFormations.set(key, formation);
  }

  const rncpCodes = new Set();
  let sessionsCount = 0;
  let upcomingSessionsCount = 0;

  for (const formation of uniqueFormations.values()) {
    const rncp = clean(formation?.rncp).toUpperCase();
    if (rncp) rncpCodes.add(rncp);

    const sessions = getSessions(formation);
    sessionsCount += sessions.length;
    upcomingSessionsCount += sessions.filter((session) => isUpcomingSession(session, asOfDate)).length;
  }

  const summaryOffers = offerSummary && offerSummary.activeOffersCount !== null && offerSummary.activeOffersCount !== undefined
    ? Math.max(0, safeNumber(offerSummary.activeOffersCount, 0))
    : null;
  const summaryOpenings = offerSummary && offerSummary.openingsCount !== null && offerSummary.openingsCount !== undefined
    ? Math.max(0, safeNumber(offerSummary.openingsCount, 0))
    : null;
  const activeOffersCount = summaryOffers !== null ? summaryOffers : uniqueOffers.size;
  const hasAnyOfferDetail = uniqueOffers.size > 0;
  const retainedOpeningsCount = summaryOpenings !== null
    ? summaryOpenings
    : hasAnyOfferDetail
      ? openingsCount
      : null;
  const hasPopulation = population && typeof population === 'object';
  const total = Number(population?.populationTotal);
  const youth = Number(population?.population15To29);

  return {
    departmentCode: department,
    romeCode: rome,
    asOfDate: asOfDate || null,
    primaryOfferDataStatus: summaryOffers !== null || hasAnyOfferDetail ? 'available' : 'missing',
    activeOffersCount,
    openingsCount: retainedOpeningsCount,
    distinctObservedEmployersCount: activeOffersCount > 0 && !hasAnyOfferDetail
      ? null
      : employerCounts.size,
    distinctObservedNafCount: activeOffersCount > 0 && !hasAnyOfferDetail
      ? null
      : nafCodes.size,
    knownEmployerOfferCoverage: activeOffersCount > 0 && hasAnyOfferDetail
      ? knownEmployerOffersCount / activeOffersCount
      : null,
    employerConcentration: hasAnyOfferDetail
      ? calculateConcentration(employerCounts)
      : null,
    formationsCount: uniqueFormations.size,
    sessionsCount,
    upcomingSessionsCount,
    distinctRncpCount: rncpCodes.size,
    populationTotal: hasPopulation && Number.isFinite(total) ? total : null,
    population15To29: hasPopulation && Number.isFinite(youth) ? youth : null,
    populationReferenceYear: hasPopulation && population?.referenceYear != null
      ? String(population.referenceYear)
      : null,
  };
}

module.exports = {
  extractOfferDetailsFromSnapshot,
  summarizeStrictOffersByRome,
  aggregateOccupationContext,
};
