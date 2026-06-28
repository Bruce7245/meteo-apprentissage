import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

const levelLabels = {
  Vert: 'Situation favorable',
  Jaune: 'À surveiller',
  Orange: 'Tendu',
  Rouge: 'Critique',
  'Non renseigné': 'Donnée non renseignée',
};

function normalizeDepartmentCode(value) {
  const raw = String(value || '').trim().toUpperCase();

  if (!raw) return '';
  if (raw === '2A' || raw === '2B') return raw;
  if (/^\d$/.test(raw)) return `0${raw}`;

  return raw;
}

function normalizeLevel(level) {
  return ['Vert', 'Jaune', 'Orange', 'Rouge', 'Non renseigné'].includes(level)
    ? level
    : 'Non renseigné';
}

function getLevelClass(level) {
  return String(level || 'Non renseigné')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
}

function getNumericValue(item, keys) {
  for (const key of keys) {
    const value = Number(item?.[key]);

    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return Number(value).toLocaleString('fr-FR');
}

function deriveOffersLevel(value) {
  if (!Number.isFinite(value)) return 'Non renseigné';
  if (value <= 0) return 'Rouge';
  if (value <= 3) return 'Orange';
  if (value <= 8) return 'Jaune';
  return 'Vert';
}

function deriveOpeningsLevel(value) {
  if (!Number.isFinite(value)) return 'Non renseigné';
  if (value <= 0) return 'Rouge';
  if (value <= 5) return 'Orange';
  if (value <= 15) return 'Jaune';
  return 'Vert';
}

function deriveConfidenceLevel(value) {
  if (value === null || value === undefined || value === '') {
    return 'Non renseigné';
  }

  const numericValue = Number(value);

  if (Number.isFinite(numericValue)) {
    if (numericValue >= 0.75) return 'Vert';
    if (numericValue >= 0.5) return 'Jaune';
    if (numericValue >= 0.25) return 'Orange';
    return 'Rouge';
  }

  const normalized = String(value).toLowerCase();

  if (
    normalized.includes('haute') ||
    normalized.includes('forte') ||
    normalized.includes('elevee') ||
    normalized.includes('élevée')
  ) {
    return 'Vert';
  }

  if (normalized.includes('moyenne') || normalized.includes('correcte')) {
    return 'Jaune';
  }

  if (normalized.includes('faible') || normalized.includes('basse')) {
    return 'Orange';
  }

  return 'Non renseigné';
}

function getAdvice(level) {
  switch (level) {
    case 'Rouge':
      return 'Élargir fortement la zone de recherche et contacter rapidement le CFA ou le référent.';
    case 'Orange':
      return 'Renforcer les démarches, relancer les entreprises et ouvrir la recherche aux départements voisins.';
    case 'Jaune':
      return 'Surveiller les nouvelles offres et préparer plusieurs candidatures ciblées.';
    case 'Vert':
      return 'Maintenir une recherche régulière et suivre les nouvelles publications.';
    default:
      return 'La donnée disponible ne permet pas encore de formuler une recommandation précise.';
  }
}

function getSectorLevel(row) {
  return normalizeLevel(row?.publicLevel || row?.suggestedLevel || row?.level || 'Non renseigné');
}

export default function PublicDepartmentBulletinPage({ departmentCode }) {
  const [departments, setDepartments] = useState([]);
  const [sectorStats, setSectorStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedSector, setSelectedSector] = useState('');

  const normalizedCode = normalizeDepartmentCode(departmentCode);

  useEffect(() => {
    let isMounted = true;

    async function loadDepartmentBulletin() {
      try {
        setLoading(true);
        setErrorMessage('');

        const [departmentsSnapshot, sectorStatsSnapshot] = await Promise.all([
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'departmentSectorStats')),
        ]);

        if (!isMounted) {
          return;
        }

        const loadedDepartments = departmentsSnapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            ...data,
            code: normalizeDepartmentCode(data.code || document.id),
            name: data.name || data.nom || data.label || `Département ${data.code || document.id}`,
            level: normalizeLevel(data.level || data.publicLevel || data.suggestedLevel || 'Non renseigné'),
            reason: data.reason || data.publicReason || '',
          };
        });

        const loadedSectorStats = sectorStatsSnapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            ...data,
            departmentCode: normalizeDepartmentCode(data.departmentCode || data.code),
            sectorLabel: data.sectorLabel || data.sector || data.label || 'Secteur non renseigné',
            level: getSectorLevel(data),
          };
        });

        setDepartments(loadedDepartments);
        setSectorStats(loadedSectorStats);
      } catch (error) {
        console.error('Erreur chargement bulletin département :', error);
        setErrorMessage('Impossible de charger le bulletin du département.');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadDepartmentBulletin();

    return () => {
      isMounted = false;
    };
  }, []);

  const department = useMemo(() => {
    return departments.find((item) => {
      return normalizeDepartmentCode(item.code) === normalizedCode;
    });
  }, [departments, normalizedCode]);

  const departmentSectorRows = useMemo(() => {
    return sectorStats
      .filter((item) => normalizeDepartmentCode(item.departmentCode) === normalizedCode)
      .sort((a, b) => String(a.sectorLabel).localeCompare(String(b.sectorLabel)));
  }, [sectorStats, normalizedCode]);

  const sectorOptions = useMemo(() => {
    return departmentSectorRows
      .map((row) => row.sectorLabel)
      .filter(Boolean);
  }, [departmentSectorRows]);

  const displayedSectorRows = useMemo(() => {
    if (!selectedSector) {
      return departmentSectorRows;
    }

    return departmentSectorRows.filter((row) => row.sectorLabel === selectedSector);
  }, [departmentSectorRows, selectedSector]);

  const aggregate = useMemo(() => {
    let jobsTotal = 0;
    let jobsFound = false;
    let openingsTotal = 0;
    let openingsFound = false;

    const confidenceValues = [];

    displayedSectorRows.forEach((row) => {
      const jobs = getNumericValue(row, ['jobsCount', 'jobsCount30Days', 'offersCount', 'offersCount30Days']);
      const openings = getNumericValue(row, ['openingCount', 'openingCount30Days', 'openingsCount', 'openingsCount30Days']);

      if (Number.isFinite(jobs)) {
        jobsTotal += jobs;
        jobsFound = true;
      }

      if (Number.isFinite(openings)) {
        openingsTotal += openings;
        openingsFound = true;
      }

      const confidence = Number(row.confidence);

      if (Number.isFinite(confidence)) {
        confidenceValues.push(confidence);
      }
    });

    const averageConfidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null;

    return {
      jobs: jobsFound ? jobsTotal : null,
      openings: openingsFound ? openingsTotal : null,
      confidence: averageConfidence,
      sectors: displayedSectorRows.length,
    };
  }, [displayedSectorRows]);

  const criteria = useMemo(() => {
    const synthesisLevel = normalizeLevel(selectedSector && displayedSectorRows[0] ? displayedSectorRows[0].level : department?.level || 'Non renseigné');
    const offersLevel = deriveOffersLevel(aggregate.jobs);
    const openingsLevel = deriveOpeningsLevel(aggregate.openings);
    const confidenceLevel = deriveConfidenceLevel(aggregate.confidence);

    return [
      {
        label: 'Synthèse',
        value: levelLabels[synthesisLevel],
        level: synthesisLevel,
      },
      {
        label: 'Offres',
        value: `${formatNumber(aggregate.jobs)} offres`,
        level: offersLevel,
      },
      {
        label: 'Postes',
        value: `${formatNumber(aggregate.openings)} postes`,
        level: openingsLevel,
      },
      {
        label: 'Fiabilité',
        value: aggregate.confidence === null ? 'non renseignée' : `${Math.round(aggregate.confidence * 100)} %`,
        level: confidenceLevel,
      },
      {
        label: 'Secteurs',
        value: `${aggregate.sectors} secteur(s) observé(s)`,
        level: aggregate.sectors > 0 ? 'Vert' : 'Non renseigné',
      },
    ];
  }, [department, aggregate, selectedSector, displayedSectorRows]);
  const visibleCriteria = useMemo(() => {
    return criteria.filter((criterion) => {
      const level = normalizeLevel(criterion.level);
      return level !== 'Vert' && level !== 'Non renseigné';
    });
  }, [criteria]);

  if (loading) {
    return (
      <div className="public-page">
        <main className="public-main">
          <div className="public-empty-card">Chargement du bulletin départemental…</div>
        </main>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="public-page">
        <main className="public-main">
          <div className="public-empty-card">{errorMessage}</div>
        </main>
      </div>
    );
  }

  if (!department) {
    return (
      <div className="public-page">
        <main className="public-main">
          <div className="public-empty-card">
            Aucun bulletin trouvé pour le département {normalizedCode || 'non renseigné'}.
          </div>
        </main>
      </div>
    );
  }

  const departmentLevel = normalizeLevel(department.level);

  return (
    <div className="public-page">
      <header className={`public-hero public-hero-${getLevelClass(departmentLevel)}`}>
        <nav className="public-nav">
          <div className="public-brand">
            <span className="public-brand-mark">A</span>
            <div>
              <strong>ApprentiFR</strong>
              <small>Bulletin départemental</small>
            </div>
          </div>

          <div className="public-nav-links">
            <a href="/">Accueil</a>
            <a href="#criteres">Critères</a>
            <a href="#secteurs">Secteurs</a>
          </div>
        </nav>

        <section className="public-hero-content">
          <div>
            <p className="public-kicker">Bulletin départemental publié</p>
            <h1>{department.name} ({department.code})</h1>
            <p>
              Lecture publique de la vigilance apprentissage du département, avec une synthèse
              et des critères affichés en badges pour alléger la carte nationale.
            </p>
          </div>

          <aside className={`public-hero-bulletin level-${getLevelClass(departmentLevel)}`}>
            <span>Niveau publié</span>
            <strong>{departmentLevel}</strong>
            <p>{levelLabels[departmentLevel]}</p>
            <small>Département {department.code}</small>
          </aside>
        </section>
      </header>

      <main className="public-main">
        <section className="public-section public-criteria-badge-panel" id="criteres">
          <div className="public-section-heading">
            <div>
              <p className="public-kicker">Critères de lecture</p>
              <h2>Indicateurs du département</h2>
            </div>
            <p>
              Seuls les critères en vigilance sont affichés. Les critères verts ou sans donnée sont masqués.
            </p>
          </div>

          <div className="public-sector-filter">
            <label>
              <span>Secteur affiché</span>
              <select value={selectedSector} onChange={(event) => setSelectedSector(event.target.value)}>
                <option value="">Tous les secteurs</option>
                {sectorOptions.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="public-criteria-badge-row">
            {visibleCriteria.length === 0 ? (
              <div className="public-empty-card">
                Aucun critère en vigilance pour ce filtre.
              </div>
            ) : (
              visibleCriteria.map((criterion) => (
                <article
                  key={criterion.label}
                  className={`public-criterion-badge level-${getLevelClass(criterion.level)}`}
                >
                  <span>{criterion.label}</span>
                  <strong>{criterion.value}</strong>
                  <em>{criterion.level}</em>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="public-section public-bulletin-section">
          <article className="public-bulletin-card">
            <p className="public-kicker">Situation observée</p>
            <div className={`public-level-pill level-${getLevelClass(departmentLevel)}`}>
              {departmentLevel} · {levelLabels[departmentLevel]}
            </div>

            <h2>Bulletin du département</h2>
            <p>{department.reason || 'Aucun commentaire public n’est encore disponible pour ce département.'}</p>

            <div className="public-bulletin-note">
              <strong>Lecture rapide</strong>
              <span>{getAdvice(departmentLevel)}</span>
            </div>
          </article>

          <article className="public-advice-card">
            <p className="public-kicker">Repère public</p>
            <h2>Pourquoi cette page ?</h2>

            <div className="public-advice-list">
              <div className="public-advice-item">
                <span>✓</span>
                <p>La carte nationale reste synthétique.</p>
              </div>
              <div className="public-advice-item">
                <span>✓</span>
                <p>Le détail départemental est isolé sur une page dédiée.</p>
              </div>
              <div className="public-advice-item">
                <span>✓</span>
                <p>Les critères sont lus rapidement sous forme de badges colorés.</p>
              </div>
            </div>
          </article>
        </section>

        <section className="public-section public-watch-section" id="secteurs">
          <div className="public-section-heading">
            <div>
              <p className="public-kicker">Secteurs observés</p>
              <h2>Détail sectoriel du département</h2>
            </div>
            <p>
              Les secteurs permettent d’affiner la lecture sans surcharger la carte nationale.
            </p>
          </div>

          {displayedSectorRows.length > 0 ? (
            <div className="public-watch-grid">
              {displayedSectorRows.map((row) => {
                const jobs = getNumericValue(row, ['jobsCount', 'jobsCount30Days', 'offersCount', 'offersCount30Days']);
                const openings = getNumericValue(row, ['openingCount', 'openingCount30Days', 'openingsCount', 'openingsCount30Days']);

                return (
                  <article key={row.id} className="public-department-card">
                    <div>
                      <strong>{row.sectorLabel}</strong>
                      <p>
                        {formatNumber(jobs)} offres · {formatNumber(openings)} postes
                      </p>
                    </div>

                    <span className={`public-level-pill small level-${getLevelClass(row.level)}`}>
                      {row.level}
                    </span>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="public-empty-card">
              Aucun détail sectoriel publié pour ce département.
            </div>
          )}
        </section>
      </main>

      <footer className="public-footer">
        <strong>ApprentiFR</strong>
        <span>Bulletin départemental de vigilance apprentissage.</span>
      </footer>
    </div>
  );
}
