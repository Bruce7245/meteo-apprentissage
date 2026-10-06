const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.join(__dirname, "..", "index.js");
const source = fs.readFileSync(indexPath, "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);

  return source.slice(start, end);
}

test("scheduled daily offer import delegates to the shared importer", () => {
  const scheduler = sliceBetween(
    "exports.importDailyOffers = onSchedule(",
    "function compactNumber"
  );

  assert.match(scheduler, /importDailyOffersForDepartments\s*\(\s*\{/);
  assert.match(scheduler, /targetDate:\s*today/);
  assert.match(scheduler, /executionMode:\s*['"]scheduled['"]/);
  assert.match(scheduler, /publish:\s*true/);
  assert.doesNotMatch(
    scheduler,
    /normalizeJobOfferObservation\s*\(\s*job\s*,\s*department\s*,\s*targetDate\s*\)/
  );
});

test("shared daily offer importer persists active offer observations", () => {
  const importer = sliceBetween(
    "async function importDailyOffersForDepartments",
    "exports.importDailyOffersHttp = onRequest("
  );

  assert.match(importer, /db\.collection\(['"]jobOfferObservations['"]\)/);
  assert.match(importer, /normalizeJobOfferObservation\s*\(\s*job\s*,\s*department\s*,\s*targetDate\s*\)/);
});

test("scheduled and manual imports keep distinct audit metadata", () => {
  const importer = sliceBetween(
    "async function importDailyOffersForDepartments",
    "exports.importDailyOffersHttp = onRequest("
  );

  assert.match(importer, /daily_scheduled_import/);
  assert.match(importer, /daily_manual_import/);
  assert.match(importer, /departmentDailyStats\.lba\.scheduled\.v1/);
  assert.match(importer, /departmentDailyStats\.lba\.manual\.v1/);
});


test("shared daily offer importer also publishes occupation vigilance snapshots", () => {
  const importer = sliceBetween(
    "async function importDailyOffersForDepartments",
    "exports.importDailyOffersHttp = onRequest("
  );

  assert.match(importer, /buildOccupationOfferSnapshot\s*\(/);
  assert.match(importer, /collection\(['"]dailyOfferSnapshots['"]\)/);
  assert.match(importer, /collection\(['"]departments['"]\)/);
  assert.match(importer, /collection\(['"]offers['"]\)/);
  assert.match(importer, /activeRunId/);
});


test("daily offer observation forwards LBA address text to occupation snapshot projection", () => {
  const normalizer = sliceBetween(
    "function normalizeJobOfferObservation",
    "async function importDailyOffersForDepartments"
  );

  assert.match(normalizer, /workplaceAddress\s*:/);
  assert.match(normalizer, /location\.address/);
});
