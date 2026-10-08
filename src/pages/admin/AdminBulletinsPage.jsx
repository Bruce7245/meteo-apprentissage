import React, { useEffect, useMemo, useState } from 'react';
import {
  FiAlertTriangle,
  FiExternalLink,
  FiFileText,
  FiFilter,
  FiSearch,
} from 'react-icons/fi';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { getLatestAdminBulletins } from '../../services/adminBulletinService.js';
import { getLevelCss, getLevelLabel } from '../../utils/levelUtils.js';

function formatNumber(value, maximumFractionDigits = 0) {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits,
  }).format(number);
}

function formatConfidence(value) {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return (
    new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 0,
    }).format(number) + ' %'
  );
}

function levelRank(level) {
  return {
    red: 4,
    orange: 3,
    yellow: 2,
    green: 1,
  }[level] || 0;
}

export default function AdminBulletinsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const result = await getLatestAdminBulletins();

        if (alive) setData(result);
      } catch (currentError) {
        if (alive) {
          setError(
            currentError?.message ||
              'Impossible de charger les bulletins publiés.'
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

  const filteredBulletins = useMemo(() => {
    const cleanQuery = query.trim().toLocaleLowerCase('fr-FR');
    const items = Array.isArray(data?.bulletins)
      ? [...data.bulletins]
      : [];

    return items
      .filter((item) => {
        if (level !== 'all' && item.publishedLevel !== level) {
          return false;
        }

        if (!cleanQuery) return true;

        return [
          item.departmentCode,
          item.departmentName,
          item.publicTitle,
          item.publicSummary,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLocaleLowerCase('fr-FR').includes(cleanQuery)
          );
      })
      .sort((left, right) => {
        const levelDiff =
          levelRank(right.publishedLevel) - levelRank(left.publishedLevel);

        if (levelDiff !== 0) return levelDiff;

        return String(left.departmentCode).localeCompare(
          String(right.departmentCode),
          'fr',
          { numeric: true }
        );
      });
  }, [data?.bulletins, level, query]);

  const summary = useMemo(() => {
    const items = Array.isArray(data?.bulletins) ? data.bulletins : [];
    const elevated = items.filter((item) =>
      ['orange', 'red'].includes(item.publishedLevel)
    ).length;
    const confidenceValues = items
      .map((item) => item.confidenceScore)
      .filter((value) => Number.isFinite(Number(value)))
      .map(Number);

    return {
      count: items.length,
      elevated,
      averageConfidence:
        confidenceValues.length > 0
          ? confidenceValues.reduce((total, value) => total + value, 0) /
            confidenceValues.length
          : null,
    };
  }, [data?.bulletins]);

  return (
    <AdminLayout>
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Publication</p>
          <h1>Bulletins territoriaux</h1>
          <p>
            Consultez les bulletins réellement produits dans
            <code> departmentVigilanceDaily </code> pour la dernière date
            publiée.
          </p>
        </div>

        <div className="admin-console-page-status">
          <span className="admin-console-live-dot" />
          <span>
            <strong>{data?.latestDate || 'Date indisponible'}</strong>
            <small>Dernière référence publique</small>
          </span>
        </div>
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
            <strong>Chargement des bulletins</strong>
            <p>Lecture de la dernière publication territoriale.</p>
          </div>
        </section>
      ) : null}

      {!loading && !error ? (
        <>
          <section className="admin-console-overview-grid">
            <MetricCard
              label="Bulletins de vigilance"
              value={formatNumber(summary.count)}
              detail="Documents réellement stockés pour la dernière date"
            />
            <MetricCard
              label="Orange ou rouge"
              value={formatNumber(summary.elevated)}
              detail="Bulletins nécessitant une attention renforcée"
            />
            <MetricCard
              label="Confiance moyenne"
              value={formatConfidence(summary.averageConfidence)}
              detail="Moyenne des scores renseignés"
            />
            <MetricCard
              label="Départements indexés"
              value={formatNumber(data?.publishedDepartments)}
              detail="Référence vigilancePublicIndex/latest"
            />
          </section>

          <section className="admin-console-card">
            <div className="admin-console-card-head">
              <div>
                <p className="admin-console-eyebrow">File de contrôle</p>
                <h2>Bulletins publiés</h2>
              </div>
              <span className="admin-console-chip">
                {filteredBulletins.length} résultat
                {filteredBulletins.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="admin-console-filterbar">
              <label className="admin-console-search">
                <FiSearch aria-hidden="true" />
                <span className="sr-only">Rechercher un bulletin</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Département, titre ou contenu…"
                />
              </label>

              <label className="admin-console-select">
                <FiFilter aria-hidden="true" />
                <span className="sr-only">Filtrer par niveau</span>
                <select
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                >
                  <option value="all">Tous les niveaux</option>
                  <option value="yellow">Jaune</option>
                  <option value="orange">Orange</option>
                  <option value="red">Rouge</option>
                </select>
              </label>
            </div>

            {filteredBulletins.length === 0 ? (
              <div className="admin-console-empty-state">
                <FiFileText aria-hidden="true" />
                <strong>Aucun bulletin correspondant</strong>
                <p>
                  Aucun document de vigilance ne correspond au filtre courant
                  pour la date {data?.latestDate || 'sélectionnée'}.
                </p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="simple-table admin-console-bulletins-table">
                  <thead>
                    <tr>
                      <th>Département</th>
                      <th>Niveau</th>
                      <th>Bulletin public</th>
                      <th>Offres actives</th>
                      <th>Confiance</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBulletins.map((bulletin) => (
                      <tr key={bulletin.id}>
                        <td>
                          <strong>
                            {bulletin.departmentName ||
                              bulletin.departmentCode}
                          </strong>
                          <div className="date-line">
                            {bulletin.departmentCode}
                          </div>
                        </td>
                        <td>
                          <span
                            className={
                              'vigilance-badge vigilance-' +
                              getLevelCss(bulletin.publishedLevel)
                            }
                          >
                            {getLevelLabel(bulletin.publishedLevel)}
                          </span>
                        </td>
                        <td className="admin-console-bulletin-copy">
                          <strong>
                            {bulletin.publicTitle ||
                              'Bulletin sans titre public'}
                          </strong>
                          <p>
                            {bulletin.publicSummary ||
                              'Aucun résumé public enregistré.'}
                          </p>
                        </td>
                        <td>
                          {formatNumber(
                            bulletin.metrics?.activeOffers,
                            0
                          )}
                        </td>
                        <td>
                          {formatConfidence(bulletin.confidenceScore)}
                        </td>
                        <td>
                          <a
                            className="admin-console-row-link"
                            href={
                              '/departement/' +
                              encodeURIComponent(
                                bulletin.departmentCode
                              )
                            }
                            target="_blank"
                            rel="noreferrer"
                            aria-label={
                              'Ouvrir le bulletin public de ' +
                              (bulletin.departmentName ||
                                bulletin.departmentCode)
                            }
                          >
                            <FiExternalLink aria-hidden="true" />
                            <span>Voir</span>
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-console-alert admin-console-alert-warning">
            <FiAlertTriangle aria-hidden="true" />
            <div>
              <strong>Lecture de la collection réelle</strong>
              <span>
                Les départements restés au niveau vert ne génèrent pas forcément
                un document dédié dans <code>departmentVigilanceDaily</code>.
                Cette file affiche donc les bulletins de vigilance effectivement
                matérialisés, et non une liste artificielle de 101 lignes.
              </span>
            </div>
          </section>
        </>
      ) : null}
    </AdminLayout>
  );
}
