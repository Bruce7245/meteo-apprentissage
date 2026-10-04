const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.join(__dirname, "..", "index.js");
const source = fs.readFileSync(indexPath, "utf8");

function handlerSource() {
  const start = source.indexOf("exports.getFormationNationalBackgroundJobStatusHttp = onRequest(");
  const end = source.indexOf("function mvNumber", start);

  assert.notEqual(start, -1, "status endpoint export is missing");
  assert.notEqual(end, -1, "status endpoint end marker is missing");

  return source.slice(start, end);
}

test("formation national status endpoint is exported", () => {
  assert.match(
    source,
    /exports\.getFormationNationalBackgroundJobStatusHttp\s*=\s*onRequest\(/
  );
});

test("formation national status endpoint requires x-admin-key", () => {
  const handler = handlerSource();

  assert.match(handler, /request\.get\(['"]x-admin-key['"]\)/);
  assert.match(handler, /response\.status\(403\)/);
  assert.doesNotMatch(handler, /request\.query\.key/);
});

test("formation national status endpoint exposes aggregate and batch progress", () => {
  const handler = handlerSource();

  assert.match(handler, /completedBatches/);
  assert.match(handler, /completedDepartments/);
  assert.match(handler, /pagesProcessed/);
  assert.match(handler, /writtenCount/);
  assert.match(handler, /batches/);
});
