const fs = require('node:fs');
const admin = require('firebase-admin');
const {
  buildCalibration,
  buildValidatedVigilanceConfig,
} = require('../lib/occupation-calibration.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'meteo-apprentissage' });
}

const db = admin.firestore();
const minimumSamplesPerRome = Number.parseInt(
  process.env.OCCUPATION_CALIBRATION_MIN_SAMPLES || '24',
  10
);
const minimumCalibratedRomeCodes = Number.parseInt(
  process.env.OCCUPATION_CALIBRATION_MIN_ROME_CODES || '20',
  10
);

function policyPathFromArgs(argv) {
  const index = argv.indexOf('--validate');
  if (index < 0) return null;
  const path = argv[index + 1];
  if (!path) throw new Error('--validate requires a JSON policy path');
  return path;
}

async function loadContextHistory() {
  const rows = [];
  let lastDoc = null;

  while (true) {
    let query = db
      .collection('occupationContextStats')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(1000);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      rows.push({
        date: data.asOfDate || data.date || null,
        romeCode: data.romeCode || null,
        primaryOfferDataStatus: data.primaryOfferDataStatus || data.primaryDataStatus || null,
        activeOffersCount: data.activeOffersCount,
        population15To29: data.population15To29,
        distinctObservedEmployersCount: data.distinctObservedEmployersCount,
        upcomingSessionsCount: data.upcomingSessionsCount,
      });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 1000) break;
  }

  return rows;
}

async function main() {
  const history = await loadContextHistory();
  const calibration = buildCalibration(history, {
    minimumSamplesPerRome,
    minimumCalibratedRomeCodes,
  });
  const policyPath = policyPathFromArgs(process.argv.slice(2));
  const computedAt = admin.firestore.FieldValue.serverTimestamp();

  if (!policyPath) {
    await db.collection('occupationVigilanceConfigs').doc(calibration.calibrationId).set({
      ...calibration,
      createdAt: computedAt,
      schemaVersion: 'occupationVigilanceCalibration.v1',
    }, { merge: false });

    console.log(JSON.stringify({
      ok: true,
      status: 'draft',
      calibrationId: calibration.calibrationId,
      calibratedRomeCount: calibration.calibratedRomeCount,
      excludedRomeCodesCount: calibration.excludedRomeCodes.length,
      invalidObservationCount: calibration.invalidObservationCount,
      canValidate: calibration.canValidate,
    }, null, 2));
    return;
  }

  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const validated = buildValidatedVigilanceConfig(calibration, policy);

  await db.collection('occupationVigilanceConfigs').doc(validated.configVersion).set({
    ...validated,
    validatedAt: computedAt,
    schemaVersion: 'occupationVigilanceConfig.v1',
  }, { merge: false });

  await db.collection('occupationVigilanceConfigMeta').doc('current').set({
    configVersion: validated.configVersion,
    calculationVersion: validated.calculationVersion,
    calibrationId: validated.calibrationId,
    validatedAt: computedAt,
    schemaVersion: 'occupationVigilanceConfigMeta.v1',
  }, { merge: false });

  console.log(JSON.stringify({
    ok: true,
    status: 'validated',
    configVersion: validated.configVersion,
    calculationVersion: validated.calculationVersion,
    calibrationId: validated.calibrationId,
    romeCodesCount: Object.keys(validated.romeBaselines).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
