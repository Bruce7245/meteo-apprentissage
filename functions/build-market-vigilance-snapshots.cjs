const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "meteo-apprentissage" });
}

const db = admin.firestore();

const departmentCode = String(process.argv[2] || "72").toUpperCase();
const snapshotDate = String(process.argv[3] || "2026-06-30");

const levelRank = {
  "Données insuffisantes": -1,
  "Vert": 0,
  "Jaune": 1,
  "Orange": 2,
  "Rouge": 3,
};

function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(n(value) * factor) / factor;
}

function dateMinus(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function sectorFromDocId(id, date, department) {
  const prefix = `${date}_${department}_`;
  if (id.startsWith(prefix)) {
    return id.slice(prefix.length);
  }

  const prefix2 = `${department}_`;
  if (id.startsWith(prefix2)) {
    return id.slice(prefix2.length);
  }

  return null;
}

function inferOfferRow(doc, data, wantedDate, wantedDepartment) {
  const id = doc.id;

  const date =
    data.date ||
    data.statDate ||
    data.day ||
    data.snapshotDate ||
    (id.match(/\d{4}-\d{2}-\d{2}/) || [null])[0];

  if (date !== wantedDate) return null;

  const department =
    data.departmentCode ||
    data.department ||
    data.depCode ||
    data.codeDepartement ||
    (id.includes(`_${wantedDepartment}_`) ? wantedDepartment : null);

  if (String(department || "").toUpperCase() !== wantedDepartment) return null;

  const sectorCode =
    data.sectorCode ||
    data.sector ||
    data.sectorKey ||
    data.category ||
    sectorFromDocId(id, wantedDate, wantedDepartment);

  if (!sectorCode) return null;

  const activeOffersCount = n(
    data.activeOffersCount ??
    data.offersCount ??
    data.jobsCount ??
    data.activeJobsCount ??
    data.returnedActiveJobsCount ??
    data.returnedJobsCount ??
    data.count ??
    (Array.isArray(data.offerIds) ? data.offerIds.length : undefined)
  );

  const openingsCount = n(
    data.openingsCount ??
    data.openingCount ??
    data.positionsCount ??
    data.placesCount ??
    data.jobsCount ??
    activeOffersCount
  );

  const recruitersCount = n(
    data.recruitersCount ??
    data.distinctRecruiterSiretCount ??
    data.distinctCompaniesCount
  );

  return {
    sectorCode,
    activeOffersCount,
    openingsCount,
    recruitersCount,
    sourceDocId: id,
  };
}

async function loadOfferMapForDate(date) {
  const collections = [
    "departmentSectorDailyStats",
    "departmentSectorStats",
  ];

  const map = new Map();

  for (const collectionName of collections) {
    const snap = await db.collection(collectionName).get();

    snap.docs.forEach((doc) => {
      const data = doc.data();
      const row = inferOfferRow(doc, data, date, departmentCode);

      if (!row) return;

      const previous = map.get(row.sectorCode) || {
        activeOffersCount: 0,
        openingsCount: 0,
        recruitersCount: 0,
        sourceCollections: [],
        sourceDocIds: [],
      };

      previous.activeOffersCount += row.activeOffersCount;
      previous.openingsCount += row.openingsCount;
      previous.recruitersCount += row.recruitersCount;
      previous.sourceCollections.push(collectionName);
      previous.sourceDocIds.push(row.sourceDocId);

      map.set(row.sectorCode, previous);
    });
  }

  return map;
}

async function loadBySector(collectionName) {
  const snap = await db.collection(collectionName)
    .where("departmentCode", "==", departmentCode)
    .get();

  const map = new Map();

  snap.docs.forEach((doc) => {
    const data = doc.data();
    const sectorCode = data.sectorCode || doc.id.replace(`${departmentCode}_`, "");
    map.set(sectorCode, { id: doc.id, ...data });
  });

  return map;
}

async function loadPreviousSnapshotMap(date) {
  const snap = await db.collection("departmentSectorMarketSnapshots")
    .where("departmentCode", "==", departmentCode)
    .where("date", "==", date)
    .get();

  const map = new Map();

  snap.docs.forEach((doc) => {
    const data = doc.data();
    map.set(data.sectorCode, data);
  });

  return map;
}

function computeRawVigilance({ insee, formation, offers, offerD7 }) {
  const employers = n(insee.activeEmployerEstablishmentsCount);
  const need = n(formation.estimatedNeedToSecure);
  const activeOffers = offers?.activeOffersCount;
  const openings = offers?.openingsCount;

  const reasons = [];
  const caveats = [];

  if (!offers) {
    return {
      level: "Données insuffisantes",
      score: null,
      reasons: ["Les offres du jour ne sont pas disponibles ou pas encore correctement mappées."],
      caveats: ["La vigilance finale ne doit pas être publiée sans données offres exploitables."],
      ratios: {
        offerCoverageRatio: null,
        openingCoverageRatio: null,
        offersPer100Employers: null,
        needPer100Employers: employers > 0 ? round((need / employers) * 100, 2) : null,
      },
    };
  }

  let score = 0;

  const offerCoverageRatio = need > 0 ? n(activeOffers) / need : null;
  const openingCoverageRatio = need > 0 ? n(openings) / need : null;
  const offersPer100Employers = employers > 0 ? (n(activeOffers) / employers) * 100 : null;
  const needPer100Employers = employers > 0 ? (need / employers) * 100 : null;

  if (need >= 300) {
    score += 20;
    reasons.push("Pression formation très élevée.");
  } else if (need >= 150) {
    score += 15;
    reasons.push("Pression formation élevée.");
  } else if (need >= 75) {
    score += 10;
    reasons.push("Pression formation modérée.");
  } else if (need >= 25) {
    score += 5;
    reasons.push("Pression formation présente mais limitée.");
  }

  if (need > 0) {
    if (n(activeOffers) === 0 && need >= 25) {
      score += 65;
      reasons.push("Aucune offre visible malgré un besoin formation estimé.");
    } else if (offerCoverageRatio < 0.25) {
      score += 55;
      reasons.push("Les offres visibles couvrent moins de 25 % du besoin estimé.");
    } else if (offerCoverageRatio < 0.50) {
      score += 40;
      reasons.push("Les offres visibles couvrent moins de 50 % du besoin estimé.");
    } else if (offerCoverageRatio < 0.80) {
      score += 25;
      reasons.push("Les offres visibles couvrent partiellement le besoin estimé.");
    } else if (offerCoverageRatio < 1.20) {
      score += 10;
      reasons.push("Les offres visibles couvrent presque le besoin estimé.");
    } else {
      reasons.push("Les offres visibles semblent couvrir le besoin estimé.");
    }
  }

  const days = formation.nearestSessionDaysBeforeStart;

  if (typeof days === "number") {
    if (days >= 0 && days <= 15) {
      score += 20;
      reasons.push("Une session proche augmente fortement l'urgence.");
    } else if (days <= 30 && days > 15) {
      score += 15;
      reasons.push("Une session démarre prochainement.");
    } else if (days <= 60 && days > 30) {
      score += 10;
      reasons.push("La prochaine session est à surveiller à court terme.");
    } else if (days <= 90 && days > 60) {
      score += 5;
      reasons.push("La prochaine session entre dans la période d'anticipation.");
    } else if (days < 0 && days >= -30) {
      score += 15;
      reasons.push("Une session a récemment démarré, replacement possible.");
    } else if (days < -30 && days >= -90) {
      score += 5;
      reasons.push("Une session récente peut encore peser sur le marché.");
    }
  }

  if (employers >= 1000 && n(activeOffers) <= 20 && need >= 100) {
    score += 15;
    reasons.push("Potentiel employeur important mais faible volume d'offres visibles.");
  } else if (employers >= 500 && n(activeOffers) <= 10 && need >= 75) {
    score += 10;
    reasons.push("Potentiel employeur significatif mais peu d'offres visibles.");
  }

  if (offerD7 && offerD7.activeOffersCount > 0) {
    const variation = (n(activeOffers) - n(offerD7.activeOffersCount)) / n(offerD7.activeOffersCount);

    if (variation <= -0.30) {
      score += 10;
      reasons.push("Les offres visibles sont en forte baisse sur 7 jours.");
    } else if (variation <= -0.15) {
      score += 5;
      reasons.push("Les offres visibles baissent sur 7 jours.");
    } else if (variation >= 0.20) {
      score -= 5;
      reasons.push("Les offres visibles progressent sur 7 jours.");
    }
  }

  if (formation.knownCapacityTotal === 0 && need > 0) {
    caveats.push("Capacités de session non renseignées, estimation par défaut utilisée.");
  }

  if (employers < 100 && score >= 70) {
    score = 69;
    caveats.push("Niveau plafonné car le potentiel employeur local est faible.");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level = "Vert";
  if (score >= 70) level = "Rouge";
  else if (score >= 45) level = "Orange";
  else if (score >= 20) level = "Jaune";

  return {
    level,
    score,
    reasons,
    caveats,
    ratios: {
      offerCoverageRatio: offerCoverageRatio === null ? null : round(offerCoverageRatio, 3),
      openingCoverageRatio: openingCoverageRatio === null ? null : round(openingCoverageRatio, 3),
      offersPer100Employers: offersPer100Employers === null ? null : round(offersPer100Employers, 2),
      needPer100Employers: needPer100Employers === null ? null : round(needPer100Employers, 2),
    },
  };
}

function stabilize(raw, previousD1, previousD2) {
  if (raw.level === "Données insuffisantes") {
    return {
      level: raw.level,
      score: raw.score,
      stabilityStatus: "not_publishable",
      stabilityReason: "Données offres insuffisantes.",
    };
  }

  if (!previousD1?.publishedVigilance?.level) {
    return {
      level: raw.level,
      score: raw.score,
      stabilityStatus: "initial",
      stabilityReason: "Premier calcul disponible.",
    };
  }

  const previousLevel = previousD1.publishedVigilance.level;
  const previousScore = n(previousD1.publishedVigilance.score ?? previousD1.rawVigilance?.score);
  const rawRank = levelRank[raw.level];
  const previousRank = levelRank[previousLevel];

  if (rawRank > previousRank) {
    if (raw.score - previousScore >= 15 || rawRank - previousRank >= 2) {
      return {
        level: raw.level,
        score: raw.score,
        stabilityStatus: "increased",
        stabilityReason: "Dégradation significative confirmée par l'écart de score.",
      };
    }

    return {
      level: previousLevel,
      score: raw.score,
      stabilityStatus: "increase_pending",
      stabilityReason: "Hausse récente à confirmer.",
    };
  }

  if (rawRank < previousRank) {
    const d1RawRank = levelRank[previousD1.rawVigilance?.level] ?? previousRank;
    const d2RawRank = levelRank[previousD2?.rawVigilance?.level] ?? previousRank;

    if (d1RawRank <= rawRank && d2RawRank <= rawRank) {
      return {
        level: raw.level,
        score: raw.score,
        stabilityStatus: "decreased_confirmed",
        stabilityReason: "Amélioration confirmée sur deux jours.",
      };
    }

    return {
      level: previousLevel,
      score: raw.score,
      stabilityStatus: "decrease_pending",
      stabilityReason: "Amélioration à confirmer avant baisse du niveau publié.",
    };
  }

  return {
    level: raw.level,
    score: raw.score,
    stabilityStatus: "stable",
    stabilityReason: "Niveau stable.",
  };
}

async function main() {
  console.log("Snapshot vigilance marché");
  console.log("Département:", departmentCode);
  console.log("Date:", snapshotDate);

  const d1 = dateMinus(snapshotDate, 1);
  const d2 = dateMinus(snapshotDate, 2);
  const d7 = dateMinus(snapshotDate, 7);

  const [
    inseeMap,
    formationMap,
    offerMap,
    offerMapD7,
    previousD1Map,
    previousD2Map,
  ] = await Promise.all([
    loadBySector("inseeDepartmentSectorStats"),
    loadBySector("formationDepartmentSectorStats"),
    loadOfferMapForDate(snapshotDate),
    loadOfferMapForDate(d7),
    loadPreviousSnapshotMap(d1),
    loadPreviousSnapshotMap(d2),
  ]);

  const allSectorCodes = new Set([
    ...inseeMap.keys(),
    ...formationMap.keys(),
    ...offerMap.keys(),
  ]);

  const rows = [];
  const writes = [];

  for (const sectorCode of allSectorCodes) {
    const insee = inseeMap.get(sectorCode) || {};
    const formation = formationMap.get(sectorCode) || {};
    const offers = offerMap.get(sectorCode) || null;
    const offerD7 = offerMapD7.get(sectorCode) || null;

    const raw = computeRawVigilance({
      insee,
      formation,
      offers,
      offerD7,
    });

    const published = stabilize(
      raw,
      previousD1Map.get(sectorCode),
      previousD2Map.get(sectorCode)
    );

    const sectorLabel = formation.sectorLabel || insee.sectorLabel || sectorCode;

    const doc = {
      date: snapshotDate,
      departmentCode,
      sectorCode,
      sectorLabel,

      insee: {
        activeEmployerEstablishmentsCount: n(insee.activeEmployerEstablishmentsCount),
        dataStatus: insee.activeEmployerEstablishmentsCount != null ? "available" : "missing",
      },

      formations: {
        formationsCount: n(formation.formationsCount),
        sessionsCount: n(formation.sessionsCount),
        upcomingSessionsCount: n(formation.upcomingSessionsCount),
        recentStartedSessionsCount: n(formation.recentStartedSessionsCount),
        knownCapacityTotal: n(formation.knownCapacityTotal),
        estimatedCapacityTotal: n(formation.estimatedCapacityTotal),
        estimatedNeedToSecure: n(formation.estimatedNeedToSecure),
        nearestSessionStartDate: formation.nearestSessionStartDate || null,
        nearestSessionDaysBeforeStart: formation.nearestSessionDaysBeforeStart ?? null,
        defaultCapacity: formation.defaultCapacity ?? null,
        dataStatus: formation.estimatedNeedToSecure != null ? "available" : "missing",
      },

      offers: {
        activeOffersCount: offers ? n(offers.activeOffersCount) : null,
        openingsCount: offers ? n(offers.openingsCount) : null,
        recruitersCount: offers ? n(offers.recruitersCount) : null,
        activeOffersCountD7: offerD7 ? n(offerD7.activeOffersCount) : null,
        sourceCollections: offers?.sourceCollections || [],
        sourceDocIds: offers?.sourceDocIds || [],
        dataStatus: offers ? "available" : "missing_or_unmatched",
      },

      ratios: raw.ratios,
      rawVigilance: {
        level: raw.level,
        score: raw.score,
        reasons: raw.reasons,
        caveats: raw.caveats,
      },
      publishedVigilance: published,

      computedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: "departmentSectorMarketSnapshots.v2",
    };

    writes.push({
      ref: db.collection("departmentSectorMarketSnapshots")
        .doc(`${snapshotDate}_${departmentCode}_${sectorCode}`),
      data: doc,
    });

    rows.push({
      sectorCode,
      secteur: sectorLabel,
      employeurs: doc.insee.activeEmployerEstablishmentsCount,
      besoin: doc.formations.estimatedNeedToSecure,
      offres: doc.offers.activeOffersCount,
      couverture: doc.ratios.offerCoverageRatio,
      brut: doc.rawVigilance.level,
      publié: doc.publishedVigilance.level,
      score: doc.rawVigilance.score,
      dataOffres: doc.offers.dataStatus,
    });
  }

  let batch = db.batch();
  let count = 0;

  for (const write of writes) {
    batch.set(write.ref, write.data, { merge: true });
    count += 1;

    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  const significant = rows.filter((row) =>
    n(row.besoin) >= 25 || n(row.offres) >= 5 || n(row.employeurs) >= 100
  );

  const publishable = significant.filter((row) => row.publié !== "Données insuffisantes");

  const globalLevel = publishable.length
    ? publishable.sort((a, b) => levelRank[b.publié] - levelRank[a.publié] || n(b.score) - n(a.score))[0].publié
    : "Données insuffisantes";

  await db.collection("departmentMarketSnapshots")
    .doc(`${snapshotDate}_${departmentCode}`)
    .set({
      date: snapshotDate,
      departmentCode,
      sectorsCount: rows.length,
      significantSectorsCount: significant.length,
      globalPublishedLevel: globalLevel,
      sectors: rows.sort((a, b) => n(b.score) - n(a.score)),
      computedAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: "departmentMarketSnapshots.v1",
    }, { merge: true });

  console.log("");
  console.log("Snapshots secteurs écrits:", writes.length);
  console.log("Niveau département publié:", globalLevel);
  console.table(rows.sort((a, b) => n(b.score) - n(a.score)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
