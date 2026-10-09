const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEPARTMENT_CODES,
  TOTAL_DEPARTMENTS,
  recentDates,
  summarizeDay,
  safeChange,
  loadNationalStats,
  handleNationalStats,
  cachedNationalStats,
  indicativeChange,
} = require('../admin-national-stats.cjs');

const TODAY = '2026-10-08';
const YESTERDAY = '2026-10-07';

function doc(id, date, offers, options = {}) {
  const strictSummary = {
    totalOffers: offers,
    totalOpenings: offers * 2,
    bySector: [{ code: 'G', label: 'Hôtellerie et restauration', offers, openings: offers * 2 }],
  };
  if (!options.unassessed) {
    strictSummary.isPossiblySaturated = options.saturated === true;
    strictSummary.newTodayOffers = options.newOffers ?? 1;
  }
  return {
    id,
    data: () => ({
      date,
      departmentCode: id,
      activeRunId: 'run-ok',
      storedOffersCount: offers + 1,
      strictSummary,
      ...(options.qualityStatus ? { qualityStatus: options.qualityStatus } : {}),
      ...(options.methodologyBreak ? { methodologyBreak: true } : {}),
    }),
  };
}

function snapshot(docs = []) {
  return { docs, empty: docs.length === 0 };
}

function mockDatabase(byDate = {}, { population = false, formations = [] } = {}) {
  const references = DEPARTMENT_CODES.map((code) => ({
    id: code,
    data: () => ({ departmentCode: code, name: 'Département ' + code, regionName: 'Région test' }),
  }));
  const populationDocuments = population
    ? DEPARTMENT_CODES.map((code) => ({
        id: code,
        data: () => ({ population15To29: 1000, referenceYear: 2026, runId: 'population-v1' }),
      })) : [];
  const calls = { daily: 0 };

  const db = {
    collection(name) {
      if (name === 'departments') return { get: async () => snapshot(references) };
      if (name === 'departmentPopulationReference') {
        return { get: async () => snapshot(populationDocuments) };
      }
      if (name === 'departmentPopulationReferenceMeta') {
        return { doc: () => ({ get: async () => ({
          exists: population,
          data: () => ({ runId: 'population-v1', referenceYear: 2026, departmentsCount: 101 }),
        }) }) };
      }
      if (name === 'formationDepartmentStats') return { get: async () => snapshot(formations) };
      if (name === 'dailyOfferSnapshots') return {
        doc(date) {
          return { collection(subcollection) {
            assert.equal(subcollection, 'departments');
            return { get: async () => {
              calls.daily += 1;
              return snapshot(byDate[date] || []);
            } };
          } };
        },
      };
      if (name === 'users') return {
        doc() {
          return { get: async () => ({ exists: true, data: () => ({ role: 'admin' }) }) };
        },
      };
      throw new Error('Unexpected collection: ' + name);
    },
  };
  return { db, calls };
}

test('101 departements administratifs et fenetre calendaire', () => {
  assert.equal(TOTAL_DEPARTMENTS, 101);
  assert.equal(new Set(DEPARTMENT_CODES).size, 101);
  assert.ok(DEPARTMENT_CODES.includes('2A'));
  assert.ok(DEPARTMENT_CODES.includes('976'));
  assert.deepEqual(recentDates(3, TODAY), [TODAY, YESTERDAY, '2026-10-06']);
});

test('calcul strict et secteurs avec population disponible', () => {
  const refs = new Map([['72', { name: 'Sarthe', regionName: 'Pays de la Loire' }]]);
  const populations = new Map([['72', { population15To29: 20000 }]]);
  const result = summarizeDay(TODAY, [doc('72', TODAY, 14), doc('44', TODAY, 5)], refs, populations);
  assert.equal(result.offers, 19);
  assert.equal(result.openings, 38);
  assert.equal(result.newOffers, 2);
  assert.equal(result.newOffersCoverage, 2);
  assert.equal(result.coveredDepartments, 2);
  assert.equal(result.comparable, false);
  assert.equal(result.sectors[0].offers, 19);
  assert.equal(result.departments[0].departmentName, 'Sarthe');
  assert.equal(result.departments[0].offersPer10000Young, 7);
  assert.equal(result.offersPer10000Young, null);
});

test('une valeur nouvelle offre absente reste null et la qualite sans controle bloque la variation', () => {
  const items = DEPARTMENT_CODES.map((code) => doc(code, TODAY, 3, { unassessed: true }));
  const result = summarizeDay(TODAY, items);
  assert.equal(result.coveredDepartments, 101);
  assert.equal(result.unassessedCapDepartments, 101);
  assert.equal(result.saturatedDepartments, 0);
  assert.equal(result.newOffers, null);
  assert.equal(result.comparable, false);
  const populations = new Map(DEPARTMENT_CODES.map((code) => [
    code, { population15To29: 1000 },
  ]));
  const observedDensity = summarizeDay(TODAY, items, new Map(), populations);
  assert.equal(observedDensity.offersPer10000Young, 30);
  assert.equal(observedDensity.comparable, false);
  assert.equal(safeChange(result, { ...result, date: YESTERDAY }), null);
});

test('variation indicative calculee uniquement a couverture 101 et sans plafonnement signale', () => {
  const latest = summarizeDay(TODAY, DEPARTMENT_CODES.map((code) => doc(code, TODAY, 8, { unassessed: true })));
  const previous = summarizeDay(YESTERDAY, DEPARTMENT_CODES.map((code) => doc(code, YESTERDAY, 4, { unassessed: true })));
  assert.equal(safeChange(latest, previous), null);
  assert.deepEqual(indicativeChange(latest, previous), {
    absolute: 404, ratio: 1, previousDate: YESTERDAY,
    caveat: 'Plafonnement non certifie pour toutes les sources',
  });
  assert.equal(indicativeChange({ ...latest, coveredDepartments: 100 }, previous), null);
  assert.equal(indicativeChange({ ...latest, saturatedDepartments: 1 }, previous), null);
});

test('quarantaines, codes hors territoire, dates et compte incoherent exclus', () => {
  const quarantined = doc('01', TODAY, 5, { qualityStatus: 'quarantined' });
  const unknown = doc('99', TODAY, 5);
  const wrongDate = doc('02', YESTERDAY, 5);
  const mismatched = {
    id: '03',
    data: () => ({ date: TODAY, departmentCode: '04', activeRunId: 'id',
      strictSummary: { totalOffers: 5, totalOpenings: 5 } }),
  };
  const overcount = {
    id: '05',
    data: () => ({ date: TODAY, departmentCode: '05', activeRunId: 'id',
      storedOffersCount: 3, strictSummary: { totalOffers: 8, totalOpenings: 9 } }),
  };
  assert.equal(summarizeDay(TODAY, [quarantined, unknown, wrongDate, mismatched, overcount]).coveredDepartments, 0);
});

test('signaux de plafonnement et historique numerique', () => {
  const items = DEPARTMENT_CODES.map((code) => doc(code, TODAY, 5, { saturated: code === '72' }));
  const result = summarizeDay(TODAY, items);
  assert.equal(result.coveredDepartments, 101);
  assert.equal(result.saturatedDepartments, 1);
  assert.equal(result.comparable, false);
  const safe = { date: TODAY, comparable: true, offers: 25 };
  const previous = { date: YESTERDAY, comparable: true, offers: 20 };
  assert.deepEqual(safeChange(safe, previous),
    { absolute: 5, ratio: 0.25, previousDate: YESTERDAY });
  assert.equal(safeChange(safe, { ...previous, offers: 0 }), null);
});

test('integration sur donnees simulees : agrégation, ratio, INSEE et formations', async () => {
  const { db } = mockDatabase({
    [TODAY]: DEPARTMENT_CODES.map((code) => doc(code, TODAY, 8)),
    [YESTERDAY]: DEPARTMENT_CODES.map((code) => doc(code, YESTERDAY, 4)),
  }, {
    population: true,
    formations: [{
      id: '72',
      data: () => ({
        asOfDate: TODAY, formationsCount: 18, sessionsCount: 30, upcomingSessionsCount: 10,
      }),
    }],
  });
  const result = await loadNationalStats(db, { days: 7, today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.latest.offers, 808);
  assert.equal(result.latest.openings, 1616);
  assert.equal(result.latest.newOffers, 101);
  assert.equal(result.latest.offersPer10000Young, 80);
  assert.equal(result.populationReferenceYear, 2026);
  assert.equal(result.populationReferenceCoverage, 101);
  assert.equal(result.latest.comparable, true);
  assert.deepEqual(result.change, {
    absolute: 404, ratio: 1, previousDate: YESTERDAY,
  });
  assert.equal(result.regions[0].offers, 808);
  assert.deepEqual(result.formations.asOfDates, [TODAY]);
  assert.equal(result.formations.formationsByDepartmentTotal, 18);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].date, YESTERDAY);
});

test('cache serveur evite les lectures repetees pour une meme fenetre', async () => {
  const { db, calls } = mockDatabase();
  const [first, second] = await Promise.all([
    cachedNationalStats(db, { days: 7 }),
    cachedNationalStats(db, { days: 7 }),
  ]);
  assert.strictEqual(first, second);
  assert.equal(calls.daily, 7);
});

function responseRecorder() {
  return {
    code: null, body: null,
    set() {},
    status(code) { this.code = code; return this; },
    json(data) { this.body = data; },
  };
}

test('endpoint refuse GET et tout acces sans bearer', async () => {
  const first = responseRecorder();
  await handleNationalStats({ request: { method: 'GET' }, response: first });
  assert.equal(first.code, 405);
  const second = responseRecorder();
  await handleNationalStats({
    request: { method: 'POST', get: () => '' }, response: second,
    auth: {}, db: {},
  });
  assert.equal(second.code, 401);
});

test('un Firebase token non admin ne peut pas lire les statistiques', async () => {
  const response = responseRecorder();
  const db = { collection(name) {
    assert.equal(name, 'users');
    return { doc: () => ({ get: async () => ({
      exists: true, data: () => ({ role: 'viewer' }),
    }) }) };
  } };
  await handleNationalStats({
    request: {
      method: 'POST', get: () => 'Bearer user-token',
    },
    response,
    auth: { verifyIdToken: async () => ({
      uid: 'test-uid', email_verified: true,
      firebase: { sign_in_provider: 'password' },
    }) },
    db,
  });
  assert.equal(response.code, 403);
});

test('export national integre : aucune fausse hausse n est calculee', async () => {
  const historical = DEPARTMENT_CODES.map((code) =>
    doc(code, YESTERDAY, 8, {unassessed:true}));
  const enriched = DEPARTMENT_CODES.map((code) =>
    doc(code, TODAY, 10, {unassessed:true,methodologyBreak:true}));
  const latest = summarizeDay(TODAY,enriched);
  const previous = summarizeDay(YESTERDAY,historical);
  assert.equal(latest.methodologyBreak,true);
  assert.equal(latest.comparable,false);
  assert.equal(safeChange(latest,previous),null);
  assert.equal(indicativeChange(latest,previous),null);
  const {db}=mockDatabase({[TODAY]:enriched,[YESTERDAY]:historical});
  const result=await loadNationalStats(db,{days:7,today:TODAY});
  assert.equal(result.latest.methodologyBreak,true);
  assert.equal(result.change,null);
  assert.equal(result.indicativeChange,null);
  assert.equal(result.history.at(-1).methodologyBreak,true);
  assert.match(result.methodology,/Rupture methodologique|Rupture méthodologique/);
});
