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

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');

        const index = await getLatestPublicVigilanceIndex();
        const targetDate = index.latestDate;

        const [departmentResult, sectorResults] = await Promise.all([
          getPublishedDepartmentVigilance(code, targetDate),
          getPublishedDepartmentSectorVigilances(code, targetDate),
        ]);

        if (!alive) return;

        setLatestIndex(index);
        setDetail(departmentResult);
        setSectors(sectorResults);
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
      <section className="hero department-hero">
        <div>
          <p className="kicker">Département {code}</p>
          <h1>{departmentName}</h1>
          <p>
            Situation publiée au {latestIndex?.latestDate || detail?.date || '-'}.
          </p>
        </div>

        <VigilanceBadge level={level} />
      </section>

      {error ? (
        <section className="panel error-box">
          Impossible de charger le département : {error}
        </section>
      ) : null}

      {loading ? (
        <section className="panel">
          Chargement de la situation publiée...
        </section>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="metrics-grid">
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
              label="Score brut"
              value={formatNumber(data.rawScore)}
              detail="Indicateur technique publié"
            />
            <MetricCard
              label="Confiance"
              value={formatNumber(data.confidenceScore)}
              detail="Qualité du signal observé"
            />
          </section>

          <section className="panel">
            <p className="kicker">Bulletin</p>
            <h2>Bulletin de situation</h2>

            {data.publicTitle ? <h3 className="subheading">{data.publicTitle}</h3> : null}

            <p>
              {data.publicSummary ||
                fallback.publicSummary ||
                'Aucun bulletin public détaillé n’est disponible pour ce département.'}
            </p>

            {data.publicAdvice ? (
              <div className="advice-box">
                {data.publicAdvice}
              </div>
            ) : null}

            {reasons.length > 0 ? (
              <ul className="reason-list">
                {reasons.slice(0, 5).map((reason, index) => (
                  <li key={`${reason}_${index}`}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Secteurs</p>
                <h2>Secteurs sous vigilance</h2>
              </div>
              <span className="soft-pill">{sectors.length} secteur(s)</span>
            </div>

            {sectors.length === 0 ? (
              <p>Aucune vigilance sectorielle publiée pour ce département.</p>
            ) : (
              <div className="table-wrapper">
                <table className="simple-table">
                  <thead>
                    <tr>
                      <th>Secteur</th>
                      <th>Vigilance</th>
                      <th>Résumé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectors.map((sector) => (
                      <tr key={sector.id}>
                        <td>{sector.sectorLabel}</td>
                        <td>
                          <VigilanceBadge level={sector.level} />
                        </td>
                        <td>{sector.publicSummary || sector.publicAdvice || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <p className="kicker">Offres</p>
            <h2>Offres du département</h2>
            <p>
              Les offres seront branchées après validation du modèle public :
              probablement depuis les observations LBA ou une vue dédiée aux offres publiables.
            </p>
          </section>
        </>
      ) : null}
    </PublicLayout>
  );
}
