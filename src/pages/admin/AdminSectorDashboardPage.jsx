import React, { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import OccupationSearch from '../../components/occupation/OccupationSearch.jsx';
import AdminVigilanceConfigEditor from '../../components/admin/AdminVigilanceConfigEditor.jsx';
import AdminVigilanceVersionHistory from '../../components/admin/AdminVigilanceVersionHistory.jsx';
import {
  getActiveOccupationVigilanceConfig,
  getOccupationAnalysisForRome,
} from '../../services/adminVigilanceModelService.js';
import { getLevelCss, getLevelLabel } from '../../utils/levelUtils.js';
import { normalizeRomeCode } from '../../utils/occupationUtils.js';
import '../../occupation.css';

function formatNumber(value, maximumFractionDigits = 2) {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits,
  }).format(number);
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(number);
}

function initialRomeFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return normalizeRomeCode(params.get('rome'));
}

function thresholdText(row) {
  const thresholds = row?.effectiveThresholds || {};

  return [
    'Vert ≥ ' + formatNumber(thresholds.greenMinOffers, 0),
    'Jaune ≥ ' + formatNumber(thresholds.yellowMinOffers, 0),
    'Orange ≥ ' + formatNumber(thresholds.orangeMinOffers, 0),
  ].join(' · ');
}

function factorLabel(value) {
  const number = optionalFiniteNumber(value);

  if (number === null) return '—';
  if (number > 1.001) return '×' + formatNumber(number) + ' ↑';
  if (number < 0.999) return '×' + formatNumber(number) + ' ↓';
  return '×1';
}

function trendLabel(trend) {
  if (!trend || trend.status === 'unavailable') return 'Historique insuffisant';
  if (trend.direction === 'degrading') return 'Dégradation';
  if (trend.direction === 'improving') return 'Amélioration';
  return 'Stable';
}

export default function AdminSectorDashboardPage() {
  const [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');

  const [romeCode, setRomeCode] = useState(initialRomeFromLocation);
  const [romeLabel, setRomeLabel] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [selectedDepartmentCode, setSelectedDepartmentCode] = useState('');

  useEffect(() => {
    let alive = true;

    async function loadConfig() {
      try {
        setConfigLoading(true);
        setConfigError('');
        const result = await getActiveOccupationVigilanceConfig();

        if (alive) setConfig(result);
      } catch (currentError) {
        if (alive) {
          setConfigError(
            currentError?.message ||
              'Impossible de charger la configuration du moteur métier.'
          );
        }
      } finally {
        if (alive) setConfigLoading(false);
      }
    }

    loadConfig();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadAnalysis() {
      if (!romeCode) {
        setAnalysis(null);
        setAnalysisError('');
        setSelectedDepartmentCode('');
        return;
      }

      try {
        setAnalysisLoading(true);
        setAnalysisError('');
        setSelectedDepartmentCode('');

        const result = await getOccupationAnalysisForRome(romeCode);

        if (alive) {
          setAnalysis(result);
          if (result?.romeLabel) setRomeLabel(result.romeLabel);
        }
      } catch (currentError) {
        if (alive) {
          setAnalysis(null);
          setAnalysisError(
            currentError?.message ||
              'Impossible de charger l’analyse nationale de ce métier.'
          );
        }
      } finally {
        if (alive) setAnalysisLoading(false);
      }
    }

    loadAnalysis();

    return () => {
      alive = false;
    };
  }, [romeCode]);

  const selectedDepartment = useMemo(
    () =>
      analysis?.rows?.find(
        (row) => row.departmentCode === selectedDepartmentCode
      ) || null,
    [analysis, selectedDepartmentCode]
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

  const thresholds = config?.thresholds || {};
  const history = config?.historicalTrend || {};
  const summary = analysis?.summary || null;

  return (
    <AdminLayout>
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Décision de vigilance</p>
          <h1>Moteur de vigilance métiers</h1>
          <p>
            Diagnostiquez le niveau calculé, ses seuils et ses facteurs avant
            toute décision ou simulation différente de la vigilance automatique.
          </p>
        </div>

        <div className="admin-console-page-status">
          <span className="admin-console-live-dot" />
          <span>
            <strong>
              {configLoading
                ? 'Configuration…'
                : config?.version || config?.id || 'Version indisponible'}
            </strong>
            <small>Configuration active du moteur</small>
          </span>
        </div>
      </section>

      <section className="panel admin-occupation-search-panel">
        <div className="section-heading">
          <div>
            <p className="kicker">Explorer</p>
            <h2>Choisir un métier ROME</h2>
          </div>
          {analysis?.run?.date ? (
            <span className="soft-pill">
              Calcul du {analysis.run.date}
            </span>
          ) : null}
        </div>

        <OccupationSearch
          onOccupationSelect={selectOccupation}
          initialRomeCode={romeCode}
          initialLabel={romeLabel}
        />

        <p className="date-line">
          L’analyse utilise le dernier run métier prêt ou publié. Elle ne
          recalcule pas la carte depuis le navigateur.
        </p>
      </section>

      {analysisLoading ? (
        <section className="panel state-box">
          Chargement des seuils et diagnostics départementaux...
        </section>
      ) : null}

      {analysisError ? (
        <section className="panel error-box" role="alert">
          {analysisError}
        </section>
      ) : null}

      {!analysisLoading && !analysisError && romeCode && analysis && !analysis.run ? (
        <section className="panel error-box">
          Aucun run de vigilance métier prêt ou publié n’est disponible.
        </section>
      ) : null}

      {!analysisLoading &&
      !analysisError &&
      analysis?.run &&
      analysis?.rows?.length === 0 ? (
        <section className="panel state-box">
          Aucun département n’est présent dans le dernier run pour {romeCode}.
        </section>
      ) : null}

      {!analysisLoading && !analysisError && summary ? (
        <>
          <section className="metrics-grid admin-analysis-summary">
            <MetricCard
              label="Départements analysés"
              value={formatNumber(summary.departmentsCount, 0)}
              detail={analysis.romeLabel || romeCode}
            />
            <MetricCard
              label="Offres observées"
              value={formatNumber(summary.totalObservedOffers, 0)}
              detail={
                'Attendu cumulé : ' +
                (summary.totalExpectedOffers === null
                  ? 'Indisponible'
                  : formatNumber(summary.totalExpectedOffers, 0)) +
                ' · calculable pour ' +
                formatNumber(summary.expectedOffersAvailableCount, 0) +
                '/' +
                formatNumber(summary.departmentsCount, 0) +
                ' départements'
              }
            />
            <MetricCard
              label="Orange ou rouge"
              value={formatNumber(summary.elevatedDepartments, 0)}
              detail={
                formatNumber(summary.levels.orange, 0) +
                ' orange · ' +
                formatNumber(summary.levels.red, 0) +
                ' rouge'
              }
            />
            <MetricCard
              label="Confiance élevée"
              value={
                formatNumber(summary.highConfidenceCount, 0) +
                ' / ' +
                formatNumber(summary.departmentsCount, 0)
              }
              detail="Diagnostics disposant du meilleur niveau de confiance"
            />
          </section>

          <section className="admin-console-data-note admin-motor-stats-note">
            <div>
              <strong>Les statistiques éditoriales sont séparées du moteur</strong>
              <p>
                Classements, variations et historiques destinés aux publications
                sont maintenant regroupés dans Stats & publications. Ici, le
                moteur reste consacré au diagnostic, à la simulation et à
                l’arbitrage de vigilance.
              </p>
              <a
                className="admin-console-inline-link"
                href={
                  '/admin/stats' +
                  (romeCode ? '?rome=' + encodeURIComponent(romeCode) : '')
                }
              >
                Ouvrir Stats & publications
              </a>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Carte expliquée</p>
                <h2>Seuils par département</h2>
              </div>
              <span className="soft-pill">
                {analysis.romeLabel || romeCode}
              </span>
            </div>

            <div className="table-wrapper">
              <table className="simple-table admin-vigilance-table">
                <thead>
                  <tr>
                    <th>Département</th>
                    <th>Niveau</th>
                    <th>Observé</th>
                    <th>Attendu</th>
                    <th>Ratio</th>
                    <th>Seuils locaux</th>
                    <th>Confiance</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.map((row) => (
                    <tr
                      key={row.id || row.departmentCode}
                      className={
                        selectedDepartmentCode === row.departmentCode
                          ? 'is-selected'
                          : ''
                      }
                    >
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
                      <td>{formatNumber(row.activeOffersCount, 0)}</td>
                      <td>{formatNumber(row.expectedOffers, 1)}</td>
                      <td>{formatPercent(row.observedVsExpectedRatio)}</td>
                      <td className="admin-threshold-cell">
                        {thresholdText(row)}
                      </td>
                      <td>{row.confidenceLevel || '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="admin-detail-button"
                          onClick={() =>
                            setSelectedDepartmentCode((current) =>
                              current === row.departmentCode
                                ? ''
                                : row.departmentCode
                            )
                          }
                        >
                          {selectedDepartmentCode === row.departmentCode
                            ? 'Fermer'
                            : 'Analyser'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selectedDepartment ? (
            <section className="panel admin-department-diagnostic">
              <div className="section-heading">
                <div>
                  <p className="kicker">Diagnostic local</p>
                  <h2>
                    {selectedDepartment.departmentName ||
                      selectedDepartment.departmentCode}
                    {' — '}
                    {analysis.romeLabel || romeCode}
                  </h2>
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

              <div className="metrics-grid">
                <MetricCard
                  label="Offres observées"
                  value={formatNumber(
                    selectedDepartment.activeOffersCount,
                    0
                  )}
                  detail={
                    'Attendu : ' +
                    formatNumber(selectedDepartment.expectedOffers, 1)
                  }
                />
                <MetricCard
                  label="Population 15–29 ans"
                  value={formatNumber(
                    selectedDepartment.population15To29,
                    0
                  )}
                  detail={
                    selectedDepartment.populationReferenceYear
                      ? 'Référence ' +
                        selectedDepartment.populationReferenceYear
                      : 'Année de référence inconnue'
                  }
                />
                <MetricCard
                  label="Évolution récente"
                  value={formatPercent(
                    selectedDepartment.recentTrend?.changeRatio
                  )}
                  detail={
                    selectedDepartment.recentTrend?.status ||
                    'Tendance inconnue'
                  }
                />
                <MetricCard
                  label="Tendance interannuelle"
                  value={formatPercent(
                    selectedDepartment.interannualTrend
                      ?.annualTrendRatio
                  )}
                  detail={trendLabel(
                    selectedDepartment.interannualTrend
                  )}
                />
              </div>

              <div className="admin-analysis-columns">
                <section className="admin-analysis-subpanel">
                  <p className="kicker">Seuils effectifs</p>
                  <h3>Ce qui déclenche la couleur</h3>
                  <dl className="admin-analysis-definition-list">
                    <div>
                      <dt>Vert</dt>
                      <dd>
                        ≥{' '}
                        {formatNumber(
                          selectedDepartment.effectiveThresholds
                            ?.greenMinOffers,
                          0
                        )}{' '}
                        offres
                      </dd>
                    </div>
                    <div>
                      <dt>Jaune</dt>
                      <dd>
                        ≥{' '}
                        {formatNumber(
                          selectedDepartment.effectiveThresholds
                            ?.yellowMinOffers,
                          0
                        )}{' '}
                        offres
                      </dd>
                    </div>
                    <div>
                      <dt>Orange</dt>
                      <dd>
                        ≥{' '}
                        {formatNumber(
                          selectedDepartment.effectiveThresholds
                            ?.orangeMinOffers,
                          0
                        )}{' '}
                        offres
                      </dd>
                    </div>
                    <div>
                      <dt>Rouge</dt>
                      <dd>
                        sous{' '}
                        {formatNumber(
                          selectedDepartment.effectiveThresholds
                            ?.orangeMinOffers,
                          0
                        )}{' '}
                        offres
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="admin-analysis-subpanel">
                  <p className="kicker">Coefficients</p>
                  <h3>Ce qui déplace le niveau attendu</h3>
                  <dl className="admin-analysis-definition-list">
                    <div>
                      <dt>Population</dt>
                      <dd>
                        {factorLabel(
                          selectedDepartment.factors?.population
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Saisonnalité</dt>
                      <dd>
                        {factorLabel(
                          selectedDepartment.factors?.seasonality
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Tendance historique</dt>
                      <dd>
                        {factorLabel(
                          selectedDepartment.factors
                            ?.historicalTrend
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Pression formation</dt>
                      <dd>
                        {factorLabel(
                          selectedDepartment.factors
                            ?.trainingPressure
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Diversité employeur</dt>
                      <dd>
                        {factorLabel(
                          selectedDepartment.factors
                            ?.diversityFragility
                        )}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="admin-analysis-subpanel">
                  <p className="kicker">Normalité historique</p>
                  <h3>Même période les années précédentes</h3>
                  <dl className="admin-analysis-definition-list">
                    <div>
                      <dt>Années comparables</dt>
                      <dd>
                        {formatNumber(
                          selectedDepartment.interannualTrend
                            ?.sampleYears,
                          0
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Médiane</dt>
                      <dd>
                        {formatNumber(
                          selectedDepartment.interannualTrend
                            ?.normalMedian,
                          1
                        )}{' '}
                        offres
                      </dd>
                    </div>
                    <div>
                      <dt>Plage centrale</dt>
                      <dd>
                        {formatNumber(
                          selectedDepartment.interannualTrend
                            ?.normalLow,
                          1
                        )}
                        {' → '}
                        {formatNumber(
                          selectedDepartment.interannualTrend
                            ?.normalHigh,
                          1
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Dernier N-1 disponible</dt>
                      <dd>
                        {formatNumber(
                          selectedDepartment.interannualTrend
                            ?.latestHistoricalOffers,
                          0
                        )}{' '}
                        offres
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>

              {Array.isArray(selectedDepartment.reasonCodes) &&
              selectedDepartment.reasonCodes.length > 0 ? (
                <div className="admin-analysis-reasons">
                  <strong>Codes explicatifs du moteur</strong>
                  <div>
                    {selectedDepartment.reasonCodes.map((reason) => (
                      <span className="soft-pill" key={reason}>
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="kicker">Paramétrage national</p>
            <h2>Configuration active du moteur</h2>
          </div>
        </div>

        {configLoading ? (
          <div className="state-box">
            Chargement de la configuration active...
          </div>
        ) : null}

        {configError ? (
          <div className="error-box">{configError}</div>
        ) : null}

        {!configLoading && !configError && !config ? (
          <div className="error-box">
            Aucune configuration métier validée n’est disponible.
          </div>
        ) : null}

        {!configLoading && !configError && config ? (
          <>
            <div className="metrics-grid">
              <MetricCard
                label="Version de calcul"
                value={config.calculationVersion || 'Inconnue'}
                detail={'Configuration ' + (config.version || config.id)}
              />
              <MetricCard
                label="Population de référence"
                value={formatNumber(
                  config.referencePopulation15To29,
                  0
                )}
                detail="Population 15–29 ans"
              />
              <MetricCard
                label="Poids tendance historique"
                value={formatPercent(history.weight)}
                detail="Influence de la tendance interannuelle"
              />
              <MetricCard
                label="Historique minimal"
                value={
                  history.minimumYears
                    ? String(history.minimumYears) + ' ans'
                    : 'Non paramétré'
                }
                detail="Avant activation de la tendance de fond"
              />
            </div>

            <div className="table-wrapper">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Niveau</th>
                    <th>Ratio minimal</th>
                    <th>Lecture</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Vert</td>
                    <td>{formatPercent(thresholds.greenMinRatio)}</td>
                    <td>Au niveau attendu ou proche.</td>
                  </tr>
                  <tr>
                    <td>Jaune</td>
                    <td>{formatPercent(thresholds.yellowMinRatio)}</td>
                    <td>Écart modéré à la normalité locale.</td>
                  </tr>
                  <tr>
                    <td>Orange</td>
                    <td>{formatPercent(thresholds.orangeMinRatio)}</td>
                    <td>Écart significatif à la normalité locale.</td>
                  </tr>
                  <tr>
                    <td>Rouge</td>
                    <td>
                      Sous {formatPercent(thresholds.orangeMinRatio)}
                    </td>
                    <td>Écart très important au niveau attendu.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="date-line">
              La normalité interannuelle est aujourd’hui mensuelle. Elle
              passera à une référence hebdomadaire quand l’historique sera
              suffisamment long et fiable.
            </p>

            <AdminVigilanceConfigEditor
              config={config}
              romeCode={romeCode}
              onActivated={() => window.location.reload()}
            />

            <AdminVigilanceVersionHistory
              romeCode={romeCode}
            />
          </>
        ) : null}
      </section>
    </AdminLayout>
  );
}
