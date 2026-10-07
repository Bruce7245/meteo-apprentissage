import React, { useEffect, useMemo, useState } from 'react';
import {
  FiBarChart2,
  FiClock,
  FiCopy,
  FiTrendingDown,
  FiTrendingUp,
} from 'react-icons/fi';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import OccupationSearch from '../../components/occupation/OccupationSearch.jsx';
import AdminStatsLineChart from '../../components/admin/AdminStatsLineChart.jsx';
import { getOccupationPublicationStats } from '../../services/adminStatsService.js';
import { getLevelCss, getLevelLabel } from '../../utils/levelUtils.js';
import { normalizeRomeCode } from '../../utils/occupationUtils.js';

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, maximumFractionDigits = 1) {
  const number = optionalNumber(value);
  if (number === null) return '—';

  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits,
  }).format(number);
}

function formatPercent(value, maximumFractionDigits = 1) {
  const number = optionalNumber(value);
  if (number === null) return '—';

  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits,
  }).format(number);
}

function percentChange(currentValue, previousValue) {
  const current = optionalNumber(currentValue);
  const previous = optionalNumber(previousValue);

  if (current === null || previous === null || previous === 0) {
    return null;
  }

  return (current - previous) / Math.abs(previous);
}

function signedNumber(value, maximumFractionDigits = 1) {
  const number = optionalNumber(value);
  if (number === null) return '—';

  const formatted = formatNumber(Math.abs(number), maximumFractionDigits);

  if (number > 0) return '+' + formatted;
  if (number < 0) return '-' + formatted;
  return formatted;
}

function signedPercent(value) {
  const number = optionalNumber(value);
  if (number === null) return '—';

  const formatted = formatPercent(Math.abs(number));

  if (number > 0) return '+' + formatted;
  if (number < 0) return '-' + formatted;
  return formatted;
}

function levelRank(level) {
  return {
    red: 4,
    orange: 3,
    yellow: 2,
    green: 1,
    insufficient_data: 0,
  }[level] || 0;
}

function initialRomeFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return normalizeRomeCode(params.get('rome'));
}

function rankingComparator(mode) {
  return (left, right) => {
    if (mode === 'offers') {
      return (
        (optionalNumber(right.activeOffersCount) ?? -Infinity) -
        (optionalNumber(left.activeOffersCount) ?? -Infinity)
      );
    }

    if (mode === 'decline') {
      const leftChange = percentChange(
        left.activeOffersCount,
        left.previousActiveOffersCount
      );
      const rightChange = percentChange(
        right.activeOffersCount,
        right.previousActiveOffersCount
      );

      if (leftChange === null && rightChange !== null) return 1;
      if (leftChange !== null && rightChange === null) return -1;
      if (leftChange !== null && rightChange !== null) {
        return leftChange - rightChange;
      }
    }

    if (mode === 'improvement') {
      const leftChange = percentChange(
        left.activeOffersCount,
        left.previousActiveOffersCount
      );
      const rightChange = percentChange(
        right.activeOffersCount,
        right.previousActiveOffersCount
      );

      if (leftChange === null && rightChange !== null) return 1;
      if (leftChange !== null && rightChange === null) return -1;
      if (leftChange !== null && rightChange !== null) {
        return rightChange - leftChange;
      }
    }

    if (mode === 'vigilance') {
      const levelDifference =
        levelRank(right.publishedLevel) -
        levelRank(left.publishedLevel);

      if (levelDifference !== 0) return levelDifference;
    }

    const leftRatio = optionalNumber(left.observedVsExpectedRatio);
    const rightRatio = optionalNumber(right.observedVsExpectedRatio);

    if (leftRatio === null && rightRatio !== null) return 1;
    if (leftRatio !== null && rightRatio === null) return -1;
    if (leftRatio !== null && rightRatio !== null && leftRatio !== rightRatio) {
      return leftRatio - rightRatio;
    }

    return String(left.departmentName || left.departmentCode).localeCompare(
      String(right.departmentName || right.departmentCode),
      'fr',
      { numeric: true }
    );
  };
}

function transitionText(row) {
  if (!row.previousPublishedLevel) return 'Nouveau';

  if (row.previousPublishedLevel === row.publishedLevel) {
    return 'Stable';
  }

  return (
    getLevelLabel(row.previousPublishedLevel) +
    ' → ' +
    getLevelLabel(row.publishedLevel)
  );
}

function buildPublicationAngles(rows) {
  const comparableRows = rows.filter(
    (row) => row.previousActiveOffersCount !== null
  );

  const mostTense = [...rows]
    .filter((row) => optionalNumber(row.observedVsExpectedRatio) !== null)
    .sort((left, right) =>
      Number(left.observedVsExpectedRatio) -
      Number(right.observedVsExpectedRatio)
    )[0] || null;

  const strongestDecline = [...comparableRows]
    .map((row) => ({
      ...row,
      changeRatio: percentChange(
        row.activeOffersCount,
        row.previousActiveOffersCount
      ),
    }))
    .filter((row) => row.changeRatio !== null)
    .sort((left, right) => left.changeRatio - right.changeRatio)[0] || null;

  const strongestWorsening = [...rows]
    .filter((row) => row.transitionDirection === 'worsened')
    .sort((left, right) =>
      levelRank(right.publishedLevel) - levelRank(left.publishedLevel)
    )[0] || null;

  return {
    mostTense,
    strongestDecline,
    strongestWorsening,
  };
}

export default function AdminStatsPage() {
  const [romeCode, setRomeCode] = useState(initialRomeFromLocation);
  const [romeLabel, setRomeLabel] = useState('');
  const [historyLimit, setHistoryLimit] = useState(30);
  const [rankingMode, setRankingMode] = useState('pressure');
  const [stats, setStats] = useState(null);
  const [selectedDepartmentCode, setSelectedDepartmentCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');

  useEffect(() => {
    let alive = true;

    async function loadStats() {
      if (!romeCode) {
        setStats(null);
        setError('');
        setSelectedDepartmentCode('');
        return;
      }

      try {
        setLoading(true);
        setError('');

        const result = await getOccupationPublicationStats(romeCode, {
          historyLimit,
        });

        if (!alive) return;

        setStats(result);
        setRomeLabel(result?.romeLabel || romeCode);

        const firstDepartment =
          result?.ranking?.find((row) => row.departmentCode)?.departmentCode ||
          '';

        setSelectedDepartmentCode((current) =>
          current &&
          result?.ranking?.some(
            (row) => row.departmentCode === current
          )
            ? current
            : firstDepartment
        );
      } catch (currentError) {
        if (!alive) return;

        setStats(null);
        setError(
          currentError?.message ||
            'Impossible de charger les statistiques de publication.'
        );
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadStats();

    return () => {
      alive = false;
    };
  }, [historyLimit, romeCode]);

  const rankingRows = useMemo(() => {
    const rows = Array.isArray(stats?.ranking) ? [...stats.ranking] : [];
    return rows.sort(rankingComparator(rankingMode));
  }, [rankingMode, stats?.ranking]);

  const selectedDepartment = useMemo(
    () =>
      rankingRows.find(
        (row) => row.departmentCode === selectedDepartmentCode
      ) || null,
    [rankingRows, selectedDepartmentCode]
  );

  const selectedDepartmentHistory = useMemo(
    () =>
      selectedDepartmentCode
        ? stats?.departmentHistory?.[selectedDepartmentCode] || []
        : [],
    [selectedDepartmentCode, stats?.departmentHistory]
  );

  const angles = useMemo(
    () => buildPublicationAngles(Array.isArray(stats?.ranking) ? stats.ranking : []),
    [stats?.ranking]
  );

  function selectOccupation(selection) {
    const nextRome = normalizeRomeCode(selection?.romeCode);
    if (!nextRome) return;

    const params = new URLSearchParams(window.location.search);
    params.set('rome', nextRome);

    window.history.replaceState(
      {},
      '',
      window.location.pathname + '?' + params.toString()
    );

    setRomeCode(nextRome);
    setRomeLabel(selection?.label || selection?.trainingLabel || nextRome);
  }

  async function copyAngle(text) {
    if (!text || !navigator?.clipboard) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice('Texte copié');
      window.setTimeout(() => setCopyNotice(''), 1600);
    } catch {
      setCopyNotice('Copie impossible');
      window.setTimeout(() => setCopyNotice(''), 1600);
    }
  }

  const summary = stats?.summary || null;
  const latestHistory = stats?.history?.at(-1) || null;
  const publicationDate = stats?.run?.date || null;

  const mostTenseCopy = angles.mostTense
    ? (romeLabel || romeCode) +
      ' : ' +
      (angles.mostTense.departmentName || angles.mostTense.departmentCode) +
      ' affiche ' +
      formatNumber(angles.mostTense.activeOffersCount, 0) +
      ' offre(s) observée(s) pour ' +
      formatNumber(angles.mostTense.expectedOffers, 1) +
      ' attendue(s), soit ' +
      formatPercent(angles.mostTense.observedVsExpectedRatio) +
      ' du niveau attendu.'
    : '';

  const declineCopy = angles.strongestDecline
    ? (romeLabel || romeCode) +
      ' : la plus forte baisse observée concerne ' +
      (angles.strongestDecline.departmentName ||
        angles.strongestDecline.departmentCode) +
      ', avec ' +
      signedPercent(angles.strongestDecline.changeRatio) +
      ' d’offres entre les deux dernières publications.'
    : '';

  const worseningCopy = angles.strongestWorsening
    ? (romeLabel || romeCode) +
      ' : ' +
      (angles.strongestWorsening.departmentName ||
        angles.strongestWorsening.departmentCode) +
      ' passe de ' +
      getLevelLabel(angles.strongestWorsening.previousPublishedLevel) +
      ' à ' +
      getLevelLabel(angles.strongestWorsening.publishedLevel) +
      ' sur la dernière publication.'
    : '';

  return (
    <AdminLayout>
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Stats & publications</p>
          <h1>Observatoire éditorial</h1>
          <p>
            Classements, évolutions et historiques issus uniquement des runs
            métiers effectivement publiés.
          </p>
        </div>

        <div className="admin-console-page-status">
          <span className="admin-console-live-dot" />
          <span>
            <strong>{publicationDate || 'Aucune publication'}</strong>
            <small>Dernier run métier publié</small>
          </span>
        </div>
      </section>

      <section className="panel admin-stats-filter-panel">
        <div className="section-heading">
          <div>
            <p className="kicker">Périmètre</p>
            <h2>Choisir le métier à analyser</h2>
          </div>

          <div className="admin-stats-period-switch">
            {[7, 30, 60].map((days) => (
              <button
                type="button"
                key={days}
                className={historyLimit === days ? 'active' : ''}
                onClick={() => setHistoryLimit(days)}
              >
                {days} j
              </button>
            ))}
          </div>
        </div>

        <OccupationSearch
          onOccupationSelect={selectOccupation}
          initialRomeCode={romeCode}
          initialLabel={romeLabel}
        />

        <p className="date-line">
          Cette page ne simule pas et ne recalcule pas la vigilance. Elle lit
          uniquement l’historique des publications enregistrées.
        </p>
      </section>

      {!romeCode ? (
        <section className="panel admin-console-empty-state">
          <FiBarChart2 aria-hidden="true" />
          <strong>Choisissez un métier</strong>
          <p>
            Le classement national et l’historique se chargeront à partir des
            runs publiés de ce code ROME.
          </p>
        </section>
      ) : null}

      {loading ? (
        <section className="admin-console-loading">
          <span className="admin-console-loader" />
          <div>
            <strong>Chargement des statistiques</strong>
            <p>Lecture des publications métier et de leur historique.</p>
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="admin-console-alert admin-console-alert-error">
          <strong>Statistiques indisponibles</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {!loading && !error && romeCode && stats && !stats.run ? (
        <section className="panel admin-console-empty-state">
          <FiClock aria-hidden="true" />
          <strong>Aucun historique publié pour ce métier</strong>
          <p>
            Le métier est connu, mais aucun run publié n’est disponible sur la
            période interrogée.
          </p>
        </section>
      ) : null}

      {!loading && !error && summary && stats?.run ? (
        <>
          <section className="admin-console-overview-grid">
            <MetricCard
              label="Offres observées"
              value={formatNumber(summary.totalObservedOffers, 0)}
              detail={
                signedNumber(summary.totalObservedDelta, 0) +
                ' · ' +
                signedPercent(summary.totalObservedChangeRatio) +
                ' vs publication précédente'
              }
            />
            <MetricCard
              label="Niveau attendu"
              value={formatNumber(summary.totalExpectedOffers, 0)}
              detail={
                signedNumber(summary.totalExpectedDelta, 1) +
                ' · ' +
                signedPercent(summary.totalExpectedChangeRatio) +
                ' vs publication précédente'
              }
            />
            <MetricCard
              label="Orange ou rouge"
              value={formatNumber(summary.elevatedDepartments, 0)}
              detail={
                formatNumber(summary.levels?.orange, 0) +
                ' orange · ' +
                formatNumber(summary.levels?.red, 0) +
                ' rouge'
              }
            />
            <MetricCard
              label="Changements de niveau"
              value={formatNumber(summary.transitions?.changedCount, 0)}
              detail={
                formatNumber(summary.transitions?.worsenedCount, 0) +
                ' dégradation(s) · ' +
                formatNumber(summary.transitions?.improvedCount, 0) +
                ' amélioration(s)'
              }
            />
          </section>

          <section className="admin-stats-two-columns">
            <article className="panel">
              <div className="section-heading">
                <div>
                  <p className="kicker">Historique national</p>
                  <h2>Observé face au niveau attendu</h2>
                </div>
                <span className="soft-pill">
                  {stats.history?.length || 0} publication
                  {(stats.history?.length || 0) > 1 ? 's' : ''}
                </span>
              </div>

              <AdminStatsLineChart
                points={stats.history || []}
                observedKey="totalObservedOffers"
                expectedKey="totalExpectedOffers"
                ratioKey="observedVsExpectedRatio"
                height={310}
              />
            </article>

            <article className="panel">
              <div className="section-heading">
                <div>
                  <p className="kicker">Répartition actuelle</p>
                  <h2>Niveaux de vigilance</h2>
                </div>
                <span className="soft-pill">{publicationDate}</span>
              </div>

              <div className="admin-stats-level-summary">
                {['green', 'yellow', 'orange', 'red'].map((level) => (
                  <div key={level}>
                    <span
                      className={
                        'vigilance-badge vigilance-' +
                        getLevelCss(level)
                      }
                    >
                      {getLevelLabel(level)}
                    </span>
                    <strong>
                      {formatNumber(summary.levels?.[level], 0)}
                    </strong>
                    <small>département(s)</small>
                  </div>
                ))}
              </div>

              <div className="admin-stats-current-ratio">
                <span>Ratio national observé / attendu</span>
                <strong>
                  {formatPercent(latestHistory?.observedVsExpectedRatio)}
                </strong>
              </div>
            </article>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Classement national</p>
                <h2>Départements pour {romeLabel || romeCode}</h2>
              </div>

              <label className="admin-console-select admin-stats-ranking-select">
                <span className="sr-only">Critère de classement</span>
                <select
                  value={rankingMode}
                  onChange={(event) => setRankingMode(event.target.value)}
                >
                  <option value="pressure">Plus sous le niveau attendu</option>
                  <option value="vigilance">Vigilance la plus forte</option>
                  <option value="decline">Plus forte baisse d’offres</option>
                  <option value="improvement">Plus forte hausse d’offres</option>
                  <option value="offers">Plus grand volume d’offres</option>
                </select>
              </label>
            </div>

            <div className="table-wrapper">
              <table className="simple-table admin-stats-ranking-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Département</th>
                    <th>Vigilance</th>
                    <th>Transition</th>
                    <th>Offres</th>
                    <th>Variation</th>
                    <th>Attendu</th>
                    <th>Ratio</th>
                    <th>Confiance</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rankingRows.map((row, index) => {
                    const change = percentChange(
                      row.activeOffersCount,
                      row.previousActiveOffersCount
                    );

                    return (
                      <tr
                        key={row.id || row.departmentCode}
                        className={
                          selectedDepartmentCode === row.departmentCode
                            ? 'is-selected'
                            : ''
                        }
                      >
                        <td>
                          <strong>{index + 1}</strong>
                        </td>
                        <td>
                          <strong>
                            {row.departmentName || row.departmentCode}
                          </strong>
                          <div className="date-line">
                            {row.departmentCode}
                          </div>
                        </td>
                        <td>
                          <span
                            className={
                              'vigilance-badge vigilance-' +
                              getLevelCss(row.publishedLevel)
                            }
                          >
                            {getLevelLabel(row.publishedLevel)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              'admin-transition-direction is-' +
                              (row.transitionDirection || 'unchanged')
                            }
                          >
                            {transitionText(row)}
                          </span>
                        </td>
                        <td>
                          <strong>
                            {formatNumber(row.activeOffersCount, 0)}
                          </strong>
                          {row.previousActiveOffersCount !== null ? (
                            <div className="date-line">
                              avant {formatNumber(
                                row.previousActiveOffersCount,
                                0
                              )}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span
                            className={
                              'admin-delta ' +
                              (change === null || change === 0
                                ? 'is-neutral'
                                : change > 0
                                  ? 'is-positive'
                                  : 'is-negative')
                            }
                          >
                            {signedPercent(change)}
                          </span>
                        </td>
                        <td>{formatNumber(row.expectedOffers, 1)}</td>
                        <td>
                          <strong>
                            {formatPercent(row.observedVsExpectedRatio)}
                          </strong>
                        </td>
                        <td>{row.confidenceLevel || '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-detail-button"
                            onClick={() =>
                              setSelectedDepartmentCode(row.departmentCode)
                            }
                          >
                            Historique
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {selectedDepartment ? (
            <section className="panel admin-stats-department-history">
              <div className="section-heading">
                <div>
                  <p className="kicker">Historique départemental</p>
                  <h2>
                    {selectedDepartment.departmentName ||
                      selectedDepartment.departmentCode}
                  </h2>
                  <p className="date-line">
                    {romeLabel || romeCode} · {selectedDepartment.departmentCode}
                  </p>
                </div>

                <span
                  className={
                    'vigilance-badge vigilance-' +
                    getLevelCss(selectedDepartment.publishedLevel)
                  }
                >
                  {getLevelLabel(selectedDepartment.publishedLevel)}
                </span>
              </div>

              <AdminStatsLineChart
                points={selectedDepartmentHistory}
                observedKey="activeOffersCount"
                expectedKey="expectedOffers"
                ratioKey="observedVsExpectedRatio"
                height={330}
              />

              <div className="admin-stats-level-timeline">
                {selectedDepartmentHistory.map((point) => (
                  <div key={point.date}>
                    <span>{point.date}</span>
                    <span
                      className={
                        'vigilance-badge vigilance-' +
                        getLevelCss(point.publishedLevel)
                      }
                    >
                      {getLevelLabel(point.publishedLevel)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Aide éditoriale</p>
                <h2>Angles de publication</h2>
                <p className="date-line">
                  Synthèses calculées depuis les données publiées. À relire
                  avant diffusion externe.
                </p>
              </div>
              {copyNotice ? (
                <span className="soft-pill">{copyNotice}</span>
              ) : null}
            </div>

            <div className="admin-stats-publication-grid">
              <article>
                <span className="admin-stats-angle-icon">
                  <FiBarChart2 aria-hidden="true" />
                </span>
                <p>Plus sous le niveau attendu</p>
                <strong>
                  {angles.mostTense
                    ? angles.mostTense.departmentName ||
                      angles.mostTense.departmentCode
                    : '—'}
                </strong>
                <small>
                  {angles.mostTense
                    ? formatPercent(
                        angles.mostTense.observedVsExpectedRatio
                      ) + ' du niveau attendu'
                    : 'Pas de donnée comparable'}
                </small>
                <button
                  type="button"
                  onClick={() => copyAngle(mostTenseCopy)}
                  disabled={!mostTenseCopy}
                >
                  <FiCopy aria-hidden="true" />
                  Copier l’angle
                </button>
              </article>

              <article>
                <span className="admin-stats-angle-icon">
                  <FiTrendingDown aria-hidden="true" />
                </span>
                <p>Plus forte baisse d’offres</p>
                <strong>
                  {angles.strongestDecline
                    ? angles.strongestDecline.departmentName ||
                      angles.strongestDecline.departmentCode
                    : '—'}
                </strong>
                <small>
                  {angles.strongestDecline
                    ? signedPercent(angles.strongestDecline.changeRatio)
                    : 'Pas de comparaison disponible'}
                </small>
                <button
                  type="button"
                  onClick={() => copyAngle(declineCopy)}
                  disabled={!declineCopy}
                >
                  <FiCopy aria-hidden="true" />
                  Copier l’angle
                </button>
              </article>

              <article>
                <span className="admin-stats-angle-icon">
                  <FiTrendingUp aria-hidden="true" />
                </span>
                <p>Dégradation de vigilance</p>
                <strong>
                  {angles.strongestWorsening
                    ? angles.strongestWorsening.departmentName ||
                      angles.strongestWorsening.departmentCode
                    : '—'}
                </strong>
                <small>
                  {angles.strongestWorsening
                    ? transitionText(angles.strongestWorsening)
                    : 'Aucune dégradation de niveau'}
                </small>
                <button
                  type="button"
                  onClick={() => copyAngle(worseningCopy)}
                  disabled={!worseningCopy}
                >
                  <FiCopy aria-hidden="true" />
                  Copier l’angle
                </button>
              </article>
            </div>
          </section>
        </>
      ) : null}
    </AdminLayout>
  );
}
