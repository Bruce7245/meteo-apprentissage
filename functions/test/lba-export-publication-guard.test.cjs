'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isPublishedExportForDate } = require('../lib/lba-export-publication-guard.cjs');

test('published export on exact date protects its canonical snapshot', () => {
  const value = { date: '2026-10-09',status:'export_published',
    publishedExportRunId:'lba_export_20261009010140' };
  assert.equal(isPublishedExportForDate(value,'2026-10-09'),true);
  assert.equal(isPublishedExportForDate(value,'2026-10-10'),false);
});
test('draft and invalid roots do not disable the current search importer', () => {
  assert.equal(isPublishedExportForDate(null,'2026-10-09'),false);
  assert.equal(isPublishedExportForDate({date:'2026-10-09',status:'preparing',
    publishedExportRunId:'lba_export_20261009010140'},'2026-10-09'),false);
  assert.equal(isPublishedExportForDate({date:'2026-10-09',status:'export_published',
    publishedExportRunId:'attacker'},'2026-10-09'),false);
});
test('accepts admin firestore document snapshot', () => {
  const doc={exists:true,data(){return {date:'2026-10-09',status:'export_published',
    publishedExportRunId:'lba_export_20261009010140'}}};
  assert.equal(isPublishedExportForDate(doc,'2026-10-09'),true);
  assert.equal(isPublishedExportForDate({...doc,exists:false},'2026-10-09'),false);
});
