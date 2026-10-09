'use strict';

// Activation one-off du complement LBA #101, APRES deploiement des gardes.
// Phase 1 : copie versionnee des offres dans canonical offers/{runId}_{hash}.
// Phase 2 : controle 101 departements, dates, compteurs, ancien historique.
// Phase 3 : BASCULE ATOMIQUE des 101 metadonnees + pointeur global.
// Aucun document du stock historique 08/10 n'est modifie.
// ROLLBACK possible via activationBackups sous lbaExportComplementRuns.
const admin=require('firebase-admin');
const { isPublishedExportForDate }=require('../lib/lba-export-publication-guard.cjs');
const RUN_ID='lba_export_20261009010140';
const DATE='2026-10-09';
const BASELINE='2026-10-08';
const PROJECT='meteo-apprentissage';
const STAGING='lbaExportComplementRuns';
const MARKER='national_export_augmented_v1';
const CODES=[
  ...Array.from({length:95},(_,i)=>String(i+1).padStart(2,'0'))
    .filter(code=>code!=='20'),
  '2A','2B','971','972','973','974','976',
];
const CODESET=new Set(CODES);
function invariant(ok,description){if(!ok)throw new Error(description);}
function parisToday(){
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date());
}
function getDate(value){
  const date=new Date(value);
  return Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat('en-CA',{
      timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',
    }).format(date)
    : null;
}
function docId(hash){return 'export_'+RUN_ID+'_'+hash;}
function metadataForDepartment(code,detail){
  invariant(CODESET.has(code),'Departement non reconnu');
  invariant(detail.code===code && detail.date===DATE,'Metadonnees par departement incoherentes');
  const count=Number(detail.totalOffers);
  const openings=Number(detail.totalOpenings);
  invariant(Number.isInteger(count)&&count>=0&&Number.isInteger(openings)&&openings>=count,
    'Totaux invalides '+code);
  const strict=detail.strictSummary || {};
  invariant(Number(strict.totalOffers)===count&&Number(strict.totalOpenings)===openings,
    'Resume strict incompatible '+code);
  const safeSummary={
    ...strict, isPossiblySaturated:null,
    newTodayOffers:null, newTodayOpenings:null,
    qualityMethod:MARKER,
    methodologyBreak:true,
  };
  return {
    date:DATE,departmentCode:code,activeRunId:RUN_ID,
    source:'la_bonne_alternance',sourceRoute:'/api/job/v1/export',
    executionMode:'manual_export_activation',rawJobsCount:count,
    storedOffersCount:count,summary:safeSummary,strictSummary:safeSummary,
    importedAt:admin.firestore.FieldValue.serverTimestamp(),
    exportLastUpdate:'2026-10-09T01:01:40.000Z',
    methodologyBreak:true,qualityMethod:MARKER,
    qualityStatus:'methodology_change',schemaVersion:'dailyOfferSnapshots.exportComplement.v1',
    isPossiblySaturated:null,saturatedSources:[],
  };
}

async function assertBaseline(db){
  const docs=await db.collection('dailyOfferSnapshots').doc(BASELINE)
    .collection('departments').get();
  invariant(docs.size===101,'Ancien relevé incomplet');
  let total=0,strict=0;
  for(const doc of docs.docs){
    const data=doc.data()||{};
    total+=Number(data.storedOffersCount||0);
    strict+=Number(data.strictSummary?.totalOffers||0);
  }
  invariant(total===8751&&strict===8217,'Ancien relevé modifié, activation bloquée');
  return {stored:total,strict};
}
async function saveBackups(db,runRef){
  const targetRoot=db.collection('dailyOfferSnapshots').doc(DATE);
  const backupRoot=runRef.collection('activationBackups').doc('root');
  const oldBackup=await backupRoot.get();
  if(!oldBackup.exists){
    const original=await targetRoot.get();
    await backupRoot.create({
      existed:original.exists,
      original: original.exists?original.data():null,
      backedUpAt:admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion:'lbaExportComplement.backup.v1',
    });
  }
  let existsCount=0;
  for(const code of CODES){
    const backupRef=runRef.collection('activationBackups').doc('department_'+code);
    const existing=await backupRef.get();
    if(existing.exists){
      existsCount+=existing.data()?.existed===true?1:0;
      continue;
    }
    const active=await targetRoot.collection('departments').doc(code).get();
    await backupRef.create({
      existed:active.exists,
      original:active.exists?active.data():null,
      backedUpAt:admin.firestore.FieldValue.serverTimestamp(),
    });
    existsCount+=active.exists?1:0;
  }
  return {previouslyExistingDepartmentSnapshots:existsCount};
}
async function copyCanonicalOffers(db,runRef,details){
  const todayRoot=db.collection('dailyOfferSnapshots').doc(DATE);
  let nextIndex=0;
  let copied=0;
  const worker=async()=>{
    while(nextIndex<details.length){
      const row=details[nextIndex++];
      const code=row.code;
      const source=await runRef.collection('offers')
        .where('departmentCode','==',code).get();
      invariant(source.size===Number(row.totalOffers),
        'Staging offres par departement incoherent '+code);
      const dest=todayRoot.collection('departments').doc(code).collection('offers');
      let batch=db.batch();
      let count=0;
      for(const doc of source.docs){
        const data=doc.data()||{};
        invariant(data.runId===RUN_ID&&data.date===DATE
          &&data.departmentCode===code&&data.locationQuality==='in_department',
          'Offre de staging incompatible '+code);
        invariant(/^[a-f0-9]{64}$/.test(doc.id)&&data.offerDocId===doc.id,
          'Identite d offre invalide '+code);
        invariant(Array.isArray(data.romeCodes)&&data.romeCodes.length>0,
          'Offre sans ROME '+code);
        batch.set(dest.doc(docId(doc.id)),data,{merge:false});
        count++;
        if(count===175){
          await batch.commit();copied+=count;count=0;batch=db.batch();
        }
      }
      if(count){await batch.commit();copied+=count;}
    }
  };
  await Promise.all(Array.from({length:5},()=>worker()));
  return copied;
}
async function assertCanonicalCounts(db,details){
  const today=db.collection('dailyOfferSnapshots').doc(DATE);
  let idx=0;
  const counts=new Map();
  const worker=async()=>{
    while(idx<details.length){
      const {code,totalOffers}=details[idx++];
      const got=await today.collection('departments').doc(code).collection('offers')
        .where('runId','==',RUN_ID).count().get();
      invariant(got.data().count===Number(totalOffers),
        'Copie canonique incomplete '+code);
      counts.set(code,got.data().count);
    }
  };
  await Promise.all(Array.from({length:7},()=>worker()));
  invariant(counts.size===101,'Pas 101 comptes valides');
  const total=[...counts.values()].reduce((n,x)=>n+x,0);
  invariant(total===10086,'Somme canonique invalide');
  return total;
}
async function atomicActivate(db,runRef,details){
  const root=db.collection('dailyOfferSnapshots').doc(DATE);
  const active=await root.get();
  if(isPublishedExportForDate(active,DATE)){
    invariant(active.data().publishedExportRunId===RUN_ID,
      'Une autre generation nationale est deja active');
    return {alreadyPublished:true};
  }
  // Toute photographie preexistante a ete sauvegardee. La phase active est
  // atomique pour la nouvelle generation : 101 meta + root + run staging.
  const tx=db.batch();
  for(const row of details){
    tx.set(root.collection('departments').doc(row.code),
      metadataForDepartment(row.code,row),{merge:false});
  }
  tx.set(root,{
    date:DATE,status:'export_published',publishedExportRunId:RUN_ID,
    qualityMethod:MARKER,methodologyBreak:true,
    exportLastUpdate:'2026-10-09T01:01:40.000Z',
    publishedAt:admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion:'dailyOfferSnapshots.root.exportComplement.v1',
  },{merge:true});
  tx.set(runRef,{
    status:'published',published:true,activeSnapshotChanged:true,
    canonicalSnapshotDate:DATE,
    publishedAt:admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion:'lbaExportComplement.run.v1',
  },{merge:true});
  await tx.commit();
  return {alreadyPublished:false};
}
async function verifyPublished(db,runRef){
  const root=db.collection('dailyOfferSnapshots').doc(DATE);
  const [r,deps,stage]=await Promise.all([
    root.get(),root.collection('departments').get(),runRef.get()
  ]);
  invariant(isPublishedExportForDate(r,DATE),'Pointeur export non actif');
  invariant(stage.data()?.published===true,'Publication staging non marquee');
  invariant(deps.size===101,'Collection active incomplete');
  let total=0;
  for(const doc of deps.docs){
    const data=doc.data()||{};
    invariant(data.activeRunId===RUN_ID&&data.methodologyBreak===true,
      'Activation partielle '+doc.id);
    total+=Number(data.strictSummary?.totalOffers||0);
  }
  invariant(total===10086,'Somme active incomplete');
  return {departmentCount:deps.size,offerCount:total};
}
async function main(){
  invariant(parisToday()===DATE,
    'Activation refusee apres la date 09/10 : verifier le stock frais');
  if(admin.apps.length===0)admin.initializeApp({projectId:PROJECT});
  const db=admin.firestore();
  const runRef=db.collection(STAGING).doc(RUN_ID);
  const run=await runRef.get();
  invariant(run.exists,'Generation preparee absente');
  const data=run.data()||{};
  invariant(['staged_complete','published'].includes(data.status)&&
    data.fileSha256?.length===64,
    'Generation incomplete/invalide');
  invariant(getDate(data.exportLastUpdate)===DATE,
    'Export de reference date dun autre jour');
  const input=await runRef.collection('departments').get();
  invariant(input.size===101,'101 departements de staging requis');
  const details=input.docs.map(doc=>doc.data()||{}).sort((a,b)=>a.code.localeCompare(b.code));
  invariant(new Set(details.map(d=>d.code)).size===101
    &&details.every(d=>CODESET.has(d.code)),'Liste departements incorrecte');
  invariant(details.reduce((n,d)=>n+Number(d.totalOffers||0),0)===10086,
    'Somme staging != 10 086');
  const baseline=await assertBaseline(db);
  const current=await db.collection('dailyOfferSnapshots').doc(DATE).get();
  if(isPublishedExportForDate(current,DATE)
    &&current.data().publishedExportRunId===RUN_ID){
    const verified=await verifyPublished(db,runRef);
    console.log(JSON.stringify({status:'already_published',...verified,baseline}));
    return;
  }
  const backups=await saveBackups(db,runRef);
  const copied=await copyCanonicalOffers(db,runRef,details);
  invariant(copied===10086,'Nombre ecrit incomplet');
  const canonical=await assertCanonicalCounts(db,details);
  const activated=await atomicActivate(db,runRef,details);
  const verified=await verifyPublished(db,runRef);
  console.log(JSON.stringify({
    status:'published_verified',date:DATE,runId:RUN_ID,
    stagedCopied:copied,canonicalVerified:canonical,
    newFromExport:1706,matchedExisting:8380,unlocatedExcluded:104,
    backup:backups,activated,baseline,
    ...verified,methodologyBreak:true,
    previousDayPreserved:true,
  },null,2));
  if(process.env.GITHUB_STEP_SUMMARY){
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
      '## Activation du complement LBA - 09/10/2026','',
      '**Generation publiee et verifiee : '+verified.offerCount+' offres, '
        +verified.departmentCount+' departements.**','','- 1 706 offres nouvelles pour ApprentiFR',
      '- 8 380 offres deja connues',
      '- 104 offres non localisables en quarantaine privee',
      '- Photographie 08/10 preservee : 8 217 offres strictes',
      '- Rupture methodologique signalee : variation 08->09 non comparable',
      '- Ancien meta sauvegarde pour retour arriere',
      '',''
    ].join('\n'));
  }
}
main().catch(err=>{
  console.error('ACTIVATION ECHOUEE :',String(err?.message||err).slice(0,280));
  process.exitCode=1;
});
