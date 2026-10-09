'use strict';
// Retour arriere sur la bascule de metadata #101.
// Ne supprime pas les offres : celles prefixees restent inactives et
// les documents historiques inchanges restent recuperables.
const admin=require('firebase-admin');
const {isPublishedExportForDate}=require('../lib/lba-export-publication-guard.cjs');
const RUN='lba_export_20261009010140',DAY='2026-10-09';
const CODES=[
  ...Array.from({length:95},(_,i)=>String(i+1).padStart(2,'0'))
    .filter(x=>x!=='20'),'2A','2B','971','972','973','974','976',
];
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
async function main(){
  assert(process.env.ROLLBACK_APPROVED==='ROLLBACK_2026_10_09',
    'Retour arriere necessite autorisation explicite');
  if(admin.apps.length===0)admin.initializeApp({projectId:'meteo-apprentissage'});
  const db=admin.firestore(),run=db.collection('lbaExportComplementRuns').doc(RUN);
  const root=db.collection('dailyOfferSnapshots').doc(DAY);
  const [current,stage,backupRoot]=await Promise.all([
    root.get(),run.get(),run.collection('activationBackups').doc('root').get(),
  ]);
  assert(isPublishedExportForDate(current,DAY)
    &&current.data()?.publishedExportRunId===RUN,'Pointeur non conforme : rollback refuse');
  assert(stage.exists&&stage.data()?.published===true,
    'Generation non publiee : rien a restaurer');
  assert(backupRoot.exists,'Sauvegarde globale absente');
  const originalRoot=backupRoot.data()||{};
  assert(typeof originalRoot.existed==='boolean','Backup root incorrect');
  const before=[];
  for(const code of CODES){
    const backup=await run.collection('activationBackups')
      .doc('department_'+code).get();
    const active=await root.collection('departments').doc(code).get();
    assert(backup.exists,'Backup departement absent '+code);
    assert(active.exists&&active.data()?.activeRunId===RUN,
      'Un autre import a modifie '+code+' : rollback manuel requis');
    before.push({code, backup:backup.data()||{}});
  }
  const batch=db.batch();
  for(const entry of before){
    const ref=root.collection('departments').doc(entry.code);
    assert(typeof entry.backup.existed==='boolean','Backup invalide '+entry.code);
    if(entry.backup.existed)batch.set(ref,entry.backup.original);
    else batch.delete(ref);
  }
  if(originalRoot.existed)batch.set(root,originalRoot.original);
  else batch.delete(root);
  batch.set(run,{status:'staged_complete',published:false,activeSnapshotChanged:false,
    rollbackDate:DAY,rolledBackAt:admin.firestore.FieldValue.serverTimestamp()}, {merge:true});
  await batch.commit();
  const back=await root.get();
  assert(!isPublishedExportForDate(back,DAY),'Pointeur export persistant');
  console.log(JSON.stringify({
    status:'rollback_verified',date:DAY,
    previousSnapshotParentsRestored:before.filter(x=>x.backup.existed).length,
    previouslyAbsentSnapshotParentsRemoved:before.filter(x=>!x.backup.existed).length,
    stagesPreserved:true,historicalDataUntouched:true,
  }));
}
main().catch(e=>{console.error('ROLLBACK REFUSE/ECHOUE:',String(e?.message||e).slice(0,280));process.exitCode=1});
