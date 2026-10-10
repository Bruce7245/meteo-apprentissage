'use strict';
// Audit strictement en lecture seule des deux passages 09-10 octobre 2026.
// Ne pas afficher d'identifiants d'annonces, secret, nom d'entreprise, adresse.
const admin=require('firebase-admin');
const {existsSync,readFileSync,appendFileSync}=require('node:fs');
const PROJECT='meteo-apprentissage',DATE='2026-10-09';
if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
const db=admin.firestore();
function iso(value){
  if(!value)return null;
  try{
    const d=typeof value.toDate==='function'?value.toDate():new Date(value);
    return Number.isFinite(d.getTime())?d.toISOString():null;
  }catch{return null;}
}
function listSummary(d){
  if(!d.exists)return {exists:false};
  const x=d.data()||{};
  return {
    exists:true,status:x.status||null,date:x.date||null,
    executionMode:x.executionMode||null,
    source:x.source||null,
    sourceRoute:x.sourceRoute||null,
    departmentsCount:x.departmentsCount??null,
    successCount:x.successCount??null,
    errorCount:x.errorCount??null,
    startedAt:iso(x.startedAt)||iso(x.createdAt)||null,
    finishedAt:iso(x.finishedAt)||null,
    exportDay:x.exportDay||null,
    exportLastUpdate:iso(x.exportLastUpdate),
    runId:x.runId||null,
    publishedExportRunId:x.publishedExportRunId||null,
    methodologyBreak:x.methodologyBreak??null,
    complemented:x.complementApplied??null,
    collectionPhase:x.collectionPhase||null,
    initialOffers:x.initialOffers??null,afterOffers:x.afterOffers??null,
    added:x.added??null,enriched:x.enriched??null,
    unchanged:x.unchanged??null,baselineOnly:x.baselineOnly??null,
    quarantined:x.quarantined??null,review:x.review??null,
    errorCode:x.errorCode||null,
    oldDate:x.baselineDate||null,
  };
}
function aggregate(data,field){
  return data.reduce((s,r)=>s+Number(r[field]||0),0);
}
function group(data,field){
  const acc={};
  for(const row of data){
    const v=String(row[field]??'(absent)');
    acc[v]=(acc[v]||0)+1;
  }
  return Object.fromEntries(Object.entries(acc).sort((a,b)=>b[1]-a[1]).slice(0,15));
}
async function main(){
  const [night,complement,root,stage,depts,dayStats]=await Promise.all([
    db.collection('apiImports').doc('daily_'+DATE).get(),
    db.collection('dailyOfferComplementRuns').doc(DATE).get(),
    db.collection('dailyOfferSnapshots').doc(DATE).get(),
    db.collection('lbaExportComplementRuns').doc('lba_export_20261009010140').get(),
    db.collection('dailyOfferSnapshots').doc(DATE).collection('departments').get(),
    db.collection('departmentDailyStats').where('date','==',DATE).get(),
  ]);
  const depRows=depts.docs.map(d=>({code:d.id,...d.data()}));
  const dayRows=dayStats.docs.map(d=>d.data()||{});
  const report={
    auditedAt:new Date().toISOString(),timezone:'Europe/Paris',
    scheduledTimes:{initial:'23:59',complement:'04:00'},
    referenceDate:DATE,
    initialCollection:{
      ...listSummary(night),
      // NB le releve collecte normalement les 101 departements, mais le
      // snapshot deja exporte peut etre protege de cette collecte.
      departmentDailyStatsRows:dayRows.length,
      departmentDailyStatsImportTimes:{
        earliest:dayRows.map(r=>iso(r.importedAt)).filter(Boolean).sort()[0]||null,
        latest:dayRows.map(r=>iso(r.importedAt)).filter(Boolean).sort().at(-1)||null,
      },
      departmentDailyStatsCounts:{
        returnedActiveJobsCount:aggregate(dayRows,'returnedActiveJobsCount'),
        returnedActiveJobsDepartmentsWithCount:dayRows.filter(x=>
          Number.isFinite(Number(x.returnedActiveJobsCount))).length,
        activeOfferIdsRaw:dayRows.reduce((n,r)=>n+
          (Array.isArray(r.activeOfferIds)?r.activeOfferIds.length:0),0),
        activeOfferIdsDistinct:new Set(dayRows.flatMap(r=>
          Array.isArray(r.activeOfferIds)?r.activeOfferIds:[])
            .filter(x=>typeof x==='string'&&x)).size,
        jobsCount:aggregate(dayRows,'jobsCount'),
        openingCount:aggregate(dayRows,'openingCount'),
        recruitersCount:aggregate(dayRows,'recruitersCount'),
        warningsCount:aggregate(dayRows,'warningsCount'),
        notSeenSinceYesterdayCount:aggregate(dayRows,'notSeenSinceYesterdayCount'),
      },
      departmentsWithLastError:dayRows.filter(r=>r.lastError).length,
    },
    complementaryFunction:listSummary(complement),
    activeSnapshot:{
      ...listSummary(root),
      departmentParents:depts.size,
      sumStored:aggregate(depRows,'storedOffersCount'),
      sumStrict:depRows.reduce((n,d)=>n+Number(d.strictSummary?.totalOffers||0),0),
      sumOpenings:depRows.reduce((n,d)=>n+Number(d.strictSummary?.totalOpenings||0),0),
      activeRunIdGroups:group(depRows,'activeRunId'),
      executionModeGroups:group(depRows,'executionMode'),
      collectionPhaseGroups:group(depRows,'collectionPhase'),
      sourceRouteGroups:group(depRows,'sourceRoute'),
      methodologyBreakCount:depRows.filter(r=>r.methodologyBreak===true).length,
      complementAppliedCount:depRows.filter(r=>r.complementApplied===true).length,
      importTimes:{
        earliest:depRows.map(r=>iso(r.importedAt)).filter(Boolean).sort()[0]||null,
        latest:depRows.map(r=>iso(r.importedAt)).filter(Boolean).sort().at(-1)||null,
      },
    },
    previousExportStage:{
      ...listSummary(stage),
      published:stage.exists?stage.data()?.published===true:false,
      totalOffers:stage.exists?stage.data()?.report?.totalStagedOffers??null:null,
      quarantined:stage.exists?stage.data()?.report?.totalQuarantinedOffers??null:null,
    },
  };
  console.log('=== AUDIT COLLECTE 23H59 ET COMPLEMENT 04H ===');
  console.log(JSON.stringify(report,null,2));
  if(process.env.GITHUB_STEP_SUMMARY){
    const yes=v=>v===null?'inconnu':String(v);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
      '## Contrôle réel 23 h 59 et 4 h — photographie du 09/10/2026',
      '',
      '| Contrôle | Firestore |','|---|---|',
      '| Collecte de fin de soirée | '+yes(report.initialCollection.exists?'enregistrement présent':'aucun enregistrement')+' |',
      '| Départements parcourus par la collecte | '+yes(report.initialCollection.departmentsCount)+' |',
      '| Succès / erreurs de la collecte | '+yes(report.initialCollection.successCount)+' / '+yes(report.initialCollection.errorCount)+' |',
      '| Function de 4h | '+yes(report.complementaryFunction.status)+' |',
      '| Complément ajouté | '+yes(report.complementaryFunction.added)+' |',
      '| Photographie active | '+yes(report.activeSnapshot.status)+' |',
      '| Offres actives / départements | '+report.activeSnapshot.sumStrict+' / '+report.activeSnapshot.departmentParents+' |',
      '',
      '*Lecture seule. Horaires de programmation et exécution effective sont distincts.*',''
    ].join('\n'));
  }
}
main().catch(e=>{
 console.error('AUDIT_FAILED',e.message?.slice(0,180));
 process.exitCode=1;
});
