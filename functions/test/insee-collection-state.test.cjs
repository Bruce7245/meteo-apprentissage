'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  isWrittenCompleteImport,
  resumableCursor,
  chooseDepartmentAction,
  classifyDepartment,
} = require('../lib/insee-collection-state.cjs');

test('an aggregate without a complete written import must not be skipped', () => {
  const plan = chooseDepartmentAction({
    importRecord: { complete: false, write: true, nextCursor: 'cursor-123' },
    statsAvailable: true,
    nafStatsAvailable: true,
  });
  assert.deepEqual(plan, { action: 'import', cursor: 'cursor-123', resumed: true });
});

test('complete import with all aggregates may be skipped', () => {
  const plan = chooseDepartmentAction({
    importRecord: { complete: true, write: true, employerOnly: true, activeOnly: false },
    statsAvailable: true,
    nafStatsAvailable: true,
  });
  assert.equal(plan.action, 'skip');
});

test('complete import missing NAF aggregation is not reimported', () => {
  const plan = chooseDepartmentAction({
    importRecord: { complete: true, write: true },
    statsAvailable: true,
    nafStatsAvailable: false,
  });
  assert.equal(plan.action, 'aggregate');
});

test('dry-run records never certify a completed import', () => {
  const state = { complete: true, write: false, nextCursor: 'cursor' };
  assert.equal(isWrittenCompleteImport(state), false);
  assert.equal(resumableCursor(state), '');
  assert.equal(chooseDepartmentAction({ importRecord: state, statsAvailable: true }).action, 'import');
});

test('existing job cursor takes priority over import index state', () => {
  const plan = chooseDepartmentAction({
    importRecord: { complete: true, write: true },
    statsAvailable: true,
    nafStatsAvailable: true,
    currentCursor: 'job-cursor',
  });
  assert.deepEqual(plan, { action: 'import', cursor: 'job-cursor', resumed: true });
});

test('forcing re-import starts at the beginning even if the old index is complete', () => {
  const plan = chooseDepartmentAction({
    importRecord: { complete: true, write: true },
    statsAvailable: true,
    nafStatsAvailable: true,
    skipExistingStats: false,
  });
  assert.deepEqual(plan, { action: 'import', cursor: '*', resumed: false });
});

test('missing or corrupted cursor restarts safely from first page', () => {
  for (const nextCursor of ['', '*', null]) {
    const plan = chooseDepartmentAction({
      importRecord: { complete: false, write: true, nextCursor },
    });
    assert.equal(plan.cursor, '*');
  }
});

test('the status separates collection progress from aggregates', () => {
  assert.equal(classifyDepartment({ statsAvailable: true }).status, 'not_started');
  assert.equal(classifyDepartment({
    importRecord: { write: true, complete: false },
    statsAvailable: true,
  }).status, 'partial');
  assert.equal(classifyDepartment({
    importRecord: { write: true, complete: true },
    statsAvailable: true,
  }).status, 'needs_aggregation');
  assert.equal(classifyDepartment({
    importRecord: { write: true, complete: true },
    statsAvailable: true,
    nafStatsAvailable: true,
  }).status, 'ready');
});
