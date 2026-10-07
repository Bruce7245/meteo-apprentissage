import React, { useEffect, useState } from 'react';
import {
  activateOccupationVigilanceConfigDraft,
  previewOccupationVigilanceConfig,
  saveOccupationVigilanceConfigDraft,
} from '../../services/adminVigilanceModelService.js';
import {
  getLevelCss,
  getLevelLabel,
} from '../../utils/levelUtils.js';

function percentValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number * 100) : '';
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '';
}

function formatNumber(value, maximumFractionDigits = 1) {
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

function directionLabel(direction) {
  if (direction === 'worsened') return 'Vigilance renforcée';
  if (direction === 'improved') return 'Vigilance allégée';
  if (direction === 'changed') return 'État modifié';
  return 'Inchangé';
}

function buildForm(config) {
  return {
    greenRatio: percentValue(config?.thresholds?.greenMinRatio),
    yellowRatio: percentValue(config?.thresholds?.yellowMinRatio),
    orangeRatio: percentValue(config?.thresholds?.orangeMinRatio),
    minimumGreenActiveOffers: numberValue(
      config?.minimumGreenActiveOffers
    ),
    historicalWeight: percentValue(
      config?.historicalTrend?.weight ?? 0.5
    ),
    historicalStableBand: percentValue(
      config?.historicalTrend?.stableBand ?? 0.05
    ),
    historicalMinimumYears: numberValue(
      config?.historicalTrend?.minimumYears ?? 3
    ),
    historicalMinFactor: numberValue(
      config?.historicalTrend?.minFactor ?? 0.9
    ),
    historicalMaxFactor: numberValue(
      config?.historicalTrend?.maxFactor ?? 1.1
    ),
    trainingPressurePerFormation: numberValue(
      config?.coefficients?.trainingPressurePerFormation
    ),
    lowDiversityThreshold: percentValue(
      config?.coefficients?.lowDiversityConcentrationThreshold
    ),
    lowDiversityFactor: numberValue(
      config?.coefficients?.lowDiversityFactor
    ),
  };
}

function number(form, key) {
  const value = Number(form[key]);
  return Number.isFinite(value) ? value : null;
}

function validateForm(form) {
  const errors = [];

  const green = number(form, 'greenRatio');
  const yellow = number(form, 'yellowRatio');
  const orange = number(form, 'orangeRatio');
  const minimumGreen = number(form, 'minimumGreenActiveOffers');
  const weight = number(form, 'historicalWeight');
  const stableBand = number(form, 'historicalStableBand');
  const minimumYears = number(form, 'historicalMinimumYears');
  const minFactor = number(form, 'historicalMinFactor');
  const maxFactor = number(form, 'historicalMaxFactor');
  const training = number(form, 'trainingPressurePerFormation');
  const diversityThreshold = number(form, 'lowDiversityThreshold');
  const diversityFactor = number(form, 'lowDiversityFactor');

  if (
    green === null ||
    yellow === null ||
    orange === null ||
    !(green > yellow && yellow > orange && orange > 0)
  ) {
    errors.push('Les seuils doivent vérifier Vert > Jaune > Orange > 0.');
  }

  if (
    minimumGreen === null ||
    !Number.isInteger(minimumGreen) ||
    minimumGreen < 1
  ) {
    errors.push('Le volume minimal vert doit être un entier positif.');
  }

  if (weight === null || weight < 0 || weight > 100) {
    errors.push('Le poids historique doit être compris entre 0 et 100 %.');
  }

  if (stableBand === null || stableBand < 0) {
    errors.push('La bande de stabilité doit être positive ou nulle.');
  }

  if (
    minimumYears === null ||
    !Number.isInteger(minimumYears) ||
    minimumYears < 2
  ) {
    errors.push('Il faut au moins 2 années comparables.');
  }

  if (
    minFactor === null ||
    maxFactor === null ||
    minFactor <= 0 ||
    maxFactor <= 0 ||
    minFactor > maxFactor
  ) {
    errors.push('Les bornes historiques doivent être positives et ordonnées.');
  }

  if (training === null || training < 0) {
    errors.push('Le coefficient formation doit être positif ou nul.');
  }

  if (
    diversityThreshold === null ||
    diversityThreshold < 0 ||
    diversityThreshold > 100
  ) {
    errors.push(
      'Le seuil de concentration employeur doit être compris entre 0 et 100 %.'
    );
  }

  if (diversityFactor === null || diversityFactor < 1) {
    errors.push('Le facteur de fragilité employeur doit être au moins égal à 1.');
  }

  return errors;
}

function candidateFromForm(config, form) {
  return {
    ...config,
    status: 'draft',
    calculationVersion:
      config?.historicalTrend
        ? config.calculationVersion
        : 'occupationVigilance.v1.2',
    thresholds: {
      ...config.thresholds,
      greenMinRatio: Number(form.greenRatio) / 100,
      yellowMinRatio: Number(form.yellowRatio) / 100,
      orangeMinRatio: Number(form.orangeRatio) / 100,
    },
    minimumGreenActiveOffers: Number(form.minimumGreenActiveOffers),
    historicalTrend: {
      ...config.historicalTrend,
      weight: Number(form.historicalWeight) / 100,
      stableBand: Number(form.historicalStableBand) / 100,
      minimumYears: Number(form.historicalMinimumYears),
      minFactor: Number(form.historicalMinFactor),
      maxFactor: Number(form.historicalMaxFactor),
    },
    coefficients: {
      ...config.coefficients,
      trainingPressurePerFormation: Number(
        form.trainingPressurePerFormation
      ),
      lowDiversityConcentrationThreshold:
        Number(form.lowDiversityThreshold) / 100,
      lowDiversityFactor: Number(form.lowDiversityFactor),
    },
  };
}

export default function AdminVigilanceConfigEditor({
  config,
  romeCode = '',
  onActivated,
}) {
  const [form, setForm] = useState(() => buildForm(config));
  const [draftId, setDraftId] = useState('');
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setForm(buildForm(config));
    setDraftId('');
    setSimulation(null);
    setError('');
    setMessage('');
  }, [config?.version]);

  useEffect(() => {
    setSimulation(null);
    setError('');
  }, [romeCode]);

  function update(key, value) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
    setDraftId('');
    setSimulation(null);
    setMessage('');
  }

  async function simulate() {
    const errors = validateForm(form);

    if (errors.length > 0) {
      setError(errors.join(' '));
      setMessage('');
      setSimulation(null);
      return;
    }

    if (!romeCode) {
      setError(
        'Choisissez d’abord un métier ROME dans l’analyse pour simuler l’impact.'
      );
      setMessage('');
      setSimulation(null);
      return;
    }

    try {
      setSimulating(true);
      setError('');
      setMessage('');

      const candidate = candidateFromForm(config, form);
      const result = await previewOccupationVigilanceConfig(
        candidate,
        romeCode
      );

      setSimulation(result);
      setMessage(
        result.summary?.changedCount > 0
          ? String(result.summary.changedCount) +
              ' département(s) changeraient de niveau avec ces réglages.'
          : 'Aucun département ne changerait de niveau avec ces réglages.'
      );
    } catch (currentError) {
      const details = currentError?.payload?.validationErrors;

      setSimulation(null);
      setError(
        Array.isArray(details) && details.length > 0
          ? details.join(' ')
          : currentError?.message ||
              'Impossible de simuler cette configuration.'
      );
    } finally {
      setSimulating(false);
    }
  }

  async function saveDraft() {
    const errors = validateForm(form);

    if (errors.length > 0) {
      setError(errors.join(' '));
      setMessage('');
      return;
    }

    try {
      setSaving(true);
      setError('');
      setMessage('');

      const candidate = candidateFromForm(config, form);
      const result = await saveOccupationVigilanceConfigDraft(
        candidate,
        config.version
      );

      setDraftId(result.id);
      setMessage(
        'Brouillon enregistré. Il n’influence pas encore la carte.'
      );
    } catch (currentError) {
      setError(
        currentError?.message ||
          'Impossible d’enregistrer le brouillon.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function activateDraft() {
    if (!draftId) {
      setError('Enregistrez d’abord le brouillon courant.');
      return;
    }

    try {
      setActivating(true);
      setError('');
      setMessage('');

      const result =
        await activateOccupationVigilanceConfigDraft(draftId);

      setMessage(
        'Configuration activée : ' +
          (result.version || 'nouvelle version') +
          '. Elle sera appliquée au prochain calcul ; la carte publiée actuelle reste inchangée.'
      );
      setDraftId('');
      onActivated?.(result);
    } catch (currentError) {
      const details = currentError?.payload?.validationErrors;

      setError(
        Array.isArray(details) && details.length > 0
          ? details.join(' ')
          : currentError?.message ||
              'Impossible d’activer la configuration.'
      );
    } finally {
      setActivating(false);
    }
  }

  if (!config) return null;

  return (
    <section className="admin-config-editor">
      <div className="section-heading">
        <div>
          <p className="kicker">Réglages manuels</p>
          <h3>Préparer une nouvelle version du moteur</h3>
        </div>
        <span className="soft-pill">
          Base : {config.version || config.id}
        </span>
      </div>

      <p className="date-line">
        Les valeurs sont enregistrées en brouillon. L’activation est une action
        séparée et crée une nouvelle configuration validée ; aucune couleur
        n’est modifiée manuellement et la carte actuelle n’est pas recalculée
        immédiatement.
      </p>

      <div className="admin-config-field-grid">
        <label>
          <span>Vert à partir de</span>
          <div>
            <input
              type="number"
              step="0.1"
              value={form.greenRatio}
              onChange={(event) =>
                update('greenRatio', event.target.value)
              }
            />
            <small>% de l’attendu</small>
          </div>
        </label>

        <label>
          <span>Jaune à partir de</span>
          <div>
            <input
              type="number"
              step="0.1"
              value={form.yellowRatio}
              onChange={(event) =>
                update('yellowRatio', event.target.value)
              }
            />
            <small>% de l’attendu</small>
          </div>
        </label>

        <label>
          <span>Orange à partir de</span>
          <div>
            <input
              type="number"
              step="0.1"
              value={form.orangeRatio}
              onChange={(event) =>
                update('orangeRatio', event.target.value)
              }
            />
            <small>% de l’attendu</small>
          </div>
        </label>

        <label>
          <span>Minimum absolu pour être vert</span>
          <div>
            <input
              type="number"
              step="1"
              min="1"
              value={form.minimumGreenActiveOffers}
              onChange={(event) =>
                update(
                  'minimumGreenActiveOffers',
                  event.target.value
                )
              }
            />
            <small>offres</small>
          </div>
        </label>

        <label>
          <span>Poids tendance interannuelle</span>
          <div>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={form.historicalWeight}
              onChange={(event) =>
                update('historicalWeight', event.target.value)
              }
            />
            <small>%</small>
          </div>
        </label>

        <label>
          <span>Bande de stabilité</span>
          <div>
            <input
              type="number"
              step="0.1"
              min="0"
              value={form.historicalStableBand}
              onChange={(event) =>
                update(
                  'historicalStableBand',
                  event.target.value
                )
              }
            />
            <small>%</small>
          </div>
        </label>

        <label>
          <span>Historique minimal</span>
          <div>
            <input
              type="number"
              step="1"
              min="2"
              value={form.historicalMinimumYears}
              onChange={(event) =>
                update(
                  'historicalMinimumYears',
                  event.target.value
                )
              }
            />
            <small>années</small>
          </div>
        </label>

        <label>
          <span>Facteur historique minimum</span>
          <div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.historicalMinFactor}
              onChange={(event) =>
                update('historicalMinFactor', event.target.value)
              }
            />
            <small>multiplicateur</small>
          </div>
        </label>

        <label>
          <span>Facteur historique maximum</span>
          <div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.historicalMaxFactor}
              onChange={(event) =>
                update('historicalMaxFactor', event.target.value)
              }
            />
            <small>multiplicateur</small>
          </div>
        </label>

        <label>
          <span>Pression par formation</span>
          <div>
            <input
              type="number"
              step="0.001"
              min="0"
              value={form.trainingPressurePerFormation}
              onChange={(event) =>
                update(
                  'trainingPressurePerFormation',
                  event.target.value
                )
              }
            />
            <small>coefficient</small>
          </div>
        </label>

        <label>
          <span>Concentration employeur</span>
          <div>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={form.lowDiversityThreshold}
              onChange={(event) =>
                update(
                  'lowDiversityThreshold',
                  event.target.value
                )
              }
            />
            <small>%</small>
          </div>
        </label>

        <label>
          <span>Fragilité employeur</span>
          <div>
            <input
              type="number"
              step="0.01"
              min="1"
              value={form.lowDiversityFactor}
              onChange={(event) =>
                update('lowDiversityFactor', event.target.value)
              }
            />
            <small>multiplicateur</small>
          </div>
        </label>
      </div>

      {error ? (
        <div className="state-box error-box" role="alert">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="state-box" role="status">
          {message}
        </div>
      ) : null}

      {simulation?.summary ? (
        <section className="admin-config-simulation">
          <div className="section-heading">
            <div>
              <p className="kicker">Simulation sans publication</p>
              <h3>
                Impact sur {simulation.romeLabel || simulation.romeCode}
              </h3>
            </div>
            <span className="soft-pill">
              Run du {simulation.run?.date || '—'}
            </span>
          </div>

          <div className="admin-simulation-summary-grid">
            <div>
              <span>Départements</span>
              <strong>
                {formatNumber(
                  simulation.summary.departmentsCount,
                  0
                )}
              </strong>
            </div>
            <div>
              <span>Changements</span>
              <strong>
                {formatNumber(simulation.summary.changedCount, 0)}
              </strong>
            </div>
            <div>
              <span>Vigilance renforcée</span>
              <strong>
                {formatNumber(simulation.summary.worsenedCount, 0)}
              </strong>
            </div>
            <div>
              <span>Vigilance allégée</span>
              <strong>
                {formatNumber(simulation.summary.improvedCount, 0)}
              </strong>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="simple-table admin-simulation-level-table">
              <thead>
                <tr>
                  <th>Niveau</th>
                  <th>Actuel</th>
                  <th>Proposé</th>
                  <th>Écart</th>
                </tr>
              </thead>
              <tbody>
                {['green', 'yellow', 'orange', 'red', 'insufficient_data'].map(
                  (level) => {
                    const current =
                      Number(
                        simulation.summary.currentLevels?.[level]
                      ) || 0;
                    const proposed =
                      Number(
                        simulation.summary.proposedLevels?.[level]
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
                        <td>{formatNumber(current, 0)}</td>
                        <td>{formatNumber(proposed, 0)}</td>
                        <td>
                          {proposed - current > 0 ? '+' : ''}
                          {formatNumber(proposed - current, 0)}
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>

          {simulation.summary.changedCount > 0 ? (
            <div className="table-wrapper">
              <table className="simple-table admin-simulation-change-table">
                <thead>
                  <tr>
                    <th>Département</th>
                    <th>Actuel</th>
                    <th>Proposé</th>
                    <th>Attendu actuel</th>
                    <th>Attendu proposé</th>
                    <th>Ratio proposé</th>
                    <th>Effet</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.rows
                    .filter((row) => row.changed)
                    .map((row) => (
                      <tr key={row.departmentCode}>
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
                              getLevelCss(row.currentLevel)
                            }
                          >
                            {getLevelLabel(row.currentLevel)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              'vigilance-badge vigilance-' +
                              getLevelCss(row.proposedLevel)
                            }
                          >
                            {getLevelLabel(row.proposedLevel)}
                          </span>
                        </td>
                        <td>
                          {formatNumber(
                            row.currentExpectedOffers,
                            1
                          )}
                        </td>
                        <td>
                          {formatNumber(
                            row.proposedExpectedOffers,
                            1
                          )}
                        </td>
                        <td>
                          {formatPercent(
                            row.proposedObservedVsExpectedRatio
                          )}
                        </td>
                        <td>{directionLabel(row.direction)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="date-line">
              Les couleurs resteraient identiques dans tous les départements
              pour le métier sélectionné.
            </p>
          )}

          <p className="date-line">
            Simulation uniquement : aucune configuration, aucun snapshot et
            aucune carte publique ne sont modifiés.
          </p>
        </section>
      ) : null}

      <div className="admin-config-actions">
        <button
          type="button"
          className="admin-detail-button"
          disabled={simulating || saving || activating || !romeCode}
          onClick={simulate}
        >
          {simulating
            ? 'Simulation…'
            : romeCode
              ? 'Simuler sur ' + romeCode
              : 'Choisir un métier pour simuler'}
        </button>

        <button
          type="button"
          className="primary-button"
          disabled={saving || activating || simulating}
          onClick={saveDraft}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer comme brouillon'}
        </button>

        <button
          type="button"
          className="admin-detail-button"
          disabled={!draftId || saving || activating || simulating}
          onClick={activateDraft}
        >
          {activating
            ? 'Activation…'
            : 'Valider et activer ce brouillon'}
        </button>
      </div>
    </section>
  );
}
