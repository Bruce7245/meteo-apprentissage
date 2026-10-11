import React, {useEffect, useMemo, useState} from 'react';
import {
  previewAdminWeightedScores,
  saveAdminWeightedScoreDraft,
} from '../../services/adminMonthlySettingsService.js';
import './AdminWeightedScorePanel.css';
import AdminSimulationColorBadge from './AdminSimulationColorBadge.jsx';
import {ADMIN_SIMULATION_BAND_LEGEND} from '../../utils/adminSimulationColors.mjs';

const FIELDS = [
  {
    key: 'offersFoundation',
    label: 'Nombre moyen d’offres actives',
    help: '5/5 par défaut : poids de la fondation des calculs. N’est pas additionné comme un second score.',
  },
  {
    key: 'density',
    label: 'Offres pour 10 000 jeunes',
    help: '4/5 : compare la disponibilité relative des offres, en tenant compte de la population.',
  },
  {
    key: 'employers',
    label: 'Potentiel employeur',
    help: '3,5/5 partagés : 60 % densité d’établissements pour 10 000 jeunes et 40 % offres pour 100 employeurs. Données corrélées, sans double pondération.',
  },
  {
    key: 'trend',
    label: 'Évolution M−1 / M−12',
    help: '4/5 : un seul groupe de pondération, partagé entre les deux variations disponibles.',
  },
  {
    key: 'seasonality',
    label: 'Saisonnalité — poids régulateur',
    help: '2,5/5 : réservé. Tant que le correcteur vaut 1,00, aucune modification du score.',
  },
];

const formatter = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1});
const levelLabels = {
  experimental: 'Expérimental',
  indicative: 'Indicatif',
  partial: 'Partiel',
  provisional: 'Provisoire',
  unavailable: 'Non calculable',
};
function scoreText(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatter.format(value) + ' / 100' : '—';
}

export default function AdminWeightedScorePanel({month, data, onSaved}) {
  const config = data?.scoreConfig;
  const [weights, setWeights] = useState(config?.weights || {});
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState(config?.version || 0);
  const [preview, setPreview] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    setWeights({...data?.scoreConfig?.weights});
    setVersion(data?.scoreConfig?.version || 0);
    setReason('');
    setPreview(null);
    setDirty(false);
    setNotice('');
  }, [month, data]);

  function change(key, value) {
    setWeights(previous => ({...previous, [key]: Number(value)}));
    setPreview(null);
    setDirty(true);
    setNotice('');
  }

  async function runPreview() {
    setBusy('preview');
    setNotice('');
    try {
      const result = await previewAdminWeightedScores(month, weights);
      setPreview(result.scoreSimulation);
      setNotice('Simulation calculée. Aucune vigilance publiée n’a changé.');
      setDirty(false);
    } catch (error) {
      setNotice(error.message || 'Simulation indisponible');
    } finally {
      setBusy('');
    }
  }

  async function save() {
    setBusy('save');
    setNotice('');
    try {
      const result = await saveAdminWeightedScoreDraft(weights, reason, version);
      setVersion(result.version);
      setDirty(false);
      setNotice('Brouillon version ' + result.version +
        ' enregistré avec justification. Aucun seuil ni niveau publié modifié.');
      onSaved?.(result.version);
    } catch (error) {
      setNotice(error.message || 'Enregistrement impossible');
    } finally {
      setBusy('');
    }
  }

  const active = preview || data?.scoreSimulation;
  const baseline = data?.scoreSimulation;
  const baselineByCode = useMemo(() => new Map(
    (baseline?.scores || []).map(row => [row.departmentCode, row])
  ), [baseline]);
  const simulationByCode = useMemo(() => new Map(
    (active?.scores || []).map(row => [row.departmentCode, row])
  ), [active]);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr-FR');
    return (data?.departments || []).filter(row =>
      (!needle || (row.departmentName + ' ' + row.departmentCode)
        .toLocaleLowerCase('fr-FR').includes(needle)) &&
      (filter === 'all' || (simulationByCode.get(row.departmentCode)?.quality === filter))
    );
  }, [data, query, filter, simulationByCode]);

  const importanceSum = (Number(weights.offersFoundation || 0) *
    Number(weights.density || 0) / 5) +
    Number(weights.employers || 0) + Number(weights.trend || 0);
  const eligible = active?.reference?.eligibleDepartments || 0;
  const minimum = active?.reference?.minimumReferenceDepartments || 75;

  return (
    <section className="panel admin-weighted-model">
      <div className="section-heading">
        <div>
          <p className="kicker">Étape 1 · Ajustement contrôlé</p>
          <h2>Pondérations et score expérimental</h2>
        </div>
        <span className="soft-pill">Brouillon v{version} · Non publié</span>
      </div>

      <p className="date-line">
        Ce calcul est une <strong>simulation analytique</strong> et non le
        moteur qui détermine les niveaux vert, jaune, orange et rouge.
        Le score de confiance métier existant ne change pas.
      </p>

      <div className="admin-weighted-grid">
        <div className="admin-weighted-fields">
          {FIELDS.map(({key, label, help}) => (
            <label key={key} className="admin-weighted-field">
              <span className="admin-weighted-field-heading">
                <strong>{label}</strong>
                <output>{Number(weights[key] ?? 0).toLocaleString('fr-FR')} / 5</output>
              </span>
              <input type="range"
                min={key === 'offersFoundation' || key === 'density' ? '0.5' : '0'}
                max="5" step="0.5"
                value={Number(weights[key] ?? 0)}
                onChange={event => change(key, event.target.value)}
                disabled={Boolean(busy)}
                aria-label={'Importance : ' + label} />
              <small>{help}</small>
            </label>
          ))}
          <div className="admin-weighted-math">
            <strong>Poids réels utilisés</strong>
            <span>Offres × densité : <b>{formatter.format(
              Number(weights.offersFoundation || 0) * Number(weights.density || 0) / 5
            )}</b></span>
            <span>Potentiel employeur (60 %) : <b>{formatter.format(Number(weights.employers || 0) * 0.6)}</b></span>
            <span>Offres / 100 employeurs (40 %) : <b>{formatter.format(Number(weights.employers || 0) * 0.4)}</b></span>
            <span>Évolutions : <b>{formatter.format(Number(weights.trend || 0))}</b></span>
            <span>Somme des poids actifs théoriques : <b>{formatter.format(importanceSum)}</b></span>
            <span>Saisonnalité : <b>{formatter.format(Number(weights.seasonality || 0))}/5 · facteur 1,00 neutre</b></span>
          </div>
        </div>

        <div className="admin-weighted-controls">
          <div className="admin-weighted-neutral">
            <span>Coefficient saisonnier appliqué</span>
            <strong>1,00</strong>
            <small>Sans historique saisonnier validé, aucun multiplicateur
              n'est appliqué, même si un mois est déclaré « fort » ou « faible ».</small>
          </div>
          <div className="admin-weighted-metrics">
            <div><span>Référence nationale disponible</span><strong>{eligible} / 101</strong></div>
            <div><span>Minimum pour simulation</span><strong>{minimum} départements</strong></div>
            <div><span>Scores calculables</span><strong>{active?.summary?.scored || 0}</strong></div>
            {active?.mode === 'provisional_admin_only' && (
              <div><span>Mode</span><strong>Provisoire</strong></div>
            )}
            <div><span>Scores non calculables</span><strong>{active?.summary?.unavailable ?? '—'}</strong></div>
          </div>
          <button type="button" className="admin-detail-button"
            disabled={Boolean(busy) || !importanceSum} onClick={runPreview}>
            {busy === 'preview' ? 'Calcul en cours…' : 'Simuler les coefficients'}
          </button>
          <label className="admin-weighted-reason">
            Motif de modification (10 caractères minimum)
            <textarea rows={3} value={reason} maxLength={1000}
              onChange={event => setReason(event.target.value)}
              placeholder="Justification du choix des pondérations…" />
          </label>
          <button type="button" className="admin-detail-button"
            disabled={Boolean(busy) || reason.trim().length < 10 || !importanceSum}
            onClick={save}>
            {busy === 'save' ? 'Enregistrement…' : 'Enregistrer le brouillon versionné'}
          </button>
          <p role="status" className="date-line">{notice}</p>
          {dirty && (
            <p className="date-line">Modifications non simulées : les résultats
              ci-dessous présentent encore les coefficients précédemment calculés.</p>
          )}
        </div>
      </div>

      {active?.previewBasis?.firstDate && (
        <p className="date-line">
          Simulation provisoire sur {active.previewBasis.sharedDays.length} journées
          communes ({active.previewBasis.firstDate} au {active.previewBasis.lastDate}),
          avec {active.previewBasis.referenceDepartments} départements de référence.
          Les mois M−1 et M−12 restent indisponibles s'ils ne sont pas complets.
        </p>
      )}
      {active?.previewBasis?.reason === 'NO_SHARED_REFERENCE_WINDOW' && (
        <p className="date-line">{active.previewBasis.explanation}</p>
      )}
      <div className="section-heading">
        <div>
          <p className="kicker">Comparaison territoriale · {month}</p>
          <h2>Scores simulés par département</h2>
        </div>
        <span className="soft-pill">{rows.length} département(s)</span>
      </div>
      <div className="admin-weighted-filters">
        <label>Rechercher un département
          <input value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Nom ou code" type="search" />
        </label>
        <label>État du score
          <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">Tous</option>
            {Object.entries(levelLabels).map(([key, label]) =>
              <option value={key} key={key}>{label}</option>)}
          </select>
        </label>
      </div>

      <div className="table-wrapper admin-weighted-table-scroll" role="region"
        aria-label="Scores expérimentaux par département" tabIndex={0}>
        <table className="simple-table admin-weighted-table">
          <thead>
            <tr>
              <th scope="col">Département</th>
              <th scope="col">Score enregistré</th>
              <th scope="col">{preview ? 'Score proposé' : 'Score simulé'}</th>
              <th scope="col">Densité /100</th>
              <th scope="col">Potentiel employeur /100</th>
              <th scope="col">Offres /100 employeurs (score /100)</th>
              <th scope="col">Tendance /100</th>
              <th scope="col">Couleur simulée</th>
              <th scope="col">Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const current = baselineByCode.get(row.departmentCode);
              const simulated = simulationByCode.get(row.departmentCode);
              return (
                <tr key={row.departmentCode}>
                  <th scope="row">{row.departmentName}
                    <small className="admin-weighted-dept-code">{row.departmentCode}</small>
                  </th>
                  <td>{scoreText(current?.score)}</td>
                  <td><strong>{scoreText(simulated?.score)}</strong></td>
                  <td>{simulated?.components?.density ?? '—'}</td>
                  <td>{simulated?.components?.employers ?? '—'}</td>
                  <td>{simulated?.components?.employerIntensity ?? '—'}</td>
                  <td>{simulated?.components?.trend ?? '—'}</td>
                  <td><AdminSimulationColorBadge score={simulated} compact /></td>
                  <td>{levelLabels[simulated?.quality] || 'Indisponible'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="date-line">
        Le repère national 50/100 n'est pas un seuil de vigilance.
        La densité et le potentiel employeur sont comparés à une référence
        nationale issue des départements couverts. La tendance est ancrée à
        50 pour une évolution nulle. Le score n'est pas calculé si
        les données ne permettent pas une lecture suffisamment fiable.
        La saisonnalité reste neutre et aucune couleur publique n'est simulée
        sans calibrage de seuils. La couleur affichée est
        strictement exploratoire, sans incidence sur la carte publique.
        {' '}{ADMIN_SIMULATION_BAND_LEGEND}
      </p>
    </section>
  );
}
