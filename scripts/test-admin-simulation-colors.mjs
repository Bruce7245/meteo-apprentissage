import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_SIMULATION_COLOR_VERSION,
  bandForAdminIndex,
  getAdminSimulationColor,
} from '../src/utils/adminSimulationColors.mjs';

test('four fixed exploratory bands have exact, unambiguous boundaries',()=>{
  for (const [value,expected] of [
    [0,'red'],[29.99,'red'],[30,'orange'],[44.99,'orange'],
    [45,'yellow'],[50,'yellow'],[59.99,'yellow'],
    [60,'green'],[100,'green'],
  ]) assert.equal(bandForAdminIndex(value)?.key,expected);
});

test('invalid, unknown or out-of-range inputs never imply a vigilance color',()=>{
  for (const value of [null,undefined,NaN,Infinity,-1,101,'60',{}]) {
    assert.equal(bandForAdminIndex(value),null);
  }
  for (const input of [null,undefined,{},{
    score:null,quality:'unavailable',
    reasons:['INCOMPLETE_OR_NONCOMPARABLE_MONTH'],
    components:{density:32},
  },{score:-1,quality:'provisional'}]) {
    assert.equal(getAdminSimulationColor(input).key,'unknown');
  }
});

test('available provisional or complete weighted score receives a simulation-only color',()=>{
  const provisional=getAdminSimulationColor({
    score:65,quality:'provisional',isProvisional:true,
  });
  assert.equal(provisional.key,'green');
  assert.equal(provisional.basis,'weighted');
  assert.match(provisional.detail,/provisoire/);
  assert.equal(provisional.version,ADMIN_SIMULATION_COLOR_VERSION);

  const complete=getAdminSimulationColor({score:33,quality:'experimental'});
  assert.equal(complete.key,'orange');
  assert.equal(complete.basis,'weighted');
  assert.match(complete.detail,/expérimental/);

  const indicative=getAdminSimulationColor({score:12,quality:'indicative'});
  assert.equal(indicative.key,'red');
  assert.equal(indicative.basis,'weighted');
});

test('a partial weighted score keeps its partial qualification',()=>{
  const color=getAdminSimulationColor({score:53,quality:'partial'});
  assert.equal(color.key,'yellow');
  assert.equal(color.basis,'weighted_partial');
  assert.match(color.detail,/partiel/);
});

test('a calculable normalized density can support a density-only color without inventing a weighted score',()=>{
  const color=getAdminSimulationColor({
    score:null,
    quality:'unavailable',
    reasons:['AT_LEAST_TWO_DISTINCT_DIMENSIONS_REQUIRED'],
    components:{density:33.6},
  });
  assert.equal(color.key,'orange');
  assert.equal(color.basis,'density_only');
  assert.equal(color.index,33.6);
  assert.match(color.detail,/score pondéré reste indisponible/);
});

test('zero density is an observed red; noncomparable density cannot be colored',()=>{
  const measured=getAdminSimulationColor({
    score:null,
    reasons:['AT_LEAST_TWO_DISTINCT_DIMENSIONS_REQUIRED'],
    components:{density:0},
  });
  assert.equal(measured.key,'red');
  assert.equal(measured.basis,'density_only');
  const missing=getAdminSimulationColor({
    score:null,
    reasons:['INSUFFICIENT_NATIONAL_REFERENCE'],
    components:{density:0},
  });
  assert.equal(missing.key,'unknown');
});

test('the provisional color must not be inferred from a stale published level',()=>{
  const result=getAdminSimulationColor({
    score:null,quality:'unavailable',publishedLevel:'green',
  });
  assert.equal(result.key,'unknown');
});
