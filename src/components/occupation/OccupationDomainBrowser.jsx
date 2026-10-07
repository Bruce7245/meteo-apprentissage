import React, { useMemo, useState } from 'react';

function groupDomains(domains) {
  const groups = new Map();

  for (const domain of Array.isArray(domains) ? domains : []) {
    const key =
      domain.majorDomainCode + '|' + domain.majorDomainLabel;

    if (!groups.has(key)) {
      groups.set(key, {
        majorDomainCode: domain.majorDomainCode,
        majorDomainLabel: domain.majorDomainLabel,
        domains: [],
      });
    }

    groups.get(key).domains.push(domain);
  }

  return Array.from(groups.values())
    .sort((a, b) =>
      a.majorDomainCode.localeCompare(b.majorDomainCode, 'fr')
    )
    .map((group) => ({
      ...group,
      domains: [...group.domains].sort((a, b) =>
        a.domainLabel.localeCompare(b.domainLabel, 'fr', {
          sensitivity: 'base',
        })
      ),
    }));
}

export default function OccupationDomainBrowser({
  domains = [],
  selectedDomainCode = '',
  selectedRomeCode = '',
  domainData = null,
  loadingDomains = false,
  loadingOccupations = false,
  domainError = '',
  occupationsError = '',
  onDomainSelect,
  onOccupationSelect,
}) {
  const [filter, setFilter] = useState('');

  const groups = useMemo(
    () => groupDomains(domains),
    [domains]
  );

  const occupations = useMemo(() => {
    const items = Array.isArray(domainData?.occupations)
      ? domainData.occupations
      : [];
    const normalized = String(filter || '')
      .trim()
      .toLocaleLowerCase('fr');

    if (!normalized) return items;

    return items.filter((occupation) => {
      const haystack =
        occupation.romeCode +
        ' ' +
        occupation.label;

      return haystack
        .toLocaleLowerCase('fr')
        .includes(normalized);
    });
  }, [domainData, filter]);

  const availableCount = useMemo(
    () =>
      (Array.isArray(domainData?.occupations)
        ? domainData.occupations
        : []
      ).filter(
        (occupation) =>
          occupation.dataStatus === 'available'
      ).length,
    [domainData]
  );

  return (
    <div className="occupation-domain-browser">
      <label
        className="occupation-search-label"
        htmlFor="occupation-domain-select"
      >
        Secteur professionnel
      </label>

      <select
        id="occupation-domain-select"
        className="occupation-domain-select"
        value={selectedDomainCode}
        disabled={loadingDomains}
        onChange={(event) => {
          setFilter('');
          onDomainSelect?.(event.target.value);
        }}
      >
        <option value="">
          {loadingDomains
            ? 'Chargement des secteurs…'
            : 'Choisir un secteur'}
        </option>

        {groups.map((group) => (
          <optgroup
            key={group.majorDomainCode}
            label={
              group.majorDomainCode +
              ' — ' +
              group.majorDomainLabel
            }
          >
            {group.domains.map((domain) => (
              <option
                key={domain.domainCode}
                value={domain.domainCode}
              >
                {domain.domainCode} — {domain.domainLabel}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {domainError ? (
        <p className="occupation-search-message is-error" role="alert">
          {domainError}
        </p>
      ) : null}

      {selectedDomainCode ? (
        <div className="occupation-domain-results">
          <div className="occupation-domain-results-head">
            <div>
              <p className="eyebrow">Métiers du secteur</p>
              <h3>
                {domainData?.domainLabel ||
                  selectedDomainCode}
              </h3>
              <p>
                {loadingOccupations
                  ? 'Chargement des métiers…'
                  : availableCount +
                    ' métier' +
                    (availableCount > 1 ? 's' : '') +
                    ' avec données exploitables.'}
              </p>
            </div>

            <label className="occupation-domain-filter">
              <span>Filtrer la liste</span>
              <input
                type="search"
                value={filter}
                placeholder="Nom ou code ROME"
                onChange={(event) =>
                  setFilter(event.target.value)
                }
                disabled={loadingOccupations}
              />
            </label>
          </div>

          {occupationsError ? (
            <p
              className="occupation-search-message is-error"
              role="alert"
            >
              {occupationsError}
            </p>
          ) : null}

          {!loadingOccupations &&
          !occupationsError &&
          occupations.length > 0 ? (
            <div className="occupation-domain-list">
              {occupations.map((occupation) => {
                const available =
                  occupation.dataStatus === 'available';
                const selected =
                  occupation.romeCode === selectedRomeCode;

                return (
                  <button
                    key={occupation.romeCode}
                    type="button"
                    className={
                      'occupation-domain-item' +
                      (selected ? ' is-selected' : '') +
                      (!available
                        ? ' is-unavailable'
                        : '')
                    }
                    disabled={!available}
                    aria-disabled={!available}
                    title={
                      available
                        ? 'Afficher la vigilance de ce métier'
                        : 'Données insuffisantes pour afficher une vigilance métier'
                    }
                    onClick={() =>
                      available &&
                      onOccupationSelect?.(occupation)
                    }
                  >
                    <span className="occupation-domain-item-copy">
                      <strong>{occupation.label}</strong>
                      <small>{occupation.romeCode}</small>
                    </span>

                    <span
                      className={
                        available
                          ? 'occupation-data-badge is-available'
                          : 'occupation-data-badge is-insufficient'
                      }
                    >
                      {available
                        ? 'Voir la carte'
                        : 'Données insuffisantes'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {!loadingOccupations &&
          !occupationsError &&
          occupations.length === 0 ? (
            <p className="occupation-search-message">
              Aucun métier ne correspond à ce filtre.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="occupation-domain-helper">
          Choisissez d’abord un secteur pour afficher les métiers ROME qui lui sont rattachés.
        </p>
      )}
    </div>
  );
}
