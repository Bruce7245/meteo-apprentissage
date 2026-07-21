const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "meteo-apprentissage" });
}

const db = admin.firestore();

const INSEE_API_KEY = process.env.INSEE_API_KEY;
const LIMIT = Number(process.env.LIMIT || 50);
const WRITE = process.env.WRITE === "1";

if (!INSEE_API_KEY) {
  console.error("ERREUR: INSEE_API_KEY manquant.");
  console.error('Utilise: export INSEE_API_KEY="TA_CLE_INSEE"');
  process.exit(1);
}

function cleanSiret(value) {
  if (!value) return null;
  const s = String(value).replace(/\D/g, "");
  return /^\d{14}$/.test(s) ? s : null;
}

function cleanNaf(value) {
  if (!value) return null;
  const s = String(value).trim().toUpperCase().replace(/\s+/g, "");
  return /^[0-9]{4}[A-Z]$/.test(s) ? s : null;
}

function normalizeText(value) {
  if (!value) return null;
  return String(value).trim();
}

function getDepartmentFromPostalCode(postalCode) {
  const cp = String(postalCode || "").replace(/\D/g, "");
  if (cp.length < 5) return null;

  if (cp.startsWith("20")) {
    const n = Number(cp);
    if (n >= 20000 && n <= 20199) return "2A";
    if (n >= 20200 && n <= 20699) return "2B";
    return "20";
  }

  return cp.slice(0, 2);
}

function findValuesByKey(obj, keyRegex, path = "", found = []) {
  if (!obj || typeof obj !== "object") return found;

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      findValuesByKey(item, keyRegex, `${path}[${index}]`, found);
    });
    return found;
  }

  Object.entries(obj).forEach(([key, value]) => {
    const nextPath = path ? `${path}.${key}` : key;

    if (keyRegex.test(key)) {
      found.push({ path: nextPath, value });
    }

    if (value && typeof value === "object") {
      findValuesByKey(value, keyRegex, nextPath, found);
    }
  });

  return found;
}

function extractOfferIdentity(detail) {
  const siretCandidates = findValuesByKey(detail, /siret/i)
    .map((item) => ({ ...item, siret: cleanSiret(item.value) }))
    .filter((item) => item.siret);

  const nafCandidates = findValuesByKey(detail, /(naf|ape)/i)
    .map((item) => ({ ...item, naf: cleanNaf(item.value) }))
    .filter((item) => item.naf);

  const postalCandidates = findValuesByKey(detail, /(codepostal|postal|zip)/i)
    .map((item) => ({ ...item, postalCode: normalizeText(item.value) }))
    .filter((item) => item.postalCode);

  const cityCandidates = findValuesByKey(detail, /(ville|city|commune)/i)
    .map((item) => ({ ...item, city: normalizeText(item.value) }))
    .filter((item) => item.city);

  return {
    siret: siretCandidates[0]?.siret || null,
    siretPath: siretCandidates[0]?.path || null,

    offerNafCode: nafCandidates[0]?.naf || null,
    offerNafPath: nafCandidates[0]?.path || null,

    offerPostalCode: postalCandidates[0]?.postalCode || null,
    offerPostalPath: postalCandidates[0]?.path || null,

    offerCity: cityCandidates[0]?.city || null,
    offerCityPath: cityCandidates[0]?.path || null,
  };
}

async function fetchInseeSiret(siret) {
  const url = `https://api.insee.fr/api-sirene/3.11/siret/${encodeURIComponent(siret)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "X-INSEE-Api-Key-Integration": INSEE_API_KEY,
    },
  });

  const text = await response.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const error = new Error(`INSEE HTTP ${response.status}`);
    error.status = response.status;
    error.body = json;
    throw error;
  }

  return json;
}

function mapInseeEtablissement(payload, siret) {
  const e = payload?.etablissement || payload;

  const adresse = e?.adresseEtablissement || {};
  const unite = e?.uniteLegale || {};

  const postalCode = normalizeText(adresse.codePostalEtablissement);
  const city =
    normalizeText(adresse.libelleCommuneEtablissement) ||
    normalizeText(adresse.libelleCommuneEtrangerEtablissement);

  const inseeNafCode =
    cleanNaf(e?.activitePrincipaleEtablissement) ||
    cleanNaf(unite?.activitePrincipaleUniteLegale);

  const active =
    e?.etatAdministratifEtablissement === "A" ||
    unite?.etatAdministratifUniteLegale === "A";

  return {
    siret,
    siren: siret.slice(0, 9),

    active,
    etatAdministratifEtablissement: e?.etatAdministratifEtablissement || null,
    dateCreationEtablissement: e?.dateCreationEtablissement || null,
    dateDernierTraitementEtablissement: e?.dateDernierTraitementEtablissement || null,

    nafCode: inseeNafCode,
    activitePrincipaleEtablissement: e?.activitePrincipaleEtablissement || null,

    postalCode,
    city,
    departmentCode: getDepartmentFromPostalCode(postalCode),

    codeCommuneEtablissement: adresse.codeCommuneEtablissement || null,
    libelleCommuneEtablissement: adresse.libelleCommuneEtablissement || null,

    denominationUniteLegale: unite.denominationUniteLegale || null,
    nomUniteLegale: unite.nomUniteLegale || null,
    prenom1UniteLegale: unite.prenom1UniteLegale || null,
    categorieJuridiqueUniteLegale: unite.categorieJuridiqueUniteLegale || null,
    trancheEffectifsEtablissement: e?.trancheEffectifsEtablissement || null,

    source: "api-sirene-insee-3.11",
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: "inseeEstablishments.v1",
  };
}

function compareOfferWithInsee(identity, inseeDoc) {
  const offerSiret = cleanSiret(identity.siret);
  const inseeSiret = cleanSiret(inseeDoc.siret);

  const offerNaf = cleanNaf(identity.offerNafCode);
  const inseeNaf = cleanNaf(inseeDoc.nafCode);

  const offerDepartment = getDepartmentFromPostalCode(identity.offerPostalCode);
  const inseeDepartment = inseeDoc.departmentCode || getDepartmentFromPostalCode(inseeDoc.postalCode);

  let siretMatchStatus = "missing_siret";
  if (offerSiret && inseeSiret && offerSiret === inseeSiret && inseeDoc.active) {
    siretMatchStatus = "matched_active";
  } else if (offerSiret && inseeSiret && offerSiret === inseeSiret && !inseeDoc.active) {
    siretMatchStatus = "matched_closed";
  } else if (offerSiret && !inseeSiret) {
    siretMatchStatus = "unmatched";
  }

  let nafMatchStatus = "naf_missing";
  if (offerNaf && inseeNaf && offerNaf === inseeNaf) {
    nafMatchStatus = "naf_exact_match";
  } else if (offerNaf && inseeNaf && offerNaf.slice(0, 2) === inseeNaf.slice(0, 2)) {
    nafMatchStatus = "naf_same_division";
  } else if (offerNaf && inseeNaf) {
    nafMatchStatus = "naf_mismatch";
  } else if (!offerNaf && inseeNaf) {
    nafMatchStatus = "naf_missing_offer";
  } else if (offerNaf && !inseeNaf) {
    nafMatchStatus = "naf_missing_insee";
  }

  let geoMatchStatus = "geo_missing";
  if (offerDepartment && inseeDepartment && offerDepartment === inseeDepartment) {
    geoMatchStatus = "same_department";
  } else if (offerDepartment && inseeDepartment) {
    geoMatchStatus = "geo_mismatch";
  } else if (!offerDepartment && inseeDepartment) {
    geoMatchStatus = "offer_location_missing";
  } else if (offerDepartment && !inseeDepartment) {
    geoMatchStatus = "insee_location_missing";
  }

  const score =
    (siretMatchStatus === "matched_active" ? 0.5 : 0) +
    (nafMatchStatus === "naf_exact_match" ? 0.25 : nafMatchStatus === "naf_same_division" ? 0.15 : 0) +
    (geoMatchStatus === "same_department" ? 0.25 : 0);

  return {
    siretMatchStatus,
    nafMatchStatus,
    geoMatchStatus,
    dataConfidenceScore: Number(score.toFixed(2)),
    offerDepartmentCode: offerDepartment,
    inseeDepartmentCode: inseeDepartment,
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("===== INSEE ENRICH FROM jobOfferDetails =====");
  console.log("LIMIT:", LIMIT);
  console.log("WRITE:", WRITE);

  const snap = await db.collection("jobOfferDetails")
    .where("detailFetchStatus", "==", "ok")
    .limit(LIMIT * 3)
    .get();

  const bySiret = new Map();

  snap.docs.forEach((doc) => {
    const detail = doc.data();
    const identity = extractOfferIdentity(detail);

    if (!identity.siret) return;

    if (!bySiret.has(identity.siret)) {
      bySiret.set(identity.siret, {
        siret: identity.siret,
        offerIds: [],
        sampleOfferIdentity: identity,
      });
    }

    bySiret.get(identity.siret).offerIds.push(doc.id);
  });

  const targets = Array.from(bySiret.values()).slice(0, LIMIT);

  console.log("jobOfferDetails scannes:", snap.size);
  console.log("SIRET distincts trouves:", bySiret.size);
  console.log("SIRET appeles:", targets.length);

  let success = 0;
  let errors = 0;
  let linkedOffers = 0;

  for (const target of targets) {
    const { siret, sampleOfferIdentity, offerIds } = target;

    try {
      const existing = await db.collection("inseeEstablishments").doc(siret).get();

      let inseeDoc;
      if (existing.exists) {
        inseeDoc = existing.data();
        console.log("CACHE", siret, inseeDoc.departmentCode, inseeDoc.nafCode, inseeDoc.active);
      } else {
        const payload = await fetchInseeSiret(siret);
        inseeDoc = mapInseeEtablissement(payload, siret);

        console.log("INSEE", siret, {
          active: inseeDoc.active,
          departmentCode: inseeDoc.departmentCode,
          postalCode: inseeDoc.postalCode,
          city: inseeDoc.city,
          nafCode: inseeDoc.nafCode,
        });

        if (WRITE) {
          await db.collection("inseeEstablishments").doc(siret).set(inseeDoc, { merge: true });
        }

        await sleep(500);
      }

      for (const offerId of offerIds) {
        const check = compareOfferWithInsee(sampleOfferIdentity, inseeDoc);

        if (WRITE) {
          await db.collection("jobOfferDetails").doc(offerId).set({
            insee: {
              matched: true,
              siret,
              siren: siret.slice(0, 9),
              active: inseeDoc.active,
              nafCode: inseeDoc.nafCode,
              postalCode: inseeDoc.postalCode,
              city: inseeDoc.city,
              departmentCode: inseeDoc.departmentCode,
              source: "api-sirene-insee-3.11",
              checkedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            checks: {
              ...(check || {}),
              checkedAt: admin.firestore.FieldValue.serverTimestamp(),
              schemaVersion: "jobOfferDetails.inseeChecks.v1",
            },
          }, { merge: true });
        }

        linkedOffers += 1;
      }

      success += 1;
    } catch (error) {
      errors += 1;
      console.log("ERROR", siret, error.status || null, error.message, error.body || "");
    }
  }

  await db.collection("apiImports").doc("insee_from_job_offer_details_latest").set({
    type: "insee_from_job_offer_details",
    scannedJobOfferDetails: snap.size,
    distinctSiretFound: bySiret.size,
    calledSiretCount: targets.length,
    successCount: success,
    errorCount: errors,
    linkedOffersCount: linkedOffers,
    write: WRITE,
    finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: "insee_from_job_offer_details.v1",
  }, { merge: true });

  console.log("===== RESULT =====");
  console.log({
    scannedJobOfferDetails: snap.size,
    distinctSiretFound: bySiret.size,
    calledSiretCount: targets.length,
    success,
    errors,
    linkedOffers,
    write: WRITE,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
