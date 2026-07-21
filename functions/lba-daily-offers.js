const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const API_APPRENTISSAGE_TOKEN = defineSecret("API_APPRENTISSAGE_TOKEN");
const BACKFILL_ADMIN_KEY = defineSecret("BACKFILL_ADMIN_KEY");

const REGION = "europe-west1";
const LBA_API_BASE = process.env.LBA_API_BASE || "https://api.apprentissage.beta.gouv.fr/api";

const DEPARTMENT_CODES = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "2A", "2B",
  "21", "22", "23", "24", "25", "26", "27", "28", "29",
  "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
  "40", "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "50", "51", "52", "53", "54", "55", "56", "57", "58", "59",
  "60", "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "70", "71", "72", "73", "74", "75", "76", "77", "78", "79",
  "80", "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "90", "91", "92", "93", "94", "95",
  "971", "972", "973", "974", "976"
];

function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function todayParis() {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\s+/g, " ").trim() || null;
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function dateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getNested(obj, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((acc, key) => {
      if (acc && Object.prototype.hasOwnProperty.call(acc, key)) return acc[key];
      return undefined;
    }, obj);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}



function departmentFromPostalCode(postalCode) {
  const code = cleanText(postalCode);

  if (!code) return null;

  if (/^97[1-8]\d{2}$/.test(code)) {
    return code.slice(0, 3);
  }

  if (/^98\d{3}$/.test(code)) {
    return code.slice(0, 3);
  }

  if (/^20\d{3}$/.test(code)) {
    return "20";
  }

  if (/^\d{5}$/.test(code)) {
    return code.slice(0, 2);
  }

  return null;
}

function normalizeDepartmentForPostalCompare(departmentCode) {
  const code = cleanText(departmentCode);

  if (!code) return null;
  if (code === "2A" || code === "2B") return "20";

  return code;
}

function buildLocationQuality(postalCode, departmentCode) {
  const effectiveDepartmentCode = departmentFromPostalCode(postalCode);
  const requestedDepartmentCode = normalizeDepartmentForPostalCompare(departmentCode);

  if (!postalCode || !effectiveDepartmentCode) {
    return {
      effectiveDepartmentCode,
      locationQuality: "unknown_postal_code",
      isInRequestedDepartment: null,
    };
  }

  const isInRequestedDepartment = effectiveDepartmentCode === requestedDepartmentCode;

  return {
    effectiveDepartmentCode,
    locationQuality: isInRequestedDepartment ? "in_department" : "out_of_department",
    isInRequestedDepartment,
  };
}

function parseFrenchAddressText(value) {
  const text = cleanText(value);

  if (!text) {
    return {
      address: null,
      postalCode: null,
      city: null,
    };
  }

  const match = text.match(/\b((?:0[1-9]|[1-8]\d|9[0-8])\d{3}|2A\d{3}|2B\d{3}|97[1-8]\d{2})\b\s*(.*)$/i);

  if (!match) {
    return {
      address: text,
      postalCode: null,
      city: null,
    };
  }

  return {
    address: text,
    postalCode: cleanText(match[1]),
    city: cleanText(match[2]),
  };
}

function sectorFromRomeCodes(romeCodes) {
  const firstRome = safeArray(romeCodes).map(cleanText).find(Boolean);

  if (!firstRome) {
    return {
      code: "inconnu",
      label: "Inconnu",
    };
  }

  const firstLetter = firstRome.slice(0, 1).toUpperCase();

  const map = {
    A: { code: "agriculture", label: "Agriculture / pêche / animalier" },
    B: { code: "culture_sport_loisirs", label: "Culture / artisanat / loisirs" },
    C: { code: "banque_assurance", label: "Banque / assurance / immobilier" },
    D: { code: "commerce_vente", label: "Commerce / vente" },
    E: { code: "numerique_information", label: "Communication / média / numérique" },
    F: { code: "construction_btp", label: "Construction / BTP" },
    G: { code: "restauration_tourisme_loisirs", label: "Hôtellerie / restauration / tourisme" },
    H: { code: "industrie", label: "Industrie / production" },
    I: { code: "industrie", label: "Installation / maintenance" },
    J: { code: "sante_social", label: "Santé / soins" },
    K: { code: "sante_social", label: "Services à la personne / social" },
    L: { code: "culture_sport_loisirs", label: "Spectacle / culture / loisirs" },
    M: { code: "services_entreprises", label: "Services aux entreprises" },
    N: { code: "transport_logistique", label: "Transport / logistique" },
  };

  return map[firstLetter] || {
    code: "inconnu",
    label: "Inconnu",
  };
}

function normalizeNaf(raw) {
  if (!raw) return { code: null, label: null };

  if (typeof raw === "string") {
    return { code: raw.trim() || null, label: null };
  }

  return {
    code: cleanText(raw.code || raw.id || raw.naf_code || raw.naf || raw.value),
    label: cleanText(raw.label || raw.libelle || raw.name || raw.intitule),
  };
}

function inferSectorFromNaf(nafCode) {
  const code = cleanText(nafCode);
  if (!code) return { code: "inconnu", label: "Inconnu" };

  const division = Number.parseInt(code.slice(0, 2), 10);
  if (!Number.isFinite(division)) return { code: "inconnu", label: "Inconnu" };

  if (division >= 1 && division <= 3) return { code: "agriculture", label: "Agriculture / pêche" };
  if (division >= 5 && division <= 9) return { code: "industrie_extractive", label: "Industrie extractive" };
  if (division >= 10 && division <= 33) return { code: "industrie", label: "Industrie / production" };
  if (division === 35) return { code: "energie", label: "Énergie" };
  if (division >= 36 && division <= 39) return { code: "eau_dechets", label: "Eau / déchets / dépollution" };
  if (division >= 41 && division <= 43) return { code: "construction_btp", label: "Construction / BTP" };
  if (division >= 45 && division <= 47) return { code: "commerce_vente", label: "Commerce / vente" };
  if (division >= 49 && division <= 53) return { code: "transport_logistique", label: "Transport / logistique" };
  if (division >= 55 && division <= 56) return { code: "restauration_tourisme_loisirs", label: "Hôtellerie / restauration / tourisme" };
  if (division >= 58 && division <= 63) return { code: "numerique_information", label: "Numérique / information / communication" };
  if (division >= 64 && division <= 66) return { code: "banque_assurance", label: "Banque / assurance" };
  if (division === 68) return { code: "immobilier", label: "Immobilier" };
  if (division >= 69 && division <= 75) return { code: "services_entreprises", label: "Services aux entreprises" };
  if (division >= 77 && division <= 82) return { code: "services_support", label: "Services administratifs / support" };
  if (division === 84) return { code: "administration_publique", label: "Administration publique" };
  if (division === 85) return { code: "enseignement_formation", label: "Enseignement / formation" };
  if (division >= 86 && division <= 88) return { code: "sante_social", label: "Santé / social" };
  if (division >= 90 && division <= 93) return { code: "culture_sport_loisirs", label: "Culture / sport / loisirs" };
  if (division >= 94 && division <= 96) return { code: "services_personnes", label: "Services aux personnes / associations" };

  return { code: "autres", label: "Autres activités" };
}

function stableOfferId(job) {
  const identifier = job.identifier || {};
  const partnerLabel = cleanText(identifier.partner_label) || "unknown";
  const partnerJobId = cleanText(identifier.partner_job_id) || cleanText(identifier.id) || JSON.stringify(job).slice(0, 500);

  const base = `${partnerLabel}:${partnerJobId}`;
  let hash = 0;

  for (let i = 0; i < base.length; i += 1) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }

  const positiveHash = Math.abs(hash).toString(36);
  return `${partnerLabel.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60)}_${positiveHash}`;
}

function normalizeOffer(job, departmentCode, date, runId) {
  const identifier = job.identifier || {};
  const workplace = job.workplace || {};
  const location = workplace.location || job.location || {};
  const address = location.address || {};
  const domain = workplace.domain || {};
  const offer = job.offer || {};
  const contract = job.contract || {};
  const publication = job.publication || {};
  const apply = job.apply || {};

  const naf = normalizeNaf(domain.naf);
  const openingCount = Math.max(1, toInt(offer.opening_count, 1));
  const romeCodes = safeArray(offer.rome_codes).map(cleanText).filter(Boolean);

  const nafSector = inferSectorFromNaf(naf.code);
  const romeSector = sectorFromRomeCodes(romeCodes);
  const sector = nafSector.code !== "inconnu" ? nafSector : romeSector;

  const addressObject = address && typeof address === "object" && !Array.isArray(address) ? address : {};
  const parsedAddress = parseFrenchAddressText(typeof address === "string" ? address : null);
  const parsedLocationAddress = parseFrenchAddressText(typeof location.address === "string" ? location.address : null);

  const postalCode = cleanText(
    addressObject.zipcode ||
    addressObject.postcode ||
    addressObject.postal_code ||
    location.zipcode ||
    location.postcode ||
    location.postal_code ||
    parsedAddress.postalCode ||
    parsedLocationAddress.postalCode
  );

  const city = cleanText(
    addressObject.city ||
    addressObject.commune ||
    location.city ||
    location.commune ||
    location.label ||
    parsedAddress.city ||
    parsedLocationAddress.city
  );

  const addressLabel = cleanText(
    typeof address === "string"
      ? address
      : addressObject.label ||
        addressObject.street ||
        addressObject.full_address ||
        location.address_label ||
        parsedAddress.address ||
        parsedLocationAddress.address
  );

  const locationQuality = buildLocationQuality(postalCode, departmentCode);

  const creationDate = dateOnly(publication.creation);
  const expirationDate = dateOnly(publication.expiration);
  const contractStartDate = dateOnly(contract.start);

  return {
    runId,
    date,
    departmentCode,
    offerDocId: stableOfferId(job),

    partnerLabel: cleanText(identifier.partner_label),
    partnerJobId: cleanText(identifier.partner_job_id),
    lbaId: cleanText(identifier.id),

    title: cleanText(offer.title),
    description: cleanText(offer.description),
    status: cleanText(offer.status),
    targetDiploma: cleanText(offer.target_diploma),
    openingCount,
    romeCodes,

    publicationCreation: publication.creation || null,
    publicationCreationDate: creationDate,
    publicationExpiration: publication.expiration || null,
    publicationExpirationDate: expirationDate,
    isCreatedToday: creationDate === date,

    contractStart: contract.start || null,
    contractStartDate,
    contractDuration: contract.duration ?? null,
    contractTypes: safeArray(contract.type).map(cleanText).filter(Boolean),
    remote: cleanText(contract.remote),

    companyName: cleanText(workplace.name),
    companyBrand: cleanText(workplace.brand),
    companyLegalName: cleanText(workplace.legal_name),
    siret: cleanText(workplace.siret),
    companySize: cleanText(workplace.size),
    companyWebsite: cleanText(workplace.website),

    city,
    postalCode,
    address: addressLabel,
    effectiveDepartmentCode: locationQuality.effectiveDepartmentCode,
    locationQuality: locationQuality.locationQuality,
    isInRequestedDepartment: locationQuality.isInRequestedDepartment,
    geopoint: getNested(location, ["geopoint", "geo_point", "coordinates"]),

    nafCode: naf.code,
    nafLabel: naf.label,
    sectorCode: sector.code,
    sectorLabel: sector.label,
    idcc: cleanText(domain.idcc),
    opco: cleanText(domain.opco),

    applyUrl: cleanText(apply.url),
    applyPhone: cleanText(apply.phone),
    applyRecipientId: cleanText(apply.recipient_id),

    raw: job,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function addStat(map, key, label, openingCount) {
  const safeKey = cleanText(key) || "inconnu";
  const safeLabel = cleanText(label) || safeKey;

  if (!map.has(safeKey)) {
    map.set(safeKey, {
      code: safeKey,
      label: safeLabel,
      offers: 0,
      openings: 0,
    });
  }

  const row = map.get(safeKey);
  row.offers += 1;
  row.openings += openingCount;
}

function toSortedArray(map, max = 100) {
  return Array.from(map.values())
    .sort((a, b) => b.openings - a.openings || b.offers - a.offers || String(a.label).localeCompare(String(b.label)))
    .slice(0, max);
}

function buildSummary(offers, rawJobs) {
  const bySector = new Map();
  const byRome = new Map();
  const byNaf = new Map();
  const byPartner = new Map();
  const byCommune = new Map();

  let totalOpenings = 0;
  let newTodayOffers = 0;
  let newTodayOpenings = 0;

  const locationQuality = {
    inDepartment: { offers: 0, openings: 0 },
    outOfDepartment: { offers: 0, openings: 0 },
    unknownPostalCode: { offers: 0, openings: 0 },
  };

  for (const offer of offers) {
    totalOpenings += offer.openingCount;

    if (offer.isCreatedToday) {
      newTodayOffers += 1;
      newTodayOpenings += offer.openingCount;
    }

    if (offer.locationQuality === "in_department") {
      locationQuality.inDepartment.offers += 1;
      locationQuality.inDepartment.openings += offer.openingCount;
    } else if (offer.locationQuality === "out_of_department") {
      locationQuality.outOfDepartment.offers += 1;
      locationQuality.outOfDepartment.openings += offer.openingCount;
    } else {
      locationQuality.unknownPostalCode.offers += 1;
      locationQuality.unknownPostalCode.openings += offer.openingCount;
    }

    addStat(bySector, offer.sectorCode, offer.sectorLabel, offer.openingCount);
    addStat(byPartner, offer.partnerLabel, offer.partnerLabel, offer.openingCount);
    addStat(byCommune, offer.city || offer.postalCode, offer.city || offer.postalCode, offer.openingCount);

    if (offer.nafCode) {
      addStat(byNaf, offer.nafCode, offer.nafLabel || offer.nafCode, offer.openingCount);
    }

    for (const rome of offer.romeCodes) {
      addStat(byRome, rome, rome, offer.openingCount);
    }
  }

  const sourceCounts = rawJobs.reduce((acc, job) => {
    const partner = cleanText(job?.identifier?.partner_label) || "unknown";
    acc[partner] = (acc[partner] || 0) + 1;
    return acc;
  }, {});

  const saturatedSources = Object.entries(sourceCounts)
    .filter(([, count]) => count >= 145)
    .map(([partner, count]) => ({ partner, count }));

  return {
    totalOffers: offers.length,
    totalOpenings,
    newTodayOffers,
    newTodayOpenings,
    sourceCounts,
    saturatedSources,
    isPossiblySaturated: saturatedSources.length > 0,
    locationQuality,
    bySector: toSortedArray(bySector, 80),
    byRome: toSortedArray(byRome, 120),
    byNaf: toSortedArray(byNaf, 120),
    byPartner: toSortedArray(byPartner, 40),
    byCommune: toSortedArray(byCommune, 120),
  };
}

async function fetchLbaJson(url) {
  const token =
    (typeof API_APPRENTISSAGE_TOKEN.value === "function" ? API_APPRENTISSAGE_TOKEN.value() : "") ||
    process.env.API_APPRENTISSAGE_TOKEN ||
    "";

  const attempts = token
    ? [
        { Authorization: `Bearer ${token}` },
        { "X-API-Key": token },
        { "api-key": token },
      ]
    : [{}];

  let lastError = null;

  for (const authHeaders of attempts) {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authHeaders,
      },
    });

    if (response.ok) {
      return response.json();
    }

    const body = await response.text().catch(() => "");
    lastError = new Error(`LBA ${response.status}: ${body.slice(0, 500)}`);

    if (![401, 403].includes(response.status)) {
      throw lastError;
    }
  }

  throw lastError || new Error("Erreur inconnue API LBA");
}

async function fetchDepartmentJobs(departmentCode) {
  const url = new URL(`${LBA_API_BASE}/job/v1/search`);
  url.searchParams.append("departements", departmentCode);

  const data = await fetchLbaJson(url);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];

  return jobs;
}

async function commitOffers(departmentRef, offers) {
  let batch = db.batch();
  let count = 0;

  for (const offer of offers) {
    const ref = departmentRef.collection("offers").doc(offer.offerDocId);
    batch.set(ref, offer, { merge: true });
    count += 1;

    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }
}

async function importDepartment(date, departmentCode, runId) {
  const startedAt = new Date();

  const rawJobs = await fetchDepartmentJobs(departmentCode);

  const offers = rawJobs
    .filter((job) => cleanText(job?.identifier?.partner_label) !== "recruteurs_lba")
    .map((job) => normalizeOffer(job, departmentCode, date, runId));

  const summary = buildSummary(offers, rawJobs);
  const strictOffers = offers.filter((offer) => offer.locationQuality === "in_department");
  const strictSummary = buildSummary(strictOffers, rawJobs);

  const departmentRef = db
    .collection("dailyOfferSnapshots")
    .doc(date)
    .collection("departments")
    .doc(departmentCode);

  await departmentRef.set(
    {
      date,
      departmentCode,
      activeRunId: runId,
      importedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "la_bonne_alternance",
      sourceRoute: "/job/v1/search",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      rawJobsCount: rawJobs.length,
      storedOffersCount: offers.length,
      summary,
      strictSummary,
    },
    { merge: true }
  );

  await commitOffers(departmentRef, offers);

  return {
    departmentCode,
    rawJobsCount: rawJobs.length,
    storedOffersCount: offers.length,
    totalOpenings: summary.totalOpenings,
    newTodayOffers: summary.newTodayOffers,
    newTodayOpenings: summary.newTodayOpenings,
    isPossiblySaturated: summary.isPossiblySaturated,
    saturatedSources: summary.saturatedSources,
  };
}

function checkAdmin(req, res) {
  const expected =
    (typeof BACKFILL_ADMIN_KEY.value === "function" ? BACKFILL_ADMIN_KEY.value() : "") ||
    process.env.BACKFILL_ADMIN_KEY ||
    "";

  const provided = cleanText(req.query.key || req.headers["x-admin-key"]);

  if (!expected || provided !== expected) {
    res.status(403).json({ ok: false, error: "FORBIDDEN" });
    return false;
  }

  return true;
}

exports.backfillDailyOffers = onRequest(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [API_APPRENTISSAGE_TOKEN, BACKFILL_ADMIN_KEY],
  },
  async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (!checkAdmin(req, res)) return;

    const date = cleanText(req.query.date) || todayParis();
    const departmentParam = cleanText(req.query.department || req.query.departments);

    const departments = departmentParam
      ? departmentParam.split(",").map((d) => cleanText(d)).filter(Boolean)
      : DEPARTMENT_CODES;

    const runId = `${date}_${Date.now().toString(36)}`;

    const results = [];
    const errors = [];

    for (const departmentCode of departments) {
      try {
        logger.info("Import offres LBA département", { date, departmentCode, runId });
        const result = await importDepartment(date, departmentCode, runId);
        results.push(result);
      } catch (error) {
        logger.error("Erreur import offres LBA", {
          date,
          departmentCode,
          message: error.message,
        });

        errors.push({
          departmentCode,
          error: error.message,
        });
      }
    }

    res.json({
      ok: errors.length === 0,
      date,
      runId,
      departmentsRequested: departments.length,
      departmentsImported: results.length,
      results,
      errors,
    });
  }
);

exports.adminDailyOffers = onRequest(
  {
    region: REGION,
    timeoutSeconds: 120,
    memory: "512MiB",
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (!checkAdmin(req, res)) return;

    const date = cleanText(req.query.date) || todayParis();
    const departmentCode = cleanText(req.query.department);

    if (!departmentCode) {
      res.status(400).json({
        ok: false,
        error: "MISSING_DEPARTMENT",
      });
      return;
    }

    const sector = cleanText(req.query.sector);
    const rome = cleanText(req.query.rome);
    const naf = cleanText(req.query.naf);
    const geo = cleanText(req.query.geo);
    const limit = Math.min(Math.max(toInt(req.query.limit, 300), 1), 1000);

    const departmentRef = db
      .collection("dailyOfferSnapshots")
      .doc(date)
      .collection("departments")
      .doc(departmentCode);

    const departmentSnap = await departmentRef.get();

    if (!departmentSnap.exists) {
      res.status(404).json({
        ok: false,
        error: "SNAPSHOT_NOT_FOUND",
        date,
        departmentCode,
      });
      return;
    }

    const meta = departmentSnap.data();
    const activeRunId = meta.activeRunId;

    const offersSnap = await departmentRef
      .collection("offers")
      .where("runId", "==", activeRunId)
      .limit(limit)
      .get();

    let rows = offersSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        companyName: data.companyName,
        departmentCode: data.departmentCode,
        city: data.city,
        postalCode: data.postalCode,
        effectiveDepartmentCode: data.effectiveDepartmentCode,
        locationQuality: data.locationQuality,
        isInRequestedDepartment: data.isInRequestedDepartment,
        sectorCode: data.sectorCode,
        sectorLabel: data.sectorLabel,
        nafCode: data.nafCode,
        nafLabel: data.nafLabel,
        romeCodes: data.romeCodes || [],
        openingCount: data.openingCount,
        partnerLabel: data.partnerLabel,
        publicationCreationDate: data.publicationCreationDate,
        publicationExpirationDate: data.publicationExpirationDate,
        contractStartDate: data.contractStartDate,
        contractTypes: data.contractTypes || [],
        siret: data.siret,
        applyUrl: data.applyUrl,
      };
    });

    if (geo === "strict") {
      rows = rows.filter((row) => row.locationQuality === "in_department");
    } else if (geo === "issues") {
      rows = rows.filter((row) => row.locationQuality === "out_of_department" || row.locationQuality === "unknown_postal_code");
    } else if (geo) {
      rows = rows.filter((row) => row.locationQuality === geo);
    }

    if (sector) {
      rows = rows.filter((row) => row.sectorCode === sector);
    }

    if (rome) {
      rows = rows.filter((row) => Array.isArray(row.romeCodes) && row.romeCodes.includes(rome));
    }

    if (naf) {
      rows = rows.filter((row) => row.nafCode === naf);
    }

    rows.sort((a, b) => {
      return (
        Number(b.openingCount || 0) - Number(a.openingCount || 0) ||
        String(a.sectorLabel || "").localeCompare(String(b.sectorLabel || "")) ||
        String(a.title || "").localeCompare(String(b.title || ""))
      );
    });

    res.json({
      ok: true,
      date,
      departmentCode,
      activeRunId,
      summary: meta.summary || {},
      strictSummary: meta.strictSummary || {},
      rowsCount: rows.length,
      rows,
    });
  }
);

exports.adminNationalDailyOffers = onRequest(
  {
    region: REGION,
    timeoutSeconds: 180,
    memory: "512MiB",
    secrets: [BACKFILL_ADMIN_KEY],
  },
  async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (!checkAdmin(req, res)) return;

    const date = cleanText(req.query.date) || todayParis();

    const departmentsSnap = await db
      .collection("dailyOfferSnapshots")
      .doc(date)
      .collection("departments")
      .get();

    const departments = [];

    for (const doc of departmentsSnap.docs) {
      const data = doc.data();
      const summary = data.summary || {};
      const strictSummary = data.strictSummary || {};

      departments.push({
        departmentCode: doc.id,
        importedAt: data.importedAt || null,
        rawJobsCount: data.rawJobsCount || 0,
        storedOffersCount: data.storedOffersCount || 0,

        totalOffers: summary.totalOffers || 0,
        totalOpenings: summary.totalOpenings || 0,
        strictOffers: strictSummary.totalOffers || 0,
        strictOpenings: strictSummary.totalOpenings || 0,

        locationQuality: summary.locationQuality || null,
        isPossiblySaturated: !!summary.isPossiblySaturated,
        saturatedSources: summary.saturatedSources || [],

        topSector: Array.isArray(strictSummary.bySector) ? strictSummary.bySector[0] || null : null,
        topSectors: Array.isArray(strictSummary.bySector) ? strictSummary.bySector.slice(0, 8) : [],

        topCommune: Array.isArray(strictSummary.byCommune) ? strictSummary.byCommune[0] || null : null,
        topCommunes: Array.isArray(strictSummary.byCommune) ? strictSummary.byCommune.slice(0, 8) : [],

        topRome: Array.isArray(strictSummary.byRome) ? strictSummary.byRome.slice(0, 8) : [],
        topNaf: Array.isArray(strictSummary.byNaf) ? strictSummary.byNaf.slice(0, 8) : [],
      });
    }

    departments.sort((a, b) => String(a.departmentCode).localeCompare(String(b.departmentCode)));

    const totals = departments.reduce(
      (acc, dep) => {
        acc.departments += 1;
        acc.totalOffers += dep.totalOffers;
        acc.totalOpenings += dep.totalOpenings;
        acc.strictOffers += dep.strictOffers;
        acc.strictOpenings += dep.strictOpenings;

        acc.geo.inDepartmentOffers += dep.locationQuality?.inDepartment?.offers || 0;
        acc.geo.inDepartmentOpenings += dep.locationQuality?.inDepartment?.openings || 0;
        acc.geo.outOfDepartmentOffers += dep.locationQuality?.outOfDepartment?.offers || 0;
        acc.geo.outOfDepartmentOpenings += dep.locationQuality?.outOfDepartment?.openings || 0;
        acc.geo.unknownPostalCodeOffers += dep.locationQuality?.unknownPostalCode?.offers || 0;
        acc.geo.unknownPostalCodeOpenings += dep.locationQuality?.unknownPostalCode?.openings || 0;

        if (dep.isPossiblySaturated) {
          acc.saturatedDepartments += 1;
        }

        return acc;
      },
      {
        departments: 0,
        totalOffers: 0,
        totalOpenings: 0,
        strictOffers: 0,
        strictOpenings: 0,
        saturatedDepartments: 0,
        geo: {
          inDepartmentOffers: 0,
          inDepartmentOpenings: 0,
          outOfDepartmentOffers: 0,
          outOfDepartmentOpenings: 0,
          unknownPostalCodeOffers: 0,
          unknownPostalCodeOpenings: 0,
        },
      }
    );

    const strongestDepartments = [...departments]
      .sort((a, b) => b.strictOpenings - a.strictOpenings || b.strictOffers - a.strictOffers)
      .slice(0, 20);

    const weakestDepartments = [...departments]
      .filter((dep) => dep.strictOffers > 0)
      .sort((a, b) => a.strictOffers - b.strictOffers || a.strictOpenings - b.strictOpenings)
      .slice(0, 20);

    const saturatedDepartments = departments
      .filter((dep) => dep.isPossiblySaturated)
      .sort((a, b) => b.strictOffers - a.strictOffers);

    res.json({
      ok: true,
      date,
      totals,
      strongestDepartments,
      weakestDepartments,
      saturatedDepartments,
      departments,
    });
  }
);
