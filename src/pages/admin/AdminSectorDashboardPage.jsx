import React, { useEffect, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { getActiveOccupationVigilanceConfig } from '../../services/adminVigilanceModelService.js';

function formatNumber(value) {
  if (value === null || value === undefined) return 'Indisponible';
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatPercent(value) {
  if (value === null || value === undefined) return 'Indisponible';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(Number(value));
}

export default function AdminSectorDashboardPage() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setError('');
        const result = await getActiveOccupationVigilanceConfig();
        if (alive) setConfig(result);
      } catch (currentError) {
        if (alive) {
          setError(
            currentError?.message ||
              'Impossible de charger la configuration du moteur métier.'
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

  const thresholds = config?.thresholds || {};
  const history = config?.historicalTrend || {};

  return (
    <AdminLayout>
      <section className="admin-page-heading">
        <p className="kicker">Analyse métier</p>
        <h1>Moteur de vigilance métiers</h1>
        <p>
          La carte nationale reste automatique. Cette vue expose les paramètres
          qui transforment les offres observées en seuils propres à chaque
          département et à chaque métier ROME.
        </p>
      </section>

      {loading ? (
        <section className="panel state-box">
          Chargement de la configuration active...
        </section>
      ) : null}

      {error ? (
        <section className="panel error-box">
          Impossible de charger le moteur : {error}
        </section>
      ) : null}

      {!loading && !error && !config ? (
        <section className="panel error-box">
          Aucune configuration métier validée n’est disponible.
        </section>
      ) : null}

      {!loading && !error && config ? (
        <>
          <section className="metrics-grid">
            <MetricCard
              label="Version de calcul"
              value={config.calculationVersion || 'Inconnue'}
              detail={'Configuration ' + (config.version || config.id)}
            />
            <MetricCard
              label="Population de référence"
              value={formatNumber(config.referencePopulation15To29)}
              detail="Population 15–29 ans utilisée pour mettre les volumes à l’échelle"
            />
            <MetricCard
              label="Poids tendance historique"
              value={formatPercent(history.weight)}
              detail="Influence maximale de la tendance interannuelle sur le niveau attendu"
            />
            <MetricCard
              label="Historique minimal"
              value={
                history.minimumYears
                  ? String(history.minimumYears) + ' ans'
                  : 'Non paramétré'
              }
              detail="Années comparables requises avant activation de la tendance de fond"
            />
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Seuils</p>
                <h2>Ratios de vigilance</h2>
              </div>
              <span className="soft-pill">
                Carte calculée automatiquement
              </span>
            </div>

            <div className="table-wrapper">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Niveau</th>
                    <th>Condition minimale</th>
                    <th>Lecture</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Vert</td>
                    <td>{formatPercent(thresholds.greenMinRatio)}</td>
                    <td>
                      Les offres observées atteignent au moins cette part du
                      volume attendu localement.
                    </td>
                  </tr>
                  <tr>
                    <td>Jaune</td>
                    <td>{formatPercent(thresholds.yellowMinRatio)}</td>
                    <td>Le marché est sous son niveau attendu mais reste proche.</td>
                  </tr>
                  <tr>
                    <td>Orange</td>
                    <td>{formatPercent(thresholds.orangeMinRatio)}</td>
                    <td>L’écart à la normalité locale devient significatif.</td>
                  </tr>
                  <tr>
                    <td>Rouge</td>
                    <td>
                      Sous {formatPercent(thresholds.orangeMinRatio)}
                    </td>
                    <td>Le volume observé est très inférieur au niveau attendu.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="date-line">
              Ces ratios sont convertis en nombres d’offres différents pour
              chaque département × métier après application des coefficients.
            </p>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Normalité locale</p>
                <h2>Facteurs qui déplacent les seuils</h2>
              </div>
            </div>

            <div className="table-wrapper">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Facteur</th>
                    <th>Bornes / réglage</th>
                    <th>Rôle</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Population 15–29 ans</td>
                    <td>
                      {formatNumber(config.factorBounds?.population?.min)}
                      {' → '}
                      {formatNumber(config.factorBounds?.population?.max)}
                    </td>
                    <td>
                      Ajuste la quantité d’offres attendue à la taille du
                      public potentiel du département.
                    </td>
                  </tr>
                  <tr>
                    <td>Saisonnalité</td>
                    <td>
                      {formatNumber(config.factorBounds?.seasonality?.min)}
                      {' → '}
                      {formatNumber(config.factorBounds?.seasonality?.max)}
                    </td>
                    <td>
                      Compare la période actuelle au comportement habituel du
                      métier dans ce département.
                    </td>
                  </tr>
                  <tr>
                    <td>Tendance interannuelle</td>
                    <td>
                      {formatNumber(history.minFactor)}
                      {' → '}
                      {formatNumber(history.maxFactor)}
                    </td>
                    <td>
                      Prend en compte l’évolution des mêmes périodes des années
                      précédentes sans laisser la tendance dominer le calcul.
                    </td>
                  </tr>
                  <tr>
                    <td>Formations</td>
                    <td>
                      {formatNumber(
                        config.coefficients?.trainingPressurePerFormation
                      )}
                      {' / formation'}
                    </td>
                    <td>
                      Peut augmenter le niveau attendu lorsque davantage de
                      candidats arrivent sur le marché.
                    </td>
                  </tr>
                  <tr>
                    <td>Diversité employeur</td>
                    <td>
                      Seuil{' '}
                      {formatPercent(
                        config.coefficients
                          ?.lowDiversityConcentrationThreshold
                      )}
                    </td>
                    <td>
                      Renforce la fragilité lorsqu’une part importante des
                      offres dépend de très peu d’employeurs.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Historique</p>
                <h2>Référence utilisée</h2>
              </div>
            </div>

            <p>
              La normalité saisonnière actuelle est calculée à partir des
              statistiques mensuelles historiques du même couple département ×
              métier. La tendance interannuelle compare les mêmes mois des
              années précédentes. Une granularité hebdomadaire pourra remplacer
              cette référence lorsque l’historique hebdomadaire sera
              suffisamment long.
            </p>

            <div className="metrics-grid">
              <MetricCard
                label="Fenêtre de calibration"
                value={
                  config.calibration?.windowStart &&
                  config.calibration?.windowEnd
                    ? config.calibration.windowStart + ' → ' + config.calibration.windowEnd
                    : 'Indisponible'
                }
              />
              <MetricCard
                label="Échantillons valides"
                value={formatNumber(config.calibration?.validSamplesCount)}
              />
              <MetricCard
                label="Métiers calibrés"
                value={formatNumber(config.calibration?.romeCount)}
              />
              <MetricCard
                label="Bande stable interannuelle"
                value={formatPercent(history.stableBand)}
                detail="En dessous de cette variation absolue, la tendance est considérée stable"
              />
            </div>
          </section>
        </>
      ) : null}
    </AdminLayout>
  );
}
