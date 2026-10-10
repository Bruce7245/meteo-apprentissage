import test from 'node:test';
import assert from 'node:assert/strict';
import {DEPARTMENT_CODES} from '../src/utils/departmentUtils.js';
import {
  buildAdminNationalSimulationMap,
  OVERSEAS_CODES,
} from '../src/utils/adminNationalSimulationMap.mjs';

const row = (departmentCode, changes = {}) => ({
  departmentCode,
  departmentName: 'Département test ' + departmentCode,
  daysObserved: 4,
  daysExpected: 31,
  averageOffers: 22,
  offersPer10000Young: 4.4,
  activeEmployerEstablishmentsCount: 200,
  offersPer100Employers: 11,
  ...changes,
});

const score = (departmentCode, value, extra = {}) => ({
  departmentCode,
  score: value,
  quality: 'provisional',
  isProvisional: true,
  ...extra,
});

function makePayload() {
  return {
    ok: true,
    scope: 'all_offers_department',
    month: '2026-10',
    populationReferenceYear: 2024,
    departments: [
      row('33'), row('72'), row('971'), row('976'),
    ],
    scoreSimulation: {
      mode: 'provisional_admin_only',
      calculationVersion: 'adminTerritorialWeightedScore.experiment.v2',
      previewBasis: {
        sharedDays: ['2026-10-02','2026-10-03','2026-10-04'],
        referenceDepartments: 82,
        method: 'job-v1-search',
      },
      scores: [
        score('33', 65),
        score('72', 40),
        score('971', null, {quality: 'unavailable', reasons: [
          'AT_LEAST_TWO_DISTINCT_DIMENSIONS_REQUIRED',
        ], components: {density: 48.5}}),
        score('976', null, {quality: 'unavailable', reasons: [
          'INCOMPLETE_OR_NONCOMPARABLE_MONTH',
        ]}),
      ],
    },
  };
}

test('always renders exactly 101 departments including five DROM', () => {
  const map = buildAdminNationalSimulationMap(makePayload());
  assert.equal(map.departments.length, 101);
  assert.equal(new Set(map.departments.map(department => department.code)).size, 101);
  assert.deepEqual(OVERSEAS_CODES, ['971','972','973','974','976']);
  for (const code of DEPARTMENT_CODES) assert.ok(map.byCode.has(code));
});

test('each color agrees with existing Admin simulation bands', () => {
  const map = buildAdminNationalSimulationMap(makePayload());
  assert.equal(map.byCode.get('33').color.key, 'green');
  assert.equal(map.byCode.get('72').color.key, 'orange');
  assert.equal(map.byCode.get('971').color.key, 'yellow');
  assert.equal(map.byCode.get('971').basis, 'density_only');
  assert.equal(map.byCode.get('971').score, null);
  assert.equal(map.byCode.get('976').color.key, 'unknown');
  assert.equal(map.byCode.get('75').color.key, 'unknown');
  assert.equal(map.summary.green, 1);
  assert.equal(map.summary.orange, 1);
  assert.equal(map.summary.yellow, 1);
  assert.equal(map.summary.unknown, 98);
  assert.equal(map.summary.colored, 3);
  assert.equal(map.summary.densityOnly, 1);
  assert.equal(map.summary.provisional, 2);
});

test('unknown data never defaults to green or a fabricated zero', () => {
  const before = buildAdminNationalSimulationMap(null);
  assert.equal(before.available, false);
  assert.equal(before.summary.total, 101);
  assert.equal(before.summary.unknown, 101);
  assert.equal(before.byCode.get('33').score, null);
  assert.equal(before.byCode.get('33').averageOffers, null);

  const empty = buildAdminNationalSimulationMap({
    ok:true,scope:'all_offers_department',
    departments:[],scoreSimulation:{mode:'simulation_only',scores:[]},
  });
  assert.equal(empty.available, true);
  assert.equal(empty.summary.unknown, 101);
  assert.equal(empty.summary.colored, 0);
});

test('rejects occupation-scoped data from a national all-occupation map', () => {
  const payload = {...makePayload(),scope:'rome_department',romeCode:'K1311'};
  const map = buildAdminNationalSimulationMap(payload);
  assert.equal(map.available, false);
  assert.equal(map.summary.colored, 0);
});

test('a score of zero is a real calculated red, while null remains unknown', () => {
  const payload = makePayload();
  payload.scoreSimulation.scores = [
    score('33', 0),
    score('72', null, {
      quality:'unavailable',
      reasons:['INSUFFICIENT_NATIONAL_REFERENCE'],
    }),
  ];
  const map = buildAdminNationalSimulationMap(payload);
  assert.equal(map.byCode.get('33').color.key, 'red');
  assert.equal(map.byCode.get('33').score, 0);
  assert.equal(map.byCode.get('72').score, null);
  assert.equal(map.byCode.get('72').color.key, 'unknown');
});

test('does not convert misleading numeric strings or broken values into index scores', () => {
  const payload = makePayload();
  payload.scoreSimulation.scores = [score('33', NaN),score('72','75')];
  const map = buildAdminNationalSimulationMap(payload);
  assert.equal(map.summary.colored, 0);
  assert.equal(map.byCode.get('33').score, null);
  assert.equal(map.byCode.get('72').score, null);
});

test('explicit provisional window provenance is retained without inventing monthly changes', () => {
  const map = buildAdminNationalSimulationMap(makePayload());
  assert.equal(map.isProvisional,true);
  assert.deepEqual(map.previewBasis.sharedDays,[
    '2026-10-02','2026-10-03','2026-10-04',
  ]);
  assert.equal(map.byCode.get('33').changeYear,null);
  assert.equal(map.byCode.get('33').daysObserved,4);
  assert.equal(map.byCode.get('33').daysExpected,31);
});
