const test = require('node:test');
const assert = require('node:assert/strict');
const { TOTAL_DEPARTMENTS, recentDates, summarizeDay, safeChange, handleNationalStats } = require('../admin-national-stats.cjs');

function doc(id, date, totalOffers, saturated = false) {
  return {
    id,
    data: () => ({
      date, departmentCode: id, activeRunId: 'run-ok',
      strictSummary: {
        totalOffers, totalOpenings: totalOffers * 2,
        newTodayOffers: 1,
        isPossiblySaturated: saturated,
        bySector: [{ code: 'G', label: 'Tourisme', offers: totalOffers, openings: totalOffers * 2 }],
      },
    }),
  };
}

test('historique correct et 101 departements attendus', () => {
  assert.equal(TOTAL_DEPARTMENTS, 101);
  assert.deepEqual(recentDates(3, '2026-10-08'), ['2026-10-08', '2026-10-07', '2026-10-06']);
});

test('calcul global depuis les strictSummary et secteurs', () => {
  const refs = new Map([['72', { name: 'Sarthe', regionName: 'Pays de la Loire' }]]);
  const result = summarizeDay('2026-10-08', [doc('72', '2026-10-08', 14), doc('44', '2026-10-08', 5)], refs);
  assert.equal(result.offers, 19);
  assert.equal(result.openings, 38);
  assert.equal(result.newOffers, 2);
  assert.equal(result.coveredDepartments, 2);
  assert.equal(result.comparable, false);
  assert.equal(result.sectors[0].offers, 19);
  assert.equal(result.departments[0].departmentName, 'Sarthe');
});

test('snapshots dates erronnees et imports non finalises exclus', () => {
  const bad = { id: '01', data: () => ({ date: '2026-10-07', activeRunId: 'ok', strictSummary: { totalOffers: 10 } }) };
  const unfinished = { id: '02', data: () => ({ date: '2026-10-08', strictSummary: { totalOffers: 10 } }) };
  assert.equal(summarizeDay('2026-10-08', [bad, unfinished]).coveredDepartments, 0);
});

test('ne compare jamais deux dates incompletes ou plafonnees', () => {
  const partial = { date: '2026-10-08', comparable: false, offers: 20 };
  const complete = { date: '2026-10-07', comparable: true, offers: 10 };
  assert.equal(safeChange(partial, complete), null);
  assert.equal(safeChange(complete, { ...partial, comparable: false }), null);
  assert.equal(safeChange(complete, { ...complete, offers: 0 }), null);
  assert.deepEqual(safeChange({ ...complete, offers: 15 }, complete), { absolute: 5, ratio: 0.5, previousDate: '2026-10-07' });
});

test('endpoint refuse GET avant toute authentification', async () => {
  let status;
  await handleNationalStats({
    request: { method: 'GET' },
    response: { set() {}, status(code) { status = code; return this; }, json() {} },
  });
  assert.equal(status, 405);
});
