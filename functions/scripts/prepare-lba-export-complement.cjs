'use strict';

/**
 * Controle/export staging (issue #101) : N'ECRIT PAS dans dailyOfferSnapshots,
 * jobOfferObservations, lbaCurrentOffers ou les statistiques publiques.
 * - MODE=preview: lecture seule et simulation.
 * - MODE=stage: ecrit exclusivement lbaExportComplementRuns/{runId}/...
 * Le run est une generation versionnee et ne sera exploite qu'apres validation.
 */
const fs = require('node:fs');
const readline = require('node:readline');
const { createHash } = require('node:crypto');
const admin = require('firebase-admin');
const {
  normalizeExportOffer, stableExportIdentity, patchExistingOffer,
  isoParisDate,
} = require('../lib/lba-export-reconciliation.cjs');
const { buildOccupationOfferSummary } = require('../lib/daily-offer-snapshot.cjs');

const MODE = process.env.MODE || 'preview';
const META = process.env.EXPORT_META_PATH;
const INPUT = process.env.EXPORT_NDJSON_PATH;
const BASELINE_DATE = process.env.BASELINE_DATE || '2026-10-08';
const PROJECT = process.env.GCLOUD_PROJECT || 'meteo-apprentissage';
const RUN_COLLECTION = 'lbaExportComplementRuns';

const DEPARTMENTS = [
  ...Array.from({length: 95}, (_, index) => String(index + 1).padStart(2, '0'))
    .filter((code) => code !== '20'),
  '2A', '2B', '971', '972', '973', '974', '976',
];

function assert(condition, description) {
  if (!condition) throw new Error(description);
}
function dateParis() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function stableRunId(timestamp) {
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timestamp),
    'lastUpdate horodatage invalide');
  return 'lba_export_' + timestamp.slice(0, 19).replace(/[^\d]/g, '');
}
function exportedDateParis(timestamp) {
  return isoParisDate(timestamp);
}
function canApplyStage(meta) {
  assert(['preview', 'stage'].includes(MODE), 'MODE non reconnu');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(BASELINE_DATE), 'date baseline incorrecte');
  assert(meta && Number(meta.offerRows) >= 7000, 'export trop petit');
  assert(/^[a-f0-9]{64}$/.test(String(meta.fileSha256 || '')), 'SHA de fichier absent');
  const lastUpdate = new Date(meta.exportLastUpdate);
  assert(Number.isFinite(lastUpdate.getTime()), 'lastUpdate invalide');
  const age = Date.now() - lastUpdate.getTime();
  assert(age > -15 * 60 * 1000 && age < 48 * 60 * 60 * 1000, 'Export obsolete');
  const day = exportedDateParis(meta.exportLastUpdate);
  assert(day && day >= BASELINE_DATE, 'Export anterieur a la baseline');
  assert(day === dateParis(), 'La date Paris de l export doit etre celle du jour');
  assert(new Date(BASELINE_DATE).getTime() < new Date(day).getTime(),
    'La photographie de reference doit etre anterieure a la date export');
  return {day, runId: stableRunId(meta.exportLastUpdate)};
}
function stripUndefined(value) {
  // Firestore n'accepte pas undefined. JSON serialisable, sans transformer les
  // timestamps existants car ceux-ci sont tenus a part.
  return JSON.parse(JSON.stringify(value));
}

async function loadBaseline(db) {
  const refs = await db.collection('dailyOfferSnapshots')
    .doc(BASELINE_DATE).collection('departments').get();
  assert(refs.size === 101, 'La reference Firestore ne contient pas 101 departements');

  let next = 0;
  const rows = [];
  const details = [];
  const codes = refs.docs;
  const worker = async () => {
    while (next < codes.length) {
      const doc = codes[next++];
      const meta = doc.data() || {};
      const activeRunId = meta.activeRunId;
      assert(meta.date === BASELINE_DATE && activeRunId,
        'Snapshot absent/invalide ' + doc.id);
      assert(meta.strictSummary && typeof meta.strictSummary.totalOffers === 'number',
        'summary strict absent ' + doc.id);
      const snapshots = await doc.ref.collection('offers')
        .where('runId', '==', activeRunId).get();
      const offers = snapshots.docs.map((s) => s.data() || {});
      assert(offers.length === Number(meta.storedOffersCount),
        'storedOffersCount incoherent ' + doc.id);
      const strict = offers.filter((x) => x.locationQuality === 'in_department');
      assert(strict.length === Number(meta.strictSummary.totalOffers),
        'strictSummary incoherent ' + doc.id);
      for (const o of offers) {
        if (typeof o.offerDocId === 'string' && /^[a-f0-9]{64}$/.test(o.offerDocId)) {
          rows.push(o);
        }
      }
      details.push({code: doc.id, stored: offers.length, strict: strict.length});
    }
  };
  await Promise.all(Array.from({length: 8}, () => worker()));
  assert(details.length === 101, 'La reference n est pas integralement chargee');
  return {rows, details};
}

function choosePrevious(candidates, dept) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return candidates.find((x) =>
    x.departmentCode === dept && x.locationQuality === 'in_department') ||
    candidates.find((x) => x.departmentCode === dept) ||
    candidates.find((x) => x.locationQuality === 'in_department') ||
    candidates[0];
}

function makeStageOffer(result, previous, runId, day) {
  const projected = result.projected;
  const identity = result.identity;
  let provenance = 'export_new';
  let row = {...projected};
  let conflicts = [];
  let changed = false;
  let departmentMismatch = false;
  let recoveredCrossDepartment = false;
  let changeInOpenings = false;

  if (previous) {
    provenance = 'baseline_enriched';
    const differentSearchDepartment =
      Boolean(previous.departmentCode && previous.departmentCode !== projected.departmentCode);
    // Une offre renvoyee par la recherche d'un autre departement n'est
    // pas une contradiction si son CP normalise confirmait deja le bon.
    recoveredCrossDepartment = differentSearchDepartment &&
      previous.locationQuality === 'out_of_department' &&
      previous.effectiveDepartmentCode === projected.departmentCode;
    departmentMismatch = differentSearchDepartment && !recoveredCrossDepartment;
    if (!departmentMismatch) {
      const patch = patchExistingOffer(previous, result);
      conflicts = patch.conflicts;
      changeInOpenings = patch.openingCountChanged;
      changed = patch.changed;
      row = {...projected, ...previous, ...patch.patch};
    }
  }

  // La generation est nouvelle, jamais l'instantane du 08/10.
  row.offerDocId = projected.offerDocId;
  row.runId = runId;
  row.date = day;
  row.departmentCode = projected.departmentCode;
  row.effectiveDepartmentCode = projected.departmentCode;
  row.isInRequestedDepartment = true;
  row.locationQuality = 'in_department';
  row.partnerLabel = identity.source;
  row.partnerJobId = row.partnerJobId || identity.partnerId || null;
  row.source = 'api-apprentissage-job-v1-export+baseline';
  row.schemaVersion = 'lbaExportComplement.offer.v1';
  row.firstVerifiedBaselineDate = previous ? BASELINE_DATE : null;
  row.firstObservedDate = previous ? (previous.firstObservedDate || null) : day;
  row.discoveredViaExportAt = day;
  row.exportPublishedDate = result.publicationCreationDate;
  row.locationNormalization = previous && !changed
    ? { origin: 'baseline_existing', quality: 'existing_observation_unverified',
        banVerified: false, cityInseeCode: null }
    : {
        origin: result.location.origin,
        quality: result.location.quality,
        banVerified: false, cityInseeCode: null,
      };
  row.reconciliation = {
    originalPresent: Boolean(previous),
    status: departmentMismatch ? 'department_conflict' :
      conflicts.length || changeInOpenings ? 'fields_conflict_review' :
        recoveredCrossDepartment ? 'relocated_from_cross_department_search' :
          changed ? 'enriched_without_overwrite' :
            previous ? 'existing_unchanged' : 'new_from_export',
    hasConflicts: Boolean(departmentMismatch || conflicts.length || changeInOpenings),
    conflictFields: conflicts,
    openingCountDivergent: changeInOpenings,
    departmentDivergent: Boolean(departmentMismatch),
    recoveredCrossDepartment,
    provenance,
  };
  row.qualityStatus = row.reconciliation.hasConflicts ? 'needs_review' : 'staged_unverified';
  // Aucun nom/URL/adresse dans les journaux. La copie Firestore s'effectue
  // dans une generation privee accessible uniquement aux administrateurs.
  return {row: stripUndefined(row), changed, conflicts,
    departmentMismatch, recoveredCrossDepartment, changeInOpenings};
}

async function buildPlan(meta, day, runId, base) {
  const previousById = new Map();
  for (const row of base.rows) {
    const values = previousById.get(row.offerDocId) || [];
    values.push(row);
    previousById.set(row.offerDocId, values);
  }
  const seen = new Set();
  const matched = new Set();
  const byDepartment = new Map(DEPARTMENTS.map((code) => [code, []]));
  const staged = [];
  const unlocated = [];
  const conflictTypes = new Map();
  const sources = new Map();
  const totals = {
    fromNdjson: 0, staged: 0, stagedNew: 0, stagedMatched: 0,
    stagedEnriched: 0, stagedUnchanged: 0, duplicateInExport: 0,
    invalidIdentities: 0, unlocated: 0, departmentConflicts: 0,
    fieldConflicts: 0, divergentOpeningCounts: 0, missingRome: 0,
    withoutCity: 0, stagingAfterExportCreatedDate: 0,
  };

  const lines = readline.createInterface({
    input: fs.createReadStream(INPUT, {encoding: 'utf8'}),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    totals.fromNdjson++;
    const job = JSON.parse(line);
    const id = stableExportIdentity(job);
    if (!id) {
      totals.invalidIdentities++;
      continue;
    }
    if (seen.has(id.offerDocId)) {
      totals.duplicateInExport++;
      continue;
    }
    seen.add(id.offerDocId);
    const result = normalizeExportOffer(job, {snapshotDate: day, runId});
    if (!result.eligible) {
      totals.unlocated++;
      unlocated.push({
        offerDocId: id.offerDocId,
        partnerLabel: id.source,
        partnerJobId: id.partnerId,
        romeCodes: Array.isArray(job.offer?.rome_codes)
          ? job.offer.rome_codes.filter((x) => typeof x === 'string' && /^[A-Z]\d{4}$/.test(x))
          : [],
        firstObservedDate: day,
        source: 'api-apprentissage-job-v1-export',
        runId, date: day, locationQuality: 'unknown_postal_code',
        qualityStatus: 'quarantined_unlocated',
        reason: result.reason || 'location_unknown',
      });
      continue;
    }
    const previous = choosePrevious(
      previousById.get(result.projected.offerDocId), result.projected.departmentCode
    );
    if (previous) {
      totals.stagedMatched++;
      matched.add(result.projected.offerDocId);
    } else {
      totals.stagedNew++;
    }
    const prepared = makeStageOffer(result, previous, runId, day);
    const o = prepared.row;
    if (prepared.changed) totals.stagedEnriched++;
    else if (previous) totals.stagedUnchanged++;
    if (prepared.departmentMismatch) totals.departmentConflicts++;
    if (prepared.recoveredCrossDepartment) totals.recoveredCrossDepartment++;
    if (prepared.changeInOpenings) totals.divergentOpeningCounts++;
    for (const field of prepared.conflicts) {
      totals.fieldConflicts++;
      conflictTypes.set(field, (conflictTypes.get(field) || 0) + 1);
    }
    if (!o.romeCodes?.length) totals.missingRome++;
    if (!o.city) totals.withoutCity++;
    if (result.publicationCreationDate && result.publicationCreationDate > day) {
      totals.stagingAfterExportCreatedDate++;
    }
    assert(byDepartment.has(o.departmentCode),
      'Departement hors referentiel ' + o.departmentCode);
    byDepartment.get(o.departmentCode).push(o);
    staged.push(o);
    sources.set(o.partnerLabel, (sources.get(o.partnerLabel) || 0) + 1);
  }
  totals.staged = staged.length;
  assert(totals.fromNdjson === Number(meta.offerRows),
    'Incoherence du nombre de lignes de l export');
  assert(totals.staged + unlocated.length + totals.invalidIdentities +
      totals.duplicateInExport === totals.fromNdjson,
    'Incoherence entre classement et nombre de lignes');
  assert(staged.length >= 9000, 'Stock geolocalise insuffisant');
  assert(totals.missingRome === 0, 'L export contient des offres sans code ROME');
  assert(DEPARTMENTS.length === 101 && byDepartment.size === 101,
    'Couverture des 101 departements invalide');
  assert(totals.stagingAfterExportCreatedDate === 0,
    'Une offre de l export possede une date de creation posterieure a la date cible');

  const details = [];
  for (const code of DEPARTMENTS) {
    const offers = byDepartment.get(code);
    const aggregate = buildOccupationOfferSummary(offers);
    details.push({
      code, offers: offers.length, openings: aggregate.totalOpenings,
      romes: aggregate.byRome.length,
      fullRomeCount: new Set(offers.flatMap((o) => o.romeCodes || [])).size,
      withCity: offers.filter((o) => o.city).length,
      needsReview: offers.filter((o) => o.qualityStatus === 'needs_review').length,
      summary: aggregate,
    });
  }
  const baselineIDs = new Set(base.rows.map((o) => o.offerDocId));
  const baselineOnly = [...baselineIDs].filter((id) => !seen.has(id)).length;
  const report = {
    exportLastUpdate: meta.exportLastUpdate,
    baselineDate: BASELINE_DATE, observationDate: day,
    mode: MODE, runId,
    exportTotal: totals.fromNdjson,
    uniqueExportIds: seen.size,
    baselineRows: base.rows.length,
    baselineUniqueIds: baselineIDs.size,
    baselineOnlyNotInExport: baselineOnly,
    totalStagedOffers: staged.length,
    totalQuarantinedOffers: unlocated.length,
    departmentsValidated: details.length,
    totals,
    conflictTypes: Object.fromEntries([...conflictTypes].sort((a,b) => b[1]-a[1])),
    sourceTop: [...sources].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([source,count])=>({source,count})),
    departmentTotalsSum: details.reduce((n,d)=>n+d.offers,0),
    publicationStatus: 'not_published',
    historicalSnapshotsModified: false,
  };
  assert(report.departmentTotalsSum === report.totalStagedOffers, 'Sommes departementales invalides');
  return {staged, unlocated, details, report};
}

async function writeDocuments(db, collection, docs) {
  let batch = db.batch();
  let writes = 0;
  let total = 0;
  for (const row of docs) {
    // Chaque document du staging est un instantane propre a ce run.
    const {offerDocId, ...payload} = row;
    batch.set(collection.doc(offerDocId), {offerDocId, ...payload});
    writes++;
    total++;
    if (writes === 200) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  return total;
}

async function stagePlan(db, meta, plan) {
  const {report, details, staged, unlocated} = plan;
  const runRef = db.collection(RUN_COLLECTION).doc(report.runId);
  const old = await runRef.get();
  if (old.exists && old.data()?.status === 'staged_complete') {
    const previous = old.data();
    assert(previous.fileSha256 === meta.fileSha256,
      'Import existant avec une signature differente');
    console.log(JSON.stringify({
      status:'already_staged',runId:report.runId,
      counts: previous.counts,publicationStatus:'not_published'
    }));
    return;
  }
  await runRef.set({
    runId: report.runId,
    status: 'preparing',
    baselineDate: BASELINE_DATE,
    exportLastUpdate: meta.exportLastUpdate,
    exportFileSha256: meta.fileSha256,
    fileSha256: meta.fileSha256,
    sourceRoute: '/api/job/v1/export',
    observedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'lbaExportComplement.run.v1',
    published: false,
  }, {merge: true});

  await writeDocuments(db, runRef.collection('offers'), staged);
  await writeDocuments(db, runRef.collection('unlocatedOffers'), unlocated);
  const departmentRows = details.map((detail) => ({
    offerDocId: detail.code,
    code: detail.code,
    date: report.observationDate,
    totalOffers: detail.offers,
    totalOpenings: detail.openings,
    withCity: detail.withCity,
    qualityStatus: detail.needsReview ? 'partially_verified' : 'staged_unverified',
    strictSummary: {
      ...detail.summary,
      isPossiblySaturated: null,
      qualityMethod: 'national_export_incomplete_validation',
      byRomeComplete: detail.fullRomeCount <= 120,
      byRomeStoredCount: detail.summary.byRome.length,
    },
    schemaVersion: 'lbaExportComplement.department.v1',
  }));
  await writeDocuments(db, runRef.collection('departments'), departmentRows);
  const [offersCount,unlocatedCount,departmentsCount] = await Promise.all([
    runRef.collection('offers').count().get(),
    runRef.collection('unlocatedOffers').count().get(),
    runRef.collection('departments').count().get(),
  ]);
  const writtenOffers = offersCount.data().count;
  const writtenUnlocated = unlocatedCount.data().count;
  const writtenDepartments = departmentsCount.data().count;
  assert(writtenOffers === staged.length, 'Offres staging manquantes, ne pas publier');
  assert(writtenUnlocated === unlocated.length, 'Quarantaine staging incomplete');
  assert(writtenDepartments === 101, 'Departements staging manquants');
  await runRef.set({
    status: 'staged_complete',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    counts: report.totals,
    report: {
      baselineRows: report.baselineRows,
      baselineUniqueIds: report.baselineUniqueIds,
      baselineOnlyNotInExport: report.baselineOnlyNotInExport,
      exportTotal: report.exportTotal,
      sourceTop: report.sourceTop,
      conflictTypes: report.conflictTypes,
      totalStagedOffers: writtenOffers,
      totalQuarantinedOffers: writtenUnlocated,
      departmentsValidated: writtenDepartments,
      publicationStatus: 'not_published',
    },
    published: false,
    activeSnapshotChanged: false,
  }, {merge: true});
  console.log(JSON.stringify({
    status: 'staged_complete', runId: report.runId,
    offers: writtenOffers, quarantined: writtenUnlocated,
    departments: writtenDepartments,
    enriched: report.totals.stagedEnriched,
    added: report.totals.stagedNew,
    matched: report.totals.stagedMatched,
    publicationStatus: 'not_published',
  }));
}

async function main() {
  assert(INPUT && META && fs.existsSync(INPUT) && fs.existsSync(META), 'Fichiers export absents');
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  const {day,runId} = canApplyStage(meta);
  if (admin.apps.length === 0) admin.initializeApp({projectId:PROJECT});
  const db = admin.firestore();
  const baseline = await loadBaseline(db);
  const plan = await buildPlan(meta, day, runId, baseline);
  console.log('=== RECONCILIATION EXPORT : RAPPORT AGREGE ===');
  console.log(JSON.stringify(plan.report,null,2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '## Complement export LBA (' + MODE + ')',
      '',
      '| Indicateur | Volume |', '|---|---:|',
      '| Export valide | ' + plan.report.exportTotal + ' |',
      '| Stages localisables | ' + plan.report.totalStagedOffers + ' |',
      '| Offres deja vues | ' + plan.report.totals.stagedMatched + ' |',
      '| Nouvelles pour notre stock | ' + plan.report.totals.stagedNew + ' |',
      '| Existantes enrichies | ' + plan.report.totals.stagedEnriched + ' |',
      '| A verifier (geo) | ' + plan.report.totalQuarantinedOffers + ' |',
      '| Vues uniquement dans releve precedent | ' + plan.report.baselineOnlyNotInExport + ' |',
      '',
      '**Aucun relevé historique ni statistique publique n’a été modifié.**',
      '',
    ].join('\n'));
  }
  if (MODE === 'stage') await stagePlan(db, meta, plan);
  else console.log(JSON.stringify({status:'preview_complete',runId,publicationStatus:'not_published'}));
}

main().catch((error) => {
  // Ne jamais imprimer d'objets d'offres complets ou de secrets.
  console.error('Complement interrompu :', String(error?.message || error).slice(0, 300));
  process.exitCode = 1;
});
