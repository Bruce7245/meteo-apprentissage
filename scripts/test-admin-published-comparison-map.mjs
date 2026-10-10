import test from 'node:test';
import assert from 'node:assert/strict';
import {DEPARTMENT_CODES} from '../src/utils/departmentUtils.js';
import {buildAdminPublishedComparisonMap} from '../src/utils/adminPublishedComparisonMap.mjs';

function index() {
  return {
    exists: true,
    latestDate: '2026-10-09',
    publishedCount: 2,
    raw: {
      departments: [
        {departmentCode: '33',publishedLevel: 'red'},
        {departmentCode: '971',publishedLevel: 'yellow'},
      ],
    },
    departments: [
      {code:'33',name:'Gironde',publishedLevel:'red'},
      {code:'971',name:'Guadeloupe',publishedLevel:'yellow'},
      {code:'72',name:'Sarthe',publishedLevel:'green'},
    ],
  };
}

test('no published index means all 101 departments remain grey',()=>{
  for (const payload of [null,{exists:false,departments:[
    {code:'33',level:'green'},
  ]}]) {
    const result=buildAdminPublishedComparisonMap(payload);
    assert.equal(result.available,false);
    assert.equal(result.summary.total,101);
    assert.equal(result.summary.unknown,101);
    assert.equal(result.summary.green,0);
    assert.equal(result.byCode.get('33').defaultGreen,false);
    assert.equal(result.latestDate,null);
  }
});

test('published map uses the same real levels and green fallback as the public page',()=>{
  const result=buildAdminPublishedComparisonMap(index());
  assert.equal(result.available,true);
  assert.equal(result.latestDate,'2026-10-09');
  assert.equal(result.summary.total,101);
  assert.equal(result.summary.red,1);
  assert.equal(result.summary.yellow,1);
  assert.equal(result.summary.green,99);
  assert.equal(result.summary.defaultGreen,99);
  assert.equal(result.summary.explicit,2);
  assert.equal(result.byCode.get('33').explicitlyPublished,true);
  assert.equal(result.byCode.get('72').defaultGreen,true);
  assert.equal(result.byCode.get('72').level,'green');
  assert.equal(result.byCode.get('75').defaultGreen,true);
});

test('same 101 French departments including the five DROM and Corsica',()=>{
  const result=buildAdminPublishedComparisonMap(index());
  assert.deepEqual(result.departments.map(x=>x.code),DEPARTMENT_CODES);
  for (const code of ['2A','2B','971','972','973','974','976']) {
    assert.ok(result.byCode.has(code));
  }
});

test('explicit green publication is not falsely called a fallback',()=>{
  const p=index();
  p.raw.departments.push({departmentCode:'72',publishedLevel:'green'});
  p.publishedCount=3;
  const result=buildAdminPublishedComparisonMap(p);
  assert.equal(result.byCode.get('72').level,'green');
  assert.equal(result.byCode.get('72').defaultGreen,false);
  assert.equal(result.byCode.get('72').explicitlyPublished,true);
  assert.equal(result.summary.defaultGreen,98);
});

test('alias colors are displayed like the public level normalizer',()=>{
  const p=index();
  p.departments[0].publishedLevel='rouge';
  p.departments[1].publishedLevel='jaune';
  const result=buildAdminPublishedComparisonMap(p);
  assert.equal(result.byCode.get('33').color,'red');
  assert.equal(result.byCode.get('971').color,'yellow');
});

test('invalid publication level uses the existing public green fallback',()=>{
  const p=index();
  p.departments[0].publishedLevel='oops';
  const result=buildAdminPublishedComparisonMap(p);
  assert.equal(result.byCode.get('33').color,'green');
  assert.equal(result.byCode.get('33').defaultGreen,false);
});

test('two maps can use the same selected code without sharing their levels',()=>{
  const published=buildAdminPublishedComparisonMap(index());
  assert.equal(published.byCode.get('33').color,'red');
  assert.equal(published.byCode.get('33').code,'33');
});
