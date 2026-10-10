import {
  collection,
  getDocs,
  getDoc,
  doc,
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
  const [departmentsSnapshot, statsSnapshot, importSnapshot, nafIndexSnapshot, jobSnapshot] =
    await Promise.all([
      getDocs(collection(db, 'departments')),
      getDocs(collection(db, 'inseeDepartmentStats')),
      getDocs(collection(db, 'inseeDepartmentImportIndex')),
      getDocs(collection(db, 'inseeDepartmentNafStatsIndex')),
      getDoc(doc(db, 'adminJobs', 'inseeNationalBackgroundJob')),
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

  const nafIndexCodes = new Set(
    nafIndexSnapshot.docs.map((document) =>
      normalizeDepartmentCode(document.data()?.departmentCode || document.id)
    )
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
        nafStatsAvailable: nafIndexCodes.has(departmentCode),
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
        // Dry-runs and old incomplete cursors never certify real coverage.
        importComplete:
          importState?.complete === true &&
          importState?.write === true &&
          importState?.employerOnly !== false &&
          importState?.activeOnly !== true,
        importPagesRead: finiteNumber(importState?.pagesRead),
        importReceivedCount: finiteNumber(
          importState?.receivedCount
        ),
        importWrittenCount: finiteNumber(
          importState?.writtenCount
        ),
        importProcessedWrittenSinceV3:
          importState?.processedWrittenSinceV3 === undefined
            ? null
            : finiteNumber(importState.processedWrittenSinceV3),
        importCursorAvailable:
          Boolean(importState?.nextCursor) && importState?.complete !== true,
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
  const fullyReady = departments.filter(
    (department) =>
      department.importComplete &&
      department.statsAvailable &&
      department.nafStatsAvailable
  );

  const job = jobSnapshot.exists() ? jobSnapshot.data() : null;

  return {
    departments,
    job: job ? {
      status: job.status || 'unknown',
      currentDepartmentCode: job.currentDepartmentCode || null,
      currentDepartmentName: job.currentDepartmentName || null,
      currentPosition: finiteNumber(job.currentPosition),
      endPosition: finiteNumber(job.endPosition),
      totalPages: finiteNumber(job.totalPages),
      totalReceived: finiteNumber(job.totalReceived),
      completedDepartmentsCount: finiteNumber(job.completedDepartmentsCount),
      lastCompletedDepartmentCode: job.lastCompletedDepartmentCode || null,
      lastRunPages: finiteNumber(job.lastRunPages),
      lastRunReceived: finiteNumber(job.lastRunReceived),
      lastHeartbeatAt: timestampToIso(job.lastHeartbeatAt),
      updatedAt: timestampToIso(job.updatedAt),
      errorMessage: job.errorMessage || null,
    } : null,
    totals: {
      departmentsCount: departments.length,
      statsReadyCount: readyDepartments.length,
      completedImportsCount: completedImports.length,
      fullyReadyCount: fullyReady.length,
      partialCount: departments.filter((d) => d.importAvailable && !d.importComplete).length,
      missingCount: departments.filter((d) => !d.importAvailable && !d.importComplete).length,
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
