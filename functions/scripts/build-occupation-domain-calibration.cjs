const admin = require('firebase-admin');
const {
  buildDomainCalibration,
  markDomainCalibrationValidated,
} = require('../lib/occupation-domain-calibration.cjs');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'meteo-apprentissage' });
}

const db = admin.firestore();

function readOption(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) =>
    value.startsWith(prefix)
  );

  if (!raw) return fallback;

  const value = Number.parseInt(
    raw.slice(prefix.length),
    10
  );

  return Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function readExcludedDates() {
  const prefix = '--exclude-dates=';
  const raw = process.argv.find((value) =>
    value.startsWith(prefix)
  );

  if (!raw) return ['2026-10-04'];

  return raw
    .slice(prefix.length)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const validateRequested =
  process.argv.includes('--validate');
const minimumSamplesPerDomain =
  readOption('min-domain', 24);
const minimumTotalSamples =
  readOption('min-total', 240);
const excludedDates = readExcludedDates();

async function loadHistory() {
  const history = [];
  let lastDoc = null;

  while (true) {
    let query = db
      .collection('occupationDomainContextStats')
      .orderBy(
        admin.firestore.FieldPath.documentId()
      )
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
        departmentCode:
          data.departmentCode || null,
        domainCode:
          data.domainCode || null,
        activeOffersCount:
          data.activeOffersCount,
        population15To29:
          data.population15To29,
        employerConcentration:
          data.employerConcentration,
      });
    }

    lastDoc =
      snapshot.docs[
        snapshot.docs.length - 1
      ];

    if (snapshot.size < 1000) break;
  }

  return history;
}

async function main() {
  const history = await loadHistory();

  const result = buildDomainCalibration(
    history,
    {
      minimumSamplesPerDomain,
      minimumTotalSamples,
      excludedDates,
    }
  );

  if (
    !result.eligibleForValidation ||
    !result.config
  ) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          historyCount: history.length,
          validationBlockers:
            result.validationBlockers,
          diagnostics:
            result.diagnostics,
        },
        null,
        2
      )
    );

    process.exitCode = 2;
    return;
  }

  const config = validateRequested
    ? markDomainCalibrationValidated(
        result
      )
    : result.config;

  const payload = {
    ...config,
    createdAt:
      admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion:
      'occupationDomainVigilanceConfig.v1',
  };

  if (config.status === 'validated') {
    payload.validatedAt =
      admin.firestore.FieldValue.serverTimestamp();
  }

  await db
    .collection(
      'occupationDomainVigilanceConfigs'
    )
    .doc(config.version)
    .set(payload, { merge: false });

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: config.version,
        status: config.status,
        historyCount: history.length,
        domainCount: Object.keys(
          config.baselines
        ).length,
        calibrationWindow: {
          start:
            config.calibration.windowStart,
          end:
            config.calibration.windowEnd,
        },
        excludedDates:
          config.calibration.excludedDates,
        diagnostics:
          result.diagnostics,
        explicitValidation:
          validateRequested,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
