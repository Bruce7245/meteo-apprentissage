function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
}

function keyFor(departmentCode, romeCode) {
  return `${departmentCode}_${romeCode}`;
}

function mapGet(value, key) {
  if (value instanceof Map) return value.get(key);
  return value?.[key];
}

function normalizeRomeCode(value) {
  const code = text(value).toUpperCase();
  return /^[A-Z][0-9]{4}$/.test(code) ? code : null;
}

function normalizeDepartmentCode(value) {
  const code = text(value).toUpperCase();
  if (/^\d$/.test(code)) return `0${code}`;
  if (/^(?:\d{2}|2A|2B|97[1-6])$/.test(code)) return code;
  return null;
}

function collectRomeCodes(offers, formations) {
  const codes = new Set();
  for (const item of [...(offers || []), ...(formations || [])]) {
    for (const value of Array.isArray(item?.romeCodes) ? item.romeCodes : []) {
      const code = normalizeRomeCode(value);
      if (code) codes.add(code);
    }
  }
  return Array.from(codes).sort((a, b) => a.localeCompare(b, 'fr'));
}

function resolveDefaults({ aggregateContext, computeRecentTrend, computeSeasonality }) {
  return {
    aggregateContext:
      aggregateContext ||
      require('./lib/occupation-context.cjs').aggregateOccupationContext,
    computeRecentTrend:
      computeRecentTrend ||
      require('./lib/occupation-history.cjs').computeRecentOfferTrend,
    computeSeasonality:
      computeSeasonality ||
      require('./lib/occupation-history.cjs').computeSeasonalityProfile,
  };
}

async function prepareOccupationVigilanceInputs({
  date,
  repository,
  aggregateContext,
  computeRecentTrend,
  computeSeasonality,
} = {}) {
  const targetDate = text(date);
  if (!validDate(targetDate)) {
    throw new Error(`Invalid occupation preparation date: ${date}`);
  }
  if (!repository) throw new Error('repository is required');

  const status = await repository.getPreparationStatus(targetDate);
  if (status?.contextReady && status?.historyReady) {
    return {
      date: targetDate,
      status: 'ready',
      contextsCount: Number(status.contextsCount || 0),
      historiesCount: Number(status.historiesCount || 0),
      reused: true,
    };
  }

  const defaults = resolveDefaults({
    aggregateContext,
    computeRecentTrend,
    computeSeasonality,
  });

  let contexts;

  if (!status?.contextReady) {
    const [
      populationByDepartment,
      formationsByDepartment,
      offerDepartments,
    ] = await Promise.all([
      repository.loadPopulationByDepartment(),
      repository.loadFormationsByDepartment(),
      repository.loadOfferDepartments(targetDate),
    ]);

    if (!Array.isArray(offerDepartments) || offerDepartments.length === 0) {
      throw new Error(
        `No daily offer department snapshots for ${targetDate}`
      );
    }

    contexts = [];

    for (const department of offerDepartments) {
      const departmentCode = normalizeDepartmentCode(
        department.departmentCode
      );
      if (!departmentCode) continue;

      const offers = Array.isArray(department.offers)
        ? department.offers
        : [];
      const formations =
        mapGet(formationsByDepartment, departmentCode) || [];
      const population =
        mapGet(populationByDepartment, departmentCode) || null;
      const romeCodes = collectRomeCodes(offers, formations);

      for (const romeCode of romeCodes) {
        const aggregate = defaults.aggregateContext({
          departmentCode,
          romeCode,
          asOfDate: targetDate,
          offers,
          formations,
          population,
        });

        contexts.push({
          date: targetDate,
          ...aggregate,
          sourceVersions: {
            offerRunId: department.activeRunId || null,
            populationRunId: population?.runId || null,
            populationReferenceYear: population?.referenceYear || null,
            formationSchemaVersion: 'formationDetails.v1',
          },
        });
      }
    }

    await repository.writeContexts(targetDate, contexts);
    await repository.markContextRunReady(targetDate, {
      departmentsProcessed: offerDepartments.length,
      occupationContexts: contexts.length,
      populationDepartmentsAvailable:
        populationByDepartment.size ?? 0,
    });
  } else {
    contexts = await repository.loadCurrentContexts(targetDate);
  }

  if (!Array.isArray(contexts) || contexts.length === 0) {
    throw new Error(`No occupationContextStats for ${targetDate}`);
  }

  if (!status?.historyReady) {
    const keys = new Set(
      contexts.map((item) =>
        keyFor(item.departmentCode, item.romeCode)
      )
    );

    const [recentByKey, monthlyByKey] = await Promise.all([
      repository.loadRecentContextHistory(targetDate, keys),
      repository.loadMonthlyRomeHistory(keys),
    ]);

    const asOfMonth = targetDate.slice(0, 7);

    const rows = contexts.map((current) => {
      const key = keyFor(
        current.departmentCode,
        current.romeCode
      );

      return {
        departmentCode: current.departmentCode,
        romeCode: current.romeCode,
        asOfDate: targetDate,
        recentTrend: defaults.computeRecentTrend(
          mapGet(recentByKey, key) || []
        ),
        seasonality: defaults.computeSeasonality(
          mapGet(monthlyByKey, key) || [],
          {
            asOfMonth,
            minActiveMonths: 24,
            completenessThreshold: 0.9,
            minFactor: 0.5,
            maxFactor: 2,
          }
        ),
        sources: {
          recent: 'occupationContextStats',
          monthly: 'lbaOfferStatsByMonthDepartmentRome',
        },
      };
    });

    await repository.writeHistories(targetDate, rows);
    await repository.markHistoryRunReady(targetDate, {
      contextsCount: rows.length,
      minActiveSeasonalityMonths: 24,
      completenessThreshold: 0.9,
    });
  }

  return {
    date: targetDate,
    status: 'ready',
    contextsCount: contexts.length,
    historiesCount: contexts.length,
    reused: false,
  };
}

function dateOffset(dateString, days) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function createFirestoreOccupationPrecomputeRepository(
  db,
  { FieldValue, FieldPath } = {}
) {
  if (!db) throw new Error('Firestore db is required');

  const serverTimestamp = () =>
    FieldValue?.serverTimestamp
      ? FieldValue.serverTimestamp()
      : new Date();

  const documentId = () =>
    FieldPath?.documentId ? FieldPath.documentId() : '__name__';

  async function commitRows(
    collectionName,
    idForRow,
    rows,
    decorate
  ) {
    let batch = db.batch();
    let count = 0;

    for (const row of rows) {
      batch.set(
        db.collection(collectionName).doc(idForRow(row)),
        {
          ...row,
          ...(decorate ? decorate(row) : {}),
        },
        { merge: false }
      );

      count += 1;

      if (count >= 400) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) await batch.commit();
  }

  async function loadOffers(departmentRef, activeRunId) {
    const offers = [];
    let last = null;

    while (true) {
      let query = departmentRef
        .collection('offers')
        .where('runId', '==', activeRunId)
        .orderBy(documentId())
        .limit(1000);

      if (last) query = query.startAfter(last);

      const snapshot = await query.get();
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        offers.push({
          offerDocId: doc.id,
          ...doc.data(),
        });
      }

      last = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.size < 1000) break;
    }

    return offers;
  }

  return {
    async getPreparationStatus(date) {
      const [context, history] = await Promise.all([
        db
          .collection('occupationContextStatsRuns')
          .doc(date)
          .get(),
        db
          .collection('occupationHistoryStatsRuns')
          .doc(date)
          .get(),
      ]);

      return {
        contextReady:
          context.exists &&
          context.data()?.status === 'ready',
        historyReady:
          history.exists &&
          history.data()?.status === 'ready',
        contextsCount: context.exists
          ? Number(context.data()?.occupationContexts || 0)
          : 0,
        historiesCount: history.exists
          ? Number(history.data()?.contextsCount || 0)
          : 0,
      };
    },

    async loadPopulationByDepartment() {
      const snapshot = await db
        .collection('departmentPopulationReference')
        .get();

      const output = new Map();

      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const code = normalizeDepartmentCode(
          data.departmentCode || doc.id
        );
        if (code) output.set(code, data);
      }

      return output;
    },

    async loadFormationsByDepartment() {
      const output = new Map();
      let last = null;

      while (true) {
        let query = db
          .collection('formationDetails')
          .orderBy(documentId())
          .limit(1000);

        if (last) query = query.startAfter(last);

        const snapshot = await query.get();
        if (snapshot.empty) break;

        for (const doc of snapshot.docs) {
          const data = doc.data() || {};
          const departmentCode = normalizeDepartmentCode(
            data?.venue?.departmentCode ||
              data?.importDepartmentCode
          );

          if (!departmentCode) continue;

          if (!output.has(departmentCode)) {
            output.set(departmentCode, []);
          }

          output.get(departmentCode).push({
            formationId: data.formationId || doc.id,
            rncp: data.rncp || null,
            romeCodes: Array.isArray(data.romeCodes)
              ? data.romeCodes
              : [],
            sessions: Array.isArray(data.sessions)
              ? data.sessions
              : [],
            primarySession: data.primarySession || null,
            venue: { departmentCode },
          });
        }

        last = snapshot.docs[snapshot.docs.length - 1];

        if (snapshot.size < 1000) break;
      }

      return output;
    },

    async loadOfferDepartments(date) {
      const snapshot = await db
        .collection('dailyOfferSnapshots')
        .doc(date)
        .collection('departments')
        .get();

      const rows = [];

      for (const doc of snapshot.docs) {
        const departmentCode =
          normalizeDepartmentCode(doc.id);
        if (!departmentCode) continue;

        const meta = doc.data() || {};
        const activeRunId = text(meta.activeRunId);

        if (!activeRunId) {
          throw new Error(
            `Department ${departmentCode} has no activeRunId for ${date}`
          );
        }

        rows.push({
          departmentCode,
          activeRunId,
          offers: await loadOffers(doc.ref, activeRunId),
        });
      }

      return rows;
    },

    async writeContexts(date, rows) {
      await commitRows(
        'occupationContextStats',
        (row) =>
          `${date}_${row.departmentCode}_${row.romeCode}`,
        rows,
        () => ({
          generatedAt: serverTimestamp(),
          schemaVersion: 'occupationContextStats.v1',
        })
      );
    },

    async markContextRunReady(date, meta) {
      await db
        .collection('occupationContextStatsRuns')
        .doc(date)
        .set(
          {
            date,
            status: 'ready',
            ...meta,
            generatedAt: serverTimestamp(),
            schemaVersion: 'occupationContextStatsRun.v1',
          },
          { merge: false }
        );
    },

    async loadCurrentContexts(date) {
      const snapshot = await db
        .collection('occupationContextStats')
        .where('date', '==', date)
        .get();

      return snapshot.docs.map(
        (doc) => doc.data() || {}
      );
    },

    async loadRecentContextHistory(date, targetKeys) {
      const start = dateOffset(date, -13);

      const snapshot = await db
        .collection('occupationContextStats')
        .where('date', '>=', start)
        .where('date', '<=', date)
        .get();

      const output = new Map();

      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const key = keyFor(
          data.departmentCode,
          data.romeCode
        );

        if (!targetKeys.has(key)) continue;

        if (!output.has(key)) output.set(key, []);

        output.get(key).push({
          date: data.date,
          activeOffersCount: data.activeOffersCount,
        });
      }

      return output;
    },

    async loadMonthlyRomeHistory(targetKeys) {
      const output = new Map();
      let last = null;

      while (true) {
        let query = db
          .collection('lbaOfferStatsByMonthDepartmentRome')
          .orderBy(documentId())
          .limit(1000);

        if (last) query = query.startAfter(last);

        const snapshot = await query.get();
        if (snapshot.empty) break;

        for (const doc of snapshot.docs) {
          const data = doc.data() || {};
          const key = keyFor(
            data.departmentCode,
            data.romeCode
          );

          if (!targetKeys.has(key)) continue;

          if (!output.has(key)) output.set(key, []);

          output.get(key).push({
            month: data.month,
            offersCount: data.offersCount,
          });
        }

        last = snapshot.docs[snapshot.docs.length - 1];

        if (snapshot.size < 1000) break;
      }

      return output;
    },

    async writeHistories(date, rows) {
      await commitRows(
        'occupationHistoryStats',
        (row) =>
          keyFor(row.departmentCode, row.romeCode),
        rows,
        () => ({
          generatedAt: serverTimestamp(),
          schemaVersion: 'occupationHistoryStats.v1',
        })
      );
    },

    async markHistoryRunReady(date, meta) {
      await db
        .collection('occupationHistoryStatsRuns')
        .doc(date)
        .set(
          {
            date,
            status: 'ready',
            recentWindowStartDate: dateOffset(date, -13),
            ...meta,
            generatedAt: serverTimestamp(),
            schemaVersion: 'occupationHistoryStatsRun.v1',
          },
          { merge: false }
        );
    },
  };
}

module.exports = {
  keyFor,
  collectRomeCodes,
  prepareOccupationVigilanceInputs,
  createFirestoreOccupationPrecomputeRepository,
};
