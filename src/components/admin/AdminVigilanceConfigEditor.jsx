import React, { useEffect, useState } from 'react';
import {
  activateOccupationVigilanceConfigDraft,
  saveOccupationVigilanceConfigDraft,
} from '../../services/adminVigilanceModelService.js';

function percentValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number * 100) : '';
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '';
}

function buildForm(config) {
  return {
    greenRatio: percentValue(config?.thresholds?.greenMinRatio),
    yellowRatio: percentValue(config?.thresholds?.yellowMinRatio),
    orangeRatio: percentValue(config?.thresholds?.orangeMinRatio),
    minimumGreenActiveOffers: numberValue(
      config?.minimumGreenActiveOffers
    ),
    historicalWeight: percentValue(config?.historicalTrend?.weight),
    historicalStableBand: percentValue(
      config?.historicalTrend?.stableBand
    ),
    historicalMinimumYears: numberValue(
      config?.historicalTrend?.minimumYears
    ),
    historicalMinFactor: numberValue(
      config?.historicalTrend?.minFactor
    ),
    historicalMaxFactor: numberValue(
      config?.historicalTrend?.maxFactor
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
  onActivated,
}) {
  const [form, setForm] = useState(() => buildForm(config));
  const [draftId, setDraftId] = useState('');
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setForm(buildForm(config));
    setDraftId('');
    setError('');
    setMessage('');
  }, [config?.version]);

  function update(key, value) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
    setDraftId('');
    setMessage('');
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
          (result.version || 'nouvelle version')
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
        n’est modifiée manuellement.
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

      <div className="admin-config-actions">
        <button
          type="button"
          className="primary-button"
          disabled={saving || activating}
          onClick={saveDraft}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer comme brouillon'}
        </button>

        <button
          type="button"
          className="admin-detail-button"
          disabled={!draftId || saving || activating}
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
