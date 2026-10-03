const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getDepartmentBatch,
  getNextPageIndex,
} = require("../lib/formation-import-batch.cjs");

const CODES = [
  "01","02","03","04","05","06","07","08","09","10",
  "11","12","13","14","15","16","17","18","19","21",
  "22","23","24","25","26","27","28","29","2A","2B",
  "30","31","32","33","34","35","36","37","38","39",
  "40","41","42","43","44","45","46","47","48","49",
  "50","51","52","53","54","55","56","57","58","59",
  "60","61","62","63","64","65","66","67","68","69",
  "70","71","72","73","74","75","76","77","78","79",
  "80","81","82","83","84","85","86","87","88","89",
  "90","91","92","93","94","95","971","972","973","974","976",
];

test("batch 1 contains departments 01 to 10", () => {
  const result = getDepartmentBatch(CODES, 1, 10);

  assert.deepEqual(result.items, [
    "01","02","03","04","05","06","07","08","09","10",
  ]);
  assert.equal(result.totalDepartments, 101);
  assert.equal(result.totalBatches, 11);
});

test("batch 2 follows the real list and skips non-existent 20", () => {
  const result = getDepartmentBatch(CODES, 2, 10);

  assert.deepEqual(result.items, [
    "11","12","13","14","15","16","17","18","19","21",
  ]);
});

test("Corsica and overseas departments are not lost", () => {
  const batch3 = getDepartmentBatch(CODES, 3, 10);
  const batch11 = getDepartmentBatch(CODES, 11, 10);

  assert.ok(batch3.items.includes("2A"));
  assert.ok(batch3.items.includes("2B"));
  assert.deepEqual(batch11.items, ["976"]);
});

test("pagination stops when a page is shorter than page size", () => {
  assert.equal(getNextPageIndex({
    pagination: null,
    pageIndex: 2,
    pageSize: 100,
    receivedCount: 42,
  }), null);
});

test("pagination continues on a full page when metadata is absent", () => {
  assert.equal(getNextPageIndex({
    pagination: null,
    pageIndex: 2,
    pageSize: 100,
    receivedCount: 100,
  }), 3);
});

test("pagination honors explicit total page count", () => {
  assert.equal(getNextPageIndex({
    pagination: { total_pages: 4 },
    pageIndex: 2,
    pageSize: 100,
    receivedCount: 100,
  }), 3);

  assert.equal(getNextPageIndex({
    pagination: { total_pages: 4 },
    pageIndex: 3,
    pageSize: 100,
    receivedCount: 100,
  }), null);
});

test("pagination stops on an explicit null next page even when page is full", () => {
  assert.equal(getNextPageIndex({
    pagination: { next_page_index: null },
    pageIndex: 2,
    pageSize: 100,
    receivedCount: 100,
  }), null);
});
