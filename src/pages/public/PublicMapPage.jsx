import React, { useEffect, useMemo, useState } from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';
import VigilanceLegend from '../../components/vigilance/VigilanceLegend.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';

const levelOrder = ['green', 'yellow', 'orange', 'red'];

const levelMeta = {
  green: { label: 'Vert', description: 'Situation favorable' },
  yellow: { label: 'Jaune', description: 'Vigilance modérée' },
  orange: { label: 'Orange', description: 'Vigilance renforcée' },
  red: { label: 'Rouge', description: 'Tension élevée' },
};

function getLevel(department) {
  return department?.publishedLevel || department?.level || 'green';
}

export default function PublicMapPage() {
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const result = await getLatestPublicVigilanceIndex();

        if (alive) setIndex(result);
      } catch (currentError) {
        if (alive) {
          setError(currentError?.message || 'Erreur inconnue');
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, []);

  const departments = index?.departments || [];

  const sortedDepartments = useMemo(() => {
    return [...departments].sort((a, b) => {
      const nameA = a.name || a.departmentName || a.code || '';
      const nameB = b.name || b.departmentName || b.code || '';
      return nameA.localeCompare(nameB, 'fr');
    });
  }, [departments]);

  const levelCounts = useMemo(() => {
    return departments.reduce(
      (counts, department) => {
        const level = getLevel(department);
        counts[level] = (counts[level] || 0) + 1;
        return counts;
      },
      { green: 0, yellow: 0, orange: 0, red: 0 }
    );
  }, [departments]);

  function openDepartment(event) {
    const code = event.target.value;
    if (code) {
      window.location.href = `/departement/${encodeURIComponent(code)}`;
    }
  }

  return (
    <PublicLayout>
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="eyebrow">Observatoire de l’apprentissage</p>
          <h1>Comprendre la tension du marché, département par département.</h1>
          <p className="public-hero-intro">
            ApprentiFR synthétise les signaux du marché de l’apprentissage pour donner une lecture territoriale claire, actualisée et comparable.
          </p>

          <div className="public-hero-meta" aria-label="Informations de publication">
            <span>
              <strong>Dernière publication</strong>
              {index?.latestDate || '—'}
            </span>
            <span>
              <strong>Couverture</strong>
              {departments.length ? `${departments.length} départements` : '—'}
            </span>
          </div>
        </div>

        <div className="department-jump-card">
          <p className="eyebrow">Accès direct</p>
          <h2>Trouver un département</h2>
          <p>Accédez directement à son bulletin et à ses indicateurs publiés.</p>
          <label className="department-select-label" htmlFor="department-select">
            Département
          </label>
          <select
            id="department-select"
            className="department-select"
            defaultValue=""
            onChange={openDepartment}
            disabled={loading || sortedDepartments.length === 0}
          >
            <option value="">Sélectionner un département</option>
            {sortedDepartments.map((department) => {
              const code = department.code || department.departmentCode;
              const name = department.name || department.departmentName || code;
              return (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              );
            })}
          </select>
        </div>
      </section>

      <section className="national-summary" aria-labelledby="national-summary-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Situation nationale</p>
            <h2 id="national-summary-title">Répartition des niveaux de vigilance</h2>
          </div>
          <p className="section-note">Lecture synthétique de la dernière publication disponible.</p>
        </div>

        <div className="vigilance-summary-grid">
          {levelOrder.map((level) => (
            <article key={level} className={`vigilance-summary-card vigilance-summary-${level}`}>
              <div className="vigilance-summary-head">
                <span className="vigilance-summary-dot" aria-hidden="true" />
                <strong>{levelMeta[level].label}</strong>
              </div>
              <span className="vigilance-summary-value">
                {loading ? '—' : levelCounts[level] || 0}
              </span>
              <small>{levelMeta[level].description}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="public-map-section">
        <div className="section-title-row map-section-heading">
          <div>
            <p className="eyebrow">Carte interactive</p>
            <h2>Explorer la France</h2>
          </div>
          <p className="section-note">
            Survolez ou sélectionnez un département pour consulter son niveau publié.
          </p>
        </div>

        <div className="public-map-grid">
          <VigilanceMap
            departments={departments}
            loading={loading}
            error={error}
            latestDate={index?.latestDate}
          />

          <aside className="public-map-aside">
            <VigilanceLegend />

            <section className="information-card">
              <p className="eyebrow">Méthode de lecture</p>
              <h3>Un indicateur, pas un verdict.</h3>
              <p>
                La vigilance combine plusieurs signaux observés. Elle aide à repérer les tensions territoriales mais ne remplace pas l’analyse détaillée d’un secteur ou d’un employeur.
              </p>
            </section>

            {index && index.publishedCount === 0 ? (
              <section className="information-card muted-information-card">
                <p>
                  Aucune vigilance détaillée n’est publiée actuellement. Les départements sont affichés au niveau par défaut.
                </p>
              </section>
            ) : null}
          </aside>
        </div>
      </section>
    </PublicLayout>
  );
}
