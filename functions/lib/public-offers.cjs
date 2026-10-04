function cleanText(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function sanitizePublicOffer(source = {}) {
  return {
    title: cleanText(source.title),
    companyName: cleanText(source.companyName),
    city: cleanText(source.city),
    sectorLabel: cleanText(source.sectorLabel),
    openingCount: Math.max(1, toNonNegativeNumber(source.openingCount) || 1),
    publicationCreationDate: cleanText(source.publicationCreationDate),
    publicationExpirationDate: cleanText(source.publicationExpirationDate),
    contractStartDate: cleanText(source.contractStartDate),
    contractTypes: safeArray(source.contractTypes)
      .map(cleanText)
      .filter(Boolean),
    applyUrl: cleanText(source.applyUrl),
  };
}

function buildPublicOffersPayload({
  date,
  departmentCode,
  strictSummary = {},
  offers = [],
  limit = 20,
} = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 20);

  const strictOffers = safeArray(offers)
    .filter((offer) => offer?.locationQuality === 'in_department')
    .sort((a, b) => {
      return (
        toNonNegativeNumber(b?.openingCount) - toNonNegativeNumber(a?.openingCount) ||
        String(b?.publicationCreationDate || '').localeCompare(
          String(a?.publicationCreationDate || '')
        ) ||
        String(a?.title || '').localeCompare(String(b?.title || ''), 'fr')
      );
    });

  const computedOpenings = strictOffers.reduce(
    (total, offer) => total + Math.max(1, toNonNegativeNumber(offer?.openingCount) || 1),
    0
  );

  return {
    date: cleanText(date),
    departmentCode: cleanText(departmentCode),
    totalOffers: toNonNegativeNumber(
      strictSummary.totalOffers ?? strictOffers.length
    ),
    totalOpenings: toNonNegativeNumber(
      strictSummary.totalOpenings ?? computedOpenings
    ),
    offers: strictOffers.slice(0, safeLimit).map(sanitizePublicOffer),
  };
}

function buildRecentDateCandidates(baseDate, lookbackDays = 14) {
  const raw = String(baseDate || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return [];
  }

  const base = new Date(`${raw}T12:00:00.000Z`);

  if (Number.isNaN(base.getTime())) {
    return [];
  }

  const maxLookback = Math.min(
    Math.max(Number.parseInt(lookbackDays, 10) || 0, 0),
    31
  );

  return Array.from({ length: maxLookback + 1 }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() - index);
    return date.toISOString().slice(0, 10);
  });
}

module.exports = {
  sanitizePublicOffer,
  buildPublicOffersPayload,
  buildRecentDateCandidates,
};
