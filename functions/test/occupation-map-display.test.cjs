const test = require('node:test');
const assert = require('node:assert/strict');

let helpersPromise;

async function helpers() {
  if (!helpersPromise) {
    helpersPromise = import('../../src/utils/vigilanceDisplayUtils.js');
  }
  return helpersPromise;
}

test('occupation display preserves insufficient_data instead of normalizing it to green', async () => {
  const display = await helpers();

  assert.equal(
    display.normalizeDisplayedVigilanceLevel('insufficient_data'),
    'insufficient_data'
  );
  assert.equal(
    display.normalizeDisplayedVigilanceLevel('unknown-value'),
    'insufficient_data'
  );
});

test('department accessible label includes occupation context and textual vigilance', async () => {
  const display = await helpers();

  const label = display.buildDepartmentVigilanceLabel({
    departmentName: 'Sarthe',
    departmentCode: '72',
    level: 'insufficient_data',
    contextLabel: 'Boulangerie',
  });

  assert.match(label, /Sarthe/);
  assert.match(label, /72/);
  assert.match(label, /Boulangerie/);
  assert.match(label, /Données insuffisantes/);
});
