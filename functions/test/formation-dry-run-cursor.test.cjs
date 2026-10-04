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

test("formation batch dry-run accepts a stateless cursor", () => {
  const handler = sliceBetween(
    "exports.importLbaFormationsBatchHttp = onRequest(",
    "const FORMATION_AUTO_JOB_COLLECTION"
  );

  assert.match(handler, /startDepartmentIndex/);
  assert.match(handler, /startPageIndex/);
  assert.match(handler, /if \(!shouldWrite\)/);
  assert.match(handler, /state\.currentDepartmentIndex = dryRunStartDepartmentIndex/);
  assert.match(handler, /state\.currentPageIndex = dryRunStartPageIndex/);
});

test("formation batch response exposes the next dry-run cursor", () => {
  const handler = sliceBetween(
    "exports.importLbaFormationsBatchHttp = onRequest(",
    "const FORMATION_AUTO_JOB_COLLECTION"
  );

  assert.match(handler, /nextCursor:\s*completed\s*\?\s*null/);
  assert.match(handler, /departmentIndex:\s*state\.currentDepartmentIndex/);
  assert.match(handler, /pageIndex:\s*state\.currentPageIndex/);
});

test("formation batch cursor does not change persisted write-mode checkpoint loading", () => {
  const handler = sliceBetween(
    "exports.importLbaFormationsBatchHttp = onRequest(",
    "const FORMATION_AUTO_JOB_COLLECTION"
  );

  assert.match(handler, /if \(shouldWrite && !reset\)/);
  assert.match(handler, /formationImportBatches/);
});
