'use strict';

// Complement a 04:00 Europe/Paris sur la photographie de la veille (J-1).
// Import initial 23h59 conserve en place; nouvelle generation versionnee,
// a laquelle les lecteurs accedent uniquement apres bascule de 101 parents.
// Aucune suppression d'offres ni dedoublonnage par similarite. Issue #103.

const admin=require('firebase-admin');
const {Readable}=require('node:stream');
const {readSignedExportStream}=require('./lib/lba-export-stream.cjs');
const {buildDailyComplementPlan,DEPARTMENTS}=
  require('./lib/lba-daily-complement-plan.cjs');
const {isPublishedExportForDate}=
  require('./lib/lba-export-publication-guard.cjs');

const API='https://api.apprentissage.beta.gouv.fr/api/job/v1/export';
const RUNS='dailyOfferComplementRuns';
const METHOD='search_2359_plus_export_complement_0400_v1';

function required(ok,code){if(!ok)throw new Error(code);}
function parisDate(date){
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(date);
}
function parisHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/Paris',hour:'2-digit',hourCycle:'h23',
  }).format(date));
}
function errorCode(error){
  const value=String(error?.message||'UNKNOWN');
  return /^[A-Z][A-Z0-9_]{3,88}$/.test(value)
    ? value:'LBA_COMPLEMENT_INTERNAL_ERROR';
}
function exportRunId(lastUpdate){
  const date=new Date(lastUpdate);
  required(Number.isFinite(date.getTime()),'INVALID_EXPORT_TIMESTAMP');
  return 'lba_export_'+date.toISOString().slice(0,19).replace(/\D/g,'');
}
function safeObject(value){
  if (value===null||value===undefined)return value;
  if(Array.isArray(value))return value.map(safeObject).filter(v=>v!==undefined);
  if(value && typeof value==='object'){
    if(value instanceof Date ||
      (typeof value.toDate==='function'&&Number.isFinite(value.seconds)) ||
      value.constructor?.name==='GeoPoint')return value;
    const out={};
    for(const [k,v] of Object.entries(value)){
      if(v!==undefined)out[k]=safeObject(v);
    }
    return out;
  }
  return value;
}
function baselineDay(now){return parisDate(new Date(now.getTime()-86400000));}

async function fetchMetadata(token,now){
  const res=await fetch(API,{
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    signal:AbortSignal.timeout(40000),
  });
  required(res.ok,'LBA_EXPORT_META_HTTP_ERROR');
  const meta=await res.json();
  const url=meta?.url;
  required(typeof url==='string'&&url.startsWith('https://'),'LBA_EXPORT_URL_INVALID');
  const stamp=new Date(meta?.lastUpdate);
  required(Number.isFinite(stamp.getTime()),'LBA_EXPORT_TIMESTAMP_INVALID');
  required(parisDate(stamp)===parisDate(now),'LBA_EXPORT_NOT_UPDATED_TODAY');
  const age=now.getTime()-stamp.getTime();
  required(age>=-15*60000&&age<=4*3600000,'LBA_EXPORT_TOO_OLD');
  required(parisHour(stamp)>=2,'LBA_EXPORT_BEFORE_NIGHTLY_REFRESH');
  return {lastUpdate:stamp.toISOString(),url,runId:exportRunId(meta.lastUpdate)};
}
async function fetchOffers(meta){
  const url=new URL(meta.url);
  required(url.protocol==='https:','LBA_EXPORT_URL_INVALID');
  const res=await fetch(meta.url,{signal:AbortSignal.timeout(20*60000)});
  required(res.ok,'LBA_EXPORT_DOWNLOAD_ERROR');
  const jobs=[];
  let recruiterRows=0,invalidRows=0;
  const stream=await readSignedExportStream(res,record=>{
    const source=record?.identifier?.partner_label;
    if(source==='recruteurs_lba'){recruiterRows++;return;}
    if(!record||typeof record!=='object'||!record.offer){
      invalidRows++;return;
    }
    jobs.push(record);
  },{maxBytes:1_500_000_000});
  required(jobs.length>=7000&&jobs.length<=100000,'LBA_EXPORT_COVERAGE_SUSPICIOUS');
  return {
    jobs,
    stats:{rowsParsed:stream.items,offerRows:jobs.length,recruiterRows,
      invalidRows,downloadedBytes:stream.downloadedBytes,gzip:stream.gzip},
  };
}
async function loadBaseline(db,date){
  const ref=db.collection('dailyOfferSnapshots').doc(date);
  const [root,depts]=await Promise.all([ref.get(),ref.collection('departments').get()]);
  required(!isPublishedExportForDate(root,date),'BASELINE_ALREADY_EXPORT_PUBLISHED');
  required(depts.size===101,'BASELINE_101_DEPARTMENTS_MISSING');
  const byCode=new Map(depts.docs.map(d=>[d.id,d]));
  required(DEPARTMENTS.every(code=>byCode.has(code)),
    'BASELINE_DEPARTMENT_CODES_MISMATCH');

  const rows=[],parents=[],batchSize=7;
  let cursor=0;
  const worker=async()=>{
    while(cursor<DEPARTMENTS.length){
      const code=DEPARTMENTS[cursor++];
      const snapshot=byCode.get(code);
      const data=snapshot.data()||{};
      required(data.date===date&&typeof data.activeRunId==='string'&&
        data.activeRunId.length>3,'BASELINE_INCOMPLETE_'+code.toUpperCase());
      required(data.strictSummary &&
        Number.isInteger(data.strictSummary.totalOffers)&&
        Number.isInteger(data.storedOffersCount),'BASELINE_SUMMARY_MISSING');
      const obs=await snapshot.ref.collection('offers')
        .where('runId','==',data.activeRunId).get();
      required(obs.size===data.storedOffersCount,'BASELINE_STORED_MISMATCH');
      let strict=0;
      for(const row of obs.docs){
        const doc=row.data()||{};
        required(doc.departmentCode===code,'BASELINE_OFFER_WRONG_DEPARTMENT');
        if(doc.locationQuality==='in_department')strict++;
        rows.push(doc);
      }
      required(strict===data.strictSummary.totalOffers,'BASELINE_STRICT_MISMATCH');
      parents.push({
        code,meta:data,activeRunId:data.activeRunId,
        stored:data.storedOffersCount,strict,
      });
    }
  };
  await Promise.all(Array.from({length:batchSize},()=>worker()));
  required(parents.length===101,'BASELINE_LOADING_INCOMPLETE');
  return {root:root.exists?root.data():null,parents,offers:rows};
}
function departmentTotals(items,original){
  const counts={before:Number(original?.strict||0),after:items.length,
    added:0,enriched:0,unchanged:0,baselineOnly:0,review:0,reclassified:0};
  for(const offer of items){
    const state=offer.complement?.status;
    if(offer.complement?.reclassifiedFromSearchDepartment)counts.reclassified++;
    if(state==='added')counts.added++;
    else if(state==='enriched')counts.enriched++;
    else if(state==='unchanged')counts.unchanged++;
    else if(state==='baseline_only')counts.baselineOnly++;
    else if(state==='review')counts.review++;
    else throw new Error('UNEXPECTED_COMPLEMENT_STATUS');
  }
  required(counts.added+counts.enriched+counts.unchanged+
    counts.baselineOnly+counts.review===counts.after,
  'DEPARTMENT_COMPLEMENT_SUM_MISMATCH');
  return counts;
}
async function acquire(db,runRef,date,now){
  return db.runTransaction(async tx=>{
    const existing=await tx.get(runRef);
    const data=existing.data()||{};
    if(data.status==='published')return 'already_published';
    const lease=data.leaseUntil?.toDate?.();
    if(data.status==='processing'&&lease&&lease>now)
      return 'already_processing';
    const attempts=Number(data.attempts||0)+1;
    required(attempts<=3,'TOO_MANY_COMPLEMENT_ATTEMPTS');
    tx.set(runRef,{
      date,status:'processing',attempts,startedAt:data.startedAt||now,
      lastAttemptAt:now,leaseUntil:new Date(now.getTime()+55*60000),
      qualityMethod:METHOD,
    },{merge:true});
    return 'acquired';
  });
}
async function stage(db,runRef,date,plan,baseline){
  const root=db.collection('dailyOfferSnapshots').doc(date);
  const beforeByCode=new Map(baseline.parents.map(p=>[p.code,p]));
  const runId=plan.runId;
  // Sauvegarde de l'etat original, sans mutation des parents actifs.
  const backupRoot=runRef.collection('backups').doc('root');
  const rootBackup=await backupRoot.get();
  if(!rootBackup.exists)await backupRoot.create({
    existed:Boolean(baseline.root),value:baseline.root||null
  });
  let i=0;
  const backWorker=async()=>{
    while(i<DEPARTMENTS.length){
      const code=DEPARTMENTS[i++];
      const target=runRef.collection('backups').doc('department_'+code);
      const exists=await target.get();
      if(!exists.exists)await target.create({
        existed:true,value:beforeByCode.get(code).meta,
      });
    }
  };
  await Promise.all(Array.from({length:7},()=>backWorker()));

  let copied=0,cursor=0;
  const worker=async()=>{
    while(cursor<plan.departments.length){
      const dept=plan.departments[cursor++];
      const target=root.collection('departments').doc(dept.code).collection('offers');
      let batch=db.batch(),queued=0;
      for(const original of dept.offers){
        required(original.runId===runId&&original.date===date,
          'STAGING_OFFER_IDENTITY_INVALID');
        const id='complement_'+runId+'_'+original.offerDocId;
        const data=safeObject(original);
        batch.set(target.doc(id),data,{merge:false});
        queued++;
        if(queued>=175){
          await batch.commit();copied+=queued;batch=db.batch();queued=0;
        }
      }
      if(queued){await batch.commit();copied+=queued;}
    }
  };
  await Promise.all(Array.from({length:5},()=>worker()));
  required(copied===plan.metrics.afterOffers,'STAGING_COUNT_MISMATCH');
  if(plan.quarantined.length){
    let batch=db.batch(),count=0;
    for(const item of plan.quarantined){
      batch.set(runRef.collection('quarantined').doc(item.offerDocId),
        safeObject(item));
      count++;
      if(count===175){await batch.commit();count=0;batch=db.batch();}
    }
    if(count)await batch.commit();
  }
  return copied;
}
async function validateStage(db,date,plan){
  const root=db.collection('dailyOfferSnapshots').doc(date);
  let cursor=0;
  const worker=async()=>{
    while(cursor<plan.departments.length){
      const d=plan.departments[cursor++];
      const res=await root.collection('departments').doc(d.code)
        .collection('offers').where('runId','==',plan.runId).count().get();
      required(res.data().count===d.offers.length,
        'STAGING_DEPARTMENT_COUNT_MISMATCH');
    }
  };
  await Promise.all(Array.from({length:7},()=>worker()));
}
async function confirmBaselineStillSame(db,date,baseline){
  const meta=await db.collection('dailyOfferSnapshots').doc(date)
    .collection('departments').get();
  required(meta.size===101,'BASELINE_CHANGED');
  for(const doc of meta.docs){
    const old=baseline.parents.find(x=>x.code===doc.id);
    const now=doc.data()||{};
    required(old&&old.activeRunId===now.activeRunId&&
      old.stored===now.storedOffersCount&&
      old.strict===now.strictSummary?.totalOffers,'BASELINE_CHANGED_DURING_COMPLEMENT');
  }
}
async function publish(db,runRef,date,plan,baseline,now){
  await confirmBaselineStillSame(db,date,baseline);
  const root=db.collection('dailyOfferSnapshots').doc(date);
  const previousDate=parisDate(new Date(new Date(date+'T12:00:00Z').getTime()-86400000));
  const prev=await db.collection('dailyOfferSnapshots').doc(previousDate)
    .collection('departments').limit(1).get();
  const previousMethod=prev.empty?null:prev.docs[0].data()?.qualityMethod;
  const methodologyBreak=previousMethod!==METHOD;
  const oldByCode=new Map(baseline.parents.map(p=>[p.code,p]));
  const batch=db.batch();
  for(const dept of plan.departments){
    const initial=oldByCode.get(dept.code);
    const counts=departmentTotals(dept.offers,initial);
    const summary=safeObject({
      ...dept.summary,isPossiblySaturated:null,newTodayOffers:null,
      newTodayOpenings:null,qualityMethod:METHOD,methodologyBreak,
    });
    const fields={
      ...initial.meta,date,departmentCode:dept.code,
      activeRunId:plan.runId,source:'la_bonne_alternance',
      sourceRoute:'/job/v1/search + /job/v1/export',
      qualityMethod:METHOD,methodologyBreak,
      collectionPhase:'complement_04h',
      complementApplied:true,complementRunId:plan.runId,
      complementExportLastUpdate:plan.exportLastUpdate,
      complementAppliedAt:admin.firestore.FieldValue.serverTimestamp(),
      initialStoredOffersCount:initial.stored,
      initialStrictOffersCount:initial.strict,
      storedOffersCount:counts.after,strictSummary:summary,summary,
      complement:counts,newTodayOffers:null,newTodayOpenings:null,
      isPossiblySaturated:null,saturatedSources:[],
      schemaVersion:'dailyOfferSnapshots.complement04h.v1',
    };
    // Les champs non-cites de la collecte initiale sont preserves.
    batch.set(root.collection('departments').doc(dept.code),fields);
  }
  batch.set(root,{
    date,status:'export_complement_published',
    publishedExportRunId:plan.runId,sourceRoute:'/job/v1/search + /job/v1/export',
    qualityMethod:METHOD,methodologyBreak,collectionPhase:'complement_04h',
    complementReportRef:runRef.path,
    updatedAt:admin.firestore.FieldValue.serverTimestamp(),
  },{merge:true});
  batch.set(runRef,{
    status:'published',publishedAt:admin.firestore.FieldValue.serverTimestamp(),
    finishedAt:admin.firestore.FieldValue.serverTimestamp(),
    runId:plan.runId,exportLastUpdate:plan.exportLastUpdate,
    baselineDate:plan.baselineDate,exportDay:plan.exportDay,
    metrics:plan.metrics,conflictTypes:plan.conflictTypes,
    fieldsFilled:plan.fieldsFilled,
    afterOffers:plan.metrics.afterOffers,
    initialOffers:plan.metrics.initialStrict,
    added:plan.metrics.added,enriched:plan.metrics.enriched,
    unchanged:plan.metrics.unchanged,baselineOnly:plan.metrics.baselineOnly,
    review:plan.metrics.review,quarantined:plan.metrics.quarantined,
    methodologyBreak,qualityMethod:METHOD,
    cleanupNeeded:false,
  },{merge:true});
  await batch.commit();
}
async function verify(db,date,plan) {
  const root=db.collection('dailyOfferSnapshots').doc(date);
  const [meta,deps]=await Promise.all([root.get(),root.collection('departments').get()]);
  required(isPublishedExportForDate(meta,date)&&
    meta.data()?.publishedExportRunId===plan.runId,'PUBLISHED_COMPLEMENT_MISSING');
  required(deps.size===101,'PUBLISHED_DEPARTMENT_COUNT_INVALID');
  const total=deps.docs.reduce((n,d)=>{
    required(d.data()?.activeRunId===plan.runId,'PUBLISHED_RUN_PARTIAL');
    return n+Number(d.data()?.strictSummary?.totalOffers||0);
  },0);
  required(total===plan.metrics.afterOffers,'PUBLISHED_TOTAL_MISMATCH');
  return {status:'published_verified',date,runId:plan.runId,afterOffers:total};
}

async function runDailyComplement({db,token,now=new Date(),publishEnabled=false}={}){
  required(db && typeof db.collection==='function','FIRESTORE_REQUIRED');
  required(typeof token==='string' && token.length>8,'LBA_TOKEN_MISSING');
  const target=baselineDay(now),exportDay=parisDate(now);
  const runRef=db.collection(RUNS).doc(target);
  const originalRoot=await db.collection('dailyOfferSnapshots').doc(target).get();
  if(isPublishedExportForDate(originalRoot,target)){
    // Pas de remplacement d'une generation export/complement deja publiee.
    const status=originalRoot.data()?.status==='export_complement_published'
      ? 'already_completed':'skipped_baseline_is_full_export';
    if(publishEnabled && status==='skipped_baseline_is_full_export') {
      await runRef.set({
        date:target,status,exportDay,
        finishedAt:admin.firestore.FieldValue.serverTimestamp(),
        description:'La veille etait deja issue de l export national',
      },{merge:true});
    }
    return {status,date:target};
  }
  if(publishEnabled){
    const locked=await acquire(db,runRef,target,now);
    if(locked!=='acquired')return {status:locked,date:target};
  }
  try {
    const baseline=await loadBaseline(db,target);
    const metadata=await fetchMetadata(token,now);
    const raw=await fetchOffers(metadata);
    const plan=buildDailyComplementPlan({
      baselineOffers:baseline.offers,exportJobs:raw.jobs,
      baselineDate:target,exportDay,exportLastUpdate:metadata.lastUpdate,
      runId:metadata.runId,
    });
    required(plan.metrics.exportOfferRows===raw.jobs.length,
      'EXPORT_PLAN_ROW_MISMATCH');
    required(plan.metrics.initialStrict>=100,'BASELINE_SUSPICIOUSLY_SMALL');
    const report={
      date:target,exportDay,runId:plan.runId,qualityMethod:METHOD,
      status:publishEnabled?'processing':'preview_verified',
      phase:publishEnabled?'staging':'preview',
      initialOffers:plan.metrics.initialStrict,afterOffers:plan.metrics.afterOffers,
      added:plan.metrics.added,enriched:plan.metrics.enriched,
      unchanged:plan.metrics.unchanged,baselineOnly:plan.metrics.baselineOnly,
      review:plan.metrics.review,quarantined:plan.metrics.quarantined,
      metrics:plan.metrics,conflictTypes:plan.conflictTypes,
      fieldsFilled:plan.fieldsFilled,
      exportLastUpdate:metadata.lastUpdate,export:raw.stats,
      completedAt:admin.firestore.FieldValue.serverTimestamp(),
    };
    if(!publishEnabled) return report;
    await runRef.set(report,{merge:true});
    await stage(db,runRef,target,plan,baseline);
    await validateStage(db,target,plan);
    await publish(db,runRef,target,plan,baseline,now);
    return {...await verify(db,target,plan),metrics:plan.metrics};
  }catch(error){
    if(publishEnabled){
      try{
        const existing=await runRef.get();
        const published=existing.data()?.status==='published';
        await runRef.set({
          ...(published ? {lastVerificationErrorCode:errorCode(error)} :
            {status:'failed',errorCode:errorCode(error)}),
          failedAt:admin.firestore.FieldValue.serverTimestamp(),
        },{merge:true});
      }catch(_ignored){}
    }
    // Pas d'URL signee, d'offres ou de secret dans l'exception exposee.
    throw new Error(errorCode(error));
  }
}
module.exports={
  runDailyComplement,baselineDay,exportRunId,fetchMetadata,
  departmentTotals,METHOD,
};
