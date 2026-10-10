import React, {useMemo, useRef, useState} from 'react';
import {FiArrowRight, FiBarChart2, FiRepeat, FiShield, FiTrendingUp} from 'react-icons/fi';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import OccupationSearch from '../../components/occupation/OccupationSearch.jsx';
import {getOccupationPublicationStats} from '../../services/adminStatsService.js';
import {getAdminMonthlySettings} from '../../services/adminMonthlySettingsService.js';
import {DEPARTMENT_CODES} from '../../utils/departmentUtils.js';
import {normalizeRomeCode} from '../../utils/occupationUtils.js';
import {getLevelLabel, getLevelCss} from '../../utils/levelUtils.js';
import './AdminSimulationPage.css';

const numberFormatter = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1});
const integerFormatter = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 0});
const preciseFormatter = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 3});
const percentFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'percent', maximumFractionDigits: 1,
});
const QUALITY_LABELS = {
  comparable: 'Comparabilité vérifiée',
  indicative: 'Données indicatives',
  incomplete: 'Mois incomplet',
  method_change: 'Méthodes non comparables',
  saturated: 'Plafonnement possible',
  missing_population: 'Population indisponible',
  experimental: 'Expérimental',
  partial: 'Score partiel',
  unavailable: 'Score indisponible',
  provisional: 'Score provisoire', 
};

function parisMonth() {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit',
  }).format(new Date());
}

function num(value, digits = 1) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return digits === 0 ? integerFormatter.format(n) : numberFormatter.format(n);
}

function smallRatio(value) {
  if (value === null || value === undefined || value === '' ||
      !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (n > 0 && n < 0.001) return '< 0,001';
  return preciseFormatter.format(n);
}

function percent(value) {
  if (value === null || value === undefined || value === '' ||
      !Number.isFinite(Number(value))) return '—';
  return percentFormatter.format(Number(value));
}

function change(value) {
  if (!value || !Number.isFinite(value.value)) return '—';
  return (value.quality === 'indicative' ? '≈ ' : '') +
    (value.value > 0 ? '+' : '') + percent(value.value);
}

function Metric({label, value, note}) {
  return (
    <div className="admin-simulation-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function CurrentModelCard({payload, row, error, departmentName, romeCode, hasRun}) {
  const run = payload?.run;
  const ratio = row?.observedVsExpectedRatio;
  const offers = row?.activeOffersCount;
  const expected = row?.expectedOffers;
  const hasObservation = offers !== null && offers !== undefined;
  return (
    <article className="panel admin-simulation-card" aria-label="Indicateurs du moteur actuel">
      <div className="admin-simulation-card-heading">
        <div>
          <span className="admin-simulation-model-tag"><FiBarChart2 aria-hidden="true" /> Modèle actuel</span>
          <h2>Offres attendues / observées</h2>
          <p>Calcul métier utilisé par la vigilance actuellement publiée.</p>
        </div>
        {row?.publishedLevel && (
          <span className={'vigilance-badge vigilance-' + getLevelCss(row.publishedLevel)}>
            {getLevelLabel(row.publishedLevel)}
          </span>
        )}
      </div>
      <div className="admin-simulation-source">
        <span><b>Périmètre :</b> {departmentName} · ROME {romeCode}</span>
        <span><b>Relevé publié :</b> {run?.date || 'indisponible'}</span>
        <span><b>Version :</b> {run?.calculationVersion || run?.configVersion || 'indisponible'}</span>
      </div>
      {error && <p role="alert" className="admin-simulation-error">{error}</p>}
      {!hasRun && <p className="admin-simulation-absence">Choisissez vos filtres et cliquez sur « Simulation ».</p>}
      {hasRun && !error && !run && <p className="admin-simulation-absence">Aucun calcul métier publié disponible.</p>}
      {!error && run && !row && (
        <p className="admin-simulation-absence">Aucune observation publiée pour ce métier et ce département.</p>
      )}
      <div className="admin-simulation-metrics">
        <Metric label="Offres observées" value={num(offers, 0)}
          note={hasObservation ? 'Stock observé sur le relevé publié' : 'Non mesuré'} />
        <Metric label="Offres attendues" value={num(expected)}
          note="Niveau de référence calculé par le moteur métier" />
        <Metric label="Observées / attendues" value={percent(ratio)}
          note="Ratio de vigilance actuelle, pas un pourcentage de candidatures" />
        <Metric label="Niveau de confiance" value={
          row?.confidenceLevel === 'high' ? 'Élevé'
            : row?.confidenceLevel === 'medium' ? 'Modéré'
              : row?.confidenceLevel === 'low' ? 'Faible' : '—'
        } note="Niveau du run publié, sans score numérique inventé" />
      </div>
      <p className="admin-simulation-card-footer">
        Niveau publié : <b>{row?.publishedLevel ? getLevelLabel(row.publishedLevel) : 'non disponible'}</b>.
        Il reste inchangé par cette simulation.
      </p>
    </article>
  );
}

function NewModelCard({payload, row, score, error, departmentName, romeCode, hasRun}) {
  const population = row?.population15To29;
  const employers = row?.activeEmployerEstablishmentsCount;
  const employerDensity = (
    population > 0 && employers !== null && employers !== undefined
  ) ? employers / population * 10000 : null;
  const weights = payload?.scoreConfig?.weights || {};
  const preview = payload?.scoreSimulation;
  const provisional = preview?.mode === 'provisional_admin_only';
  const previewBasis = preview?.previewBasis;
  const scoreReady = typeof score?.score === 'number' && Number.isFinite(score.score);
  const previewDates = previewBasis?.sharedDays?.length || 0;
  const scoreStatus = scoreReady && provisional
    ? score?.quality === 'indicative' ? 'Provisoire et indicatif' : 'Score provisoire'
    : QUALITY_LABELS[score?.quality] || 'Score indisponible';
  return (
    <article className="panel admin-simulation-card" aria-label="Nouveaux indicateurs pondérés">
      <div className="admin-simulation-card-heading">
        <div>
          <span className="admin-simulation-model-tag is-new"><FiTrendingUp aria-hidden="true" /> Nouveau modèle</span>
          <h2>Indicateurs pondérés</h2>
          <p>Lecture territoriale expérimentale à partir des stocks quotidiens moyens.</p>
        </div>
        <span className="admin-simulation-status">{scoreStatus}</span>
      </div>
      <div className="admin-simulation-source">
        <span><b>Périmètre :</b> {departmentName} · ROME {romeCode}</span>
        <span><b>Période :</b> {payload?.month || 'indisponible'} · {row ? row.daysObserved + '/' + row.daysExpected + ' jours' : '—'}</span>
        <span><b>Statut du mois :</b> {QUALITY_LABELS[row?.quality] || 'Indisponible'}</span>
        {provisional && previewBasis?.firstDate && (
          <span><b>Score provisoire :</b> {previewDates} jours communs du {previewBasis.firstDate} au {previewBasis.lastDate}, {previewBasis.referenceDepartments} départements de référence</span>
        )}
      </div>
      {error && <p role="alert" className="admin-simulation-error">{error}</p>}
      {!hasRun && <p className="admin-simulation-absence">Le nouveau modèle sera calculé uniquement après lancement de « Simulation ».</p>}
      {hasRun && !error && !row && <p className="admin-simulation-absence">Pas de relevés mensuels exploitables.</p>}
      <div className="admin-simulation-metrics">
        <Metric label="Offres actives moyennes" value={num(row?.averageOffers)}
          note={'Indicateur source · poids ' + num(weights.offersFoundation) + ' / 5'} />
        <Metric label="Offres / 10 000 jeunes" value={num(row?.offersPer10000Young)}
          note={'Densité · poids ' + num(weights.density) + ' / 5'} />
        <Metric label="Établissements employeurs / 10 000 jeunes"
          value={num(employerDensity)} note={'Potentiel : 60 % du poids employeurs ' + num(weights.employers) + '/5 · tous secteurs'} />
        <Metric label="Offres / 100 employeurs" value={smallRatio(row?.offersPer100Employers)}
          note={'Intensité : 40 % du poids employeurs ' + num(weights.employers) + '/5 · ' +
            num(employers, 0) + ' établissements au dénominateur'} />
        <Metric label="Évolution mensuelle M−1" value={change(row?.changeMonth)}
          note={payload?.previousMonth || 'Mois précédent'} />
        <Metric label="Évolution annuelle M−12" value={change(row?.changeYear)}
          note={payload?.previousYear || 'Même mois un an plus tôt'} />
      </div>
      <div className="admin-simulation-score">
        <div>
          <small>{provisional ? 'Score provisoire — non consolidé, Admin uniquement' : 'Score expérimental — pas un niveau de vigilance'}</small>
          <strong>{score?.score !== null && score?.score !== undefined ? num(score.score) + ' / 100' : '—'}</strong>
          <span>{scoreStatus}</span>
        </div>
        <div>
          <small>Facteur saisonnier</small>
          <strong>1,00</strong>
          <span>Neutre · poids {num(weights.seasonality)} / 5</span>
        </div>
      </div>
      {!scoreReady && row && (
        <p className="admin-simulation-absence">
          {previewBasis?.reason === 'NO_SHARED_REFERENCE_WINDOW'
            ? previewBasis.explanation
            : 'Aucune référence ou seconde composante suffisamment couverte pour calculer le score de façon défendable. Les valeurs affichées restent exploitables séparément.'}
        </p>
      )}
      <p className="admin-simulation-card-footer">
        Les deux ratios employeurs participent ensemble au coefficient 3,5/5 ;
        les offres ne sont pas additionnées comme un nouveau sous-score.
        Aucun seuil vert, jaune, orange ou rouge n'est déduit de ce nouveau score.
        Il ne modifie pas la carte publique.
      </p>
    </article>
  );
}

export default function AdminSimulationPage() {
  const [month, setMonth] = useState(parisMonth);
  const [romeCode, setRomeCode] = useState('');
  const [romeLabel, setRomeLabel] = useState('');
  const [departmentCode, setDepartmentCode] = useState('');
  const [simulation, setSimulation] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const departmentNames = useMemo(() => new Map(
    (simulation?.modern?.departments || []).map(row =>
      [row.departmentCode, row.departmentName])
  ), [simulation]);
  const departmentName = departmentNames.get(departmentCode) || ('Département ' + departmentCode);

  function invalidate() {
    version.current += 1;
    setSimulation(null);
    setError('');
    setRunning(false);
  }

  async function runSimulation(event) {
    event.preventDefault();
    if (!romeCode || !departmentCode || !month) {
      setError('Choisissez un métier, un département et un mois.');
      return;
    }
    const ticket = ++version.current;
    setRunning(true);
    setError('');
    setSimulation(null);
    const results = await Promise.allSettled([
      getOccupationPublicationStats(romeCode, {historyLimit: 7}),
      getAdminMonthlySettings(month, romeCode, departmentCode),
    ]);
    if (ticket !== version.current) return;
    const [previous, modern] = results;
    const oldResult = previous.status === 'fulfilled' ? previous.value : null;
    const newResult = modern.status === 'fulfilled' ? modern.value : null;
    setSimulation({
      selected: {romeCode, romeLabel, departmentCode, month},
      previous: oldResult,
      modern: newResult,
      previousError: previous.status === 'rejected' ? previous.reason?.message || 'Données du moteur actuel indisponibles.' : '',
      modernError: modern.status === 'rejected' ? modern.reason?.message || 'Données mensuelles indisponibles.' : '',
    });
    setRunning(false);
  }

  const currentRow = simulation?.previous?.ranking?.find(row =>
    row.departmentCode === simulation.selected.departmentCode) || null;
  const modernRow = simulation?.modern?.departments?.find(row =>
    row.departmentCode === simulation.selected.departmentCode) || null;
  const modernScore = simulation?.modern?.scoreSimulation?.scores?.find(row =>
    row.departmentCode === simulation.selected.departmentCode) || null;
  const displayDeptName = modernRow?.departmentName || currentRow?.departmentName || departmentName;

  return (
    <AdminLayout>
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Administration · Contrôle avant publication</p>
          <h1>Simulation</h1>
          <p>Comparer les indicateurs du moteur actuel aux nouveaux critères, sans modifier la vigilance publiée.</p>
        </div>
        <a className="admin-detail-button" href="/admin/parametrage">
          Paramétrage <FiArrowRight aria-hidden="true" />
        </a>
      </section>

      <form className="panel admin-simulation-filters" onSubmit={runSimulation}>
        <div className="section-heading">
          <div>
            <p className="kicker">Périmètre de simulation</p>
            <h2>Même métier, même département</h2>
          </div>
          <span className="soft-pill">Lecture seule</span>
        </div>
        <div className="admin-simulation-search">
          <label className="admin-simulation-field-label">Métier à analyser (ROME)</label>
          <OccupationSearch
            onOccupationSelect={selection => {
              const next = normalizeRomeCode(selection?.romeCode);
              invalidate();
              setRomeCode(next);
              setRomeLabel(selection?.label || selection?.trainingLabel || next);
            }}
            initialRomeCode={romeCode}
            initialLabel={romeLabel}
          />
          <small>La comparaison n'utilise jamais les offres tous métiers face à une seule profession.</small>
        </div>
        <div className="admin-simulation-field-row">
          <label>Département
            <select value={departmentCode} onChange={e => {
              invalidate();
              setDepartmentCode(e.target.value);
            }} required>
              <option value="">Choisir le département</option>
              {DEPARTMENT_CODES.map(code => (
                <option key={code} value={code}>
                  {departmentNames.get(code) ? departmentNames.get(code) + ' · ' : ''}{code}
                </option>
              ))}
            </select>
          </label>
          <label>Mois étudié (nouveau modèle)
            <input type="month" value={month} max={parisMonth()}
              onChange={e => {
                if (!e.target.value) return;
                invalidate();
                setMonth(e.target.value);
              }} required />
          </label>
          <button type="submit" className="primary-button admin-simulation-submit"
            disabled={running || !romeCode || !departmentCode}>
            <FiRepeat aria-hidden="true" />
            {running ? 'Simulation en cours…' : 'Simulation'}
          </button>
        </div>
        <p className="date-line">Le moteur actuel est lu sur son dernier run métier publié.
          Le nouveau modèle utilise la moyenne quotidienne du mois choisi :
          les dates et les échelles sont affichées séparément.</p>
        {error && <p role="alert" className="admin-simulation-error">{error}</p>}
      </form>

      {running && <section className="panel" role="status">
        Lecture des deux moteurs et contrôle des données du métier sélectionné…
      </section>}

      <div className="admin-simulation-cards" aria-live="polite">
        <CurrentModelCard
          payload={simulation?.previous}
          row={currentRow}
          hasRun={Boolean(simulation)}
          error={simulation?.previousError}
          departmentName={displayDeptName}
          romeCode={simulation?.selected.romeCode || romeCode || '—'}
        />
        <NewModelCard
          payload={simulation?.modern}
          row={modernRow}
          score={modernScore}
          hasRun={Boolean(simulation)}
          error={simulation?.modernError}
          departmentName={displayDeptName}
          romeCode={simulation?.selected.romeCode || romeCode || '—'}
        />
      </div>
      <section className="panel admin-simulation-caution">
        <FiShield aria-hidden="true" />
        <div>
          <strong>Deux lectures, pas une substitution automatique.</strong>
          <p>La carte de gauche représente un calcul métier publié à une date donnée ;
            celle de droite est un agrégat mensuel expérimental.
            Une annonce peut être associée à plusieurs codes ROME, et des
            statistiques journalières peuvent être tronquées au-delà de 120 métiers.
            Les établissements employeurs sont ceux de tous les secteurs économiques du département,
            et non une liste certifiée d'employeurs de ce métier.
            L'historique ou la couverture insuffisante interdit alors le nouveau score.
            Aucun coefficient, seuil ou niveau de vigilance public n'est modifié.</p>
        </div>
      </section>
    </AdminLayout>
  );
}
