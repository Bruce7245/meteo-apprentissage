import React, { useEffect, useMemo, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';

const LEVEL_COLORS = {
  'Non renseigné': '#CBD5E1',
  Vert: '#22c55e',
  Jaune: '#facc15',
  Orange: '#fb923c',
  Rouge: '#ef4444',
};

const DEFAULT_COLOR = '#e5e7eb';

const LEGEND_ITEMS = [
  {
    level: 'Vert',
    label: 'Situation favorable',
    description: 'Marché ouvert, démarches normales.',
  },
  {
    level: 'Jaune',
    label: 'À surveiller',
    description: 'Tension limitée, veille renforcée.',
  },
  {
    level: 'Orange',
    label: 'Vigilance renforcée',
    description: 'Recherche à élargir et relances nécessaires.',
  },
  {
    level: 'Rouge',
    label: 'Situation critique',
    description: 'Action rapide avec appui CFA ou référent.',
  },
  {
    level: 'Non renseigné',
    label: 'Donnée absente',
    description: 'Aucune donnée exploitable pour ce choix.',
  },
];

function normalizeCode(value) {
  if (!value) return '';

  const raw = String(value).trim().toUpperCase();

  if (raw === '2A' || raw === '2B') {
    return raw;
  }

  if (/^\d+$/.test(raw)) {
    return raw.padStart(2, '0');
  }

  return raw;
}

function getFeatureCode(feature) {
  const props = feature.properties || {};

  return normalizeCode(
    props.code ||
      props.code_insee ||
      props.codeDepartement ||
      props.dep ||
      feature.id
  );
}

function getFeatureName(feature) {
  const props = feature.properties || {};

  return (
    props.nom ||
    props.name ||
    props.libelle ||
    props.department ||
    'Département'
  );
}

function getLevelSlug(level) {
  return String(level || 'Vert')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
}

function FranceMap({
  departments,
  title = 'Département sélectionné',
  criteriaLabel = 'Vigilance globale',
  emptyTitle = 'Sélectionne un département',
  emptyText = 'Clique sur un département de la carte pour afficher son niveau de vigilance et son motif.',
  selectedDepartmentCode = '',
  onSelectDepartment,
}) {
  const [features, setFeatures] = useState([]);
  const [activeCode, setActiveCode] = useState(normalizeCode(selectedDepartmentCode));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setActiveCode(normalizeCode(selectedDepartmentCode));
  }, [selectedDepartmentCode]);

  const departmentsByCode = useMemo(() => {
    return departments.reduce((accumulator, department) => {
      accumulator[normalizeCode(department.code)] = department;
      return accumulator;
    }, {});
  }, [departments]);

  const featuresByCode = useMemo(() => {
    return features.reduce((accumulator, feature) => {
      accumulator[getFeatureCode(feature)] = feature;
      return accumulator;
    }, {});
  }, [features]);

  const projection = useMemo(() => {
    return geoMercator()
      .center([2.5, 46.6])
      .scale(2600)
      .translate([400, 390]);
  }, []);

  const pathGenerator = useMemo(() => {
    return geoPath(projection);
  }, [projection]);

  const selectedDepartment = useMemo(() => {
    const code = normalizeCode(activeCode);

    if (!code) {
      return null;
    }

    if (departmentsByCode[code]) {
      return departmentsByCode[code];
    }

    const feature = featuresByCode[code];

    if (!feature) {
      return null;
    }

    return {
      code,
      name: getFeatureName(feature),
      level: 'Non renseigné',
      reason: 'Aucune donnée publiée pour ce département.',
    };
  }, [activeCode, departmentsByCode, featuresByCode]);

  useEffect(() => {
    async function loadMap() {
      try {
        const response = await fetch('/departements.geojson');

        if (!response.ok) {
          throw new Error('Impossible de charger departements.geojson');
        }

        const geojson = await response.json();
        setFeatures(geojson.features || []);
      } catch (error) {
        console.error('Erreur chargement carte GeoJSON :', error);
      } finally {
        setLoading(false);
      }
    }

    loadMap();
  }, []);

  function handleSelectFeature(feature) {
    const code = getFeatureCode(feature);

    setActiveCode(code);

    if (onSelectDepartment) {
      onSelectDepartment(code);
    }
  }

  return (
    <div className="france-real-map-panel">
      <div className="france-real-map">
        <div className="france-map-toolbar">
          <span>{criteriaLabel}</span>
          <strong>{features.length || departments.length} départements</strong>
        </div>

        {loading ? (
          <div className="map-loading">Chargement de la carte...</div>
        ) : (
          <svg
            viewBox="0 0 800 760"
            role="img"
            aria-label="Carte de France par département"
          >
            {features.map((feature) => {
              const code = getFeatureCode(feature);
              const department = departmentsByCode[code];

              const level = department?.level || 'Non renseigné';
              const fill = LEVEL_COLORS[level] || DEFAULT_COLOR;
              const name = department?.name || getFeatureName(feature);
              const isSelected = normalizeCode(activeCode) === code;

              return (
                <path
                  key={code}
                  d={pathGenerator(feature)}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth="1"
                  className={`department-shape level-${getLevelSlug(level)}${isSelected ? ' is-selected' : ''}`}
                  onClick={() => handleSelectFeature(feature)}
                  tabIndex="0"
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`${name}, vigilance ${level}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSelectFeature(feature);
                    }
                  }}
                >
                  <title>
                    {name} ({code}) - Vigilance {level}
                  </title>
                </path>
              );
            })}
          </svg>
        )}
      </div>

      <aside className="france-map-details">
        <p className="section-label">{title}</p>

        {selectedDepartment ? (
          <>
            <div className="map-detail-meta">
              <span>Département</span>
              <strong>{selectedDepartment.code}</strong>
            </div>

            <h3>{selectedDepartment.name}</h3>

            <span
              className={`level level-${getLevelSlug(selectedDepartment.level)}`}
            >
              Vigilance {selectedDepartment.level}
            </span>

            <p>{selectedDepartment.reason}</p>
          </>
        ) : (
          <div className="map-detail-empty">
            <h3>{emptyTitle}</h3>
            <p>{emptyText}</p>
          </div>
        )}

        <div className="map-detail-divider"></div>

        <div className="map-legend" aria-label="Légende des niveaux de vigilance">
          <strong className="map-legend-title">Niveaux de vigilance</strong>

          {LEGEND_ITEMS.map((item) => (
            <div className="legend-item" key={item.level}>
              <span className={`legend-color legend-${getLevelSlug(item.level)}`}></span>
              <span>
                <strong>{item.level}</strong>
                <small>{item.label} · {item.description}</small>
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

export default FranceMap;
