'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeExportOffer}=require('../lib/lba-export-reconciliation.cjs');
const {buildDailyComplementPlan}=require('../lib/lba-daily-complement-plan.cjs');
const D='2026-10-09',E='2026-10-10',RUN='lba_export_20261010010140';
function job(id,address='72000 LE MANS',creation='2026-10-09T10:20:00Z',extra={}){
  return {
    identifier:{id,partner_label:'France Travail',partner_job_id:id},
    offer:{title:'Boulanger',opening_count:1,rome_codes:['D1102'],
      publication:{creation,expiration:'2026-11-09T00:00:00Z'}},
    workplace:{location:{address},...extra},
  };
}
function original(j) {
  const p=normalizeExportOffer(j,{snapshotDate:D,runId:'original'});
  return {...p.projected,runId:'original',firstObservedDate:D};
}
function plan(exportJobs,baselineOffers=[]){
  return buildDailyComplementPlan({
    baselineOffers,exportJobs,baselineDate:D,exportDay:E,
    exportLastUpdate:'2026-10-10T01:01:40.000Z',runId:RUN,minOffers:0
  });
}
test('complement distingue ajoutee, enrichie, inchangee et initiale seule',()=>{
  const a=original(job('A'));
  const b={...original(job('B','75001 PARIS')),city:null};
  const old=original(job('C','59000 LILLE'));
  const audit=plan([job('A'),job('B','75001 PARIS'),job('D','69001 LYON')],[a,b,old]);
  assert.equal(audit.metrics.initialStrict,3);
  assert.equal(audit.metrics.added,1);
  assert.equal(audit.metrics.enriched,1);
  assert.equal(audit.metrics.unchanged,1);
  assert.equal(audit.metrics.baselineOnly,1);
  assert.equal(audit.metrics.afterOffers,4);
  const o=audit.departments.flatMap(d=>d.offers);
  assert.equal(o.find(x=>x.offerDocId===a.offerDocId).complement.status,'unchanged');
  assert.equal(o.find(x=>x.offerDocId===b.offerDocId).city,'PARIS');
  assert.equal(o.find(x=>x.offerDocId===old.offerDocId).complement.status,'baseline_only');
  assert.equal(o.find(x=>x.complement.status==='added').firstObservedDate,E);
  assert.equal(new Set(o.map(x=>x.offerDocId)).size,o.length);
  assert.equal(audit.departments.length,101);
});
test('aucune offre publiee apres le relevé initial n est attribuee au 09',()=>{
  const x=plan([job('A','72000 LE MANS','2026-10-10T01:23:00Z')]);
  assert.equal(x.metrics.exportCreatedAfterBaseline,1);
  assert.equal(x.metrics.added,0);
});
test('offre sans code postal reste en quarantaine',()=>{
  const a=plan([job('A','ADRESSE NON DEFINIE')]);
  assert.equal(a.metrics.quarantined,1);
  assert.equal(a.metrics.afterOffers,0);
});
test('un conflit de localisation conserve le lieu initial et le signale',()=>{
  const old=original(job('A','72000 LE MANS'));
  const a=plan([job('A','75001 PARIS')],[old]);
  assert.equal(a.metrics.review,1);
  assert.equal(a.metrics.departmentConflicts,1);
  assert.equal(a.departments.find(x=>x.code==='72').offers.length,1);
  assert.equal(a.departments.find(x=>x.code==='75').offers.length,0);
  assert.equal(a.departments.find(x=>x.code==='72').offers[0].complement.status,'review');
});
test('idempotence de la lecture : doublon export compte une seule fois',()=>{
  const one=job('A');
  const x=plan([one,one]);
  assert.equal(x.metrics.added,1);
  assert.equal(x.metrics.exportDuplicateIds,1);
  assert.equal(x.metrics.afterOffers,1);
});
test('une divergence de date de creation ne transforme pas une offre connue en nouvelle',()=>{
  const old=original(job('A','72000 LE MANS','2026-09-20T10:00:00Z'));
  const x=plan([job('A','72000 LE MANS','2026-10-09T10:00:00Z')],[old]);
  assert.equal(x.metrics.added,0);
  assert.equal(x.metrics.review,1);
  assert.equal(x.metrics.conflicts>=1,true);
  assert.equal(x.departments.find(x=>x.code==='72').offers[0].publicationCreationDate,'2026-09-20');
});
test('les 101 departements et les totaux sont toujours coherents',()=>{
  const x=plan([job('A'),job('B','97410 SAINT PIERRE')]);
  assert.equal(x.departments.length,101);
  assert.equal(x.metrics.afterOffers,2);
  assert.equal(x.departments.reduce((n,d)=>n+d.summary.totalOffers,0),2);
  assert.equal(x.departments.find(x=>x.code==='974').summary.totalOffers,1);
});

test('deux annonces semblables mais avec ID differents ne sont pas dedoublonnees',()=>{
  const x=plan([job('ID-1'),job('ID-2')]);
  assert.equal(x.metrics.added,2);
  assert.equal(x.metrics.afterOffers,2);
  assert.equal(x.metrics.exportDuplicateIds,0);
});
test('une nouvelle annonce sans date est mise a part au lieu d etre attribuee a la veille',()=>{
  const d=job('ID-A');
  d.offer.publication.creation=null;
  const x=plan([d]);
  assert.equal(x.metrics.added,0);
  assert.equal(x.metrics.quarantined,1);
  assert.equal(x.metrics.withoutCreationQuarantined,1);
});
test('une annonce ancienne sans date peut etre conservee et enrichie par identifiant',()=>{
  const old=original(job('ID-B'));
  const d=job('ID-B');
  d.offer.publication.creation=null;
  const x=plan([d],[old]);
  assert.equal(x.metrics.added,0);
  assert.equal(x.metrics.afterOffers,1);
});
