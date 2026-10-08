import React,{useEffect,useMemo,useState} from 'react';
import AdminLayout from '../../layouts/AdminLayout.jsx';
import OccupationSearch from '../../components/occupation/OccupationSearch.jsx';
import {getAdminOccupationOffers} from '../../services/adminStatsService.js';
import {normalizeRomeCode} from '../../utils/occupationUtils.js';
import './AdminOccupationOffersPage.css';

const PICKS=[
  {rome:'D1102',name:'Boulanger / Boulangère'},
  {rome:'G1803',name:'Serveur / Serveuse'},
  {rome:'N1103',name:'Préparateur / Préparatrice de commandes'},
  {rome:'D1214',name:'Vendeur / Vendeuse'},
  {rome:'D1202',name:'Coiffeur / Coiffeuse'},
];
const fmt=(v)=>v===null||v===undefined?'Non établi':new Intl.NumberFormat('fr-FR').format(v);
const signed=(v)=>v===null?'—':(v>0?'+':'')+new Intl.NumberFormat('fr-FR',{style:'percent',maximumFractionDigits:1}).format(v);
const slug=(s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function csvEscape(value){const s=String(value??'');return '"'+s.replace(/"/g,'""')+'"';}
function csvDownload(name,rows){
  const content='\uFEFF'+rows.map(row=>row.map(csvEscape).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function metric(row,key){return row?.[key]??null;}
export default function AdminOccupationOffersPage(){
  const params=new URLSearchParams(window.location.search);
  const [rome,setRome]=useState(normalizeRomeCode(params.get('rome'))||'');
  const [label,setLabel]=useState(PICKS.find(x=>x.rome===rome)?.name||rome);
  const [days,setDays]=useState(7);
  const [response,setResponse]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [metricKey,setMetricKey]=useState('offers');
  const [region,setRegion]=useState('all');
  const [query,setQuery]=useState('');
  const [minimum,setMinimum]=useState(0);
  const [limit,setLimit]=useState('5');
  const [completeOnly,setCompleteOnly]=useState(true);
  const [selectedDate,setSelectedDate]=useState('');
  const [copyNote,setCopyNote]=useState('');
  useEffect(()=>{
    if(!rome){setResponse(null);return undefined;}
    let active=true;
    setBusy(true);setError('');setResponse(null);setSelectedDate('');
    getAdminOccupationOffers(rome,{days}).then(result=>{if(active){setResponse(result);setSelectedDate(result.latestDate||'');}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(false)});
    return()=>{active=false};
  },[rome,days]);
  const history=useMemo(()=>response?.history||[],[response]);
  const dateRows=useMemo(()=>{
    const date=selectedDate||response?.latestDate;
    if(date===response?.latestDate)return response?.departments||[];
    return []; // Historical aggregates cannot be used to invent department-level history.
  },[response,selectedDate]);
  const current=history.find(item=>item.date===selectedDate) || response?.latest || null;
  const regions=useMemo(()=>[...new Set(dateRows.map(r=>r.regionName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr')),[dateRows]);
  const rows=useMemo(()=>{
    const needle=query.trim().toLocaleLowerCase('fr-FR');
    return dateRows.filter(row=>(!completeOnly||row.complete)&&
      (region==='all'||row.regionName===region)&&
      (!needle||[row.departmentName,row.departmentCode,row.regionName].some(s=>String(s).toLocaleLowerCase('fr-FR').includes(needle)))&&
      (metric(row,metricKey)===null?minimum===0:metric(row,metricKey)>=minimum))
      .sort((a,b)=>(metric(b,metricKey)??-1)-(metric(a,metricKey)??-1)||a.departmentCode.localeCompare(b.departmentCode,'fr'))
      .slice(0,limit==='all'?undefined:Number(limit));
  },[dateRows,completeOnly,region,query,minimum,metricKey,limit]);
  const allRows=useMemo(()=>dateRows.filter(row=>(!completeOnly||row.complete)&&
    (region==='all'||row.regionName===region)&&
    (!query.trim()||[row.departmentName,row.departmentCode,row.regionName].some(s=>String(s).toLocaleLowerCase('fr-FR').includes(query.trim().toLocaleLowerCase('fr-FR'))))&&
    (metric(row,metricKey)===null?minimum===0:metric(row,metricKey)>=minimum)),[dateRows,completeOnly,region,query,minimum,metricKey]);
  const previous=history.filter(p=>p.date<selectedDate).at(-1)||null;
  const comparable=Boolean(current?.comparable&&previous?.comparable);
  const variation=comparable&&previous?.[metricKey]>0?(current[metricKey]-previous[metricKey])/previous[metricKey]:null;
  const isVerified=Boolean(current?.comparable);
  const title=label||rome;
  const topFive=rows.slice(0,5);
  const exportBase=()=>['ApprentiFR',title,'ROME '+rome,'Relevé du '+(current?.date||'—'),'',...topFive.map((r,i)=>String(i+1)+'. '+r.departmentName+' ('+r.departmentCode+') : '+fmt(r.offers)+' offre(s), '+fmt(r.openings)+' poste(s)'),'','Source : La Bonne Alternance / ApprentiFR','Une offre peut correspondre à plusieurs postes et codes ROME.',isVerified?'Contrôles complets':'Données non certifiées : plafonnement ou couverture à vérifier'].join('\n');
  async function copyText(){try{await navigator.clipboard.writeText(exportBase());setCopyNote('Texte copié pour Canva');}catch{setCopyNote('Copie impossible : utilisez l’export CSV');}}
  function exportCsv(){csvDownload('apprentifr_'+rome+'_'+(current?.date||'releve')+'.csv',[
    ['Rang','Code ROME','Métier','Date','Département','Code département','Région','Offres','Postes','Fiabilité','SVG bleu'],
    ...rows.map((r,i)=>[i+1,rome,title,current?.date,r.departmentName,r.departmentCode,r.regionName,r.offers,r.openings,r.complete&&r.capAssessed&&!r.capped?'évalué':'à vérifier',r.departmentCode+'_'+slug(r.departmentName)+'_bleu.svg']),
  ]);}
  function choose(selection){
    const next=normalizeRomeCode(selection?.romeCode);
    if(!next)return;
    const url=new URL(window.location.href);url.searchParams.set('rome',next);window.history.replaceState(null,'',url.pathname+url.search);
    setRome(next);setLabel(selection.label||selection.trainingLabel||next);
    setRegion('all');setQuery('');setMinimum(0);
  }
  return <AdminLayout>
    <header className="admin-console-page-head"><div><p className="admin-console-eyebrow">Statistiques & publications / Métiers</p><h1>Explorer les offres par métier</h1><p>Classements territoriaux, filtres et données prêtes pour Canva, à partir des relevés quotidiens.</p></div>
      <a className="admin-detail-button" href="/admin/stats/vigilance">Analyses de vigilance →</a>
    </header>
    <section className="panel editorial-filters">
      <div className="section-heading"><div><p className="kicker">01 / Métier</p><h2>Choisir un métier (ROME)</h2></div><span className="soft-pill">{rome||'Aucun métier'}</span></div>
      <div className="editorial-picks">{PICKS.map(p=><button type="button" key={p.rome} className={rome===p.rome?'editorial-chip is-active':'editorial-chip'} onClick={()=>choose({romeCode:p.rome,label:p.name})}>{p.name} <small>{p.rome}</small></button>)}</div>
      <div className="editorial-picker-row"><OccupationSearch onOccupationSelect={choose} initialRomeCode={rome} initialLabel={label}/><div className="editorial-field"><label htmlFor="editorial-rome">Ou saisir un code ROME</label><input id="editorial-rome" placeholder="D1102" maxLength={5} onKeyDown={e=>{if(e.key==='Enter')choose({romeCode:e.currentTarget.value,label:e.currentTarget.value.toUpperCase()})}}/><small>Entrée pour valider</small></div></div>
      <div className="editorial-switch"><span>Période de recherche</span>{[7,30,60].map(n=><button type="button" key={n} className={days===n?'is-active':''} onClick={()=>setDays(n)}>{n} jours</button>)}</div>
    </section>
    {!rome&&<section className="panel"><h2>Sélectionne un métier pour commencer.</h2><p>Tu peux utiliser les raccourcis ou la recherche.</p></section>}
    {busy&&<section className="panel" role="status">Chargement du classement métier et vérification des données…</section>}
    {error&&<section className="admin-console-alert admin-console-alert-error" role="alert"><strong>Données indisponibles</strong><p>{error}</p><button onClick={()=>{const next=rome;setRome('');setTimeout(()=>setRome(next),0)}}>Réessayer</button></section>}
    {!busy&&!error&&response&& !response.latest&&<section className="panel"><h2>Aucun relevé disponible</h2><p>Le métier sélectionné ne possède pas encore d’instantané sur la période demandée.</p></section>}
    {!busy&&!error&&response?.latest&&<>
      <section className={'panel editorial-quality '+(isVerified?'is-valid':'is-warning')} role="status"><strong>{isVerified?'Relevé intégralement comparable':'Relevé observé, couverture ou plafonnement non certifiés'}</strong><span>{current?.coveredDepartments} / 101 départements · {current?.measuredDepartments} mesurés · {current?.unknownDepartments} avec ROME potentiellement tronqué · {current?.unassessedCapDepartments} sans contrôle de plafonnement · {current?.cappedDepartments} potentiellement plafonnés</span></section>
      <section className="editorial-kpis">
        <div className="panel"><small>Offres pour {rome}</small><strong>{fmt(current?.offers)}</strong><span>Minimum observé : {fmt(current?.observedOffers)}</span></div>
        <div className="panel"><small>Postes associés</small><strong>{fmt(current?.openings)}</strong><span>Minimum observé : {fmt(current?.observedOpenings)}</span></div>
        <div className="panel"><small>Variation vérifiable</small><strong>{signed(variation)}</strong><span>{comparable?'Depuis '+previous.date:'Données non comparables'}</span></div>
      </section>
      <section className="panel editorial-filters"><div className="section-heading"><div><p className="kicker">02 / Classement</p><h2>Filtrer et classer les départements</h2></div><span className="soft-pill">{allRows.length} territoire(s) dans le périmètre</span></div>
        <div className="editorial-control-grid">
          <div className="editorial-field"><label htmlFor="ed-region">Région</label><select id="ed-region" value={region} onChange={e=>setRegion(e.target.value)}><option value="all">Toutes les régions</option>{regions.map(x=><option key={x} value={x}>{x}</option>)}</select></div>
          <div className="editorial-field"><label htmlFor="ed-search">Département</label><input id="ed-search" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nom ou numéro"/></div>
          <div className="editorial-field"><label htmlFor="ed-metric">Critère</label><select id="ed-metric" value={metricKey} onChange={e=>setMetricKey(e.target.value)}><option value="offers">Nombre d’offres</option><option value="openings">Nombre de postes</option></select></div>
          <div className="editorial-field"><label htmlFor="ed-min">Minimum {metricKey==='offers'?'d’offres':'de postes'}</label><input id="ed-min" type="number" min="0" value={minimum} onChange={e=>setMinimum(Math.max(0,Number(e.target.value)||0))}/></div>
          <div className="editorial-field"><label htmlFor="ed-count">Nombre de résultats</label><select id="ed-count" value={limit} onChange={e=>setLimit(e.target.value)}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="all">Tous</option></select></div>
          <div className="editorial-field"><label htmlFor="ed-date">Date de référence</label><select id="ed-date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}><option value={response.latestDate}>{response.latestDate}</option>{history.filter(p=>p.date!==response.latestDate).map(p=><option key={p.date} value={p.date}>{p.date} (historique national)</option>)}</select></div>
        </div>
        <label className="editorial-checkbox"><input type="checkbox" checked={completeOnly} onChange={e=>setCompleteOnly(e.target.checked)}/> Masquer les départements sans décompte métier vérifiable</label>
        {selectedDate!==response.latestDate&&<p className="editorial-notice">La date sélectionnée ne comporte qu'un historique national ; aucun classement départemental n'est produit sans relevé géographique de cette date. Reviens à la dernière date pour exporter un Top 5.</p>}
      </section>
      <section className="panel editorial-results"><div className="section-heading"><div><p className="kicker">Résultats</p><h2>Classement — {title}</h2></div><span className="soft-pill">{current?.date}</span></div>
        <div className="table-wrapper"><table className="simple-table"><thead><tr><th>Rang</th><th>Département</th><th>Région</th><th>Offres</th><th>Postes</th><th>Statut</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.departmentCode}><td><strong>{i+1}</strong></td><td><strong>{r.departmentName}</strong><small className="editorial-depcode">{r.departmentCode}</small></td><td>{r.regionName}</td><td><strong>{fmt(r.offers)}</strong></td><td>{fmt(r.openings)}</td><td>{r.complete?(r.capped?'Plafonnement possible':r.capAssessed?'Mesuré':'À vérifier'):'Décompte absent'}</td></tr>)}</tbody></table></div>
        {!rows.length&&<p>Aucun département ne correspond aux filtres et à la date sélectionnés.</p>}
      </section>
      <section className="panel editorial-publication"><div className="section-heading"><div><p className="kicker">03 / Canva</p><h2>Préparer la publication</h2><p>Le texte et le fichier CSV utilisent exclusivement les lignes actuellement sélectionnées.</p></div></div>
        <div className="editorial-actions"><button type="button" onClick={copyText} disabled={!rows.length}>Copier les chiffres</button><button type="button" onClick={exportCsv} disabled={!rows.length}>Exporter le classement CSV</button></div>
        {copyNote&&<p role="status">{copyNote}</p>}
        <pre className="editorial-preview">{exportBase()}</pre>
        <p className="editorial-notice">Fichiers visuels : <code>Numdep_nomdep_bleu.svg</code> dans le pack bleu. Vérifie le nom exact de chaque fichier avant import Canva. Ne publie pas un total national marqué « Non établi » comme exhaustif.</p>
      </section>
    </>}
  </AdminLayout>;
}
