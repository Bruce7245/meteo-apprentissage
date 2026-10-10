import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  FiActivity, FiAlertCircle, FiCheckCircle, FiDownload, FiFileText,
  FiInfo, FiRefreshCw, FiShield, FiTrendingDown, FiTrendingUp,
} from 'react-icons/fi';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import {getAdminMonthlySettings} from '../../services/adminMonthlySettingsService.js';
import {getLatestPublicVigilanceIndex} from '../../services/vigilanceService.js';
import {
  AUDIT_LEVELS,
  buildAdminModelValidationAudit,
} from '../../utils/adminModelValidationAudit.mjs';
import './AdminModelValidationPage.css';

const fmt = new Intl.NumberFormat('fr-FR', {maximumFractionDigits:2});
const COLORS = {green:'Vert',yellow:'Jaune',orange:'Orange',red:'Rouge',unknown:'Indisponible'};
const FILTERS = [
  ['all','101 départements'],['critical','Anomalies critiques'],
  ['source','Données manquantes'],['stronger','Vigilance plus élevée'],
  ['weaker','Vigilance moins élevée'],['major','Divergences ≥ 2 niveaux'],
  ['threshold','Proches d’un seuil'],['density','Densité seule'],
  ['unknown','Sans indice'],
];
const format = value => typeof value === 'number' && Number.isFinite(value)
  ? fmt.format(value) : '—';

function parisMonth() {
  return new Intl.DateTimeFormat('fr-CA',{
    timeZone:'Europe/Paris',year:'numeric',month:'2-digit',
  }).format(new Date());
}

function Level({value,defaultGreen = false}) {
  const color = Object.hasOwn(COLORS,value) ? value : 'unknown';
  return (
    <span className={'admin-validation-level admin-validation-level--'+color}
      title={defaultGreen
        ? 'Vert par défaut sans publication explicite : exclu des comparaisons fiables'
        : ''}>
      <span aria-hidden="true" className="admin-validation-level-dot"/>
      {COLORS[color]}
      {defaultGreen && <small> (défaut)</small>}
    </span>
  );
}

function Indicator({label,value,note}) {
  return (
    <div className="admin-validation-indicator">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function csvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[;"\n\r]/.test(str) ? '"'+str.replace(/"/g,'""')+'"' : str;
}

function exportAudit(audit) {
  if (!audit?.available) return;
  const headings = [
    'Version audit','Mois','Date publication','Version moteur','Année population INSEE',
    'Jours communs score provisoire','Code','Département','Niveau publié','Publié explicitement',
    'Vert public par défaut','Niveau simulé','Variation entre modèles',
    'Indice simulé','Score pondéré','Base de couleur','Qualité score',
    'Score provisoire','Jours mensuels relevés','Jours attendus','Qualité mois',
    'Offres moyennes mensuelles','Population 15-29 ans','Établissements employeurs',
    'Offres pour 10000 jeunes','Offres pour 100 employeurs',
    'Composante densité','Composante employeurs','Composante intensité','Composante tendance',
    'Évolution M-1','Évolution M-12','Distance au seuil','Anomalies',
  ];
  const lines = [headings].concat(audit.rows.map(row => [
    audit.version,audit.month,audit.publicationDate,audit.modelVersion,
    audit.populationReferenceYear,audit.sharedDays.join(' | '),
    row.code,row.name,row.oldLevel,row.oldExplicit,row.oldDefaultGreen,
    row.newLevel,row.change,row.index,row.score,row.scoreBasis,
    row.scoreQuality,row.provisional,row.daysObserved,row.daysExpected,
    row.monthlyQuality,row.averageOffers,row.population15To29,row.employers,
    row.offersPer10000Young,row.offersPer100Employers,
    row.components.density,row.components.employers,row.components.employerIntensity,
    row.components.trend,row.changeMonth,row.changeYear,row.nearThreshold,
    row.flags.map(flag => flag.level+':'+flag.code).join(' | '),
  ])));
  const csv = '\uFEFF'+lines.map(line => line.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv],{
    type:'text/csv;charset=utf-8;',
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'apprentifr_audit_exploratoire_'+audit.month+'.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after initiating the browser download, never retain the file in Firestore.
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function describeComparison(change) {
  if (change === 'stronger') return 'Vigilance plus élevée';
  if (change === 'weaker') return 'Vigilance moins élevée';
  if (change === 'same') return 'Même niveau';
  return 'Non comparable';
}

export default function AdminModelValidationPage() {
  const [month,setMonth] = useState(parisMonth);
  const [payload,setPayload] = useState(null);
  const [published,setPublished] = useState(null);
  const [attempted,setAttempted] = useState(false);
  const [loading,setLoading] = useState(false);
  const [monthlyError,setMonthlyError] = useState('');
  const [publishedError,setPublishedError] = useState('');
  const [filter,setFilter] = useState('all');
  const [search,setSearch] = useState('');
  const [order,setOrder] = useState('issues');
  const generation = useRef(0);

  useEffect(()=>{
    generation.current+=1;
    setPayload(null);
    setPublished(null);
    setMonthlyError('');
    setPublishedError('');
    setAttempted(false);
    setLoading(false);
    setFilter('all');
  },[month]);

  const audit = useMemo(() =>
    buildAdminModelValidationAudit(
      payload?.month === month ? payload : null,
      published,
    ),[payload,published,month]);

  async function run() {
    if (!month || loading) return;
    const ticket = ++generation.current;
    setLoading(true);
    setAttempted(true);
    setPayload(null);
    setPublished(null);
    setMonthlyError('');
    setPublishedError('');
    const [newResult,oldResult] = await Promise.allSettled([
      getAdminMonthlySettings(month),
      getLatestPublicVigilanceIndex(),
    ]);
    if (ticket !== generation.current) return;
    if (newResult.status === 'fulfilled') {
      setPayload(newResult.value);
      if (newResult.value?.scope !== 'all_offers_department') {
        setMonthlyError('Le service n’a pas fourni les 101 départements tous métiers.');
      }
    } else {
      setMonthlyError(newResult.reason?.message || 'Réponse mensuelle indisponible.');
    }
    if (oldResult.status === 'fulfilled' && oldResult.value?.exists) {
      setPublished(oldResult.value);
    } else {
      setPublishedError(oldResult.status === 'rejected'
        ? oldResult.reason?.message || 'Index publié inaccessible.'
        : 'Aucun index actuel vérifiable. Les écarts entre modèles ne seront pas calculés.');
    }
    setLoading(false);
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('fr-FR');
    const result = audit.available ? audit.rows.filter(row => {
      if (needle && !(row.code+' '+row.name).toLocaleLowerCase('fr-FR')
        .includes(needle)) return false;
      switch (filter) {
        case 'critical': return row.flags.some(flag=>flag.level==='critical');
        case 'source': return row.flags.some(flag=>[
          'MISSING_YOUNG_POPULATION','MISSING_EMPLOYERS',
          'NO_DAILY_OBSERVATION','NO_MONTHLY_ROW','NO_SCORE_RECORD',
        ].includes(flag.code));
        case 'stronger': return row.change==='stronger';
        case 'weaker': return row.change==='weaker';
        case 'major': return row.delta!==null && Math.abs(row.delta)>=2;
        case 'threshold': return row.nearThreshold!==null;
        case 'density': return row.scoreBasis==='density_only';
        case 'unknown': return row.newLevel==='unknown';
        default: return true;
      }
    }) : [];

    return result.sort((a,b)=>{
      if (order==='code') return a.code.localeCompare(b.code,'fr',{numeric:true});
      if (order==='score') return (a.index??Infinity)-(b.index??Infinity) ||
        a.code.localeCompare(b.code,'fr',{numeric:true});
      if (order==='delta') return (b.delta??-99)-(a.delta??-99) ||
        a.code.localeCompare(b.code,'fr',{numeric:true});
      // Auditing priority: critical anomalies, then warning or large discrepancy.
      const rank = row => row.flags.some(x=>x.level==='critical') ? 0 :
        row.flags.some(x=>x.level==='warning') ? 1 :
        row.delta!==null && Math.abs(row.delta)>=2 ? 2 :
        row.nearThreshold!==null ? 3 : 4;
      return rank(a)-rank(b) || a.code.localeCompare(b.code,'fr',{numeric:true});
    });
  },[audit,search,filter,order]);

  const counts = audit.counts;

  return (
    <AdminLayout>
      <section className="admin-console-page-head">
        <div>
          <p className="admin-console-eyebrow">Administration · Méthodologie · Contrôle qualité</p>
          <h1>Validation du modèle</h1>
          <p>Premier audit technique des 101 départements. Identifier les incohérences,
            les changements de classification et la qualité des données avant
            toute décision de publication.</p>
        </div>
        <a className="admin-detail-button" href="/admin/simulation">
          <FiActivity aria-hidden="true"/> Comparer les cartes
        </a>
      </section>

      <section className="panel admin-validation-panel">
        <div className="admin-validation-head">
          <div>
            <p className="admin-validation-eyebrow">Phase 1 · Audit exploratoire</p>
            <h2>Contrôle du modèle territorial</h2>
            <p>Ce contrôle ne modifie aucune vigilance, aucun seuil ni aucune donnée Firestore.</p>
          </div>
          <span className="admin-validation-badge"><FiShield aria-hidden="true"/>
            Non validé scientifiquement</span>
        </div>
        <form className="admin-validation-controls" onSubmit={event=>{
          event.preventDefault();
          run();
        }}>
          <label htmlFor="validation-month">Mois à analyser
            <input id="validation-month" type="month" value={month}
              max={parisMonth()} onChange={event => {
                if (event.target.value) setMonth(event.target.value);
              }} required/>
          </label>
          <button className="primary-button admin-validation-run" type="submit"
            disabled={loading}>
            <FiRefreshCw aria-hidden="true"/>
            {loading?'Audit en cours…':attempted?'Relancer l’audit':'Lancer l’audit'}
          </button>
          <button type="button" className="admin-validation-export"
            onClick={()=>exportAudit(audit)} disabled={!audit.available || loading}>
            <FiDownload aria-hidden="true"/> Exporter le rapport CSV
          </button>
        </form>
        <p className="admin-validation-hint">
          Deux sources en lecture seule : statistiques mensuelles Admin et dernier
          index effectivement publié. Le bouton ne recalcule pas les coefficients.
        </p>
      </section>

      {!attempted && (
        <section className="panel admin-validation-empty">
          <FiFileText aria-hidden="true"/>
          <div>
            <h2>Prêt pour le premier audit</h2>
            <p>Choisis un mois et lance le contrôle. Les 101 départements seront examinés
              individuellement avec un tableau des écarts et un inventaire des anomalies.</p>
          </div>
        </section>
      )}
      {loading && <p className="admin-validation-feedback" role="status">
        Lecture authentifiée et analyse des références disponibles…
      </p>}
      {monthlyError && <p className="admin-validation-error" role="alert">
        Nouveau moteur : {monthlyError} Aucun score ne sera extrapolé.
      </p>}
      {publishedError && <p className="admin-validation-feedback" role="status">
        Carte publiée : {publishedError}
      </p>}

      {audit.available && (
        <>
          <section className="panel admin-validation-panel" aria-label="Traçabilité du contrôle">
            <div className="section-heading">
              <div>
                <p className="kicker">Provenance et couverture</p>
                <h2>Ce qui a réellement été examiné</h2>
              </div>
              <span className="soft-pill">Lecture seule</span>
            </div>
            <dl className="admin-validation-provenance">
              <div><dt>Mois analysé</dt><dd>{audit.month} {audit.isProvisional?'· Provisoire':'· Mois clos ou demandé'}</dd></div>
              <div><dt>Vigilance publique</dt><dd>{audit.publicationDate || 'Non vérifiée'}</dd></div>
              <div><dt>Version du modèle</dt><dd>{audit.modelVersion || 'Inconnue'}</dd></div>
              <div><dt>Population de référence</dt><dd>INSEE · 15–29 ans · {audit.populationReferenceYear || 'millésime inconnu'}</dd></div>
              <div><dt>Référence nationale</dt><dd>{audit.reference?.eligibleDepartments ?? '—'} département(s) éligibles</dd></div>
              <div><dt>Référence employeurs</dt><dd>{audit.reference?.employerCoverageDepartments ?? '—'} département(s)</dd></div>
              <div><dt>Journées du score provisoire</dt>
                <dd>{audit.isProvisional
                  ? audit.sharedDays.length+' journée(s) communes · '+
                    (audit.sharedDays[0]||'—')+' au '+
                    (audit.sharedDays.at(-1)||'—')
                  : 'Sans fenêtre provisoire'}</dd></div>
              <div><dt>Méthode des relevés</dt><dd>{audit.previewMethod || 'Non précisée'}</dd></div>
              <div><dt>Version du rapport</dt><dd>{audit.version}</dd></div>
            </dl>
            {audit.isProvisional && (
              <p className="admin-validation-qualifier"><FiInfo aria-hidden="true"/>
                Le nombre de jours relevés dans le tableau couvre le mois,
                tandis que les scores provisoires utilisent seulement les jours
                communs de la cohorte nationale. Ces deux mesures ne sont pas
                directement interchangeables.
              </p>
            )}
            <div className="admin-validation-kpis">
              <Indicator label="Départements examinés" value={counts.total}
                note="Couverture administrative France entière"/>
              <Indicator label="Population disponible" value={counts.population+'/101'}
                note="INSEE 15–29 ans, pas le nombre réel de candidats"/>
              <Indicator label="Établissements disponibles" value={counts.employers+'/101'}
                note="Tous secteurs, pas uniquement les recruteurs d’apprentis"/>
              <Indicator label="Départements avec relevés" value={counts.observedRows+'/101'}
                note="Au moins une journée observée dans le mois"/>
              <Indicator label="Scores pondérés" value={counts.weighted+'/101'}
                note={counts.provisionalScores+' calcul(s) explicitement provisoires'}/>
              <Indicator label="Densité seule" value={counts.densityOnly}
                note="Couleur possible, mais score complet indisponible"/>
              <Indicator label="Scores sans tendance" value={counts.missingTrends}
                note="M−1/M−12 absentes du score pondéré"/>
              <Indicator label="Composantes toutes présentes" value={counts.weightedFourComponents}
                note="Densité, deux dimensions employeurs et évolution"/>
              <Indicator label="Anomalies critiques" value={counts.criticalDepartments}
                note="Départements ayant un contrôle incohérent"/>
              <Indicator label="À proximité d’un seuil" value={counts.nearThreshold}
                note="±"+audit.thresholdMargin+' points : contrôle indicatif, pas robustesse validée'/>
            </div>
            {audit.guardrails.length>0 && (
              <div className="admin-validation-issues">
                <h3><FiAlertCircle aria-hidden="true"/> Points bloquants à analyser</h3>
                <ul>{audit.guardrails.map((text,i)=><li key={i}>{text}</li>)}</ul>
              </div>
            )}
          </section>

          <section className="panel admin-validation-panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Lecture comparative</p>
                <h2>Transitions entre les deux méthodes</h2>
              </div>
            </div>
            <p className="admin-validation-qualifier"><FiInfo aria-hidden="true"/>
              Les deux méthodes n’ont pas les mêmes seuils ni forcément les mêmes dates.
              Il s’agit de divergences de classement, <strong>pas de l’évolution
              temporelle d’un département</strong>. Les verts publics non explicitement
              publiés sont exclus du calcul comparable.
            </p>
            <div className="admin-validation-kpis admin-validation-kpis--compare">
              <Indicator label="Comparaisons possibles" value={counts.compared}
                note="Niveaux publiés explicitement + indice expérimental"/>
              <Indicator label="Vigilance plus élevée" value={counts.strongerVigilance}
                note="Nouveau classement plus défavorable"/>
              <Indicator label="Vigilance moins élevée" value={counts.weakerVigilance}
                note="Nouveau classement plus favorable"/>
              <Indicator label="Niveau identique" value={counts.unchangedVigilance}
                note="Même couleur, malgré des méthodes différentes"/>
              <Indicator label="Écarts ≥ 2 niveaux" value={counts.majorDivergences}
                note="Examens prioritaires de divergence"/>
              <Indicator label="Verts publics exclus" value={counts.excludedDefaultGreen}
                note="Vert par défaut sans publication explicite"/>
            </div>
            {!audit.publishedAvailable && <p className="admin-validation-feedback">
              Matrice indisponible tant que l’index publié n’a pas été récupéré.
              Les contrôles de qualité du nouveau moteur restent disponibles.
            </p>}
            {audit.publishedAvailable && (
              <div className="admin-validation-table-scroll" role="region"
                aria-label="Tableau croisé des classements comparables" tabIndex={0}>
                <table className="simple-table admin-validation-matrix">
                  <caption>Ancienne couleur explicitement publiée (lignes) → couleur expérimentale (colonnes)</caption>
                  <thead><tr>
                    <th scope="col">Actuelle ↓ / Nouvelle →</th>
                    {AUDIT_LEVELS.map(level=><th scope="col" key={level}>{COLORS[level]}</th>)}
                    <th scope="col">Sans indice</th>
                  </tr></thead>
                  <tbody>
                    {AUDIT_LEVELS.map(level=>(
                      <tr key={level}>
                        <th scope="row"><Level value={level}/></th>
                        {AUDIT_LEVELS.map(next=>(
                          <td key={next} className={level===next?'admin-validation-matrix-diagonal':''}>
                            {audit.matrix[level][next]}
                          </td>
                        ))}
                        <td>{audit.matrix[level].unknown}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel admin-validation-panel">
            <div className="section-heading">
              <div>
                <p className="kicker">Détail territorial</p>
                <h2>101 dossiers départementaux</h2>
              </div>
              <span className="soft-pill">{visible.length} affiché(s)</span>
            </div>
            <div className="admin-validation-table-controls">
              <label htmlFor="admin-validation-search">Rechercher
                <input id="admin-validation-search" type="search"
                  value={search} placeholder="Nom ou code de département"
                  onChange={e=>setSearch(e.target.value)}/>
              </label>
              <label htmlFor="admin-validation-filter">Filtrer
                <select id="admin-validation-filter" value={filter}
                  onChange={e=>setFilter(e.target.value)}>
                  {FILTERS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label htmlFor="admin-validation-order">Classer
                <select id="admin-validation-order" value={order}
                  onChange={e=>setOrder(e.target.value)}>
                  <option value="issues">Contrôles à examiner</option>
                  <option value="delta">Vigilance plus élevée d’abord</option>
                  <option value="score">Indice expérimental croissant</option>
                  <option value="code">Ordre départemental</option>
                </select>
              </label>
            </div>
            <div className="admin-validation-table-scroll" role="region"
              aria-label="Rapport détaillé départemental" tabIndex={0}>
              <table className="simple-table admin-validation-table">
                <thead><tr>
                  <th scope="col">Département</th><th scope="col">Actuel</th>
                  <th scope="col">Simulé</th><th scope="col">Score / indice</th>
                  <th scope="col">Comparaison</th><th scope="col">Observations</th>
                  <th scope="col">Qualité / contrôles</th>
                </tr></thead>
                <tbody>
                  {visible.map(row=>(
                    <tr key={row.code}>
                      <th scope="row"><span>{row.code}</span> · {row.name}</th>
                      <td><Level value={row.oldLevel}
                        defaultGreen={row.oldDefaultGreen}/></td>
                      <td><Level value={row.newLevel}/></td>
                      <td>
                        <strong>{format(row.index)} / 100</strong>
                        <small>{row.scoreBasis==='density_only'
                          ? 'Densité seule · pas un score pondéré'
                          : row.weighted?'Score pondéré':'Non calculé'}</small>
                      </td>
                      <td>
                        <span className={'admin-validation-direction admin-validation-direction--'+row.change}>
                          {row.change==='stronger'?<FiTrendingUp aria-hidden="true"/>:
                            row.change==='weaker'?<FiTrendingDown aria-hidden="true"/>:null}
                          {describeComparison(row.change)}
                        </span>
                      </td>
                      <td>{row.daysObserved??'—'} / {row.daysExpected??'—'}
                        <small>Mois brut · {row.monthlyQuality}</small>
                      </td>
                      <td>
                        <strong>{row.scoreQuality}</strong>
                        <small>{row.flags.length} point(s) à examiner</small>
                        {row.flags.length>0 && <details className="admin-validation-row-flags">
                          <summary>Voir les contrôles</summary>
                          <ul>{row.flags.map((flag,i)=>(
                            <li key={flag.code+i}>
                              <b>{flag.level==='critical'?'Critique':flag.level==='warning'
                                ?'À vérifier':'À surveiller'}</b> : {flag.message}
                            </li>
                          ))}</ul>
                        </details>}
                        {row.reasons.length>0 &&
                          <small>Motifs moteur : {row.reasons.join(', ')}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length===0 && <p className="admin-validation-feedback">
              Aucun département ne correspond à ce filtre.</p>}
          </section>

          <section className="panel admin-validation-panel">
            <div className="section-heading">
              <div><p className="kicker">Périmètre de validation</p>
                <h2>Ce que ce premier audit ne prouve pas</h2></div>
              <FiShield aria-hidden="true"/>
            </div>
            <div className="admin-validation-pending">
              <p><FiCheckCircle aria-hidden="true"/> Contrôles exécutés : source,
                couverture, cohérence des ratios, présence des composantes, doublons,
                changements de couleurs et proximité des seuils.</p>
              <p><FiAlertCircle aria-hidden="true"/> Non évalués : sensibilité
                réelle aux coefficients ±0,5, stabilité sur plusieurs mois,
                cycle annuel, choix du périmètre démographique 14–29 vs 15–29 ans,
                confrontation DARES/DEPP et validation des seuils.</p>
              <p><FiInfo aria-hidden="true"/> Les ratios « offres/jeunes »,
                « établissements/jeunes » et « offres/établissements » sont
                mathématiquement liés : davantage de dimensions ne signifie
                pas davantage d’observations indépendantes.</p>
            </div>
            <p className="admin-validation-conclusion">
              <strong>Décision : modèle expérimental, validation statistique non acquise.</strong>
              Les résultats de ce rapport servent à orienter la revue humaine
              avant toute éventuelle publication.
            </p>
          </section>
        </>
      )}
    </AdminLayout>
  );
}
