import React, { useEffect, useState } from 'react';
import {
  FiAlertTriangle,
  FiArrowRight,
  FiDatabase,
  FiRefreshCw,
} from 'react-icons/fi';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import VigilanceMap from '../../components/maps/VigilanceMap.jsx';
import { getLatestPublicVigilanceIndex } from '../../services/vigilanceService.js';

function formatNumber(value) {
  if (value === null || value === undefined) return '—';

  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('fr-FR').format(number)
    : '—';
}

export default function AdminDraftMapPage() {
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
          setError(
            currentError?.message ||
              'Impossible de lire la référence publiée.'
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
          <p className="admin-console-eyebrow">Cycle de publication</p>
          <h1>Prépublication</h1>
          <p>
            Écran de contrôle avant évolution du pipeline vers un véritable
            brouillon administrable.
          </p>
        </div>

        <div className="admin-console-page-status admin-console-page-status-neutral">
          <span className="admin-console-neutral-dot" />
          <span>
            <strong>Publication directe</strong>
            <small>Pas de draft persistant aujourd’hui</small>
          </span>
        </div>
      </section>

      <section className="admin-console-architecture-alert">
        <FiAlertTriangle aria-hidden="true" />
        <div>
          <p className="admin-console-eyebrow">État réel du pipeline</p>
          <h2>Il n’existe pas encore de carte brouillon séparée</h2>
          <p>
            Le traitement calcule les vigilances dans
            <code> departmentVigilanceDaily </code> puis met à jour
            <code> vigilancePublicIndex/latest </code>. Afficher ici une carte
            différente reviendrait donc à simuler un état qui n’existe pas.
          </p>
        </div>
      </section>

      {error ? (
        <section className="admin-console-alert admin-console-alert-error">
          <strong>Référence indisponible</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {loading ? (
        <section className="admin-console-loading">
          <span className="admin-console-loader" />
          <div>
            <strong>Lecture du dernier état public</strong>
            <p>Contrôle de la référence actuellement publiée.</p>
          </div>
        </section>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="admin-console-overview-grid">
            <MetricCard
              label="Dernière publication"
              value={index?.latestDate || '—'}
              detail="Référence utilisée comme point de comparaison"
            />
            <MetricCard
              label="Départements indexés"
              value={formatNumber(index?.publishedCount)}
              detail="Entrées de vigilance explicites"
            />
            <MetricCard
              label="Collection source"
              value="Daily"
              detail="departmentVigilanceDaily"
            />
            <MetricCard
              label="Mode actuel"
              value="Auto"
              detail="Calcul puis publication sans étape draft"
            />
          </section>

          <section className="admin-console-dashboard-grid">
            <article className="admin-console-card">
              <div className="admin-console-card-head">
                <div>
                  <p className="admin-console-eyebrow">Flux actuel</p>
                  <h2>Comment la publication fonctionne</h2>
                </div>
                <FiRefreshCw aria-hidden="true" />
              </div>

              <div className="admin-console-pipeline">
                <div>
                  <span>1</span>
                  <div>
                    <strong>Données quotidiennes</strong>
                    <small>departmentDailyStats</small>
                  </div>
                </div>
                <FiArrowRight aria-hidden="true" />
                <div>
                  <span>2</span>
                  <div>
                    <strong>Vigilance calculée</strong>
                    <small>departmentVigilanceDaily</small>
                  </div>
                </div>
                <FiArrowRight aria-hidden="true" />
                <div>
                  <span>3</span>
                  <div>
                    <strong>Index public</strong>
                    <small>vigilancePublicIndex/latest</small>
                  </div>
                </div>
              </div>
            </article>

            <article className="admin-console-card">
              <div className="admin-console-card-head">
                <div>
                  <p className="admin-console-eyebrow">Prochaine évolution</p>
                  <h2>Créer un vrai sas de validation</h2>
                </div>
                <FiDatabase aria-hidden="true" />
              </div>

              <p className="admin-console-card-copy">
                Pour rendre cette page éditable sans ambiguïté, il faudra
                introduire une ressource de prépublication distincte, avec
                simulation, validation humaine, audit et publication atomique.
              </p>

              <a className="admin-console-inline-link" href="/admin/secteurs">
                Ouvrir le moteur de vigilance
                <FiArrowRight aria-hidden="true" />
              </a>
            </article>
          </section>

          <section className="admin-console-reference-map">
            <div className="admin-console-card-head">
              <div>
                <p className="admin-console-eyebrow">Référence</p>
                <h2>Dernière carte effectivement publiée</h2>
              </div>
              <span className="admin-console-chip">
                {index?.latestDate || 'Date inconnue'}
              </span>
            </div>

            <VigilanceMap
              mode="admin-published"
              departments={index?.departments || []}
              loading={false}
              error=""
              latestDate={index?.latestDate}
            />
          </section>
        </>
      ) : null}
    </AdminLayout>
  );
}
