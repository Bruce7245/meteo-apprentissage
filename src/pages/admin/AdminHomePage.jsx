import React, { useEffect, useState } from 'react';
import {
  FiActivity,
  FiArrowRight,
  FiCheckCircle,
  FiEdit3,
  FiFileText,
  FiMap,
  FiTrendingUp,
} from 'react-icons/fi';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { getAdminDashboardSummary } from '../../services/adminDashboardService.js';

function formatValue(value) {
  if (value === null || value === undefined) return 'Indisponible';
  return new Intl.NumberFormat('fr-FR').format(value);
}

const quickActions = [
  {
    href: '/admin/carte-publiee',
    title: 'Contrôler la carte publiée',
    description: 'Vérifier immédiatement ce qui est visible côté public.',
    icon: FiMap,
  },
  {
    href: '/admin/secteurs',
    title: 'Analyser un métier',
    description: 'Explorer les écarts territoriaux, seuils et signaux de vigilance.',
    icon: FiActivity,
  },
  {
    href: '/admin/bulletins',
    title: 'Préparer un bulletin',
    description: 'Accéder à la file éditoriale et aux futures validations.',
    icon: FiEdit3,
  },
];

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
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Pilotage</p>
          <h1>Vue d’ensemble</h1>
          <p>
            Contrôlez l’état de publication, les vigilances et les principaux
            volumes d’ApprentiFR depuis un seul écran.
          </p>
        </div>
        <div className="admin-console-page-status">
          <span className="admin-console-live-dot" />
          <span>
            <strong>Console opérationnelle</strong>
            <small>Administration sécurisée</small>
          </span>
        </div>
      </section>

      {error ? (
        <section className="admin-console-alert admin-console-alert-error">
          <strong>Tableau de bord indisponible</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {loading ? (
        <section className="admin-console-loading">
          <span className="admin-console-loader" />
          <div>
            <strong>Chargement du pilotage</strong>
            <p>Lecture des dernières données publiées.</p>
          </div>
        </section>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="admin-console-overview-grid">
            <MetricCard
              label="Départements publiés"
              value={formatValue(summary?.publishedDepartments)}
              detail={
                summary?.latestDate
                  ? `Dernière publication · ${summary.latestDate}`
                  : 'Aucune publication datée'
              }
            />
            <MetricCard
              label="Bulletins"
              value={formatValue(summary?.bulletinsCount)}
              detail="Documents enregistrés"
            />
            <MetricCard
              label="Vigilances sectorielles"
              value={formatValue(summary?.sectorsCount)}
              detail="Secteurs du dernier jeu publié"
            />
            <MetricCard
              label="Orange ou rouge"
              value={formatValue(summary?.elevatedDepartments)}
              detail="Territoires nécessitant une attention"
            />
          </section>

          <section className="admin-console-dashboard-grid">
            <article className="admin-console-card admin-console-publication-card">
              <div className="admin-console-card-head">
                <div>
                  <p className="admin-console-eyebrow">Publication</p>
                  <h2>État public actuel</h2>
                </div>
                <span className="admin-console-chip">
                  {summary?.latestDate || 'Date inconnue'}
                </span>
              </div>

              <div className="admin-console-publication-status">
                <FiCheckCircle aria-hidden="true" />
                <div>
                  <strong>{formatValue(summary?.publishedDepartments)} départements servis</strong>
                  <p>
                    La répartition ci-dessous correspond au dernier index public
                    disponible.
                  </p>
                </div>
              </div>

              <div className="admin-console-level-grid">
                <div className="level-green">
                  <span>Vert</span>
                  <strong>{formatValue(summary?.levels?.green)}</strong>
                </div>
                <div className="level-yellow">
                  <span>Jaune</span>
                  <strong>{formatValue(summary?.levels?.yellow)}</strong>
                </div>
                <div className="level-orange">
                  <span>Orange</span>
                  <strong>{formatValue(summary?.levels?.orange)}</strong>
                </div>
                <div className="level-red">
                  <span>Rouge</span>
                  <strong>{formatValue(summary?.levels?.red)}</strong>
                </div>
              </div>

              <a className="admin-console-inline-link" href="/admin/carte-publiee">
                Ouvrir la carte publiée <FiArrowRight aria-hidden="true" />
              </a>
            </article>

            <article className="admin-console-card">
              <div className="admin-console-card-head">
                <div>
                  <p className="admin-console-eyebrow">Accès rapides</p>
                  <h2>Actions principales</h2>
                </div>
              </div>

              <div className="admin-console-quick-actions">
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <a href={action.href} key={action.href}>
                      <span className="admin-console-action-icon">
                        <Icon aria-hidden="true" />
                      </span>
                      <span>
                        <strong>{action.title}</strong>
                        <small>{action.description}</small>
                      </span>
                      <FiArrowRight aria-hidden="true" />
                    </a>
                  );
                })}
              </div>
            </article>
          </section>

          <section className="admin-console-card admin-console-activity-card">
            <div className="admin-console-card-head">
              <div>
                <p className="admin-console-eyebrow">Lecture métier</p>
                <h2>À surveiller</h2>
              </div>
              <FiTrendingUp aria-hidden="true" />
            </div>

            <div className="admin-console-watch-grid">
              <div>
                <span className="admin-console-watch-icon">
                  <FiActivity aria-hidden="true" />
                </span>
                <strong>Vigilance territoriale</strong>
                <p>
                  {formatValue(summary?.elevatedDepartments)} département(s)
                  actuellement classés orange ou rouge.
                </p>
                <a href="/admin/secteurs">Analyser les métiers</a>
              </div>
              <div>
                <span className="admin-console-watch-icon">
                  <FiFileText aria-hidden="true" />
                </span>
                <strong>Production éditoriale</strong>
                <p>
                  {formatValue(summary?.bulletinsCount)} bulletin(s) enregistrés
                  dans la collection actuelle.
                </p>
                <a href="/admin/bulletins">Ouvrir les bulletins</a>
              </div>
            </div>
          </section>

          {summary?.warnings?.length > 0 ? (
            <section className="admin-console-alert admin-console-alert-warning">
              <strong>Chargement partiel</strong>
              <ul>
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
