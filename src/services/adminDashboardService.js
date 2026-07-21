import {
  collection,
  getCountFromServer,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { getLatestPublicVigilanceIndex } from './vigilanceService.js';

async function readCount(reference) {
  const snapshot = await getCountFromServer(reference);
  return snapshot.data().count;
}

export async function getAdminDashboardSummary() {
  const index = await getLatestPublicVigilanceIndex();
  const latestDate = index.latestDate || null;

  const sectorReference = latestDate
    ? query(
        collection(db, 'departmentSectorVigilanceDaily'),
        where('date', '==', latestDate)
      )
    : null;

  const [bulletinsResult, sectorsResult] = await Promise.allSettled([
    readCount(collection(db, 'bulletins')),
    sectorReference ? readCount(sectorReference) : Promise.resolve(0),
  ]);

  const warnings = [];

  if (bulletinsResult.status === 'rejected') {
    warnings.push('Le nombre de bulletins n’a pas pu être chargé.');
  }

  if (sectorsResult.status === 'rejected') {
    warnings.push('Le nombre de vigilances sectorielles n’a pas pu être chargé.');
  }

  const levels = index.levels || {};
  const elevatedDepartments =
    Number(levels.orange || 0) + Number(levels.red || 0);

  return {
    latestDate,
    publishedDepartments: Number(index.publishedCount || 0),
    bulletinsCount:
      bulletinsResult.status === 'fulfilled' ? bulletinsResult.value : null,
    sectorsCount:
      sectorsResult.status === 'fulfilled' ? sectorsResult.value : null,
    elevatedDepartments,
    levels: {
      green: Number(levels.green || 0),
      yellow: Number(levels.yellow || 0),
      orange: Number(levels.orange || 0),
      red: Number(levels.red || 0),
    },
    warnings,
  };
}
