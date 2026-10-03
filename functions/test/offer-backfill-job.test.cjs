const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getOfferBackfillWindow,
  registerOfferBackfillFailure,
} = require("../lib/offer-backfill-job.cjs");

const DEPARTMENTS = [
  "01","02","03","04","05","06","07","08","09","10",
  "11","12","13","14","15","16","17","18","19","2A",
  "2B","21","22","23","24","25","26","27","28","29",
  "30","31","32","33","34","35","36","37","38","39",
  "40","41","42","43","44","45","46","47","48","49",
  "50","51","52","53","54","55","56","57","58","59",
  "60","61","62","63","64","65","66","67","68","69",
  "70","71","72","73","74","75","76","77","78","79",
  "80","81","82","83","84","85","86","87","88","89",
  "90","91","92","93","94","95","971","972","973","974","976"
];

test("manual start processes the first 10 departments", () => {
  const result = getOfferBackfillWindow(DEPARTMENTS, 0, 10);
  assert.equal(result.batchNumber, 1);
  assert.deepEqual(result.items, ["01","02","03","04","05","06","07","08","09","10"]);
});

test("resume continues inside the current batch", () => {
  const result = getOfferBackfillWindow(DEPARTMENTS, 4, 10);
  assert.equal(result.batchNumber, 1);
  assert.deepEqual(result.items, ["05","06","07","08","09","10"]);
});

test("next run starts the following batch", () => {
  const result = getOfferBackfillWindow(DEPARTMENTS, 10, 10);
  assert.equal(result.batchNumber, 2);
  assert.equal(result.items.length, 10);
  assert.equal(result.items[0], "11");
});

test("the final window contains the remaining department", () => {
  const result = getOfferBackfillWindow(DEPARTMENTS, 100, 10);
  assert.equal(result.batchNumber, 11);
  assert.deepEqual(result.items, ["976"]);
});

test("job is done after all 101 departments", () => {
  const result = getOfferBackfillWindow(DEPARTMENTS, 101, 10);
  assert.equal(result.done, true);
  assert.deepEqual(result.items, []);
});

test("persistent failures pause after the third failure", () => {
  assert.deepEqual(registerOfferBackfillFailure(0, 3), {
    consecutiveFailures: 1,
    shouldPause: false,
  });
  assert.deepEqual(registerOfferBackfillFailure(2, 3), {
    consecutiveFailures: 3,
    shouldPause: true,
  });
});
