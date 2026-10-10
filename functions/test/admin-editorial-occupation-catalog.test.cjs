const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogueFromSnapshots, mergeOccupationCatalogues, loadEditorialOccupationCatalogue, handleEditorialOccupationCatalogue } = require('../admin-editorial-occupation-catalog.cjs');
const date = '2026-10-09';
function doc(id, rows, extra = {}) {
  return { id, data: () => ({
    departmentCode: id, date, activeRunId: 'run', storedOffersCount: 100,
    strictSummary: { totalOffers: 25, byRome: rows },
    ...extra,
  }) };
}
test('catalogue all positively observed codes, not five hardcoded picks', () => {
  const result = catalogueFromSnapshots(date, [
    doc('72', [{ code: 'D1102', offers: 4, openings: 6 }, { code: 'G1803', offers: 2, openings: 2 }]),
    doc('59', [{ code: 'D1102', offers: 5, openings: 5 }, { code: 'A1203', offers: 1, openings: 1 }]),
  ], new Map([['D1102', 'Boulangerie']]));
  assert.deepEqual(result.occupations.map(x => x.romeCode), ['D1102', 'G1803', 'A1203']);
  assert.equal(result.occupations[0].label, 'Boulangerie');
  assert.equal(result.occupations[0].observedOffers, 9);
  assert.equal(result.occupations[0].departments, 2);
  assert.equal(result.coveredDepartments, 2);
});
test('quarantine and malformed or incoherent snapshots do not contribute', () => {
  const result = catalogueFromSnapshots(date, [
    doc('72', [{ code: 'D1102', offers: 10, openings: 11 }], { qualityStatus: 'quarantined' }),
    doc('59', [{ code: 'G1803', offers: 3, openings: 3 }], { storedOffersCount: 1 }),
    doc('75', [{ code: 'D1202', offers: 2, openings: 2 }], { date: '2026-10-08' }),
    doc('69', [{ code: 'N1103', offers: 2, openings: 2 }]),
  ]);
  assert.deepEqual(result.occupations.map(x => x.romeCode), ['N1103']);
});
test('missing code or zero offers do not count as availability', () => {
  const result = catalogueFromSnapshots(date, [doc('72', [
    { code: 'D1102', offers: 0, openings: 0 },
    { code: '<script>', offers: 2, openings: 2 },
    { code: 'G1803', offers: 1, openings: 2 },
    { code: 'G1803', offers: 1, openings: 2 },
  ])]);
  assert.equal(result.occupations.length, 1);
  assert.equal(result.occupations[0].observedOffers, 1);
});
test('anonymous admin endpoint is rejected', async () => {
  const response = { status(code) { this.code = code; return this; }, json(data) { this.payload = data; }, set() {} };
  await handleEditorialOccupationCatalogue({ request: { method: 'POST', get: () => '' }, response, auth: {}, db: {} });
  assert.equal(response.code, 401);
});

test('retains occupations seen on different days without adding daily totals', () => {
  const recent = catalogueFromSnapshots('2026-10-10', [
    doc('72', [{ code: 'G1803', offers: 3, openings: 4 }], { date: '2026-10-10' }),
  ]);
  const older = catalogueFromSnapshots(date, [
    doc('72', [{ code: 'D1102', offers: 4, openings: 5 }, { code: 'G1803', offers: 9, openings: 10 }]),
  ]);
  const result = mergeOccupationCatalogues([recent, older], new Map([['D1102', 'Boulanger']]));
  assert.equal(result.count, 2);
  assert.equal(result.periodStart, '2026-10-09');
  assert.equal(result.periodEnd, '2026-10-10');
  assert.equal(result.occupations.find(item => item.romeCode === 'G1803').observedOffers, 3);
  assert.equal(result.occupations.find(item => item.romeCode === 'G1803').lastObservedDate, '2026-10-10');
  assert.equal(result.occupations.find(item => item.romeCode === 'D1102').label, 'Boulanger');
});
test('empty recent observations yield an empty catalogue and no invented zero', () => {
  const result = mergeOccupationCatalogues([catalogueFromSnapshots(date, [])]);
  assert.equal(result.count, 0);
  assert.equal(result.date, null);
});

test('catalogue period includes more eligible ROME codes at 30 and 60 days', async () => {
  const today = '2026-10-10';
  const dateDocs = {
    '2026-10-10': [doc('72', [{ code: 'G1803', offers: 2, openings: 3 }], { date: '2026-10-10' })],
    '2026-09-20': [doc('72', [{ code: 'D1102', offers: 4, openings: 4 }], { date: '2026-09-20' })],
    '2026-08-15': [doc('72', [{ code: 'N1103', offers: 1, openings: 1 }], { date: '2026-08-15' })],
  };
  let readDates = [];
  const db = { collection(name) {
    if (name === 'dailyOfferSnapshots') return { doc(date) { return {
      collection(segment) {
        assert.equal(segment, 'departments');
        return { async get() { readDates.push(date); return { docs: dateDocs[date] || [] }; } };
      },
    }; } };
    if (name === 'occupationReferenceMeta') return { doc(id) {
      assert.equal(id, 'current');
      return { async get() { return { exists: false }; } };
    } };
    throw new Error('Unexpected collection: ' + name);
  } };
  const seven = await loadEditorialOccupationCatalogue(db, { days: 7, today });
  assert.equal(readDates.length, 7);
  assert.equal(seven.days, 7);
  assert.deepEqual(seven.occupations.map(row=>row.romeCode), ['G1803']);
  readDates = [];
  const thirty = await loadEditorialOccupationCatalogue(db, { days: 30, today });
  assert.equal(readDates.length, 30);
  assert.deepEqual(new Set(thirty.occupations.map(row => row.romeCode)),
    new Set(['G1803','D1102']));
  readDates = [];
  const sixty = await loadEditorialOccupationCatalogue(db, { days: 60, today });
  assert.equal(readDates.length, 60);
  assert.deepEqual(new Set(sixty.occupations.map(row => row.romeCode)),
    new Set(['G1803','D1102','N1103']));
  assert.equal(sixty.occupations.find(row=>row.romeCode==='N1103').lastObservedDate, '2026-08-15');
  readDates = [];
  const invalid = await loadEditorialOccupationCatalogue(db, { days: 999, today });
  assert.equal(readDates.length, 7);
  assert.equal(invalid.days, 7);
});
