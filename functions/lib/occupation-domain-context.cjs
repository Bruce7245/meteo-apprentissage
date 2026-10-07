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

function normalizeDomainCode(value) {
  const code = cleanText(value).toUpperCase();
  return /^[A-Z][0-9]{2}$/.test(code) ? code : null;
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function toPositiveNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : fallback;
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

function normalizeDomains(domains) {
  const result = [];
  const seen = new Set();

  for (const raw of Array.isArray(domains) ? domains : []) {
    const domainCode = normalizeDomainCode(raw?.domainCode);
    const domainLabel = cleanText(raw?.domainLabel);
    const romeCodes = Array.from(
      new Set(
        (Array.isArray(raw?.romeCodes) ? raw.romeCodes : [])
          .map(normalizeRomeCode)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'fr'));

    if (
      !domainCode ||
      !domainLabel ||
      romeCodes.some((romeCode) => !romeCode.startsWith(domainCode))
    ) {
      throw new Error(
        `Invalid domain reference: ${cleanText(raw?.domainCode) || 'unknown'}`
      );
    }

    if (seen.has(domainCode)) {
      throw new Error(
        `Invalid domain reference: duplicate ${domainCode}`
      );
    }

    seen.add(domainCode);
    result.push({
      domainCode,
      domainLabel,
      majorDomainCode:
        cleanText(raw?.majorDomainCode) || domainCode.slice(0, 1),
      majorDomainLabel:
        cleanText(raw?.majorDomainLabel) || null,
      romeCodes,
    });
  }

  return result.sort((a, b) =>
    a.domainCode.localeCompare(b.domainCode, 'fr')
  );
}

function buildOccupationDomainContexts({
  departmentCode,
  date,
  domains = [],
  offers = [],
  population = null,
  sourceVersions = null,
} = {}) {
  const department = normalizeDepartmentCode(departmentCode);

  if (!department) {
    throw new Error(`Invalid department code: ${departmentCode}`);
  }

  const normalizedDate = normalizeDateOnly(date);
  if (!normalizedDate) {
    throw new Error(`Invalid date: ${date}`);
  }

  const domainEntries = normalizeDomains(domains);
  const domainByRome = new Map();

  for (const domain of domainEntries) {
    for (const romeCode of domain.romeCodes) {
      domainByRome.set(romeCode, domain.domainCode);
    }
  }

  const offersByDomain = new Map(
    domainEntries.map((domain) => [
      domain.domainCode,
      new Map(),
    ])
  );
  const unknownRomeCodes = new Set();

  (Array.isArray(offers) ? offers : []).forEach(
    (offer, index) => {
      if (
        offer?.locationQuality !== 'in_department'
      ) {
        return;
      }

      const effectiveDepartment =
        normalizeDepartmentCode(
          offer?.effectiveDepartmentCode ||
          offer?.departmentCode
        );

      if (
        effectiveDepartment &&
        effectiveDepartment !== department
      ) {
        return;
      }

      const matchedDomains = new Set();

      for (const rawRomeCode of Array.isArray(offer?.romeCodes)
        ? offer.romeCodes
        : []) {
        const romeCode = normalizeRomeCode(rawRomeCode);
        if (!romeCode) continue;

        const domainCode = domainByRome.get(romeCode);
        if (domainCode) {
          matchedDomains.add(domainCode);
        } else {
          unknownRomeCodes.add(romeCode);
        }
      }

      const key = offerKey(offer, index);

      for (const domainCode of matchedDomains) {
        const map = offersByDomain.get(domainCode);
        const previous = map.get(key);

        if (
          !previous ||
          toPositiveNumber(offer?.openingCount, 1) >
            toPositiveNumber(previous?.openingCount, 1)
        ) {
          map.set(key, offer);
        }
      }
    }
  );

  const populationTotal = Number(
    population?.populationTotal
  );
  const population15To29 = Number(
    population?.population15To29
  );
  const populationReferenceYear = Number(
    population?.referenceYear
  );

  const contexts = domainEntries.map((domain) => {
    const uniqueOffers =
      offersByDomain.get(domain.domainCode) || new Map();
    const employerCounts = new Map();
    const nafCodes = new Set();
    let openingsCount = 0;
    let offersWithEmployer = 0;

    for (const offer of uniqueOffers.values()) {
      openingsCount += toPositiveNumber(
        offer?.openingCount,
        1
      );

      const employer = employerKey(offer);
      if (employer) {
        offersWithEmployer += 1;
        employerCounts.set(
          employer,
          (employerCounts.get(employer) || 0) + 1
        );
      }

      const nafCode = cleanText(
        offer?.nafCode
      ).toUpperCase();
      if (nafCode) nafCodes.add(nafCode);
    }

    const largestEmployerCount =
      employerCounts.size > 0
        ? Math.max(...employerCounts.values())
        : 0;

    return {
      date: normalizedDate,
      departmentCode: department,
      domainCode: domain.domainCode,
      domainLabel: domain.domainLabel,
      majorDomainCode: domain.majorDomainCode,
      majorDomainLabel: domain.majorDomainLabel,
      activeOffersCount: uniqueOffers.size,
      openingsCount,
      distinctObservedEmployersCount:
        employerCounts.size,
      distinctObservedNafCount: nafCodes.size,
      employerConcentration:
        offersWithEmployer > 0
          ? largestEmployerCount / offersWithEmployer
          : null,
      employerCoverageRatio:
        uniqueOffers.size > 0
          ? offersWithEmployer / uniqueOffers.size
          : null,
      populationTotal:
        Number.isFinite(populationTotal)
          ? populationTotal
          : null,
      population15To29:
        Number.isFinite(population15To29)
          ? population15To29
          : null,
      populationReferenceYear:
        Number.isInteger(populationReferenceYear)
          ? populationReferenceYear
          : null,
      sourceVersions:
        sourceVersions && typeof sourceVersions === 'object'
          ? { ...sourceVersions }
          : null,
      schemaVersion:
        'occupationDomainContextStats.v1',
    };
  });

  return {
    contexts,
    diagnostics: {
      domainsCount: domainEntries.length,
      strictOffersInputCount: (
        Array.isArray(offers) ? offers : []
      ).filter(
        (offer) =>
          offer?.locationQuality === 'in_department'
      ).length,
      unknownRomeCodes: Array.from(
        unknownRomeCodes
      ).sort((a, b) => a.localeCompare(b, 'fr')),
    },
  };
}

module.exports = {
  buildOccupationDomainContexts,
};
