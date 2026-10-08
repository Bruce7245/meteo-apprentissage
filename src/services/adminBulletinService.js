import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { getLatestPublicVigilanceIndex } from './vigilanceService.js';
import { getDepartmentName } from '../utils/departmentUtils.js';
import { sortByVigilanceThenCode } from '../utils/levelUtils.js';

function timestampToIso(value) {
  if (!value) return null;

  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === 'string' ? value : null;
}

function normalizeBulletin(document) {
  const data = document.data() || {};
  const departmentCode = String(
    data.departmentCode || document.id.split('_').pop() || ''
  ).trim().toUpperCase();

  return {
    id: document.id,
    date: data.date || document.id.split('_')[0] || null,
    departmentCode,
    departmentName:
      data.departmentName ||
      getDepartmentName({ ...data, departmentCode }),
    publishedLevel: data.publishedLevel || 'green',
    rawLevel: data.rawLevel || null,
    rawScore: Number(data.rawScore || 0),
    confidenceScore:
      data.confidenceScore === null || data.confidenceScore === undefined
        ? null
        : Number(data.confidenceScore),
    publicTitle: data.publicTitle || null,
    publicSummary: data.publicSummary || null,
    publicAdvice: data.publicAdvice || null,
    reasons: Array.isArray(data.reasons) ? data.reasons : [],
    technicalReasons: Array.isArray(data.technicalReasons)
      ? data.technicalReasons
      : [],
    metrics: data.metrics || {},
    generatedAt: timestampToIso(data.generatedAt),
    schemaVersion: data.schemaVersion || null,
  };
}

export async function getLatestAdminBulletins() {
  const index = await getLatestPublicVigilanceIndex();
  const latestDate = index.latestDate || null;

  if (!latestDate) {
    return {
      latestDate: null,
      bulletins: [],
      publishedDepartments: Number(index.publishedCount || 0),
      levels: index.levels || {},
    };
  }

  const snapshot = await getDocs(
    query(
      collection(db, 'departmentVigilanceDaily'),
      where('date', '==', latestDate)
    )
  );

  const bulletins = sortByVigilanceThenCode(
    snapshot.docs.map(normalizeBulletin)
  );

  return {
    latestDate,
    bulletins,
    publishedDepartments: Number(index.publishedCount || 0),
    levels: index.levels || {},
  };
}
