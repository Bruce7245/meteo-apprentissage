const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

function resolveProjectId() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;

  const firebasercPath = path.join(__dirname, "..", ".firebaserc");
  const config = JSON.parse(fs.readFileSync(firebasercPath, "utf8"));

  return config.projects.default;
}

const projectId = resolveProjectId();

if (!admin.apps.length) {
  admin.initializeApp({
    projectId,
  });
}

const db = admin.firestore();

function get(obj, pathName) {
  return pathName.split(".").reduce((acc, key) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, key)) return acc[key];
    return undefined;
  }, obj);
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

async function main() {
  const date = process.argv[2] || "2026-07-05";
  const department = process.argv[3] || "72";
  const limit = Number(process.argv[4] || 20);

  console.log("PROJECT_ID:", projectId);
  console.log("DATE:", date);
  console.log("DEPARTMENT:", department);
  console.log("LIMIT:", limit);

  const depRef = db
    .collection("dailyOfferSnapshots")
    .doc(date)
    .collection("departments")
    .doc(department);

  const depSnap = await depRef.get();

  if (!depSnap.exists) {
    console.error("Snapshot introuvable", { date, department });
    process.exit(1);
  }

  const activeRunId = depSnap.data().activeRunId;
  console.log("ACTIVE_RUN_ID:", activeRunId);

  const snap = await depRef
    .collection("offers")
    .where("runId", "==", activeRunId)
    .limit(limit)
    .get();

  const paths = [
    "raw.workplace.location",
    "raw.workplace.location.address",
    "raw.workplace.location.address.city",
    "raw.workplace.location.address.zipcode",
    "raw.workplace.location.address.postal_code",
    "raw.workplace.location.city",
    "raw.workplace.location.zipcode",
    "raw.workplace.location.postal_code",
    "raw.place",
    "raw.place.city",
    "raw.place.zipcode",
    "raw.place.postal_code",
    "raw.offer.place",
    "raw.offer.place.city",
    "raw.offer.place.zipcode",
    "raw.offer.place.postal_code",
    "raw.workplace.domain",
    "raw.workplace.domain.naf",
    "raw.workplace.domain.naf.code",
    "raw.workplace.domain.naf.label",
    "raw.workplace.siret",
    "raw.workplace.name",
    "raw.company",
    "raw.company.naf",
    "raw.nafs",
    "raw.offer.rome_codes",
    "raw.publication",
    "raw.contract"
  ];

  for (const doc of snap.docs) {
    const data = doc.data();

    console.log("\n==================================================");
    console.log("DOC:", doc.id);
    console.log("TITLE:", data.title);
    console.log("COMPANY:", data.companyName);
    console.log("CITY_NORMALIZED:", data.city);
    console.log("POSTAL_NORMALIZED:", data.postalCode);
    console.log("NAF_NORMALIZED:", data.nafCode, data.nafLabel);
    console.log("SECTOR_NORMALIZED:", data.sectorCode, data.sectorLabel);
    console.log("PARTNER:", data.partnerLabel);
    console.log("ROME:", JSON.stringify(data.romeCodes || []));

    for (const pathName of paths) {
      const value = get(data, pathName);

      if (value !== undefined) {
        console.log("\nPATH:", pathName);
        console.log("TYPE:", typeOf(value));
        console.log(JSON.stringify(value, null, 2).slice(0, 1800));
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
