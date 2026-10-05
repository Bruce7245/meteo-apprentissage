const test = require('node:test');
const assert = require('node:assert/strict');

let helpersPromise;

async function helpers() {
  if (!helpersPromise) {
    helpersPromise = import('../../src/utils/occupationSearchUtils.js');
  }
  return helpersPromise;
}

test('occupation result becomes an explicit occupation selection', async () => {
  const search = await helpers();

  assert.deepEqual(
    search.resolveOccupationSearchResult({
      type: 'occupation',
      romeCode: 'd1108',
      label: 'Vente en alimentation',
    }),
    {
      status: 'selected',
      selection: {
        type: 'occupation',
        romeCode: 'D1108',
        label: 'Vente en alimentation',
      },
    }
  );
});

test('training with one ROME can resolve directly to that occupation', async () => {
  const search = await helpers();

  assert.deepEqual(
    search.resolveOccupationSearchResult({
      type: 'training',
      publicId: 'rncp_123',
      label: 'CAP Exemple',
      romeCodes: ['D1108'],
    }),
    {
      status: 'selected',
      selection: {
        type: 'training',
        trainingId: 'rncp_123',
        trainingLabel: 'CAP Exemple',
        romeCode: 'D1108',
        label: 'D1108',
      },
    }
  );
});

test('training with several ROME codes requires a choice and never auto-selects the first', async () => {
  const search = await helpers();

  const result = search.resolveOccupationSearchResult({
    type: 'training',
    publicId: 'rncp_999',
    label: 'BTS Exemple',
    romeCodes: ['M1607', 'D1401', 'bad', 'M1607'],
  });

  assert.deepEqual(result, {
    status: 'requires_rome_choice',
    training: {
      trainingId: 'rncp_999',
      trainingLabel: 'BTS Exemple',
    },
    choices: ['D1401', 'M1607'],
  });
  assert.equal('selection' in result, false);
});

test('training without a usable ROME is explicitly unavailable', async () => {
  const search = await helpers();

  assert.deepEqual(
    search.resolveOccupationSearchResult({
      type: 'training',
      label: 'Formation sans métier',
      romeCodes: [],
    }),
    {
      status: 'unavailable',
      message: 'Aucun métier ROME exploitable pour cette formation.',
    }
  );
});
