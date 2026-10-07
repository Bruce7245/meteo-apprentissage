import React, { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { getAdminDashboardSummary } from '../../services/adminDashboardService.js';

function formatValue(value) {
  if (value === null || value === undefined) return 'Indisponible';
  return new Intl.NumberFormat('fr-FR').format(value);
}

export default function AdminHomePage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const result = await getAdminDashboardSummary();

        if (alive) setSummary(result);
      } catch (currentError) {
        if (alive) {
          setError(
            currentError?.message ||
              'Impossible de charger les indicateurs administratifs.'
          );
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

  return (
    <AdminLayout>
      <section className="admin-page-heading">
        <p className="kicker">Pilotage</p>
        <h1>Administration ApprentiFR</h1>
        <p>
          Espace de contrôle des vigilances, bulletins, secteurs, entreprises et publications.
        </p>
      </section>

      {error ? (
        <section className="panel error-box">
          Impossible de charger le tableau de bord : {error}
        </section>
      ) : null}

      {loading ? (
        <section className="panel state-box">
          Chargement des indicateurs administratifs...
        </section>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="metrics-grid">
            <MetricCard
              label="Départements publiés"
              value={formatValue(summary?.publishedDepartments)}
              detail={
                summary?.latestDate
                  ? `Publication du ${summary.latestDate}`
                  : 'Aucune publication datée'
              }
            />
            <MetricCard
              label="Bulletins enregistrés"
              value={formatValue(summary?.bulletinsCount)}
              detail="Documents présents dans la collection bulletins"
            />
            <MetricCard
              label="Vigilances sectorielles"
              value={formatValue(summary?.sectorsCount)}
              detail="Secteurs publiés pour la dernière date"
            />
            <MetricCard
              label="Départements orange ou rouge"
              value={formatValue(summary?.elevatedDepartments)}
              detail="Niveaux nécessitant une attention renforcée"
            />
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Répartition</p>
                <h2>Niveaux publiés</h2>
              </div>
              <span className="soft-pill">
                {summary?.latestDate || 'Date inconnue'}
              </span>
            </div>

            <div className="metrics-grid">
              <MetricCard label="Vert" value={formatValue(summary?.levels?.green)} />
              <MetricCard label="Jaune" value={formatValue(summary?.levels?.yellow)} />
              <MetricCard label="Orange" value={formatValue(summary?.levels?.orange)} />
              <MetricCard label="Rouge" value={formatValue(summary?.levels?.red)} />
            </div>
          </section>

          {summary?.warnings?.length > 0 ? (
            <section className="panel error-box">
              <h2>Chargement partiel</h2>
              <ul className="reason-list">
                {summary.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </AdminLayout>
  );
}
