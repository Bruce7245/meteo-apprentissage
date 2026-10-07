import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { normalizeRomeCode } from '../utils/occupationUtils.js';

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export async function getActiveOccupationVigilanceConfig() {
  const snapshot = await getDocs(
    query(
      collection(db, 'occupationVigilanceConfigs'),
      where('status', '==', 'validated')
    )
  );

  const configs = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .sort(
      (a, b) =>
        timestampMillis(b.validatedAt || b.createdAt) -
        timestampMillis(a.validatedAt || a.createdAt)
    );

  return configs[0] || null;
}


const LEVEL_RANK = {
  red: 0,
  orange: 1,
  yellow: 2,
  green: 3,
  insufficient_data: 4,
};

function runTimestamp(run) {
  return Math.max(
    timestampMillis(run?.publishedAt),
    timestampMillis(run?.updatedAt),
    timestampMillis(run?.startedAt)
  );
}

export async function getLatestOccupationVigilanceRun() {
  const snapshot = await getDocs(
    collection(db, 'occupationVigilanceRuns')
  );

  const runs = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .filter((run) =>
      ['published', 'ready'].includes(String(run.status || ''))
    )
    .sort((a, b) => {
      const dateCompare = String(b.date || '').localeCompare(
        String(a.date || '')
      );

      if (dateCompare !== 0) return dateCompare;
      return runTimestamp(b) - runTimestamp(a);
    });

  return runs[0] || null;
}

export async function getOccupationAnalysisForRome(romeCode) {
  const rome = normalizeRomeCode(romeCode);

  if (!rome) {
    throw new Error('Code ROME invalide.');
  }

  const run = await getLatestOccupationVigilanceRun();

  if (!run) {
    return {
      run: null,
      romeCode: rome,
      rows: [],
      summary: null,
    };
  }

  const snapshot = await getDocs(
    query(
      collection(
        db,
        'occupationVigilanceSnapshots',
        run.id,
        'entries'
      ),
      where('romeCode', '==', rome)
    )
  );

  const rows = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .sort((a, b) => {
      const levelCompare =
        (LEVEL_RANK[a.publishedLevel] ?? 99) -
        (LEVEL_RANK[b.publishedLevel] ?? 99);

      if (levelCompare !== 0) return levelCompare;

      const ratioA = Number(a.observedVsExpectedRatio);
      const ratioB = Number(b.observedVsExpectedRatio);

      if (Number.isFinite(ratioA) && Number.isFinite(ratioB)) {
        if (ratioA !== ratioB) return ratioA - ratioB;
      }

      return String(a.departmentName || a.departmentCode || '').localeCompare(
        String(b.departmentName || b.departmentCode || ''),
        'fr'
      );
    });

  const levels = {
    green: 0,
    yellow: 0,
    orange: 0,
    red: 0,
    insufficient_data: 0,
  };

  let highConfidenceCount = 0;
  let totalObservedOffers = 0;
  let totalExpectedOffers = 0;

  for (const row of rows) {
    const level = String(row.publishedLevel || 'insufficient_data');

    if (level in levels) levels[level] += 1;
    if (row.confidenceLevel === 'high') highConfidenceCount += 1;

    const observed = Number(row.activeOffersCount);
    const expected = Number(row.expectedOffers);

    if (Number.isFinite(observed)) totalObservedOffers += observed;
    if (Number.isFinite(expected)) totalExpectedOffers += expected;
  }

  return {
    run,
    romeCode: rome,
    romeLabel: rows[0]?.romeLabel || rome,
    rows,
    summary: {
      departmentsCount: rows.length,
      totalObservedOffers,
      totalExpectedOffers,
      highConfidenceCount,
      levels,
      elevatedDepartments:
        levels.orange + levels.red,
    },
  };
}
