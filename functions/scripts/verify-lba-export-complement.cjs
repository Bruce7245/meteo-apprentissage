'use strict';

// Controle post-creation de la generation privee #101.
// Une ecriture autorisee : correction d'un compteur agregat de metadata,
// jamais une offre ni un instantane historique.
const admin = require('firebase-admin');
const PROJECT = 'meteo-apprentissage';
const RUN_ID = 'lba_export_20261009010140';
const BASELINE_DATE = '2026-10-08';

function assert(ok, message) { if (!ok) throw new Error(message); }

async function main() {
  if (admin.apps.length === 0) admin.initializeApp({projectId: PROJECT});
  const db = admin.firestore();
  const runRef = db.collection('lbaExportComplementRuns').doc(RUN_ID);
  const root = await runRef.get();
  assert(root.exists && root.data().status === 'staged_complete',
    'Generation non terminee / absente : publication interdite');
  assert(root.data().published === false && root.data().activeSnapshotChanged === false,
    'Generation deja publiee ou etat inattendu');

  const [offers, quarantine, departments, reclassified, baseline] = await Promise.all([
    runRef.collection('offers').count().get(),
    runRef.collection('unlocatedOffers').count().get(),
    runRef.collection('departments').get(),
    runRef.collection('offers')
      .where('reconciliation.recoveredCrossDepartment', '==', true)
      .count().get(),
    db.collection('dailyOfferSnapshots').doc(BASELINE_DATE)
      .collection('departments').get(),
  ]);
  const offerCount = offers.data().count;
  const quarantinedCount = quarantine.data().count;
  const recoveredCount = reclassified.data().count;
  const departmentOffers = departments.docs.reduce((n,s)=>n+Number(s.data()?.totalOffers||0),0);
  const baselineStored = baseline.docs.reduce((n,s)=>n+Number(s.data()?.storedOffersCount||0),0);
  const baselineStrict = baseline.docs.reduce((n,s)=>n+Number(s.data()?.strictSummary?.totalOffers||0),0);
  assert(offerCount===10086 && quarantinedCount===104 && departments.size===101,
    'Nombre de documents staging incoherent');
  assert(departmentOffers === offerCount, 'Total par departement divergent');
  assert(baseline.size===101 && baselineStored===8751 && baselineStrict===8217,
    'La photographie historique de reference a ete modifiee ou est incoherente');
  assert(recoveredCount>=0 && recoveredCount<=8380,
    'Reclassements de departement hors borne');
  const oldCount = root.data()?.counts?.recoveredCrossDepartment;
  if (!Number.isInteger(oldCount) || oldCount !== recoveredCount) {
    await runRef.update({'counts.recoveredCrossDepartment':recoveredCount});
  }
  const report={
    status:'verified_staged_not_published',
    runId:RUN_ID, offers:offerCount, quarantined:quarantinedCount,
    departments:departments.size, totalDepartmentOffers:departmentOffers,
    relocatedPreviouslyMisfiled:recoveredCount,
    baseline:{date:BASELINE_DATE, stored:baselineStored, strict:baselineStrict},
    changedOnlyStagingMetadata: !Number.isInteger(oldCount)||oldCount!==recoveredCount,
    historicalSnapshotChanged:false, published:false
  };
  console.log(JSON.stringify(report,null,2));
  if(process.env.GITHUB_STEP_SUMMARY){
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
      '## Complement national #101 : verification de Firestore',
      '',
      '| Controle | Volume |','|---|---:|',
      '| Offres dans la generation privee | '+offerCount+' |',
      '| Offres sans territoire en quarantaine | '+quarantinedCount+' |',
      '| Departements controles | '+departments.size+' |',
      '| Annonces reaffectees apres recherche hors departement | '+recoveredCount+' |',
      '| Photographie historique 08/10 | '+baselineStrict+' offres strictes |',
      '',
      '**Generation staging verifiee, aucune modification des donnees publiques ni du snapshot historique.**',''
    ].join('\n'))
  }
}

main().catch(e=>{
 console.error('Verification echouee:',String(e?.message||e).slice(0,300));
 process.exitCode=1;
});
