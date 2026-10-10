import test from 'node:test';
import assert from 'node:assert/strict';
import {DEPARTMENT_CODES} from '../src/utils/departmentUtils.js';
import {
  AUDIT_VERSION,
  buildAdminModelValidationAudit,
} from '../src/utils/adminModelValidationAudit.mjs';

const monthly = (departmentCode, extras = {}) => ({
  departmentCode, departmentName: 'Département test ' + departmentCode,
  quality: 'incomplete', daysObserved: 4, daysExpected: 31,
  population15To29: 50000, activeEmployerEstablishmentsCount: 200,
  averageOffers: 22, offersPer10000Young: 4.4,
  offersPer100Employers: 11,
  changeMonth: null, changeYear: null,
  ...extras,
});

const score = (departmentCode, value, extras = {}) => ({
  departmentCode, score: value, quality: 'provisional', isProvisional: true,
  components: {density:50,employers:50,employerIntensity:50,trend:null},
  reasons: [],seasonalityFactorApplied:1,
  ...extras,
});

const publication = (explicit = [
  {departmentCode:'33',publishedLevel:'yellow'},
  {departmentCode:'72',publishedLevel:'red'},
  {departmentCode:'971',publishedLevel:'orange'},
]) => ({
  exists: true, latestDate:'2026-10-09',
  publishedCount: explicit.length, raw:{departments:explicit},
  departments: [
    {code:'33',name:'Gironde',publishedLevel:'yellow'},
    {code:'72',name:'Sarthe',publishedLevel:'red'},
    {code:'971',name:'Guadeloupe',publishedLevel:'orange'},
    {code:'75',name:'Paris',publishedLevel:'green'},
  ],
});

function experiment() {
  return {
    ok:true,scope:'all_offers_department',month:'2026-10',
    populationReferenceYear:2024,
    scoreConfig:{weights:{density:4,employers:3.5,trend:4}},
    departments:[monthly('33'),monthly('72'),monthly('971')],
    scoreSimulation:{
      calculationVersion:'adminTerritorialWeightedScore.experiment.v2',
      mode:'provisional_admin_only',
      previewBasis:{
        sharedDays:['2026-10-02','2026-10-03','2026-10-04'],
        referenceDepartments:82,method:'job-v1-search',
      },
      reference:{eligibleDepartments:82,employerCoverageDepartments:68},
      scores:[
        score('33',61),score('72',45),score('971',null,{
          quality:'unavailable',reasons:['AT_LEAST_TWO_DISTINCT_DIMENSIONS_REQUIRED'],
          components:{density:27,employers:null,employerIntensity:null,trend:null},
        }),
      ],
    },
  };
}

test('unknown inputs never imply validation, published green or comparable levels',()=>{
  const r=buildAdminModelValidationAudit(null,null);
  assert.equal(r.version,AUDIT_VERSION);
  assert.equal(r.available,false);
  assert.equal(r.counts.total,101);
  assert.equal(r.counts.compared,0);
  assert.equal(r.counts.criticalDepartments,0);
  assert.equal(r.counts.excludedDefaultGreen,0);
  assert.equal(r.publishedAvailable,false);
  assert.equal(r.rows.length,101);
  assert.equal(r.rows[0].oldLevel,'unknown');
});

test('compares only explicitly published values, excludes default greens and counts the DROM',()=>{
  const r=buildAdminModelValidationAudit(experiment(),publication());
  assert.equal(r.available,true);
  assert.equal(r.publishedAvailable,true);
  assert.equal(r.rows.length,101);
  assert.deepEqual(r.rows.map(row=>row.code),DEPARTMENT_CODES);
  assert.equal(r.counts.monthlyRows,3);
  assert.equal(r.counts.observedRows,3);
  assert.equal(r.counts.weighted,2);
  assert.equal(r.counts.weightedFourComponents,0);
  assert.equal(r.counts.weightedWithoutTrend,2);
  assert.equal(r.counts.densityOnly,1);
  assert.equal(r.counts.unavailable,98);
  assert.equal(r.counts.compared,3);
  assert.equal(r.counts.strongerVigilance,1);
});

test('vigilance comparisons have sign aligned with risk, not chronologically worded',()=>{
  const r=buildAdminModelValidationAudit(experiment(),publication());
  assert.equal(r.rows.find(x=>x.code==='33').oldLevel,'yellow');
  assert.equal(r.rows.find(x=>x.code==='33').newLevel,'green');
  assert.equal(r.rows.find(x=>x.code==='33').change,'weaker');
  assert.equal(r.rows.find(x=>x.code==='72').oldLevel,'red');
  assert.equal(r.rows.find(x=>x.code==='72').newLevel,'yellow');
  assert.equal(r.rows.find(x=>x.code==='72').change,'weaker');
  assert.equal(r.rows.find(x=>x.code==='971').oldLevel,'orange');
  assert.equal(r.rows.find(x=>x.code==='971').newLevel,'red');
  assert.equal(r.rows.find(x=>x.code==='971').change,'stronger');
  assert.equal(r.counts.strongerVigilance,1);
  assert.equal(r.counts.weakerVigilance,2);
  assert.equal(r.counts.unchangedVigilance,0);
  assert.equal(r.counts.majorDivergences,1);
  assert.equal(r.matrix.yellow.green,1);
  assert.equal(r.matrix.red.yellow,1);
  assert.equal(r.matrix.orange.red,1);
  assert.equal(r.rows.find(x=>x.code==='75').oldDefaultGreen,true);
  assert.equal(r.rows.find(x=>x.code==='75').delta,null);
  assert.equal(r.counts.excludedDefaultGreen,98);
  assert.equal(r.counts.excludedUnknownOrMissing,0);
});

test('threshold distance flags are descriptive only, never an implicit weight test',()=>{
  const r=buildAdminModelValidationAudit(experiment(),publication(),{
    thresholdMargin:3,
  });
  assert.equal(r.rows.find(x=>x.code==='33').nearThreshold,1);
  assert.equal(r.rows.find(x=>x.code==='72').nearThreshold,0);
  assert.equal(r.rows.find(x=>x.code==='971').nearThreshold,3);
  assert.equal(r.counts.nearThreshold,3);
  const without=buildAdminModelValidationAudit(experiment(),publication(),{
    thresholdMargin:0,
  });
  assert.equal(without.counts.nearThreshold,1);
  assert.ok(r.findings.some(item=>item.includes('coefficients')));
});

test('monthly ratio validation flags faulty source data without confusing provisional score basis',()=>{
  const data=experiment();
  data.departments[0]=monthly('33',{
    offersPer10000Young:4.9,offersPer100Employers:30,
  });
  const r=buildAdminModelValidationAudit(data,publication());
  const flags=r.rows.find(x=>x.code==='33').flags.map(f=>f.code);
  assert.ok(flags.includes('YOUNG_DENSITY_MISMATCH'));
  assert.ok(flags.includes('EMPLOYER_INTENSITY_MISMATCH'));
  assert.equal(r.counts.criticalDepartments,1);
  assert.equal(r.counts.weighted,2);
});

test('zero is a valid offer count and score, null remains unavailable',()=>{
  const data=experiment();
  data.departments[0]=monthly('33',{
    averageOffers:0,offersPer10000Young:0,offersPer100Employers:0,
  });
  data.scoreSimulation.scores[0]=score('33',0);
  const r=buildAdminModelValidationAudit(data,publication());
  const d=r.rows.find(x=>x.code==='33');
  assert.equal(d.score,0);
  assert.equal(d.newLevel,'red');
  assert.equal(d.flags.some(f=>f.level==='critical'),false);
  assert.equal(r.rows.find(x=>x.code==='75').score,null);
});

test('duplications and impossible observed days cause blockers on exact department',()=>{
  const data=experiment();
  data.departments.push(monthly('72',{daysObserved:36}));
  data.scoreSimulation.scores.push(score('72',29));
  const r=buildAdminModelValidationAudit(data,publication());
  const flags=r.rows.find(x=>x.code==='72').flags.map(f=>f.code);
  assert.ok(flags.includes('DUPLICATE_MONTHLY_ROW'));
  assert.ok(flags.includes('DUPLICATE_SCORE'));
  assert.ok(flags.includes('INVALID_DAY_COVERAGE'));
  assert.ok(r.guardrails.some(s=>s.includes('Doublons')));
  assert.ok(r.counts.criticalDepartments>=1);
});

test('provisional cohort provenance and populations are reported, not certified',()=>{
  const data=experiment();
  const r=buildAdminModelValidationAudit(data,publication());
  assert.equal(r.isProvisional,true);
  assert.equal(r.sharedDays.length,3);
  assert.equal(r.referenceDepartments,82);
  assert.equal(r.populationReferenceYear,2024);
  assert.equal(r.counts.population,3);
  assert.equal(r.counts.employers,3);
  assert.equal(r.counts.provisionalScores,2);
  assert.equal(r.counts.missingTrends,2);
  assert.equal(r.seasonalityNeutral,true);
  assert.equal(r.guardrails.length,0);
  data.scoreSimulation.previewBasis.sharedDays=['2026-10-02','2026-10-03'];
  data.scoreSimulation.previewBasis.referenceDepartments=65;
  const unsafe=buildAdminModelValidationAudit(data,publication());
  assert.ok(unsafe.guardrails.some(s=>s.includes('Provenance provisoire insuffisante')));
});

test('the technical audit runs without any published index and never fakes transitions',()=>{
  const r=buildAdminModelValidationAudit(experiment(),null);
  assert.equal(r.available,true);
  assert.equal(r.publishedAvailable,false);
  assert.equal(r.counts.compared,0);
  assert.equal(r.counts.excludedDefaultGreen,0);
  assert.equal(r.counts.excludedUnknownOrMissing,101);
  assert.equal(r.rows.find(x=>x.code==='33').change,'non_comparable');
});

test('bad scope blocks statistics rather than mixing occupation with national',()=>{
  const data=experiment();
  data.scope='rome_department';
  const r=buildAdminModelValidationAudit(data,publication());
  assert.equal(r.available,false);
  assert.equal(r.counts.compared,0);
});

test('model inputs remain unchanged by auditing',()=>{
  const data=experiment();
  const published=publication();
  const snapshot=JSON.stringify([data,published]);
  buildAdminModelValidationAudit(data,published);
  assert.equal(JSON.stringify([data,published]),snapshot);
});
