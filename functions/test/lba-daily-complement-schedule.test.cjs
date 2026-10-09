'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  baselineDay,exportRunId,departmentTotals,METHOD
}=require('../lba-daily-complement.cjs');

const source=fs.readFileSync(path.join(__dirname,'..','index.js'),'utf8');
const original=source.match(/exports\.importDailyOffers = onSchedule\([\s\S]*?schedule:\s*'([^']+)'/);
const complement=source.match(/exports\.complementPreviousDayLbaOffers = onSchedule\([\s\S]*?schedule:\s*'([^']+)'/);

test('releve 23h59 preserve, complement 04h Paris',()=>{
  assert.equal(original?.[1],'59 23 * * *');
  assert.equal(complement?.[1],'0 4 * * *');
  assert.match(source,/LBA_DAILY_COMPLEMENT_04H_V1/);
  assert.match(source,/timeZone: 'Europe\/Paris'/);
});
test('date cible : toujours la veille pour la fonction de 04h',()=>{
  assert.equal(baselineDay(new Date('2026-10-10T02:00:00.000Z')),'2026-10-09');
  assert.equal(baselineDay(new Date('2026-10-11T02:00:00.000Z')),'2026-10-10');
  assert.equal(baselineDay(new Date('2026-10-25T03:00:00.000Z')),'2026-10-24');
  assert.equal(baselineDay(new Date('2026-03-29T02:00:00.000Z')),'2026-03-28');
});
test('identifiant generation derive du timestamp UTC stable',()=>{
  assert.equal(exportRunId('2026-10-10T01:01:40.000Z'),'lba_export_20261010010140');
  assert.throws(()=>exportRunId('n/a'),/INVALID_EXPORT_TIMESTAMP/);
});
test('bilan par departement verifie avant / apres',()=>{
  const report=departmentTotals([
    {complement:{status:'added'}},
    {complement:{status:'enriched'}},
    {complement:{status:'baseline_only'}},
  ],{strict:2});
  assert.equal(report.before,2);
  assert.equal(report.after,3);
  assert.equal(report.added,1);
  assert.equal(report.enriched,1);
  assert.equal(report.baselineOnly,1);
  assert.equal(METHOD,'search_2359_plus_export_complement_0400_v1');
});
