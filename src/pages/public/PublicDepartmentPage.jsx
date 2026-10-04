import React, { useEffect, useMemo, useState } from 'react';
import PublicLayout from '../../layouts/PublicLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import VigilanceBadge from '../../components/vigilance/VigilanceBadge.jsx';
import {
  getLatestPublicVigilanceIndex,
  getPublishedDepartmentSectorVigilances,
  getPublishedDepartmentVigilance,
} from '../../services/vigilanceService.js';
import { normalizeDepartmentCode } from '../../utils/departmentUtils.js';
import { getPublicFormationDepartmentStats } from '../../services/formationPublicService.js';

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (Number.isNaN(number)) return String(value);

  return new Intl.NumberFormat('fr-FR').format(number);
}

function getMetric(metrics, keys) {
  for (const key of keys) {
    if (metrics?.[key] !== null && metrics?.[key] !== undefined) {
      return metrics[key];
    }
  }

  return null;
}

export default function PublicDepartmentPage({ departmentCode }) {
  const code = normalizeDepartmentCode(departmentCode);

  const [latestIndex, setLatestIndex] = useState(null);
  const [detail, setDetail] = useState(null);
  const [sectors, setSectors] = useState([]);
  const [formationStats, setFormationStats] = useState(null);
  const [formationStatsError, setFormationStatsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        setFormationStatsError('');

        const index = await getLatestPublicVigilanceIndex();
        const targetDate = index.latestDate;

        const [departmentResult, sectorResults, formationResult] = await Promise.all([
          getPublishedDepartmentVigilance(code, targetDate),
          getPublishedDepartmentSectorVigilances(code, targetDate),
          getPublicFormationDepartmentStats(code).catch((formationError) => ({
            exists: false,
            data: null,
            error: formationError?.message || 'Statistiques formations indisponibles',
          })),
        ]);

        if (!alive) return;

        setLatestIndex(index);
        setDetail(departmentResult);
        setSectors(sectorResults);
        setFormationStats(formationResult?.data || null);
        setFormationStatsError(formationResult?.error || '');
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
  }, [code]);

  const data = detail?.data || {};
  const fallback = detail?.fallbackFromIndex || {};
  const metrics = data.metrics || {};

  const departmentName = data.departmentName || fallback.name || `Département ${code}`;
  const level = data.publishedLevel || fallback.publishedLevel || fallback.level || 'green';

  const reasons = useMemo(() => {
    if (Array.isArray(data.reasons)) return data.reasons;
    if (Array.isArray(data.publicReasons)) return data.publicReasons;
    if (data.publicSummary) return [data.publicSummary];

    return [];
  }, [data]);

  return (
    <PublicLayout>
      <nav className="breadcrumb" aria-label="Fil d’Ariane">
        <a href="/">France</a>
        <span aria-hidden="true">/</span>
        <span>Département {code}</span>
      </nav>

      <section className="department-overview">
        <div className="department-overview-copy">
          <p className="eyebrow">Département {code}</p>
          <h1>{departmentName}</h1>
          <p className="department-overview-intro">
            Lecture de la situation du marché de l’apprentissage à partir des données publiées au {latestIndex?.latestDate || detail?.date || '—'}.
          </p>
        </div>

        <div className="department-status-card">
          <span className="department-status-label">Niveau publié</span>
          <VigilanceBadge level={level} />
          <small>Situation observée à la date de publication.</small>
        </div>
      </section>

      {error ? (
        <section className="panel error-box">
          Impossible de charger le département : {error}
        </section>
      ) : null}

      {loading ? (
        <section className="panel state-box">
          Chargement de la situation publiée…
        </section>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="department-metrics-section">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Données formations</p>
                <h2>Couverture de l’offre de formation</h2>
              </div>
              <p className="section-note">
                {formationStats?.asOfDate
                  ? `Données agrégées au ${formationStats.asOfDate}.`
                  : 'Agrégats disponibles lorsque le département a été importé.'}
              </p>
            </div>

            {formationStats ? (
              <div className="metrics-grid">
                <MetricCard
                  label="Formations"
                  value={formatNumber(formationStats.formationsCount)}
                  detail="Formations recensées dans le département"
                />
                <MetricCard
                  label="Sessions"
                  value={formatNumber(formationStats.sessionsCount)}
                  detail="Sessions rattachées aux formations"
                />
                <MetricCard
                  label="Sessions à venir"
                  value={formatNumber(formationStats.upcomingSessionsCount)}
                  detail="Sessions dont le démarrage est à venir"
                />
                <MetricCard
                  label="Secteurs couverts"
                  value={formatNumber(formationStats.sectorsCount)}
                  detail="Secteurs représentés dans les données importées"
                />
              </div>
            ) : (
              <div className="empty-state">
                <strong>Données de formation non disponibles.</strong>
                <p>
                  {formationStatsError ||
                    'Aucun agrégat de formation n’est encore disponible pour ce département.'}
                </p>
              </div>
            )}
          </section>

          <section className="department-metrics-section vigilance-metrics-section">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Indicateurs</p>
                <h2>Repères essentiels</h2>
              </div>
              <p className="section-note">Les valeurs disponibles reflètent la dernière publication.</p>
            </div>

            <div className="metrics-grid">
              <MetricCard
                label="Offres actives"
                value={formatNumber(getMetric(metrics, ['activeOffers', 'offers', 'totalOffers']))}
                detail="Offres observées dans le département"
              />
              <MetricCard
                label="Postes à pourvoir"
                value={formatNumber(getMetric(metrics, ['openingCountTotal', 'openingCount', 'postsToFill']))}
                detail="Volume déclaré dans les offres"
              />
              <MetricCard
                label="Score d’analyse"
                value={formatNumber(data.rawScore)}
                detail="Indicateur technique de synthèse"
              />
              <MetricCard
                label="Indice de confiance"
                value={formatNumber(data.confidenceScore)}
                detail="Qualité du signal disponible"
              />
            </div>
          </section>

          <section className="department-content-grid">
            <article className="bulletin-card">
              <p className="eyebrow">Bulletin de situation</p>
              <h2>{data.publicTitle || 'Analyse territoriale'}</h2>
              <p className="bulletin-summary">
                {data.publicSummary ||
                  fallback.publicSummary ||
                  'Aucun bulletin public détaillé n’est disponible pour ce département.'}
              </p>

              {data.publicAdvice ? (
                <div className="advice-box">
                  <strong>Point d’attention</strong>
                  <p>{data.publicAdvice}</p>
                </div>
              ) : null}

              {reasons.length > 0 ? (
                <div className="bulletin-reasons">
                  <h3>Éléments observés</h3>
                  <ul className="reason-list">
                    {reasons.slice(0, 5).map((reason, index) => (
                      <li key={`${reason}_${index}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>

            <aside className="department-context-card">
              <p className="eyebrow">À retenir</p>
              <h3>Comment interpréter ce niveau ?</h3>
              <p>
                La vigilance traduit une situation observée à un instant donné. Elle doit être lue avec les indicateurs, le bulletin et le contexte sectoriel du département.
              </p>
              <a className="text-link" href="/">Revenir à la carte nationale</a>
            </aside>
          </section>

          <section className="sector-section">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Analyse sectorielle</p>
                <h2>Secteurs sous vigilance</h2>
              </div>
              <span className="soft-pill">{sectors.length} secteur(s)</span>
            </div>

            {sectors.length === 0 ? (
              <div className="empty-state">
                <strong>Aucune vigilance sectorielle publiée.</strong>
                <p>Aucun signal sectoriel détaillé n’est disponible pour ce département à cette date.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="simple-table sector-table">
                  <thead>
                    <tr>
                      <th>Secteur</th>
                      <th>Vigilance</th>
                      <th>Lecture publiée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectors.map((sector) => (
                      <tr key={sector.id}>
                        <td className="sector-name">{sector.sectorLabel}</td>
                        <td>
                          <VigilanceBadge level={sector.level} />
                        </td>
                        <td>{sector.publicSummary || sector.publicAdvice || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </PublicLayout>
  );
}
