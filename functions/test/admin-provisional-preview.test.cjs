'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_PREVIEW_DAYS,
  MIN_PREVIEW_DEPARTMENTS,
  findWindow,
  buildAlignedProvisionalRows,
} = require('../lib/admin-provisional-preview.cjs');
const {DEFAULT_WEIGHTS,simulateTerritorialScores} =
  require('../lib/admin-weighted-score.cjs');

function sampleRows({
  covered = 82, validDays = 4, withEmployers = 60,
  withoutDay33 = false, method = 'job-v1-search',
} = {}) {
  return Array.from({length:101},(_,index)=>{
    const code = String(index+1).padStart(2,'0');
    const hasWindow = index < covered;
    const n = hasWindow ? validDays : 1;
    const days = Array.from({length:n},(_,day)=>({
      date:'2026-10-'+String(day+2).padStart(2,'0'),
      method, offers:20+index%3, openings:30+index%3,
      possiblySaturated:false, methodologyBreak:false,
    }));
    if(withoutDay33 && code==='33')days.splice(0,days.length-2);
    const employerCount = index < withEmployers ? 2000 : null;
    const average = hasWindow ? 20+index%3 : 20;
    return {
      departmentCode:code,
      quality:'incomplete',
      comparisonReady:false,
      daysObserved:days.length,
      daysExpected:31,
      population15To29:100000,
      activeEmployerEstablishmentsCount:employerCount,
      averageOffers:average,
      offersPer10000Young:average/10,
      offersPer100Employers:employerCount>0?average/employerCount*100:null,
      dailySamples:days,
      changeMonth:null,
      changeYear:null,
    };
  });
}

test('a running month supports only a labelled provisional score on shared dates',()=>{
 const rows=sampleRows();
 const aligned=buildAlignedProvisionalRows(rows,{focusDepartmentCode:'33'});
 assert.equal(aligned.available,true);
 assert.equal(aligned.basis.sharedDays.length,4);
 assert.ok(aligned.basis.referenceDepartments>=MIN_PREVIEW_DEPARTMENTS);
 assert.equal(aligned.rows.find(x=>x.departmentCode==='33').comparisonReady,true);
 const result=simulateTerritorialScores(aligned.rows,DEFAULT_WEIGHTS,{provisional:true});
 assert.equal(result.mode,'provisional_admin_only');
 assert.ok(result.summary.scored>0);
 const score=result.scores.find(x=>x.departmentCode==='33');
 assert.equal(score.isProvisional,true);
 assert.equal(score.quality,'provisional');
 assert.ok(score.score!==null);
 assert.equal(score.components.trend,null);
 assert.equal(score.activeWeights.employers,2.1);
 assert.equal(score.activeWeights.employerIntensity,1.4);
 assert.equal(score.activeWeights.trend,0);
 assert.equal(score.seasonalityFactorApplied,1);
 assert.equal(result.reference.minimumEmployerReferenceDepartments,45);
 assert.equal(result.reference.employerCoverageDepartments,60);
 assert.equal(rows[32].quality,'incomplete');
 assert.equal(rows[32].comparisonReady,false);
});

test('no preview with only two days or fewer than 75 matching departments',()=>{
 const twoDays=buildAlignedProvisionalRows(sampleRows({validDays:2}));
 assert.equal(twoDays.available,false);
 assert.equal(twoDays.basis.reason,'NO_SHARED_REFERENCE_WINDOW');
 const lowCoverage=buildAlignedProvisionalRows(sampleRows({covered:74}));
 assert.equal(lowCoverage.available,false);
 assert.equal(MIN_PREVIEW_DAYS,3);
});

test('focus department is required to belong to the common comparison cohort',()=>{
 const rows=sampleRows({withoutDay33:true});
 const result=buildAlignedProvisionalRows(rows,{focusDepartmentCode:'33'});
 assert.equal(result.available,false);
 assert.equal(result.basis.reason,'NO_SHARED_REFERENCE_WINDOW');
});

test('common dates are the only input and unobserved days are never zero-filled',()=>{
 const rows=sampleRows();
 const row33=rows.find(r=>r.departmentCode==='33');
 row33.dailySamples[0].offers=45;
 const aligned=buildAlignedProvisionalRows(rows,{focusDepartmentCode:'33'});
 const transformed=aligned.rows.find(r=>r.departmentCode==='33');
 const expected=(45+row33.dailySamples.slice(1).reduce((s,d)=>s+d.offers,0))/4;
 assert.ok(Math.abs(transformed.averageOffers-expected)<1e-10);
 assert.equal(transformed.daysExpected,31);
 assert.equal(transformed.daysObserved,4);
 assert.equal(transformed.offersPer100Employers,expected/2000*100);
});

test('mixed methodology cannot be smuggled into a provisional common day',()=>{
 const rows=sampleRows();
 const row33=rows.find(r=>r.departmentCode==='33');
 row33.dailySamples[0].method='new-import-v2';
 const aligned=buildAlignedProvisionalRows(rows,{focusDepartmentCode:'33'});
 assert.equal(aligned.available,true);
 assert.ok(aligned.basis.sharedDays.length>=3);
 assert.ok(aligned.basis.sharedDays.every(date=>date!=='2026-10-02'));
});

test('suspected source saturation is excluded from the provisional window',()=>{
 const rows=sampleRows();
 const row33=rows.find(r=>r.departmentCode==='33');
 row33.dailySamples[1].possiblySaturated=true;
 const aligned=buildAlignedProvisionalRows(rows,{focusDepartmentCode:'33'});
 assert.ok(aligned.available);
 assert.equal(aligned.basis.sharedDays.length,3);
 assert.ok(!aligned.basis.sharedDays.includes('2026-10-03'));
});

test('unknown capping is explicitly indicative, never a consolidated score',()=>{
 const rows=sampleRows();
 for(const row of rows.slice(0,82)) row.dailySamples[0].possiblySaturated=null;
 const aligned=buildAlignedProvisionalRows(rows,{focusDepartmentCode:'33'});
 const scoring=simulateTerritorialScores(aligned.rows,DEFAULT_WEIGHTS,{provisional:true});
 const row=scoring.scores.find(x=>x.departmentCode==='33');
 assert.equal(row.quality,'indicative');
 assert.equal(row.isProvisional,true);
});

test('readiness threshold for an employer reference is not silently waived',()=>{
 const rows=sampleRows({withEmployers:20});
 const aligned=buildAlignedProvisionalRows(rows,{focusDepartmentCode:'33'});
 const scoring=simulateTerritorialScores(aligned.rows,DEFAULT_WEIGHTS,{provisional:true});
 assert.equal(scoring.reference.referenceEmployersPer10000Young,null);
 assert.equal(scoring.reference.referenceOffersPer100Employers,null);
 assert.equal(scoring.summary.scored,0);
});

test('completed-month benchmark never accepts provisional quality flags',()=>{
 const aligned=buildAlignedProvisionalRows(sampleRows());
 const consolidated=simulateTerritorialScores(aligned.rows,DEFAULT_WEIGHTS);
 assert.equal(consolidated.summary.scored,0);
});
