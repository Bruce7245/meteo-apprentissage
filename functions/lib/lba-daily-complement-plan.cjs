'use strict';

const {buildOccupationOfferSummary}=require('./daily-offer-snapshot.cjs');
const {normalizeExportOffer,stableExportIdentity,patchExistingOffer}=
  require('./lba-export-reconciliation.cjs');

const DEPARTMENTS=[
  ...Array.from({length:95},(_,i)=>String(i+1).padStart(2,'0')).filter(x=>x!=='20'),
  '2A','2B','971','972','973','974','976',
];
const VALID=new Set(DEPARTMENTS);
const ROME=/^[A-Z][0-9]{4}$/;

function required(ok,code){if(!ok)throw new Error(code);}
function sameDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(String(date||''));}

function chooseBaseline(existing, newValue){
  if(!existing)return newValue;
  if(newValue.locationQuality==='in_department'&&existing.locationQuality!=='in_department')
    return newValue;
  if(existing.locationQuality==='in_department'&&newValue.locationQuality!=='in_department')
    return existing;
  return existing;
}
function safeRow(row,runId,baselineDate){
  const clean={...row,runId,date:baselineDate};
  delete clean.updatedAt; // Timestamp Firestore historique != nouvelle observation.
  return clean;
}
function complementInfo(status,{exportDay,exportLastUpdate,baselineDate,conflicts=[]}){
  return {
    phase:'complement_04h',
    status,baselineDate,exportObservationDate:exportDay,
    exportLastUpdate,conflicts,
    sourceRoute:'/job/v1/export',
  };
}
function buildDailyComplementPlan({
  baselineOffers=[],exportJobs=[],baselineDate,exportDay,exportLastUpdate,runId
}={}){
  required(sameDate(baselineDate)&&sameDate(exportDay)&&baselineDate<exportDay,
    'INVALID_COMPLEMENT_DATES');
  required(/^lba_export_\d{14}$/.test(String(runId||'')),
    'INVALID_COMPLEMENT_RUN_ID');
  required(typeof exportLastUpdate==='string'&&exportLastUpdate.length>=19,
    'INVALID_EXPORT_UPDATE');

  const byId=new Map();
  const quality={invalidBaseline:0,duplicateBaseline:0};
  const list=Array.isArray(baselineOffers)?baselineOffers:[];
  for(const row of list){
    if(!row || !/^[a-f0-9]{64}$/.test(String(row.offerDocId||'')) ||
      !VALID.has(row.departmentCode)){
      quality.invalidBaseline++;continue;
    }
    const old=byId.get(row.offerDocId);
    if(old)quality.duplicateBaseline++;
    byId.set(row.offerDocId,chooseBaseline(old,row));
  }
  const initial=new Map([...byId].filter(([,r])=>r.locationQuality==='in_department'));
  const metrics={
    initialStored:list.length,initialStrict:initial.size,
    initialDuplicates:quality.duplicateBaseline,invalidBaseline:quality.invalidBaseline,
    exportEntries:0,exportOfferRows:0,exportDuplicateIds:0,
    exportCreatedAfterBaseline:0,exportWithoutCreationDate:0,
    added:0,enriched:0,unchanged:0,baselineOnly:0,review:0,
    conflicts:0,openingConflicts:0,departmentConflicts:0,
    quarantined:0,invalidIdentity:0,
    afterOffers:0,afterOpenings:0,
  };
  const staged=new Map();
  const selectedExport=new Set();
  const quarantined=[];
  const conflictTypes=new Map();
  function review(kind){conflictTypes.set(kind,(conflictTypes.get(kind)||0)+1);}
  const rows=Array.isArray(exportJobs)?exportJobs:[];
  for(const job of rows){
    metrics.exportEntries++;
    if(!job || typeof job!=='object'||!job.offer||
      job.identifier?.partner_label==='recruteurs_lba')continue;
    metrics.exportOfferRows++;
    const id=stableExportIdentity(job);
    if(!id){metrics.invalidIdentity++;continue;}
    if(selectedExport.has(id.offerDocId)){metrics.exportDuplicateIds++;continue;}
    selectedExport.add(id.offerDocId);
    const result=normalizeExportOffer(job,{snapshotDate:baselineDate,runId});
    const creation=result.publicationCreationDate;
    if(creation&&creation>baselineDate){
      metrics.exportCreatedAfterBaseline++;
      continue; // 04h du 10 ne devient jamais une creation le 09.
    }
    if(!creation)metrics.exportWithoutCreationDate++;
    if(!result.eligible){
      metrics.quarantined++;
      quarantined.push({
        offerDocId:id.offerDocId,partnerLabel:id.source,
        partnerJobId:id.partnerId||null,
        reason:result.reason||'location_unverified',
        observedDate:exportDay,runId,baselineDate,
      });
      continue;
    }
    const candidate=result.projected;
    if(!Array.isArray(candidate.romeCodes)||
        candidate.romeCodes.length===0){
      metrics.quarantined++;
      quarantined.push({
        offerDocId:id.offerDocId,partnerLabel:id.source,
        reason:'rome_missing',observedDate:exportDay,runId,baselineDate,
      });
      continue;
    }
    const previous=byId.get(candidate.offerDocId);
    let item,classification,conflicts=[];
    if(previous){
      const conflictingDept=previous.locationQuality==='in_department' &&
        previous.departmentCode!==candidate.departmentCode;
      if(conflictingDept){
        metrics.departmentConflicts++;review('departmentCode');
        // Sur ce conflit, conserver la localisation de la collecte initiale.
        // Ne pas dupliquer l'offre dans le nouveau departement.
        item=safeRow(previous,runId,baselineDate);
        classification='review';conflicts=['departmentCode'];
      }else{
        const patch=patchExistingOffer(previous,result);
        item=safeRow({...candidate,...previous,...patch.patch},runId,baselineDate);
        item.departmentCode=candidate.departmentCode;
        item.effectiveDepartmentCode=candidate.departmentCode;
        item.locationQuality='in_department';
        item.isInRequestedDepartment=true;
        conflicts=[...patch.conflicts];
        if(patch.openingCountChanged){
          metrics.openingConflicts++;conflicts.push('openingCount');
        }
        classification=conflicts.length?'review':
          patch.changed?'enriched':'unchanged';
      }
    }else{
      item=safeRow(candidate,runId,baselineDate);
      item.firstObservedDate=exportDay;
      item.firstObservedAt=null;
      classification='added';
    }
    for(const type of conflicts)review(type);
    metrics.conflicts+=conflicts.length;
    metrics[classification]++;
    item.complement=complementInfo(classification,{
      exportDay,exportLastUpdate,baselineDate,conflicts,
    });
    item.collectionPhase='complement_04h';
    item.collectionSource=previous?'daily_search_plus_lba_export':'lba_export_only';
    item.locationNormalization=item.locationNormalization||{
      origin:'original_collection',quality:'original_unverified',banVerified:false,
    };
    staged.set(candidate.offerDocId,item);
  }

  for(const [id,old] of initial){
    if(staged.has(id))continue;
    const original=safeRow(old,runId,baselineDate);
    original.complement=complementInfo('baseline_only',{
      exportDay,exportLastUpdate,baselineDate
    });
    original.collectionPhase='complement_04h';
    original.collectionSource='daily_search_only_not_confirmed_by_export';
    original.qualityStatus='baseline_unconfirmed_by_export';
    staged.set(id,original);
    metrics.baselineOnly++;
  }
  const byDepartment=new Map(DEPARTMENTS.map(code=>[code,[]]));
  for(const item of staged.values()){
    if(!VALID.has(item.departmentCode)||item.locationQuality!=='in_department'||
      !Array.isArray(item.romeCodes)||item.romeCodes.length===0){
      throw new Error('INVALID_FINAL_COMPLEMENT_OFFER');
    }
    if(!item.romeCodes.every(rome=>ROME.test(rome))){
      throw new Error('INVALID_FINAL_ROME');
    }
    byDepartment.get(item.departmentCode).push(item);
  }
  const departments=DEPARTMENTS.map(code=>{
    const offers=byDepartment.get(code);
    const summary=buildOccupationOfferSummary(offers);
    return {code,offers,summary,storedOffersCount:offers.length};
  });
  metrics.afterOffers=staged.size;
  metrics.afterOpenings=departments.reduce((sum,d)=>sum+d.summary.totalOpenings,0);
  required(departments.length===101 && byDepartment.size===101,'MISSING_DEPARTMENTS');
  required(metrics.afterOffers>=metrics.initialStrict,'COMPLEMENT_DELETED_INITIAL_OFFERS');
  required(metrics.afterOffers>=Math.max(7000,metrics.initialStrict),
    'COMPLEMENT_LOW_COVERAGE');
  required(departments.reduce((n,d)=>n+d.offers.length,0)===staged.size,
    'COMPLEMENT_SUM_MISMATCH');
  required(metrics.afterOffers===metrics.added+metrics.enriched+
    metrics.unchanged+metrics.review+metrics.baselineOnly,
    'COMPLEMENT_CLASSIFICATION_MISMATCH');
  return {
    baselineDate,exportDay,runId,exportLastUpdate,
    metrics,departments,quarantined,
    conflictTypes:Object.fromEntries(conflictTypes),
  };
}
module.exports={buildDailyComplementPlan,DEPARTMENTS};
