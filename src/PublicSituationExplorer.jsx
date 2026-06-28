import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import FranceMap from './FranceMap';

const CRITERIA_OPTIONS = [
  {
    id: 'synthese',
    label: 'Synthèse',
    shortLabel: 'Global',
    description: 'Niveau public de vigilance publié pour le territoire.',
  },
  {
    id: 'offres',
    label: 'Volume d’offres',
    shortLabel: 'Offres',
    description: 'Lecture indicative du nombre d’offres observées.',
  },
  {
    id: 'postes',
    label: 'Postes ouverts',
    shortLabel: 'Postes',
    description: 'Lecture indicative du nombre de postes disponibles.',
  },
  {
    id: 'confiance',
    label: 'Fiabilité donnée',
    shortLabel: 'Fiabilité',
    description: 'Lecture de confiance associée à la donnée disponible.',
  },
];

function normalizeDepartmentCode(value) {
  const raw = String(value || '').trim();

  if (!raw) return '';
  if (raw === '2A' || raw === '2B') return raw;
  if (/^\d$/.test(raw)) return `0${raw}`;

  return raw;
}

function getLevelClass(level) {
  return `level-${String(level || 'Vert')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')}`;
}

function sortDepartments(items) {
  return [...items].sort((a, b) => {
    return normalizeDepartmentCode(a.code).localeCompare(normalizeDepartmentCode(b.code));
  });
}

function countByLevel(departments) {
  return departments.reduce(
    (accumulator, department) => {
      const level = department.level || 'Non renseigné';
      accumulator[level] = (accumulator[level] || 0) + 1;
      return accumulator;
    },
    {
      Vert: 0,
      Jaune: 0,
      Orange: 0,
      Rouge: 0,
      'Non renseigné': 0,
    }
  );
}

function getAdvice(level) {
  switch (level) {
    case 'Rouge':
      return 'Élargissez fortement votre zone de recherche et contactez rapidement votre CFA ou référent.';
    case 'Orange':
      return 'Renforcez vos démarches, relancez les entreprises et élargissez votre recherche aux zones voisines.';
    case 'Jaune':
      return 'Surveillez les nouvelles offres régulièrement et préparez plusieurs candidatures ciblées.';
    case 'Vert':
      return 'Poursuivez vos démarches normalement en maintenant une veille régulière.';
    default:
      return 'La donnée sectorielle n’est pas encore disponible pour ce choix.';
  }
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

  if (normalized.includes('haute') || normalized.includes('forte') || normalized.includes('elevee') || normalized.includes('élevée')) {
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

function getCriterionValue(item, criterionId) {
  if (criterionId === 'offres') {
    return getNumericValue(item, ['jobsCount', 'jobsCount30Days', 'offersCount', 'offersCount30Days']);
  }

  if (criterionId === 'postes') {
    return getNumericValue(item, ['openingCount', 'openingCount30Days', 'openingsCount', 'openingsCount30Days']);
  }

  return null;
}

function getCriterionDisplayValue(item, criterionId) {
  if (criterionId === 'offres') {
    return `${formatNumber(getCriterionValue(item, criterionId))} offres`;
  }

  if (criterionId === 'postes') {
    return `${formatNumber(getCriterionValue(item, criterionId))} postes`;
  }

  if (criterionId === 'confiance') {
    return item?.confidence || 'non renseignée';
  }

  return item?.level || 'Non renseigné';
}

function getCriterionLevel(item, criterionId, fallbackLevel = 'Vert') {
  if (criterionId === 'offres') {
    return deriveOffersLevel(getCriterionValue(item, criterionId));
  }

  if (criterionId === 'postes') {
    return deriveOpeningsLevel(getCriterionValue(item, criterionId));
  }

  if (criterionId === 'confiance') {
    return deriveConfidenceLevel(item?.confidence);
  }

  return item?.level || fallbackLevel;
}

function getCriterionReason(item, criterion, fallbackReason) {
  if (criterion.id === 'synthese') {
    return fallbackReason || 'Aucun commentaire public n’est encore disponible pour ce territoire.';
  }

  const value = getCriterionDisplayValue(item, criterion.id);

  if (value.startsWith('—')) {
    return `Aucune donnée exploitable n’est disponible pour le critère « ${criterion.label} ».`;
  }

  return `${criterion.description} Valeur observée : ${value}.`;
}

export default function PublicSituationExplorer() {
  const [departments, setDepartments] = useState([]);
  const [sectorStats, setSectorStats] = useState([]);
  const [selectedSector, setSelectedSector] = useState('');
  const [selectedCriterion, setSelectedCriterion] = useState('synthese');
  const [selectedDepartmentCode, setSelectedDepartmentCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        setLoading(true);
        setErrorMessage('');

        const [departmentsSnapshot, sectorStatsSnapshot] = await Promise.all([
          getDocs(collection(db, 'departments')),
          getDocs(collection(db, 'departmentSectorStats')),
        ]);

        if (!mounted) return;

        const loadedDepartments = departmentsSnapshot.docs.map((document) => {
          const data = document.data();
          const code = normalizeDepartmentCode(data.code || document.id);

          return {
            id: document.id,
            ...data,
            code,
            name: data.name || data.nom || data.label || `Département ${code}`,
            level: data.level || 'Vert',
            reason: data.reason || '',
          };
        });

        const loadedSectorStats = sectorStatsSnapshot.docs.map((document) => {
          const data = document.data();

          return {
            id: document.id,
            ...data,
            departmentCode: normalizeDepartmentCode(data.departmentCode || data.code),
            sectorLabel: data.sectorLabel || data.sector || data.label || 'Secteur non renseigné',
            level: data.publicLevel || data.suggestedLevel || data.level || 'Vert',
            reason:
              data.publicReason ||
              data.reason ||
              'Aucun commentaire public disponible pour ce secteur.',
          };
        });

        setDepartments(sortDepartments(loadedDepartments));
        setSectorStats(loadedSectorStats);
      } catch (error) {
        console.error('Erreur chargement situation publique :', error);
        setErrorMessage('Impossible de charger les données de vigilance.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const activeCriterion = useMemo(() => {
    return CRITERIA_OPTIONS.find((criterion) => criterion.id === selectedCriterion) || CRITERIA_OPTIONS[0];
  }, [selectedCriterion]);

  const sectorOptions = useMemo(() => {
    const labels = sectorStats
      .map((item) => item.sectorLabel)
      .filter(Boolean);

    return [...new Set(labels)].sort((a, b) => a.localeCompare(b));
  }, [sectorStats]);

  const sectorByDepartment = useMemo(() => {
    if (!selectedSector) {
      return {};
    }

    return sectorStats.reduce((accumulator, item) => {
      if (item.sectorLabel === selectedSector) {
        accumulator[item.departmentCode] = item;
      }

      return accumulator;
    }, {});
  }, [sectorStats, selectedSector]);

  const mapDepartments = useMemo(() => {
    return departments.map((department) => {
      if (!selectedSector) {
        return {
          ...department,
          criterionLabel: activeCriterion.label,
          criterionDisplayValue: getCriterionDisplayValue(department, selectedCriterion),
          reason:
            selectedCriterion === 'synthese'
              ? department.reason
              : `Le critère « ${activeCriterion.label} » est plus précis après le choix d’un secteur. ${department.reason || ''}`.trim(),
        };
      }

      const sector = sectorByDepartment[normalizeDepartmentCode(department.code)];

      if (!sector) {
        return {
          ...department,
          level: 'Non renseigné',
          reason: `Aucune donnée disponible pour le secteur ${selectedSector} dans ce département.`,
          criterionLabel: activeCriterion.label,
          criterionDisplayValue: '—',
        };
      }

      const computedLevel = getCriterionLevel(sector, selectedCriterion, sector.level || 'Vert');

      return {
        ...department,
        level: computedLevel,
        reason: getCriterionReason(sector, activeCriterion, sector.reason),
        sectorLabel: selectedSector,
        sectorJobsCount: sector.jobsCount || sector.jobsCount30Days || 0,
        sectorOpeningCount: sector.openingCount || sector.openingCount30Days || 0,
        sectorConfidence: sector.confidence || 'non renseignée',
        criterionLabel: activeCriterion.label,
        criterionDisplayValue: getCriterionDisplayValue(sector, selectedCriterion),
      };
    });
  }, [departments, selectedSector, sectorByDepartment, selectedCriterion, activeCriterion]);

  const selectedDepartment = useMemo(() => {
    return departments.find((department) => {
      return normalizeDepartmentCode(department.code) === normalizeDepartmentCode(selectedDepartmentCode);
    }) || null;
  }, [departments, selectedDepartmentCode]);

  const selectedMapDepartment = useMemo(() => {
    return mapDepartments.find((department) => {
      return normalizeDepartmentCode(department.code) === normalizeDepartmentCode(selectedDepartmentCode);
    }) || null;
  }, [mapDepartments, selectedDepartmentCode]);

  const selectedSectorSituation = useMemo(() => {
    if (!selectedSector || !selectedDepartmentCode) {
      return null;
    }

    return sectorByDepartment[normalizeDepartmentCode(selectedDepartmentCode)] || null;
  }, [selectedSector, selectedDepartmentCode, sectorByDepartment]);

  const mapCounts = useMemo(() => countByLevel(mapDepartments), [mapDepartments]);

  if (loading) {
    return (
      <section className="public-situation-explorer">
        <p>Chargement de la situation locale…</p>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className="public-situation-explorer">
        <p>{errorMessage}</p>
      </section>
    );
  }

  return (
    <section className="public-situation-explorer">
      <div className="public-situation-heading">
        <p className="public-eyebrow">Situation personnalisée</p>
        <h2>Connaître la vigilance dans mon département et mon secteur</h2>
        <p>
          La carte générale indique la situation par département. Le filtre secteur
          permet d’afficher une lecture plus précise pour un domaine d’activité.
        </p>
      </div>

      <div className="public-situation-controls">
        <label>
          <span>Département</span>
          <select
            value={selectedDepartmentCode}
            onChange={(event) => setSelectedDepartmentCode(event.target.value)}
          >
            <option value="">Choisir un département</option>
            {departments.map((department) => (
              <option key={department.code} value={department.code}>
                {department.name} ({department.code})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Secteur</span>
          <select
            value={selectedSector}
            onChange={(event) => setSelectedSector(event.target.value)}
          >
            <option value="">Tous les secteurs · carte globale</option>
            {sectorOptions.map((sector) => (
              <option key={sector} value={sector}>
                {sector}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="public-criteria-strip" role="tablist" aria-label="Critères de vigilance">
        {CRITERIA_OPTIONS.map((criterion) => (
          <button
            key={criterion.id}
            type="button"
            className={criterion.id === selectedCriterion ? 'active' : ''}
            onClick={() => setSelectedCriterion(criterion.id)}
            aria-pressed={criterion.id === selectedCriterion}
          >
            <span>{criterion.shortLabel}</span>
            <strong>{criterion.label}</strong>
            <small>{criterion.description}</small>
          </button>
        ))}
      </div>

      <div className="public-situation-layout">
        <article className="public-situation-map-card">
          <div className="map-count-row">
            <span className="map-count-item count-vert">
              <strong>{mapCounts.Vert}</strong>
              <small>Vert</small>
            </span>
            <span className="map-count-item count-jaune">
              <strong>{mapCounts.Jaune}</strong>
              <small>Jaune</small>
            </span>
            <span className="map-count-item count-orange">
              <strong>{mapCounts.Orange}</strong>
              <small>Orange</small>
            </span>
            <span className="map-count-item count-rouge">
              <strong>{mapCounts.Rouge}</strong>
              <small>Rouge</small>
            </span>
            <span className="map-count-item count-non-renseigne">
              <strong>{mapCounts['Non renseigné']}</strong>
              <small>Non renseigné</small>
            </span>
          </div>

          <FranceMap
            departments={mapDepartments}
            title={selectedSector ? `Carte sectorielle · ${selectedSector}` : 'Carte globale'}
            criteriaLabel={`Critère affiché · ${activeCriterion.label}`}
            selectedDepartmentCode={selectedDepartmentCode}
            emptyTitle="Sélectionne un département"
            emptyText="Clique sur un département pour afficher sa situation."
            onSelectDepartment={(code) => setSelectedDepartmentCode(normalizeDepartmentCode(code))}
          />
        </article>

        <article className="public-situation-result-card">
          <p className="public-eyebrow">Résultat</p>

          {selectedDepartment ? (
            <>
              <h3>
                {selectedDepartment.name} ({selectedDepartment.code})
              </h3>

              <p className="public-result-context">
                Critère affiché : <strong>{activeCriterion.label}</strong>
                {selectedSector ? ` · ${selectedSector}` : ' · carte globale'}
              </p>

              <div className={`public-result-level ${getLevelClass(selectedMapDepartment?.level || selectedDepartment.level)}`}>
                <span>Vigilance affichée</span>
                <strong>{selectedMapDepartment?.level || selectedDepartment.level || 'Vert'}</strong>
                <p>
                  {selectedMapDepartment?.reason ||
                    selectedDepartment.reason ||
                    'Aucun commentaire public n’est encore disponible pour ce département.'}
                </p>
                <small>
                  Valeur du critère : {selectedMapDepartment?.criterionDisplayValue || '—'}
                </small>
              </div>

              {selectedSector ? (
                selectedSectorSituation ? (
                  <div className={`public-result-level ${getLevelClass(selectedMapDepartment?.level || selectedSectorSituation.level)}`}>
                    <span>Lecture sectorielle</span>
                    <strong>{selectedMapDepartment?.level || selectedSectorSituation.level}</strong>
                    <p>{selectedMapDepartment?.reason || selectedSectorSituation.reason}</p>
                    <small>
                      {Number(selectedSectorSituation.jobsCount || 0).toLocaleString('fr-FR')} offres ·{' '}
                      {Number(selectedSectorSituation.openingCount || 0).toLocaleString('fr-FR')} postes ·{' '}
                      confiance : {selectedSectorSituation.confidence || 'non renseignée'}
                    </small>
                  </div>
                ) : (
                  <div className="public-result-level level-non-renseigne">
                    <span>Vigilance du secteur</span>
                    <strong>Non renseigné</strong>
                    <p>
                      Aucune donnée sectorielle n’est disponible pour ce secteur dans ce département.
                    </p>
                  </div>
                )
              ) : (
                <p className="public-muted">
                  Choisis un secteur pour obtenir une lecture plus précise par critère.
                </p>
              )}

              <div className="public-advice-box">
                <strong>Conseil</strong>
                <p>{getAdvice(selectedMapDepartment?.level || selectedDepartment.level)}</p>
              </div>
            </>
          ) : (
            <p className="public-muted">
              Choisis un département, puis éventuellement un secteur.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
