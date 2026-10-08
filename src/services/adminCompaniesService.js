import {
  collection,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { normalizeDepartmentCode } from '../utils/departmentUtils.js';

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function getAdminCompaniesDashboard() {
  const [departmentsSnapshot, statsSnapshot, importSnapshot] =
    await Promise.all([
      getDocs(collection(db, 'departments')),
      getDocs(collection(db, 'inseeDepartmentStats')),
      getDocs(collection(db, 'inseeDepartmentImportIndex')),
    ]);

  const statsByDepartment = new Map(
    statsSnapshot.docs.map((document) => {
      const data = document.data() || {};
      const code = normalizeDepartmentCode(
        data.departmentCode || document.id
      );

      return [code, { id: document.id, ...data }];
    })
  );

  const importsByDepartment = new Map(
    importSnapshot.docs.map((document) => {
      const data = document.data() || {};
      const code = normalizeDepartmentCode(
        data.departmentCode || document.id
      );

      return [code, { id: document.id, ...data }];
    })
  );

  const departments = departmentsSnapshot.docs
    .map((document) => {
      const data = document.data() || {};
      const departmentCode = normalizeDepartmentCode(
        data.departmentCode || data.code || document.id
      );
      const stats = statsByDepartment.get(departmentCode) || null;
      const importState =
        importsByDepartment.get(departmentCode) || null;

      return {
        id: document.id,
        departmentCode,
        departmentName:
          data.name ||
          data.nom ||
          data.departmentName ||
          departmentCode,
        regionName: data.regionName || null,
        enabled: data.enabled !== false,
        statsAvailable: Boolean(stats),
        establishmentsCount: finiteNumber(
          stats?.establishmentsCount
        ),
        activeEstablishmentsCount: finiteNumber(
          stats?.activeEstablishmentsCount
        ),
        activeEmployerEstablishmentsCount: finiteNumber(
          stats?.activeEmployerEstablishmentsCount
        ),
        sectorsCount: finiteNumber(stats?.sectorsCount),
        nafCodesCount:
          stats?.nafCodesCount === null ||
          stats?.nafCodesCount === undefined
            ? null
            : finiteNumber(stats.nafCodesCount),
        aggregationMode: stats?.aggregationMode || null,
        statsSchemaVersion: stats?.schemaVersion || null,
        statsComputedAt: timestampToIso(stats?.computedAt),
        importAvailable: Boolean(importState),
        importComplete: importState?.complete === true,
        importPagesRead: finiteNumber(importState?.pagesRead),
        importReceivedCount: finiteNumber(
          importState?.receivedCount
        ),
        importWrittenCount: finiteNumber(
          importState?.writtenCount
        ),
        importUpdatedAt: timestampToIso(importState?.updatedAt),
      };
    })
    .filter((department) => department.departmentCode)
    .sort((left, right) =>
      String(left.departmentCode).localeCompare(
        String(right.departmentCode),
        'fr',
        { numeric: true }
      )
    );

  const readyDepartments = departments.filter(
    (department) => department.statsAvailable
  );
  const completedImports = departments.filter(
    (department) => department.importComplete
  );

  return {
    departments,
    totals: {
      departmentsCount: departments.length,
      statsReadyCount: readyDepartments.length,
      completedImportsCount: completedImports.length,
      activeEmployerEstablishmentsCount:
        readyDepartments.reduce(
          (total, department) =>
            total +
            department.activeEmployerEstablishmentsCount,
          0
        ),
      activeEstablishmentsCount:
        readyDepartments.reduce(
          (total, department) =>
            total + department.activeEstablishmentsCount,
          0
        ),
    },
  };
}
