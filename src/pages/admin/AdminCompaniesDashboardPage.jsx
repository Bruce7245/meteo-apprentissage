import React, { useEffect, useMemo, useState } from 'react';
import {
  FiCheckCircle,
  FiDatabase,
  FiFilter,
  FiSearch,
  FiRefreshCw,
} from 'react-icons/fi';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { getAdminCompaniesDashboard } from '../../services/adminCompaniesService.js';

function formatNumber(value) {
  if (value === null || value === undefined) return '—';

  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return new Intl.NumberFormat('fr-FR').format(number);
}

function formatDateTime(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function statusLabel(department) {
  if (department.statsAvailable && department.nafStatsAvailable && department.importComplete) {
    return 'Complet';
  }

  if (department.importComplete) {
    return 'Agrégation à terminer';
  }

  if (department.importAvailable) {
    return department.importCursorAvailable ? 'À reprendre' : 'Import partiel';
  }

  if (department.statsAvailable || department.nafStatsAvailable) {
    return 'Agrégats seuls';
  }

  return 'Non collecté';
}

function statusClass(department) {
  if (department.statsAvailable && department.nafStatsAvailable && department.importComplete) {
    return 'is-ready';
  }

  if (department.statsAvailable || department.nafStatsAvailable || department.importAvailable) {
    return 'is-partial';
  }

  return 'is-missing';
}

export default function AdminCompaniesDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [coverage, setCoverage] = useState('all');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const result = await getAdminCompaniesDashboard();

        if (alive) setData(result);
      } catch (currentError) {
        if (alive) {
          setError(
            currentError?.message ||
              'Impossible de charger les agrégats entreprises.'
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
  }, [reloadKey]);

  useEffect(() => {
    if (data?.job?.status !== 'running') return undefined;
    const interval = window.setInterval(() => setReloadKey((value) => value + 1), 60000);
    return () => window.clearInterval(interval);
  }, [data?.job?.status]);

  const filteredDepartments = useMemo(() => {
    const cleanQuery = query.trim().toLocaleLowerCase('fr-FR');
    const departments = Array.isArray(data?.departments)
      ? data.departments
      : [];

    return departments.filter((department) => {
      if (
        coverage === 'ready' &&
        !(department.statsAvailable && department.nafStatsAvailable && department.importComplete)
      ) {
        return false;
      }

      if (
        coverage === 'complete' &&
        !department.importComplete
      ) {
        return false;
      }

      if (coverage === 'pending' && department.statsAvailable && department.nafStatsAvailable && department.importComplete) return false;

      if (
        coverage === 'missing' &&
        (department.statsAvailable || department.nafStatsAvailable || department.importAvailable)
      ) {
        return false;
      }

      if (!cleanQuery) return true;

      return [
        department.departmentCode,
        department.departmentName,
        department.regionName,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLocaleLowerCase('fr-FR').includes(cleanQuery)
        );
    });
  }, [coverage, data?.departments, query]);

  const totals = data?.totals || {};
  const job = data?.job;
  const statusLabels = { running: 'Collecte en cours', done: 'Terminée', paused: 'En pause', error: 'Erreur', unknown: 'Indéterminé' };
  const completion = totals.departmentsCount ? Math.round(100 * (totals.fullyReadyCount || 0) / totals.departmentsCount) : 0;

  return (
    <AdminLayout>
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Données entreprises</p>
          <h1>Couverture INSEE</h1>
          <p>
            Suivez les imports Sirene et leurs agrégats utilisés par ApprentiFR sans
            charger la collection brute <code>inseeEstablishments</code>.
          </p>
        </div>

        <div className="admin-console-page-status">
          <span className="admin-console-live-dot" />
          <span>
            <strong>
              {formatNumber(totals.fullyReadyCount)} /{' '}
              {formatNumber(totals.departmentsCount)}
            </strong>
            <small>Collectes et agrégations complètes</small>
          </span>
        </div>
        <button
          type="button"
          className="admin-console-chip"
          onClick={() => setReloadKey((value) => value + 1)}
          disabled={loading}
          aria-label="Actualiser les données entreprises"
        >
          <FiRefreshCw aria-hidden="true" /> Actualiser
        </button>
      </section>

      {error ? (
        <section className="admin-console-alert admin-console-alert-error">
          <strong>Lecture impossible</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {loading ? (
        <section className="admin-console-loading">
          <span className="admin-console-loader" />
          <div>
            <strong>Chargement du contexte entreprises</strong>
            <p>
              Lecture de inseeDepartmentStats,
              inseeDepartmentNafStatsIndex et inseeDepartmentImportIndex.
            </p>
          </div>
        </section>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="admin-console-card" aria-label="Suivi de la récolte INSEE">
            <div className="admin-console-card-head">
              <div>
                <p className="admin-console-eyebrow">Collecte Sirene · Suivi national</p>
                <h2>{job ? statusLabels[job.status] || 'Statut inconnu' : 'Aucun job national enregistré'}</h2>
              </div>
              <span className={'admin-console-data-status ' + (job?.status === 'running' || job?.status === 'done' ? 'is-ready' : 'is-partial')}>
                {job?.status || 'indisponible'}
              </span>
            </div>
            <div className="admin-insee-job-grid">
              <div><span>Couverture complète</span><strong>{formatNumber(totals.fullyReadyCount)} / {formatNumber(totals.departmentsCount)}</strong></div>
              <div><span>Départements partiels</span><strong>{formatNumber(totals.partialCount)}</strong></div>
              <div><span>Non commencés</span><strong>{formatNumber(totals.missingCount)}</strong></div>
              <div><span>Département traité</span><strong>{job?.currentDepartmentName || job?.currentDepartmentCode || '—'}</strong></div>
              <div><span>Pages traitées par le job</span><strong>{job ? formatNumber(job.totalPages) : '—'}</strong></div>
              <div><span>Enregistrements reçus</span><strong>{job ? formatNumber(job.totalReceived) : '—'}</strong></div>
            </div>
            <div className="admin-insee-progress" role="progressbar" aria-label="Couverture INSEE complète" aria-valuemin="0" aria-valuemax="100" aria-valuenow={completion}>
              <div style={{ width: completion + '%' }} />
            </div>
            <p className="admin-insee-job-footnote">
              {completion}% des départements prêts · Dernière activité : {formatDateTime(job?.lastHeartbeatAt || job?.updatedAt)}
              {job?.status === 'running' ? ' · Actualisation automatique toutes les 60 secondes' : ''}
            </p>
            {job?.errorMessage ? <p className="admin-console-alert admin-console-alert-error">Erreur du traitement : {job.errorMessage}</p> : null}
            <p className="admin-insee-job-footnote">
              Les pages et enregistrements reçus mesurent l'activité du traitement et non des établissements SIRET uniques.
              Aucune publication des vigilances n'est déclenchée ici.
            </p>
          </section>

          <section className="admin-console-overview-grid">
            <MetricCard
              label="Collectes complètes"
              value={
                formatNumber(totals.fullyReadyCount) +
                ' / ' +
                formatNumber(totals.departmentsCount)
              }
              detail="Imports écrits et agrégats secteur/NAF disponibles"
            />
            <MetricCard
              label="Imports terminés"
              value={formatNumber(totals.completedImportsCount)}
              detail="inseeDepartmentImportIndex.complete = true"
            />
            <MetricCard
              label="Établissements employeurs actifs"
              value={formatNumber(
                totals.activeEmployerEstablishmentsCount
              )}
              detail="Somme des agrégats départementaux"
            />
            <MetricCard
              label="Établissements actifs"
              value={formatNumber(
                totals.activeEstablishmentsCount
              )}
              detail="Toutes catégories actives agrégées"
            />
          </section>

          <section className="admin-console-card">
            <div className="admin-console-card-head">
              <div>
                <p className="admin-console-eyebrow">Couverture territoriale</p>
                <h2>État département par département</h2>
              </div>
              <span className="admin-console-chip">
                {filteredDepartments.length} département
                {filteredDepartments.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="admin-console-filterbar">
              <label className="admin-console-search">
                <FiSearch aria-hidden="true" />
                <span className="sr-only">Rechercher un département</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Département ou région…"
                />
              </label>

              <label className="admin-console-select">
                <FiFilter aria-hidden="true" />
                <span className="sr-only">Filtrer la couverture</span>
                <select
                  value={coverage}
                  onChange={(event) => setCoverage(event.target.value)}
                >
                  <option value="all">Toute la couverture</option>
                  <option value="ready">Couverture complète</option>
                  <option value="complete">Imports terminés</option>
                  <option value="pending">À compléter</option>
                  <option value="missing">Non préparés</option>
                </select>
              </label>
            </div>

            <div className="table-wrapper">
              <table className="simple-table admin-console-companies-table">
                <thead>
                  <tr>
                    <th>Département</th>
                    <th>État</th>
                    <th>Employeurs actifs</th>
                    <th>Établissements actifs</th>
                    <th>Secteurs</th>
                    <th>Import</th>
                    <th>Dernière agrégation</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDepartments.map((department) => (
                    <tr key={department.departmentCode}>
                      <td>
                        <strong>
                          {department.departmentName ||
                            department.departmentCode}
                        </strong>
                        <div className="date-line">
                          {department.departmentCode}
                          {department.regionName
                            ? ' · ' + department.regionName
                            : ''}
                        </div>
                      </td>
                      <td>
                        <span
                          className={
                            'admin-console-data-status ' +
                            statusClass(department)
                          }
                        >
                          {department.statsAvailable &&
                          department.nafStatsAvailable &&
                          department.importComplete ? (
                            <FiCheckCircle aria-hidden="true" />
                          ) : (
                            <FiDatabase aria-hidden="true" />
                          )}
                          {statusLabel(department)}
                        </span>
                      </td>
                      <td>
                        {formatNumber(
                          department.activeEmployerEstablishmentsCount
                        )}
                      </td>
                      <td>
                        {formatNumber(
                          department.activeEstablishmentsCount
                        )}
                      </td>
                      <td>
                        {department.statsAvailable
                          ? formatNumber(department.sectorsCount)
                          : '—'}
                      </td>
                      <td>
                        <strong>
                          {department.importComplete
                            ? 'Terminé'
                            : department.importAvailable
                              ? 'Partiel'
                              : 'Absent'}
                        </strong>
                        {department.importAvailable ? (
                          <div className="date-line">
                            {formatNumber(department.importWrittenCount)} écritures
                            sur la dernière requête
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {formatDateTime(
                          department.statsComputedAt ||
                            department.importUpdatedAt
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-console-data-note">
            <FiDatabase aria-hidden="true" />
            <div>
              <strong>Lecture optimisée pour l’administration</strong>
              <p>
                Cette page repose sur les collections agrégées déjà calculées
                par le backend. Elle évite volontairement un scan national des
                établissements Sirene depuis le navigateur. Un agrégat disponible
                ne constitue pas, à lui seul, la preuve d’un import terminé.
              </p>
            </div>
          </section>
        </>
      ) : null}
    </AdminLayout>
  );
}
