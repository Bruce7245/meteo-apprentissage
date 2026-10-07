const admin = require('firebase-admin');
const {
  buildCalibration,
  markCalibrationValidated,
} = require('../lib/occupation-calibration.cjs');
const {
  validateOccupationVigilanceConfig,
} = require('../lib/occupation-vigilance.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'meteo-apprentissage' });
}

const db = admin.firestore();

function readOption(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix));
  if (!raw) return fallback;

  const value = Number.parseInt(raw.slice(prefix.length), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const validateRequested = process.argv.includes('--validate');
const minimumSamplesPerRome = readOption('min-rome', 24);
const minimumTotalSamples = readOption('min-total', 240);

async function loadHistory() {
  const history = [];
  let lastDoc = null;

  while (true) {
    let query = db
      .collection('occupationContextStats')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(1000);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() || {};

      history.push({
        date: data.date || null,
        departmentCode: data.departmentCode || null,
        romeCode: data.romeCode || null,
        activeOffersCount: data.activeOffersCount,
        population15To29: data.population15To29,
        formationsCount: data.formationsCount,
        employerConcentration: data.employerConcentration,
      });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 1000) break;
  }

  return history;
}

async function main() {
  const history = await loadHistory();
  const result = buildCalibration(history, {
    minimumSamplesPerRome,
    minimumTotalSamples,
  });

  if (!result.eligibleForValidation || !result.config) {
    console.error(JSON.stringify({
      ok: false,
      historyCount: history.length,
      validationBlockers: result.validationBlockers,
      diagnostics: result.diagnostics,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const config = validateRequested
    ? markCalibrationValidated(result)
    : result.config;

  const validation = validateOccupationVigilanceConfig(config);
  if (!validation.ok) {
    throw new Error(
      `Generated calibration config is invalid: ${validation.errors.join('; ')}`
    );
  }

  const payload = {
    ...config,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 'occupationVigilanceConfig.v1',
  };

  if (config.status === 'validated') {
    payload.validatedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.collection('occupationVigilanceConfigs').doc(config.version).set(
    payload,
    { merge: false }
  );

  console.log(JSON.stringify({
    ok: true,
    version: config.version,
    status: config.status,
    historyCount: history.length,
    romeCount: Object.keys(config.baselines).length,
    calibrationWindow: {
      start: config.calibration.windowStart,
      end: config.calibration.windowEnd,
    },
    explicitValidation: validateRequested,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
