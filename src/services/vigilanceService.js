import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { normalizeDepartmentCode, getDepartmentName } from '../utils/departmentUtils.js';
import { sortByVigilanceThenCode } from '../utils/levelUtils.js';

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function normalizeIndexDepartment(item, indexData = {}) {
  const code = normalizeDepartmentCode(
    item?.departmentCode ||
    item?.code ||
    item?.inseeCode ||
    item?.id
  );

  return {
    id: item?.id || `${item?.date || indexData.latestDate || indexData.date || 'latest'}_${code}`,
    code,
    departmentCode: code,
    name: getDepartmentName({ ...item, departmentCode: code }),
    level: item?.publishedLevel || item?.level || item?.vigilanceLevel || 'green',
    publishedLevel: item?.publishedLevel || item?.level || item?.vigilanceLevel || 'green',
    date: item?.date || indexData.latestDate || indexData.date || null,
    publicSummary: item?.publicSummary || item?.summary || null,
    raw: item,
  };
}

function normalizeDepartmentReference(document) {
  const data = document.data() || {};
  const code = normalizeDepartmentCode(
    data.code ||
    data.departmentCode ||
    data.inseeCode ||
    document.id
  );

  return {
    id: document.id,
    code,
    departmentCode: code,
    name: getDepartmentName({ ...data, departmentCode: code }),
    regionName: data.regionName || null,
    position: Number(data.position ?? 999),
    level: 'green',
    publishedLevel: 'green',
    date: null,
    publicSummary: 'Aucune vigilance particulière publiée.',
    raw: data,
  };
}

async function getDepartmentReferences() {
  const snapshot = await getDocs(collection(db, 'departments'));

  return snapshot.docs
    .map((document) => normalizeDepartmentReference(document))
    .filter((item) => item.code)
    .sort((a, b) => {
      const positionDiff = Number(a.position || 999) - Number(b.position || 999);
      if (positionDiff !== 0) return positionDiff;

      return String(a.code).localeCompare(String(b.code), 'fr', { numeric: true });
    });
}

function normalizeIndexData(snapshot, fallbackDepartments = []) {
  if (!snapshot.exists()) {
    return {
      id: 'latest',
      exists: false,
      latestDate: null,
      publishedCount: 0,
      levels: {
        green: fallbackDepartments.length,
        yellow: 0,
        orange: 0,
        red: 0,
      },
      departments: sortByVigilanceThenCode(fallbackDepartments),
      raw: null,
    };
  }

  const data = snapshot.data() || {};

  const rawDepartments = firstArray(
    data.departments,
    data.items,
    data.docs,
    data.publications,
    data.vigilances
  );

  const publishedDepartments = rawDepartments
    .map((item) => normalizeIndexDepartment(item, data))
    .filter((item) => item.code);

  const publishedByCode = new Map(
    publishedDepartments.map((item) => [item.code, item])
  );

  const departments = fallbackDepartments.length > 0
    ? fallbackDepartments.map((department) => ({
        ...department,
        ...(publishedByCode.get(department.code) || {}),
        date: publishedByCode.get(department.code)?.date || data.latestDate || data.date || data.targetDate || null,
      }))
    : publishedDepartments;

  const sortedDepartments = sortByVigilanceThenCode(departments);

  return {
    id: snapshot.id,
    exists: true,
    latestDate: data.latestDate || data.date || data.targetDate || null,
    publishedCount: Number(data.publishedCount ?? publishedDepartments.length ?? 0),
    levels: {
      green: Math.max(sortedDepartments.length - publishedDepartments.length, 0),
      ...(data.levels || data.levelCounts || {}),
    },
    departments: sortedDepartments,
    raw: data,
  };
}

export async function getLatestPublicVigilanceIndex() {
  const [latestSnapshot, fallbackDepartments] = await Promise.all([
    getDoc(doc(db, 'vigilancePublicIndex', 'latest')),
    getDepartmentReferences(),
  ]);

  return normalizeIndexData(latestSnapshot, fallbackDepartments);
}

export async function getDepartmentReference(departmentCode) {
  const code = normalizeDepartmentCode(departmentCode);

  if (!code) return null;

  const snapshot = await getDoc(doc(db, 'departments', code));

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeDepartmentReference(snapshot);
}

export async function getPublishedDepartmentVigilance(departmentCode, date) {
  const code = normalizeDepartmentCode(departmentCode);

  let targetDate = date || null;
  let latestIndex = null;

  if (!targetDate) {
    latestIndex = await getLatestPublicVigilanceIndex();
    targetDate = latestIndex.latestDate;
  }

  const [departmentReference, latestIndexIfNeeded] = await Promise.all([
    getDepartmentReference(code),
    latestIndex ? Promise.resolve(latestIndex) : getLatestPublicVigilanceIndex(),
  ]);

  const currentIndex = latestIndex || latestIndexIfNeeded;
  const fallbackFromIndex = currentIndex?.departments?.find((item) => item.code === code) || null;

  if (!code || !targetDate) {
    return {
      exists: false,
      code,
      departmentCode: code,
      date: targetDate,
      data: null,
      fallbackFromIndex,
      departmentReference,
    };
  }

  const snapshot = await getDoc(
    doc(db, 'departmentVigilanceDaily', `${targetDate}_${code}`)
  );

  if (!snapshot.exists()) {
    return {
      exists: false,
      code,
      departmentCode: code,
      date: targetDate,
      data: {
        departmentCode: code,
        departmentName:
          departmentReference?.name ||
          fallbackFromIndex?.name ||
          `Département ${code}`,
        publishedLevel: 'green',
        publicTitle: 'Aucune vigilance particulière publiée.',
        publicSummary: 'La situation publiée ne signale pas de vigilance particulière pour ce département.',
        publicAdvice: 'La recherche d’apprentissage peut se poursuivre normalement, tout en surveillant les offres disponibles.',
        metrics: {},
      },
      fallbackFromIndex,
      departmentReference,
    };
  }

  const data = snapshot.data() || {};

  return {
    exists: true,
    id: snapshot.id,
    code,
    departmentCode: code,
    date: targetDate,
    data,
    fallbackFromIndex,
    departmentReference,
  };
}

export async function getPublishedDepartmentSectorVigilances(departmentCode, date) {
  const code = normalizeDepartmentCode(departmentCode);

  if (!code || !date) return [];

  const sectorQuery = query(
    collection(db, 'departmentSectorVigilanceDaily'),
    where('date', '==', date),
    where('departmentCode', '==', code)
  );

  const snapshot = await getDocs(sectorQuery);

  return sortByVigilanceThenCode(
    snapshot.docs.map((document) => {
      const data = document.data() || {};

      return {
        id: document.id,
        code: data.sectorCode || document.id,
        sectorCode: data.sectorCode || null,
        sectorLabel: data.sectorLabel || 'Secteur non renseigné',
        level: data.publishedLevel || data.level || 'green',
        publicSummary: data.publicSummary || data.reason || null,
        publicAdvice: data.publicAdvice || null,
        metrics: data.metrics || {},
        raw: data,
      };
    })
  );
}
