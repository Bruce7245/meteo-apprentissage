import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase.js';

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
