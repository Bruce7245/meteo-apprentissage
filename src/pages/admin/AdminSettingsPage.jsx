import React, {useEffect, useMemo, useState} from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import {
  getAdminMonthlySettings,
  saveAdminSeasonality,
} from '../../services/adminMonthlySettingsService.js';
import './AdminSettingsPage.css';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const SEASONS = [
  ['unknown', 'Inconnue'], ['low', 'Faible'],
  ['normal', 'Normale'], ['high', 'Forte'],
];
const QUALITY_LABELS = {
  comparable: 'Comparable',
  indicative: 'Indicatif',
  incomplete: 'Mois incomplet',
  saturated: 'Plafonnement suspecté',
  method_change: 'Méthode non comparable',
  missing_population: 'Population indisponible',
};
const numberFormatter = new Intl.NumberFormat('fr-FR', {maximumFractionDigits: 1});
const percentFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'percent', maximumFractionDigits: 1,
});

function number(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—' : numberFormatter.format(Number(value));
}

function percent(change) {
  if (change?.value === null || change?.value === undefined ||
      !Number.isFinite(Number(change.value))) return '—';
  const prefix = change.quality === 'indicative' ? '≈ ' : '';
  return prefix + (change.value > 0 ? '+' : '') + percentFormatter.format(change.value);
}

function currentParisMonth() {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit',
  }).format(new Date());
}

function RatioChange({change, fallbackTitle}) {
  if (!change) return <span title={fallbackTitle || 'Comparaison non disponible'}>—</span>;
  return (
    <span
      className={change.value < 0 ? 'settings-delta-down' : 'settings-delta'}
      title={change.quality === 'indicative'
        ? 'Variation indicative : plafonnement de certaines sources non vérifié'
        : 'Variation calculée à méthode comparable'}
    >
      {percent(change)}
    </span>
  );
}

export default function AdminSettingsPage() {
  const [month, setMonth] = useState(currentParisMonth);
  const [tab, setTab] = useState('results');
  const [query, setQuery] = useState('');
  const [qualityFilter, setQualityFilter] = useState('all');
  const [order, setOrder] = useState('department');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [seasonality, setSeasonality] = useState(Array(12).fill('unknown'));
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setError('');
    setNotice('');

    getAdminMonthlySettings(month)
      .then(result => {
        if (!alive) return;
        setData(result);
        setSeasonality([...result.seasonality.months]);
        setReason(result.seasonality.reason || '');
        setVersion(result.seasonality.version || 0);
      })
      .catch(err => {
        if (alive) setError(err.message || 'Données indisponibles');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {alive = false;};
  }, [month]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr-FR');
    const rows = (data?.departments || []).filter(row =>
      (!needle || (row.departmentName + ' ' + row.departmentCode)
        .toLocaleLowerCase('fr-FR').includes(needle)) &&
      (qualityFilter === 'all' || row.quality === qualityFilter)
    );
    if (order === 'offers' || order === 'density') {
      const key = order === 'offers' ? 'averageOffers' : 'offersPer10000Young';
      return rows.sort((a, b) =>
        (b[key] ?? -1) - (a[key] ?? -1) ||
        a.departmentCode.localeCompare(b.departmentCode, 'fr'));
    }
    if (order === 'decline' || order === 'increase') {
      return rows.sort((a, b) => {
        const first = a.changeMonth?.value;
        const second = b.changeMonth?.value;
        if (first === null || first === undefined) return 1;
        if (second === null || second === undefined) return -1;
        return (order === 'decline' ? first - second : second - first);
      });
    }
    return rows.sort((a, b) => a.departmentCode.localeCompare(b.departmentCode, 'fr'));
  }, [data, query, qualityFilter, order]);

  async function save() {
    setSaving(true);
    setNotice('');
    try {
      const result = await saveAdminSeasonality(seasonality, reason, version);
      setVersion(result.version);
      setNotice('Version enregistrée. Les vigilances publiées restent inchangées.');
    } catch (err) {
      setNotice(err.message || 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = MONTHS[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);
  const selectedSeason = SEASONS.find(([value]) =>
    value === seasonality[Number(month.slice(5, 7)) - 1])?.[1] || 'Inconnue';

  return (
    <AdminLayout>
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Pilotage et méthode</p>
          <h1>Paramétrage</h1>
          <p>Indicateurs territoriaux, saisonnalité et évolutions mensuelles.</p>
        </div>
      </section>

      <nav className="settings-tabs" aria-label="Sections du paramétrage">
        {[
          ['results', 'Résultats mensuels'],
          ['seasonality', 'Saisonnalité'],
          ['method', 'Critères & méthode'],
        ].map(([id, label]) => (
          <button
            type="button" key={id} className={tab === id ? 'active' : ''}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >{label}</button>
        ))}
      </nav>

      <section className="panel settings-filters">
        <label>
          Mois à analyser
          <input
            type="month" value={month} max={currentParisMonth()}
            onChange={event => {
              if (event.target.value) setMonth(event.target.value);
            }}
          />
        </label>
        <div className="settings-note">
          <strong>{monthLabel}</strong> · M−1 : {data?.previousMonth || '—'} ·
          M−12 : {data?.previousYear || '—'} · Saisonnalité déclarée : {selectedSeason}.
          Les variations non vérifiables restent indisponibles.
        </div>
      </section>

      {loading && (
        <section className="panel" role="status">
          Chargement des données disponibles, sans réimportation…
        </section>
      )}
      {error && (
        <section className="admin-console-alert admin-console-alert-error" role="alert">
          <strong>Lecture impossible</strong> {error}. Aucune donnée n'est simulée.
        </section>
      )}

      {data && tab === 'results' && (
        <>
          <section className="admin-console-overview-grid" aria-label="Couverture statistique">
            <MetricCard label="Départements" value={number(data.summary.departments)}
              detail="Périmètre national" />
            <MetricCard label="Comparables" value={number(data.summary.complete)}
              detail="Contrôles complets sur le mois" />
            <MetricCard label="Évolutions M−1" value={number(data.summary.m1Available)}
              detail="Départements calculables" />
            <MetricCard label="Évolutions M−12" value={number(data.summary.m12Available)}
              detail="Même mois de l'année précédente" />
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Suivi mensuel</p>
                <h2>Tableau territorial des critères</h2>
              </div>
              <span className="soft-pill">{visible.length} département(s)</span>
            </div>

            <div className="settings-controls">
              <label>
                Département
                <input type="search" value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Nom, 72, 75, 2A…" />
              </label>
              <label>
                Qualité
                <select value={qualityFilter}
                  onChange={event => setQualityFilter(event.target.value)}>
                  <option value="all">Tous les états</option>
                  {Object.entries(QUALITY_LABELS).map(([value, label]) =>
                    <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                Classement
                <select value={order} onChange={event => setOrder(event.target.value)}>
                  <option value="department">Département</option>
                  <option value="offers">Offres moyennes</option>
                  <option value="density">Offres pour 10 000 jeunes</option>
                  <option value="decline">Plus fortes baisses M−1</option>
                  <option value="increase">Plus fortes hausses M−1</option>
                </select>
              </label>
            </div>

            <div className="table-wrapper settings-table-scroll" role="region"
              aria-label="Tableau comparatif territorial défilant" tabIndex={0}>
              <table className="simple-table settings-table">
                <thead>
                  <tr>
                    <th scope="col">Département</th>
                    <th scope="col">Jours</th>
                    <th scope="col">Offres moy./j</th>
                    <th scope="col">Postes moy./j</th>
                    <th scope="col">15–29 ans</th>
                    <th scope="col">Employeurs INSEE</th>
                    <th scope="col">Offres / 10 000 jeunes</th>
                    <th scope="col">Offres / 100 employeurs</th>
                    <th scope="col" title={'Variation face à ' + (data.previousMonth || 'M−1')}>Δ M−1</th>
                    <th scope="col" title={'Variation face à ' + (data.previousYear || 'M−12')}>Δ M−12</th>
                    <th scope="col">Fiabilité</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(row => (
                    <tr key={row.departmentCode}>
                      <th scope="row">{row.departmentName}
                        <small className="settings-department-code">{row.departmentCode}</small>
                      </th>
                      <td>{row.daysObserved}/{row.daysExpected}</td>
                      <td>{number(row.averageOffers)}</td>
                      <td>{number(row.averageOpenings)}</td>
                      <td>{number(row.population15To29)}</td>
                      <td>{number(row.activeEmployerEstablishmentsCount)}</td>
                      <td><strong>{number(row.offersPer10000Young)}</strong></td>
                      <td>{number(row.offersPer100Employers)}</td>
                      <td><RatioChange change={row.changeMonth}
                        fallbackTitle="Couverture, méthode ou dénominateur insuffisant" /></td>
                      <td><RatioChange change={row.changeYear}
                        fallbackTitle="Historique annuel ou comparabilité insuffisante" /></td>
                      <td><span className={'settings-quality settings-quality-' + row.quality}>
                        {QUALITY_LABELS[row.quality] || row.quality}
                      </span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length === 0 && (
              <p className="date-line">Aucun département pour ce filtre.</p>
            )}
            <p className="date-line">
              « — » indique une valeur non disponible ou une comparaison
              impossible. Le signe ≈ signale une variation indicative,
              non certifiée faute de contrôle de plafonnement complet.
              Un mois en cours reste incomplet.
            </p>
          </section>
        </>
      )}

      {data && tab === 'seasonality' && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="kicker">Référentiel humain</p>
              <h2>Saisonnalité nationale présumée</h2>
            </div>
            <span className="soft-pill">Version {version}</span>
          </div>
          <p className="date-line">
            Ces valeurs sont des hypothèses révisables. Elles ne modifient ni
            les calculs de collecte ni la vigilance publiée.
          </p>
          <div className="settings-season-grid">
            {MONTHS.map((label, i) => (
              <label key={label}>
                {label}
                <select value={seasonality[i]} onChange={event =>
                  setSeasonality(old => old.map((value, j) =>
                    j === i ? event.target.value : value))}>
                  {SEASONS.map(([value, name]) =>
                    <option value={value} key={value}>{name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <label className="settings-reason">
            Justification (au moins 10 caractères)
            <textarea rows={3} value={reason} maxLength={1000}
              onChange={event => setReason(event.target.value)}
              placeholder="Source, période ou motif de la révision…" />
          </label>
          <div className="settings-save">
            <button type="button" className="admin-detail-button"
              onClick={save} disabled={saving || reason.trim().length < 10}>
              {saving ? 'Enregistrement…' : 'Enregistrer une nouvelle version'}
            </button>
            <span role="status">{notice}</span>
          </div>
          <p className="date-line">
            Les suggestions automatiques nécessiteront plusieurs cycles annuels
            comparables. Aucun ajustement ne sera appliqué sans validation.
          </p>
        </section>
      )}

      {tab === 'method' && (
        <section className="panel settings-method">
          <h2>Définition des indicateurs</h2>
          <div className="settings-method-grid">
            <article><strong>Offres moyennes quotidiennes</strong>
              <p>Moyenne des stocks d'offres strictement géolocalisées
                observés les jours disponibles. Une annonce présente deux
                jours n'est pas comptée comme deux nouvelles offres.</p></article>
            <article><strong>Postes moyens quotidiens</strong>
              <p>Nombre moyen de postes ouverts rattachés à ces offres.</p></article>
            <article><strong>Population INSEE</strong>
              <p>Population de 15 à 29 ans, millésime {data?.populationReferenceYear || 'non établi'}.
                Elle n'est pas égale au nombre de candidats en recherche.</p></article>
            <article><strong>Établissements employeurs</strong>
              <p>Effectifs Sirene des établissements actifs employeurs,
                uniquement après import complet et agrégations validées.</p></article>
            <article><strong>Ratio principal</strong>
              <p>Moyenne quotidienne des offres ÷ population 15–29 ans × 10 000.</p></article>
            <article><strong>Ratio complémentaire</strong>
              <p>Moyenne quotidienne des offres ÷ établissements
                actifs employeurs × 100. Les établissements sont une référence
                économique actuelle, non un total d'employeurs d'apprentis.</p></article>
            <article><strong>Évolutions M−1 et M−12</strong>
              <p>Variation du ratio principal sur des mois terminés,
                avec même référentiel de population et méthode de collecte
                homogène. Base nulle : évolution non calculable.</p></article>
            <article><strong>Qualité et saisonnalité</strong>
              <p>Mois incomplet, plafonnement et changement de méthode
                bloquent ou qualifient les comparaisons.
                La saisonnalité est déclarative tant qu'elle n'est pas vérifiée.</p></article>
          </div>
        </section>
      )}
    </AdminLayout>
  );
}
