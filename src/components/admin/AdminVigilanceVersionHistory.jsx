import React, { useEffect, useMemo, useState } from 'react';
import {
  compareOccupationVigilanceConfigVersions,
  getOccupationVigilanceConfigHistory,
} from '../../services/adminVigilanceModelService.js';
import {
  getLevelCss,
  getLevelLabel,
} from '../../utils/levelUtils.js';

function formatDateTime(value) {
  if (!value) return 'Date inconnue';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatNumber(value, maximumFractionDigits = 2) {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits,
  }).format(number);
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

function getPath(value, path) {
  return String(path || '')
    .split('.')
    .reduce(
      (current, key) =>
        current && typeof current === 'object'
          ? current[key]
          : undefined,
      value
    );
}

const PARAMETER_ROWS = [
  {
    label: 'Version de calcul',
    path: 'calculationVersion',
    format: (value) => value || '—',
  },
  {
    label: 'Population de référence 15–29 ans',
    path: 'referencePopulation15To29',
    format: (value) => formatNumber(value, 0),
  },
  {
    label: 'Plancher d’offres attendu',
    path: 'expectedOffersFloor',
    format: (value) => formatNumber(value),
  },
  {
    label: 'Minimum absolu pour être vert',
    path: 'minimumGreenActiveOffers',
    format: (value) => formatNumber(value, 0),
  },
  {
    label: 'Seuil vert',
    path: 'thresholds.greenMinRatio',
    format: formatPercent,
  },
  {
    label: 'Seuil jaune',
    path: 'thresholds.yellowMinRatio',
    format: formatPercent,
  },
  {
    label: 'Seuil orange',
    path: 'thresholds.orangeMinRatio',
    format: formatPercent,
  },
  {
    label: 'Poids tendance interannuelle',
    path: 'historicalTrend.weight',
    format: formatPercent,
  },
  {
    label: 'Bande de stabilité interannuelle',
    path: 'historicalTrend.stableBand',
    format: formatPercent,
  },
  {
    label: 'Historique minimal',
    path: 'historicalTrend.minimumYears',
    format: (value) =>
      value === null || value === undefined
        ? '—'
        : String(value) + ' ans',
  },
  {
    label: 'Facteur historique minimum',
    path: 'historicalTrend.minFactor',
    format: (value) => formatNumber(value),
  },
  {
    label: 'Facteur historique maximum',
    path: 'historicalTrend.maxFactor',
    format: (value) => formatNumber(value),
  },
  {
    label: 'Pression par formation',
    path: 'coefficients.trainingPressurePerFormation',
    format: (value) => formatNumber(value, 4),
  },
  {
    label: 'Seuil concentration employeur',
    path: 'coefficients.lowDiversityConcentrationThreshold',
    format: formatPercent,
  },
  {
    label: 'Facteur fragilité employeur',
    path: 'coefficients.lowDiversityFactor',
    format: (value) => formatNumber(value),
  },
  {
    label: 'Bornes facteur population',
    path: 'factorBounds.population',
    format: (value) =>
      value
        ? formatNumber(value.min) + ' → ' + formatNumber(value.max)
        : '—',
  },
  {
    label: 'Bornes saisonnalité',
    path: 'factorBounds.seasonality',
    format: (value) =>
      value
        ? formatNumber(value.min) + ' → ' + formatNumber(value.max)
        : '—',
  },
  {
    label: 'Nombre de baselines ROME',
    path: 'baselineCount',
    format: (value) => formatNumber(value, 0),
  },
  {
    label: 'Empreinte des baselines',
    path: 'baselineFingerprint',
    format: (value) => value || '—',
  },
];

function comparableValue(value) {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function impactDirectionLabel(value) {
  if (value === 'stricter') return 'Plus sévère';
  if (value === 'softer') return 'Plus souple';
  if (value === 'changed') return 'État modifié';
  return 'Identique';
}

export default function AdminVigilanceVersionHistory({
  romeCode = '',
}) {
  const [history, setHistory] = useState(null);
  const [leftVersion, setLeftVersion] = useState('');
  const [rightVersion, setRightVersion] = useState('');
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');

        const result = await getOccupationVigilanceConfigHistory();

        if (!alive) return;

        setHistory(result);

        const versions = Array.isArray(result?.versions)
          ? result.versions
          : [];

        setRightVersion(result?.activeVersion || versions[0]?.version || '');
        setLeftVersion(
          versions[1]?.version ||
            versions[0]?.version ||
            ''
        );
      } catch (currentError) {
        if (alive) {
          setError(
            currentError?.message ||
              'Impossible de charger l’historique des versions.'
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

  useEffect(() => {
    setComparison(null);
  }, [leftVersion, rightVersion, romeCode]);

  const versions = Array.isArray(history?.versions)
    ? history.versions
    : [];

  const left = useMemo(
    () =>
      versions.find(
        (version) => version.version === leftVersion
      ) || null,
    [versions, leftVersion]
  );

  const right = useMemo(
    () =>
      versions.find(
        (version) => version.version === rightVersion
      ) || null,
    [versions, rightVersion]
  );

  const parameterDiffs = useMemo(
    () =>
      PARAMETER_ROWS.map((definition) => {
        const leftValue = getPath(left, definition.path);
        const rightValue = getPath(right, definition.path);

        return {
          ...definition,
          leftValue,
          rightValue,
          changed:
            comparableValue(leftValue) !==
            comparableValue(rightValue),
        };
      }),
    [left, right]
  );

  async function compareImpact() {
    if (!leftVersion || !rightVersion || !romeCode) return;

    try {
      setComparing(true);
      setError('');

      const result =
        await compareOccupationVigilanceConfigVersions(
          leftVersion,
          rightVersion,
          romeCode
        );

      setComparison(result);
    } catch (currentError) {
      setComparison(null);
      setError(
        currentError?.message ||
          'Impossible de comparer l’impact des versions.'
      );
    } finally {
      setComparing(false);
    }
  }

  return (
    <section className="admin-version-history">
      <div className="section-heading">
        <div>
          <p className="kicker">Traçabilité</p>
          <h3>Historique des versions du moteur</h3>
        </div>
        {history?.activeVersion ? (
          <span className="soft-pill">
            Active : {history.activeVersion}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="state-box">
          Chargement de l’historique...
        </div>
      ) : null}

      {error ? (
        <div className="state-box error-box" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && versions.length === 0 ? (
        <div className="state-box">
          Aucune version validée disponible.
        </div>
      ) : null}

      {!loading && versions.length > 0 ? (
        <>
          <div className="table-wrapper">
            <table className="simple-table admin-version-list-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Validation</th>
                  <th>Par</th>
                  <th>Base</th>
                  <th>Baselines</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.version}>
                    <td>
                      <strong>{version.version}</strong>
                      {version.version === history.activeVersion ? (
                        <span className="soft-pill admin-active-version-pill">
                          Active
                        </span>
                      ) : null}
                    </td>
                    <td>{formatDateTime(version.validatedAt)}</td>
                    <td>
                      {version.validatedBy?.email ||
                        version.validatedBy?.uid ||
                        'Automatique / non renseigné'}
                    </td>
                    <td>{version.baseConfigVersion || '—'}</td>
                    <td>
                      {formatNumber(version.baselineCount, 0)}
                      <div className="date-line">
                        {version.baselineFingerprint || '—'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-version-compare-controls">
            <label>
              <span>Version A</span>
              <select
                value={leftVersion}
                onChange={(event) =>
                  setLeftVersion(event.target.value)
                }
              >
                {versions.map((version) => (
                  <option
                    key={'left_' + version.version}
                    value={version.version}
                  >
                    {version.version}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Version B</span>
              <select
                value={rightVersion}
                onChange={(event) =>
                  setRightVersion(event.target.value)
                }
              >
                {versions.map((version) => (
                  <option
                    key={'right_' + version.version}
                    value={version.version}
                  >
                    {version.version}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {left && right ? (
            <div className="table-wrapper">
              <table className="simple-table admin-version-diff-table">
                <thead>
                  <tr>
                    <th>Paramètre</th>
                    <th>Version A</th>
                    <th>Version B</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {parameterDiffs.map((item) => (
                    <tr
                      key={item.path}
                      className={item.changed ? 'is-changed' : ''}
                    >
                      <td>{item.label}</td>
                      <td>{item.format(item.leftValue)}</td>
                      <td>{item.format(item.rightValue)}</td>
                      <td>
                        {item.changed ? 'Modifié' : 'Identique'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="admin-config-actions">
            <button
              type="button"
              className="admin-detail-button"
              disabled={
                comparing ||
                !romeCode ||
                !leftVersion ||
                !rightVersion
              }
              onClick={compareImpact}
            >
              {comparing
                ? 'Comparaison…'
                : romeCode
                  ? 'Comparer l’impact sur ' + romeCode
                  : 'Choisir un métier pour comparer l’impact'}
            </button>
          </div>

          {comparison?.summary ? (
            <section className="admin-version-impact">
              <div className="section-heading">
                <div>
                  <p className="kicker">Même jeu de données</p>
                  <h3>
                    Impact territorial —{' '}
                    {comparison.romeLabel || comparison.romeCode}
                  </h3>
                </div>
                <span className="soft-pill">
                  Run du {comparison.run?.date || '—'}
                </span>
              </div>

              <div className="admin-simulation-summary-grid">
                <div>
                  <span>Départements</span>
                  <strong>
                    {formatNumber(
                      comparison.summary.departmentsCount,
                      0
                    )}
                  </strong>
                </div>
                <div>
                  <span>Changements</span>
                  <strong>
                    {formatNumber(
                      comparison.summary.changedCount,
                      0
                    )}
                  </strong>
                </div>
                <div>
                  <span>Version B plus sévère</span>
                  <strong>
                    {formatNumber(
                      comparison.summary.stricterCount,
                      0
                    )}
                  </strong>
                </div>
                <div>
                  <span>Version B plus souple</span>
                  <strong>
                    {formatNumber(
                      comparison.summary.softerCount,
                      0
                    )}
                  </strong>
                </div>
              </div>

              <div className="table-wrapper">
                <table className="simple-table admin-simulation-level-table">
                  <thead>
                    <tr>
                      <th>Niveau</th>
                      <th>Version A</th>
                      <th>Version B</th>
                      <th>Écart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      'green',
                      'yellow',
                      'orange',
                      'red',
                      'insufficient_data',
                    ].map((level) => {
                      const leftCount =
                        Number(
                          comparison.summary.leftLevels?.[level]
                        ) || 0;
                      const rightCount =
                        Number(
                          comparison.summary.rightLevels?.[level]
                        ) || 0;

                      return (
                        <tr key={level}>
                          <td>
                            <span
                              className={
                                'vigilance-badge vigilance-' +
                                getLevelCss(level)
                              }
                            >
                              {getLevelLabel(level)}
                            </span>
                          </td>
                          <td>{formatNumber(leftCount, 0)}</td>
                          <td>{formatNumber(rightCount, 0)}</td>
                          <td>
                            {rightCount - leftCount > 0 ? '+' : ''}
                            {formatNumber(
                              rightCount - leftCount,
                              0
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {comparison.summary.changedCount > 0 ? (
                <div className="table-wrapper">
                  <table className="simple-table admin-version-impact-table">
                    <thead>
                      <tr>
                        <th>Département</th>
                        <th>Version A</th>
                        <th>Version B</th>
                        <th>Attendu A</th>
                        <th>Attendu B</th>
                        <th>Effet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows
                        .filter((row) => row.changed)
                        .map((row) => (
                          <tr key={row.departmentCode}>
                            <td>
                              <strong>
                                {row.departmentName ||
                                  row.departmentCode}
                              </strong>
                              <div className="date-line">
                                {row.departmentCode}
                              </div>
                            </td>
                            <td>
                              <span
                                className={
                                  'vigilance-badge vigilance-' +
                                  getLevelCss(row.leftLevel)
                                }
                              >
                                {getLevelLabel(row.leftLevel)}
                              </span>
                            </td>
                            <td>
                              <span
                                className={
                                  'vigilance-badge vigilance-' +
                                  getLevelCss(row.rightLevel)
                                }
                              >
                                {getLevelLabel(row.rightLevel)}
                              </span>
                            </td>
                            <td>
                              {formatNumber(
                                row.leftExpectedOffers,
                                1
                              )}
                            </td>
                            <td>
                              {formatNumber(
                                row.rightExpectedOffers,
                                1
                              )}
                            </td>
                            <td>
                              {impactDirectionLabel(row.direction)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="date-line">
                  Les deux versions produisent les mêmes couleurs sur ce run
                  pour le métier sélectionné.
                </p>
              )}

              <p className="date-line">
                Les deux versions sont rejouées sur exactement les mêmes
                snapshots du run indiqué. Cette comparaison ne publie rien.
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
