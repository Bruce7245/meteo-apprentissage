import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const CATALOGUE_API_BASE =
  process.env.CATALOGUE_API_BASE ||
  "https://catalogue.apprentissage.education.gouv.fr/api/v1";

const PAGE_LIMIT = Number(process.env.PAGE_LIMIT || 1000);
const DRY_RUN = process.env.DRY_RUN === "1";

const wantedDepartments = process.argv
  .slice(2)
  .map((value) => String(value).padStart(2, "0"))
  .filter(Boolean);

if (wantedDepartments.length === 0) {
  console.error("Usage : node scripts/import-lba-formations.mjs 72");
  console.error("Ou plusieurs départements : node scripts/import-lba-formations.mjs 36 37 38 39 40 41 42 43 44 45");
  process.exit(1);
}

if (!DRY_RUN) {
  admin.initializeApp();
}

const db = DRY_RUN ? null : getFirestore();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeText(value) {
  return safeString(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactObject(value) {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map(compactObject).filter((item) => item !== undefined && item !== "");
  }

  const output = {};

  for (const [key, item] of Object.entries(value)) {
    const cleaned = compactObject(item);

    if (
      cleaned !== undefined &&
      cleaned !== null &&
      cleaned !== "" &&
      !(Array.isArray(cleaned) && cleaned.length === 0) &&
      !(typeof cleaned === "object" && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0)
    ) {
      output[key] = cleaned;
    }
  }

  return output;
}

function deepValues(value, results = []) {
  if (value === null || value === undefined) return results;

  if (typeof value === "string" || typeof value === "number") {
    results.push(String(value));
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) deepValues(item, results);
    return results;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) deepValues(item, results);
  }

  return results;
}

function findFirstByKeyName(value, candidates) {
  if (!value || typeof value !== "object") return null;

  const candidateSet = new Set(candidates.map((item) => item.toLowerCase()));

  function walk(node) {
    if (!node || typeof node !== "object") return null;

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }

    for (const [key, item] of Object.entries(node)) {
      if (candidateSet.has(key.toLowerCase())) {
        const text = safeString(item);
        if (text) return text;
      }

      const found = walk(item);
      if (found) return found;
    }

    return null;
  }

  return walk(value);
}

function extractRncp(raw) {
  const explicit = findFirstByKeyName(raw, [
    "rncp",
    "code_rncp",
    "rncp_code",
    "numero_rncp",
  ]);

  if (explicit) {
    const match = safeString(explicit).match(/RNCP\s*\d+/i) || safeString(explicit).match(/\d{3,6}/);
    if (match) return match[0].toUpperCase().startsWith("RNCP") ? match[0].toUpperCase() : `RNCP${match[0]}`;
  }

  const allText = deepValues(raw).join(" ");
  const match = allText.match(/RNCP\s*\d+/i);
  return match ? match[0].replace(/\s+/g, "").toUpperCase() : null;
}

function extractCfd(raw) {
  const explicit = findFirstByKeyName(raw, [
    "cfd",
    "code_cfd",
    "cfd_code",
    "code_formation_diplome",
  ]);

  if (explicit) {
    const match = safeString(explicit).match(/\b\d{8}\b/);
    if (match) return match[0];
  }

  const allText = deepValues(raw).join(" ");
  const match = allText.match(/\b\d{8}\b/);
  return match ? match[0] : null;
}

function extractPostalCode(raw) {
  const explicit = findFirstByKeyName(raw, [
    "code_postal",
    "postal_code",
    "cp",
    "etablissement_formateur_code_postal",
    "etablissement_gestionnaire_code_postal",
  ]);

  if (explicit) {
    const match = safeString(explicit).match(/\b\d{5}\b/);
    if (match) return match[0];
  }

  const allText = deepValues(raw).join(" ");
  const match = allText.match(/\b\d{5}\b/);
  return match ? match[0] : null;
}

function extractDepartment(raw) {
  const postalCode = extractPostalCode(raw);
  if (!postalCode) return null;

  if (postalCode.startsWith("97") || postalCode.startsWith("98")) {
    return postalCode.slice(0, 3);
  }

  return postalCode.slice(0, 2);
}

function extractTitle(raw) {
  return (
    findFirstByKeyName(raw, [
      "intitule_long",
      "intitule_court",
      "onisep_intitule",
      "intitule",
      "libelle",
      "title",
    ]) || "Formation sans intitulé"
  );
}

function extractFormationId(raw) {
  return (
    safeString(raw._id) ||
    safeString(raw.id) ||
    safeString(raw.identifiant) ||
    safeString(raw.cle_ministere_educatif) ||
    safeString(raw.cleMinistereEducatif) ||
    null
  );
}

function extractSiret(raw) {
  return findFirstByKeyName(raw, [
    "siret",
    "etablissement_formateur_siret",
    "etablissement_gestionnaire_siret",
  ]);
}

function extractUai(raw) {
  return findFirstByKeyName(raw, [
    "uai",
    "etablissement_formateur_uai",
    "etablissement_gestionnaire_uai",
  ]);
}

function extractCity(raw) {
  return findFirstByKeyName(raw, [
    "commune",
    "ville",
    "localite",
    "etablissement_formateur_commune",
    "etablissement_gestionnaire_commune",
  ]);
}

function extractLatitude(raw) {
  const explicit = findFirstByKeyName(raw, [
    "latitude",
    "lat",
  ]);

  const value = Number(explicit);
  return Number.isFinite(value) ? value : null;
}

function extractLongitude(raw) {
  const explicit = findFirstByKeyName(raw, [
    "longitude",
    "lon",
    "lng",
  ]);

  const value = Number(explicit);
  return Number.isFinite(value) ? value : null;
}

function extractStartDate(raw) {
  return findFirstByKeyName(raw, [
    "debut",
    "date_debut",
    "session_debut",
    "start_date",
  ]);
}

function extractEndDate(raw) {
  return findFirstByKeyName(raw, [
    "fin",
    "date_fin",
    "session_fin",
    "end_date",
  ]);
}

function extractCapacity(raw) {
  const explicit = findFirstByKeyName(raw, [
    "capacite",
    "session_capacite",
    "capacity",
  ]);

  const value = Number(explicit);
  return Number.isFinite(value) ? value : null;
}

function normalizeFormation(raw) {
  const formationId = extractFormationId(raw);
  const rncp = extractRncp(raw);
  const cfd = extractCfd(raw);
  const title = extractTitle(raw);
  const postalCode = extractPostalCode(raw);
  const department = extractDepartment(raw);
  const siret = extractSiret(raw);
  const uai = extractUai(raw);
  const city = extractCity(raw);

  const masterId =
    rncp ||
    (cfd ? `CFD${cfd}` : null) ||
    `TITLE_${normalizeText(title).replaceAll(" ", "_").slice(0, 90)}`;

  const sessionIdSource = [
    formationId,
    rncp,
    cfd,
    siret,
    uai,
    postalCode,
    normalizeText(title),
  ]
    .filter(Boolean)
    .join("_");

  const sessionId = sessionIdSource
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 400);

  return {
    masterId,
    sessionId,

    master: compactObject({
      rncp,
      cfd,
      title,
      normalizedTitle: normalizeText(title),
      source: {
        laBonneAlternance: true,
        catalogueApprentissage: true,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }),

    session: compactObject({
      formationId,
      masterId,
      rncp,
      cfd,
      title,
      normalizedTitle: normalizeText(title),

      source: "catalogue_apprentissage_lba",
      rawSource: "catalogue.apprentissage.education.gouv.fr",

      location: {
        department,
        postalCode,
        city,
        latitude: extractLatitude(raw),
        longitude: extractLongitude(raw),
      },

      organism: {
        siret,
        uai,
        name: findFirstByKeyName(raw, [
          "raison_sociale",
          "nom",
          "etablissement_formateur_raison_sociale",
          "etablissement_gestionnaire_raison_sociale",
        ]),
      },

      session: {
        startDate: extractStartDate(raw),
        endDate: extractEndDate(raw),
        capacity: extractCapacity(raw),
      },

      raw,

      importedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  };
}

async function fetchCataloguePage(page) {
  const url = new URL(`${CATALOGUE_API_BASE}/entity/formations`);

  const payload = {
    query: JSON.stringify({}),
    page,
    limit: PAGE_LIMIT,
  };

  url.searchParams.set("payload", JSON.stringify(payload));

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url);

    if (response.ok) {
      return response.json();
    }

    const body = await response.text();

    if (attempt === 3) {
      throw new Error(`Erreur API catalogue page=${page} status=${response.status} body=${body.slice(0, 500)}`);
    }

    await sleep(700 * attempt);
  }
}

async function commitBatch(items) {
  if (DRY_RUN) return;

  let batch = db.batch();
  let count = 0;

  for (const item of items) {
    const masterRef = db.collection("formations_master").doc(item.masterId);
    const sessionRef = db.collection("formation_sessions").doc(item.sessionId);

    batch.set(masterRef, item.master, { merge: true });
    batch.set(sessionRef, item.session, { merge: true });

    count += 2;

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

async function main() {
  console.log("==================================================");
  console.log("IMPORT FORMATIONS LA BONNE ALTERNANCE / CATALOGUE");
  console.log("==================================================");
  console.log(`Départements ciblés : ${wantedDepartments.join(", ")}`);
  console.log(`Mode test : ${DRY_RUN ? "oui" : "non"}`);
  console.log("");

  let page = 1;
  let totalRead = 0;
  let totalKept = 0;
  let totalWritten = 0;
  let totalWithoutDepartment = 0;
  let totalWithoutRncp = 0;

  while (true) {
    const data = await fetchCataloguePage(page);

    const formations = Array.isArray(data.formations)
      ? data.formations
      : Array.isArray(data.results)
        ? data.results
        : Array.isArray(data)
          ? data
          : [];

    if (formations.length === 0) {
      console.log(`Page ${page} vide, fin.`);
      break;
    }

    totalRead += formations.length;

    const normalized = [];

    for (const raw of formations) {
      const department = extractDepartment(raw);

      if (!department) {
        totalWithoutDepartment++;
        continue;
      }

      if (!wantedDepartments.includes(department)) {
        continue;
      }

      const item = normalizeFormation(raw);

      if (!item.session.rncp) {
        totalWithoutRncp++;
      }

      normalized.push(item);
    }

    totalKept += normalized.length;

    await commitBatch(normalized);
    totalWritten += normalized.length;

    const pagination = data.pagination || {};
    const totalPages = Number(pagination.nombre_de_page || pagination.totalPages || 0);

    console.log(
      `Page ${page} | reçus=${formations.length} | gardés=${normalized.length} | totalGardés=${totalKept} | totalLus=${totalRead}`
    );

    if (totalPages && page >= totalPages) {
      break;
    }

    if (formations.length < PAGE_LIMIT) {
      break;
    }

    page++;
    await sleep(250);
  }

  console.log("");
  console.log("==================================================");
  console.log("RÉSUMÉ IMPORT FORMATIONS");
  console.log("==================================================");
  console.log(`Total lus : ${totalRead}`);
  console.log(`Total gardés : ${totalKept}`);
  console.log(`Total écrits : ${DRY_RUN ? 0 : totalWritten}`);
  console.log(`Sans département détecté : ${totalWithoutDepartment}`);
  console.log(`Sans RNCP détecté : ${totalWithoutRncp}`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

