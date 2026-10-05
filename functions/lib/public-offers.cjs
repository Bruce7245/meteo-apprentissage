function cleanText(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\s+/g, ' ').trim() || null;
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizePublicRomeCode(value) {
  const code = cleanText(value)?.toUpperCase() || '';
  return /^[A-Z][0-9]{4}$/.test(code) ? code : null;
}

function offerHasRomeCode(offer, romeCode) {
  const target = normalizePublicRomeCode(romeCode);
  if (!target) return false;

  return safeArray(offer?.romeCodes)
    .map(normalizePublicRomeCode)
    .filter(Boolean)
    .includes(target);
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function sanitizePublicUrl(value) {
  const cleaned = cleanText(value);

  if (!cleaned) return null;

  try {
    const url = new URL(cleaned);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
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
    applyUrl: sanitizePublicUrl(source.applyUrl),
  };
}

function buildPublicOffersPayload({
  date,
  departmentCode,
  strictSummary = {},
  offers = [],
  limit = 20,
  romeCode = null,
} = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 20);

  const normalizedRomeCode = romeCode
    ? normalizePublicRomeCode(romeCode)
    : null;

  const strictOffers = safeArray(offers)
    .filter((offer) => offer?.locationQuality === 'in_department')
    .filter((offer) =>
      normalizedRomeCode
        ? offerHasRomeCode(offer, normalizedRomeCode)
        : true
    )
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
    ...(normalizedRomeCode ? { romeCode: normalizedRomeCode } : {}),
    totalOffers: normalizedRomeCode
      ? strictOffers.length
      : toNonNegativeNumber(
          strictSummary.totalOffers ?? strictOffers.length
        ),
    totalOpenings: normalizedRomeCode
      ? computedOpenings
      : toNonNegativeNumber(
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


function buildPublicOffersHistory(snapshots = [], romeCode = null) {
  const normalizedRomeCode = romeCode
    ? normalizePublicRomeCode(romeCode)
    : null;

  return safeArray(snapshots)
    .filter((snapshot) => {
      return (
        cleanText(snapshot?.date) &&
        snapshot?.strictSummary &&
        typeof snapshot.strictSummary === 'object'
      );
    })
    .map((snapshot) => {
      if (!normalizedRomeCode) {
        return {
          date: cleanText(snapshot.date),
          totalOffers: toNonNegativeNumber(
            snapshot.strictSummary.totalOffers
          ),
          totalOpenings: toNonNegativeNumber(
            snapshot.strictSummary.totalOpenings
          ),
        };
      }

      const row = safeArray(snapshot.strictSummary.byRome).find(
        (item) =>
          normalizePublicRomeCode(item?.code) === normalizedRomeCode
      );

      if (!row) return null;

      return {
        date: cleanText(snapshot.date),
        totalOffers: toNonNegativeNumber(row.offers),
        totalOpenings: toNonNegativeNumber(row.openings),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function computePublicTrend(values = []) {
  const usable = safeArray(values).map(Number).filter(Number.isFinite);

  if (usable.length < 2) return null;

  const opening = usable[0];
  const closing = usable[usable.length - 1];

  if (opening <= 0) return null;

  return Number(((closing - opening) / opening).toFixed(4));
}

module.exports = {
  normalizePublicRomeCode,
  offerHasRomeCode,
  sanitizePublicOffer,
  buildPublicOffersPayload,
  buildRecentDateCandidates,
  buildPublicOffersHistory,
  computePublicTrend,
};
