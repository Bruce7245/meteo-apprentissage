const test = require('node:test');
const assert = require('node:assert/strict');

let layout = {};
try {
  layout = require('../lib/occupation-source-layout.cjs');
} catch {
  layout = {};
}

test('dailyDepartmentSnapshotPath matches the nested LBA snapshot layout', () => {
  assert.equal(typeof layout.dailyDepartmentSnapshotPath, 'function');
  assert.equal(
    layout.dailyDepartmentSnapshotPath('2026-10-05', '72'),
    'dailyOfferSnapshots/2026-10-05/departments/72'
  );
});

test('daily occupation trend reads exact daily occupation context snapshots', () => {
  assert.equal(typeof layout.dailyOccupationContextCollection, 'function');
  assert.equal(layout.dailyOccupationContextCollection(), 'occupationContextStats');
});
