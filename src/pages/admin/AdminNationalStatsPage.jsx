import React, { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import MetricCard from '../../components/dashboard/MetricCard.jsx';
import { getAdminNationalStats } from '../../services/adminNationalStatsService.js';
import './AdminNationalStatsPage.css';

const TABS = [
  ['global', 'Vue globale'],
  ['territories', 'Territoires'],
  ['jobs', 'Métiers'],
  ['formations', 'Formations'],
  ['history', 'Historique'],
  ['publications', 'Publications'],
];
function number(value) {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat('fr-FR').format(value);
}
function oneDecimal(value) {
  return value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value);
}
function signed(value) {
  if (value === null || value === undefined) return '—';
  const formatted = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(value));
  return (value > 0 ? '+' : value < 0 ? '−' : '') + formatted;
}
function Coverage({ data }) {
  if (!data) return null;
  return <div className={'national-coverage ' + (data.comparable ? 'is-ready' : 'is-partial')} role="status">
    <strong>{data.comparable ? 'Couverture complète, sources non plafonnées' : 'Couverture partielle ou source potentiellement plafonnée'}</strong>
    <span>{number(data.coveredDepartments)} / {number(data.expectedDepartments)} départements · {number(data.saturatedDepartments)} signalé(s) plafonné(s) · {number(data.unassessedCapDepartments)} sans contrôle documenté du plafonnement.
      {data.missingDepartments?.length ? ' Départements absents : ' + data.missingDepartments.slice(0, 12).join(', ') + (data.missingDepartments.length > 12 ? '…' : '') + '.' : ''}
      {!data.comparable ? ' Les évolutions nationales ne sont pas calculées.' : ''}
    </span>
  </div>;
}
function Ranking({ rows, labelKey = 'departmentName', onChoose, metric = 'offers' }) {
  if (!rows.length) return <p className="date-line">Aucune donnée territoriale à afficher.</p>;
  return <div className="table-wrapper"><table className="simple-table national-table"><thead><tr><th>Rang</th><th>Territoire</th><th>{metric === 'offers' ? 'Offres recensées' : 'Offres pour 10 000 jeunes'}</th><th>Action</th></tr></thead>
    <tbody>{rows.map((item, index) => <tr key={item.departmentCode || item.name}><td>{index + 1}</td><td><strong>{item[labelKey] || item.name}</strong>{item.departmentCode ? <small className="national-row-subtitle">{item.departmentCode}</small> : null}</td><td>{metric === 'offers' ? number(item.offers) : oneDecimal(item.offersPer10000Young)}</td><td>{item.departmentCode && onChoose ? <button className="admin-detail-button" type="button" onClick={() => onChoose(item.departmentCode)}>Voir détail</button> : '—'}</td></tr>)}</tbody></table></div>;
}
function TrendChart({ points }) {
  const valid = points.filter((point) => point.coveredDepartments > 0);
  if (!valid.length) return <p className="date-line">Aucun historique disponible.</p>;
  const max = Math.max(...valid.map((point) => point.offers), 1);
  return <div className="national-trend" role="img" aria-label="Évolution des sommes départementales des offres par date">
    {valid.map((point) => <div className="national-trend-item" key={point.date} title={point.date + ': ' + number(point.offers) + ' offres, ' + point.coveredDepartments + ' départements'}>
      <strong>{number(point.offers)}</strong><div className="national-trend-track"><div className={point.comparable ? 'national-trend-bar' : 'national-trend-bar is-partial'} style={{ height: (point.offers / max * 100) + '%' }} /></div><small>{point.date.slice(5)}</small>
    </div>)}
  </div>;
}
export default function AdminNationalStatsPage() {
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTab] = useState(TABS.some(([key]) => key === requestedTab) ? requestedTab : 'global');
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [rankingMetric, setRankingMetric] = useState('offers');
  useEffect(() => {
    let active = true;
    getAdminNationalStats(days).then((result) => {
      if (active) { setData(result); setError(''); }
    }).catch((e) => {
      if (active) { setData(null); setError(e.message); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days]);
  const latest = data?.latest;
  const filteredDepartments = useMemo(() => {
    const term = search.toLocaleLowerCase('fr-FR').trim();
    return (data?.departments || []).filter((item) => !term ||
      [item.departmentName, item.departmentCode, item.regionName].some((field) => String(field || '').toLocaleLowerCase('fr-FR').includes(term)));
  }, [search, data?.departments]);
  const rankedDepartments = useMemo(() => {
    const key = rankingMetric === 'offers' ? 'offers' : 'offersPer10000Young';
    return [...filteredDepartments].sort((a, b) =>
      (b[key] ?? -1) - (a[key] ?? -1) ||
      a.departmentCode.localeCompare(b.departmentCode, 'fr')
    );
  }, [filteredDepartments, rankingMetric]);
  function changeTab(next) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState({}, '', url.pathname + url.search);
  }
  const summary = <section className="admin-console-overview-grid national-kpis" aria-label="Indicateurs nationaux">
    <MetricCard label="Offres recensées" value={number(latest?.offers)} detail="Somme des instantanés départementaux" />
    <MetricCard label="Postes proposés" value={number(latest?.openings)} detail="Total des postes associés aux offres" />
    <MetricCard label="Départements couverts" value={latest ? number(latest.coveredDepartments) + ' / ' + number(latest.expectedDepartments) : '—'} detail="Source quotidienne vérifiée" />
    <MetricCard label="Évolution nationale" value={signed(data?.change?.ratio)} detail={data?.change ? 'vs ' + data.change.previousDate + ' · ' + (data.change.absolute > 0 ? '+' : '') + number(data.change.absolute) : 'Comparaison fiable indisponible'} />
  </section>;
  return <AdminLayout>
    <section className="admin-console-page-head"><div><p className="admin-console-eyebrow">Statistiques & analyse</p><h1>État de l’apprentissage en France</h1><p>Vue nationale, territoires, métiers et publications à partir des données collectées.</p></div>
      <div className="admin-console-page-status"><span className="admin-console-neutral-dot" /><span><strong>{data?.date || 'Aucune donnée'}</strong><small>Dernier instantané disponible</small></span></div>
    </section>
    <nav className="national-tabs" aria-label="Rubriques statistiques">{TABS.map(([key, label]) =>
      <button key={key} type="button" className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => changeTab(key)}>{label}</button>)}</nav>
    <section className="panel national-controls"><div><strong>Période d'observation</strong><p className="date-line">Historique des instantanés quotidiens disponibles.</p></div><div className="admin-stats-period-switch">
      {[7, 30, 60].map((value) => <button key={value} className={days === value ? 'active' : ''} onClick={() => { setLoading(true); setDays(value); }} type="button">{value} j</button>)}
    </div></section>
    {loading && <section className="admin-console-loading" role="status"><span className="admin-console-loader" /><span>Lecture des indicateurs nationaux…</span></section>}
    {error && <section className="admin-console-alert admin-console-alert-error" role="alert"><strong>Impossible de charger les statistiques</strong><span>{error}</span></section>}
    {!loading && !error && !latest && <section className="panel admin-console-empty-state"><strong>Aucune donnée nationale disponible</strong><p>La collecte quotidienne doit produire des instantanés avant le calcul de la synthèse.</p></section>}
    {!loading && !error && latest && <>
      <Coverage data={latest} />
      {tab === 'global' && <>{summary}
        <div className="admin-stats-two-columns"><article className="panel"><div className="section-heading"><div><p className="kicker">Tendance</p><h2>Évolution des offres recensées</h2></div></div><TrendChart points={data.history} /><p className="date-line">Les barres atténuées signalent une couverture incomplète, un plafonnement possible ou un contrôle de plafonnement indisponible.</p></article>
        <article className="panel"><div className="section-heading"><div><p className="kicker">Lecture nationale</p><h2>Repères essentiels</h2></div></div><div className="national-facts"><div><span>Nouvelles offres du jour recensées</span><strong>{number(latest.newOffers)}</strong></div>
          <div><span>Départements renseignant les nouvelles offres</span><strong>{number(latest.newOffersCoverage)} / {number(latest.coveredDepartments)}</strong></div>
          <div><span>Offres pour 10 000 jeunes de 15–29 ans</span><strong>{oneDecimal(latest.offersPer10000Young)}</strong></div>
          <div><span>Référence démographique INSEE</span><strong>{data.populationReferenceYear || '—'}</strong></div><div><span>Régions identifiées</span><strong>{number(data.regions.filter((region) => region.name !== 'Non renseignée').length)}</strong></div><div><span>Départements potentiellement plafonnés</span><strong>{number(latest.saturatedDepartments)}</strong></div></div></article></div>
        <section className="panel"><div className="section-heading"><div><p className="kicker">Lecture territoriale</p><h2>Principaux départements par volume observé</h2></div><button className="admin-detail-button" type="button" onClick={() => changeTab('territories')}>Tous les territoires</button></div><Ranking rows={data.departments.slice(0, 10)} onChoose={(code) => window.location.assign('/departement/' + encodeURIComponent(code))} /></section>
      </>}
      {tab === 'territories' && <section className="panel"><div className="section-heading"><div><p className="kicker">Classements</p><h2>Départements et régions</h2></div></div><label className="national-search-label">Rechercher une région ou un département<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom ou code du département" type="search" /></label>
          <label className="national-search-label">Critère de classement
            <select value={rankingMetric} onChange={(event) => setRankingMetric(event.target.value)}>
              <option value="offers">Nombre d'offres recensées</option>
              <option value="density">Offres pour 10 000 jeunes (INSEE 15–29 ans)</option>
            </select>
          </label>
          <p className="date-line">La densité est calculée seulement pour les départements disposant d’une population INSEE valide. Elle mesure l'offre recensée, et non les chances individuelles de recrutement.</p>
          <Ranking rows={rankedDepartments} metric={rankingMetric === 'density' ? 'offersPer10000Young' : 'offers'} onChoose={(code) => window.location.assign('/departement/' + encodeURIComponent(code))} /><h3>Répartition régionale des offres recensées</h3><Ranking rows={data.regions.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()))} /></section>}
      {tab === 'jobs' && <section className="panel"><div className="section-heading"><div><p className="kicker">Métiers et secteurs</p><h2>Offres par secteur déclaré dans la source</h2></div><a className="admin-detail-button" href="/admin/stats/metiers">Ouvrir les analyses ROME existantes</a></div><p className="date-line">Agrégats sectoriels de la source d'offres (pas un classement des domaines ROME). Une offre peut avoir plusieurs codes ROME ; les correspondances détaillées restent disponibles dans la vue métier.</p><div className="table-wrapper"><table className="simple-table national-table"><thead><tr><th>Secteur</th><th>Offres</th><th>Postes</th></tr></thead><tbody>{data.sectors.map((item) => <tr key={item.code}><td>{item.label}</td><td>{number(item.offers)}</td><td>{number(item.openings)}</td></tr>)}</tbody></table></div></section>}
      {tab === 'formations' && <><section className="admin-console-overview-grid national-kpis">
        <MetricCard label="Départements renseignés" value={number(data.formations.coveredDepartments)} detail="Agrégats formations disponibles" />
        <MetricCard label="Formations par territoire" value={number(data.formations.formationsByDepartmentTotal)} detail="Somme départementale, pas un décompte de formations uniques" />
        <MetricCard label="Sessions recensées" value={number(data.formations.sessionsByDepartmentTotal)} detail="Toutes sessions agrégées par département" />
        <MetricCard label="Sessions à venir" value={number(data.formations.upcomingSessionsTotal)} detail="Selon la date propre à chaque source" />
      </section><section className="panel"><h2>Lecture des formations</h2>
        <p className="date-line">Dates des données : {data.formations.asOfDates.length ? data.formations.asOfDates.join(' · ') : 'indisponibles'}. {data.formations.asOfDates.length > 1 ? 'Attention : les dates diffèrent selon les départements.' : ''}</p><p>Les agrégats de formations n'indiquent ni la demande réelle, ni les places ouvertes. Aucun indicateur de saturation ou de tension n'est déduit de ces chiffres.</p></section></>}
      {tab === 'history' && <section className="panel"><div className="section-heading"><div><p className="kicker">Historique national</p><h2>Couverture et volume des offres</h2></div></div><TrendChart points={data.history} /><div className="table-wrapper"><table className="simple-table national-table"><thead><tr><th>Date</th><th>Offres</th><th>Postes</th><th>Départements</th><th>Qualité</th></tr></thead><tbody>{[...data.history].reverse().map((p) => <tr key={p.date}><td>{p.date}</td><td>{number(p.offers)}</td><td>{number(p.openings)}</td><td>{number(p.coveredDepartments)}</td><td>{p.comparable ? 'Comparable' : 'Partiel / plafonnement non établi'}</td></tr>)}</tbody></table></div></section>}
      {tab === 'publications' && <section className="panel"><div className="section-heading"><div><p className="kicker">Préparation éditoriale</p><h2>Chiffres à vérifier avant publication</h2></div><a className="admin-detail-button" href="/admin/stats/metiers">Angles métiers ROME</a></div><div className="national-publication-copy">
          {!latest.comparable && <p className="national-publication-warning">Publication externe déconseillée : le contrôle de couverture et de plafonnement n'est pas suffisant.</p>}
          <strong>{number(latest.offers)} offres recensées dans {number(latest.coveredDepartments)} départements au {latest.date}</strong><p>Base : instantanés départementaux géolocalisés strictement. {latest.comparable ? 'Couverture complète non plafonnée.' : 'Attention : couverture incomplète ou plafonnement possible ; ne pas présenter le total comme exhaustif.'}</p><button className="admin-detail-button" type="button" disabled={!latest.comparable} onClick={() => navigator.clipboard?.writeText(number(latest.offers) + ' offres recensées dans ' + latest.coveredDepartments + ' départements au ' + latest.date + '. Source : ApprentiFR, couverture : ' + (latest.comparable ? 'complète' : 'partielle ou plafonnée') + '.')}>Copier avec la méthode</button></div></section>}
      <section className="panel national-methodology"><h2>Méthodologie et limites</h2><p>{data.methodology}</p><p>Les agrégats sont des observations, pas une estimation exhaustive du marché. Le nombre de formations est une somme départementale, pas un nombre de diplômes uniques. Une baisse entre deux dates ne constitue pas à elle seule une alerte de tension.</p></section>
    </>}
  </AdminLayout>;
}
