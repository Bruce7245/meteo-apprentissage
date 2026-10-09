'use strict';
// Rollback manuel, pas d'appel HTTP public. Ne supprime pas de documents
// d'offres : seule la reference active des 101 departements est restauree.
// runRef conserve les rapports et les documents versionnes pour l'audit.
const admin=require('firebase-admin');
const {DEPARTMENTS}=require('../lib/lba-daily-complement-plan.cjs');
const {isPublishedExportForDate}=require('../lib/lba-export-publication-guard.cjs');

function required(ok,code){if(!ok)throw new Error(code);}
async function main(){
  const date=process.env.COMPLEMENT_DATE;
  const approval=process.env.ROLLBACK_CONFIRMATION;
  required(/^\d{4}-\d{2}-\d{2}$/.test(date||''),'ROLLBACK_DATE_INVALID');
  required(approval==='ROLLBACK_COMPLEMENT_'+date,'ROLLBACK_APPROVAL_REQUIRED');
  if(!admin.apps.length)admin.initializeApp({projectId:'meteo-apprentissage'});
  const db=admin.firestore();
  const runRef=db.collection('dailyOfferComplementRuns').doc(date);
  const current=await db.collection('dailyOfferSnapshots').doc(date).get();
  const root=current.ref;
  const report=await runRef.get();
  required(current.exists && isPublishedExportForDate(current,date) &&
    current.data()?.status==='export_complement_published','ROLLBACK_UNEXPECTED_ROOT');
  required(report.exists && report.data()?.status==='published','ROLLBACK_RUN_NOT_PUBLISHED');
  required(current.data()?.publishedExportRunId===report.data()?.runId,
    'ROLLBACK_OTHER_RUN_ACTIVE');

  const rootBackup=await runRef.collection('backups').doc('root').get();
  required(rootBackup.exists,'ROLLBACK_ROOT_BACKUP_MISSING');
  const originalRoot=rootBackup.data()||{};
  required(typeof originalRoot.existed==='boolean','ROLLBACK_ROOT_BACKUP_INVALID');
  const original=[];
  for(const code of DEPARTMENTS){
    const [backup,now]=await Promise.all([
      runRef.collection('backups').doc('department_'+code).get(),
      root.collection('departments').doc(code).get()
    ]);
    required(backup.exists&&now.exists,'ROLLBACK_DEPARTMENT_BACKUP_MISSING');
    required(now.data()?.activeRunId===report.data().runId,
      'ROLLBACK_DEPARTMENT_CHANGED');
    const data=backup.data()||{};
    required(data.existed===true && data.value && typeof data.value.activeRunId==='string',
      'ROLLBACK_DEPARTMENT_BACKUP_INVALID');
    original.push({code,data:data.value});
  }

  const tx=db.batch();
  for(const item of original)
    tx.set(root.collection('departments').doc(item.code),item.data);
  if(originalRoot.existed)tx.set(root,originalRoot.value);
  else tx.delete(root);
  tx.set(runRef,{
    status:'rolled_back',rolledBackAt:admin.firestore.FieldValue.serverTimestamp(),
    publishedBeforeRollback:true,activeSnapshotChanged:false
  },{merge:true});
  await tx.commit();
  const [check,depts]=await Promise.all([root.get(),root.collection('departments').get()]);
  required(!isPublishedExportForDate(check,date),'ROLLBACK_ROOT_STILL_ACTIVE');
  required(depts.size===101,'ROLLBACK_DEPARTMENTS_MISSING');
  for(const doc of depts.docs){
    const prev=original.find(x=>x.code===doc.id);
    required(prev?.data.activeRunId===doc.data()?.activeRunId,
      'ROLLBACK_PARENT_NOT_RESTORED');
  }
  console.log(JSON.stringify({status:'rollback_verified',date,departmentsRestored:101,
    previousOffersNotDeleted:true,stagedOffersPreserved:true}));
}
main().catch(error=>{
  const msg=String(error?.message||'');
  console.error(/^[A-Z_]{6,90}$/.test(msg)?msg:'ROLLBACK_FAILED');
  process.exitCode=1;
});
