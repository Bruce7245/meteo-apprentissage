function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizePublicOccupationDomainCode(value) {
  const code = cleanText(value)?.toUpperCase() || '';
  return /^[A-Z][0-9]{2}$/.test(code) ? code : null;
}

function normalizeRomeCode(value) {
  const code = cleanText(value)?.toUpperCase() || '';
  return /^[A-Z][0-9]{4}$/.test(code) ? code : null;
}

function resolvePublishedOccupationDomainIndex(pointer, run) {
  const pointerRunId = cleanText(pointer?.runId);

  if (!pointerRunId) {
    return {
      ok: false,
      error: 'NO_PUBLISHED_OCCUPATION_DOMAIN_INDEX',
    };
  }

  if (!run || run.status !== 'ready') {
    return {
      ok: false,
      error: 'OCCUPATION_DOMAIN_INDEX_NOT_READY',
    };
  }

  const runId = cleanText(run.runId);

  if (!runId || runId !== pointerRunId) {
    return {
      ok: false,
      error: 'OCCUPATION_DOMAIN_INDEX_MISMATCH',
    };
  }

  return {
    ok: true,
    runId,
    asOfDate: cleanText(pointer?.asOfDate || run?.asOfDate),
  };
}

function sanitizeDomainSummary(value = {}) {
  const domainCode = normalizePublicOccupationDomainCode(
    value.domainCode
  );
  const domainLabel = cleanText(value.domainLabel);
  const majorDomainCode =
    cleanText(value.majorDomainCode)?.toUpperCase() || null;
  const majorDomainLabel = cleanText(value.majorDomainLabel);

  if (
    !domainCode ||
    !domainLabel ||
    !/^[A-Z]$/.test(majorDomainCode || '') ||
    !majorDomainLabel
  ) {
    return null;
  }

  const occupationsCount = Number(value.occupationsCount);

  return {
    domainCode,
    domainLabel,
    majorDomainCode,
    majorDomainLabel,
    occupationsCount:
      Number.isFinite(occupationsCount) &&
      occupationsCount >= 0
        ? occupationsCount
        : 0,
  };
}

function sanitizeDomainOccupations(value = {}) {
  const summary = sanitizeDomainSummary(value);
  if (!summary) return null;

  const occupations = (
    Array.isArray(value.occupations)
      ? value.occupations
      : []
  )
    .map((occupation) => {
      const romeCode = normalizeRomeCode(
        occupation?.romeCode
      );
      const label = cleanText(occupation?.label);

      if (
        !romeCode ||
        !label ||
        !romeCode.startsWith(summary.domainCode)
      ) {
        return null;
      }

      return {
        romeCode,
        label,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const labelDiff = a.label.localeCompare(
        b.label,
        'fr',
        { sensitivity: 'base' }
      );

      return (
        labelDiff ||
        a.romeCode.localeCompare(b.romeCode, 'fr')
      );
    });

  return {
    domainCode: summary.domainCode,
    domainLabel: summary.domainLabel,
    majorDomainCode: summary.majorDomainCode,
    majorDomainLabel: summary.majorDomainLabel,
    occupations,
  };
}

async function resolveRepositoryIndex(repository) {
  const pointer =
    await repository.loadCurrentIndexPointer();

  if (!pointer) {
    return resolvePublishedOccupationDomainIndex(
      null,
      null
    );
  }

  const pointerRunId = cleanText(pointer.runId);
  const run = pointerRunId
    ? await repository.loadIndexRun(pointerRunId)
    : null;

  return resolvePublishedOccupationDomainIndex(
    pointer,
    run
  );
}

async function getPublicOccupationDomains(repository) {
  const published =
    await resolveRepositoryIndex(repository);

  if (!published.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        exists: false,
        error: published.error,
      },
    };
  }

  const rawDomains =
    await repository.loadDomains(published.runId);

  const domains = (
    Array.isArray(rawDomains) ? rawDomains : []
  )
    .map(sanitizeDomainSummary)
    .filter(Boolean)
    .sort((a, b) => {
      const majorDiff =
        a.majorDomainCode.localeCompare(
          b.majorDomainCode,
          'fr'
        );
      if (majorDiff) return majorDiff;

      const labelDiff =
        a.domainLabel.localeCompare(
          b.domainLabel,
          'fr',
          { sensitivity: 'base' }
        );

      return (
        labelDiff ||
        a.domainCode.localeCompare(
          b.domainCode,
          'fr'
        )
      );
    });

  return {
    status: 200,
    body: {
      ok: true,
      exists: true,
      asOfDate: published.asOfDate,
      domains,
    },
  };
}

async function getPublicOccupationDomainOccupations(
  repository,
  rawDomainCode
) {
  const domainCode =
    normalizePublicOccupationDomainCode(
      rawDomainCode
    );

  if (!domainCode) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'INVALID_DOMAIN',
      },
    };
  }

  const published =
    await resolveRepositoryIndex(repository);

  if (!published.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        exists: false,
        error: published.error,
      },
    };
  }

  const rawDomain = await repository.loadDomain(
    published.runId,
    domainCode
  );

  if (!rawDomain) {
    return {
      status: 404,
      body: {
        ok: false,
        exists: false,
        domainCode,
        data: null,
      },
    };
  }

  const domain =
    sanitizeDomainOccupations(rawDomain);

  if (!domain) {
    return {
      status: 500,
      body: {
        ok: false,
        error: 'INVALID_PUBLIC_OCCUPATION_DOMAIN',
      },
    };
  }

  let occupationAvailability = null;

  if (
    typeof repository.loadOccupationAvailability === 'function'
  ) {
    occupationAvailability =
      await repository.loadOccupationAvailability(
        domain.occupations.map(
          (occupation) => occupation.romeCode
        )
      );
  }

  const availabilityByRome =
    occupationAvailability?.byRomeCode &&
    typeof occupationAvailability.byRomeCode === 'object'
      ? occupationAvailability.byRomeCode
      : {};

  const occupations = domain.occupations.map(
    (occupation) => ({
      ...occupation,
      dataStatus:
        availabilityByRome[occupation.romeCode] === true
          ? 'available'
          : 'insufficient_data',
    })
  );

  return {
    status: 200,
    body: {
      ok: true,
      exists: true,
      asOfDate: published.asOfDate,
      occupationDataDate:
        cleanText(occupationAvailability?.date) || null,
      ...domain,
      occupations,
    },
  };
}

module.exports = {
  normalizePublicOccupationDomainCode,
  resolvePublishedOccupationDomainIndex,
  getPublicOccupationDomains,
  getPublicOccupationDomainOccupations,
};
