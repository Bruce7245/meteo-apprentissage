const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_FORMATION_CAPACITY,
  FORMATION_NEED_METHOD_VERSION,
  getFormationNeedTimeCoefficient,
  computeFormationNeed,
} = require("../lib/formation-need.cjs");

test("formation need v2 exposes the expected version and default capacity", () => {
  assert.equal(FORMATION_NEED_METHOD_VERSION, "formationNeed.v2");
  assert.equal(DEFAULT_FORMATION_CAPACITY, 8);
});

test("formation need v2 uses the canonical time coefficients", () => {
  const cases = [
    [181, 0.10],
    [180, 0.20],
    [121, 0.20],
    [120, 0.35],
    [91, 0.35],
    [90, 0.50],
    [61, 0.50],
    [60, 0.70],
    [31, 0.70],
    [30, 0.85],
    [16, 0.85],
    [15, 1.00],
    [0, 1.00],
    [-1, 0.60],
    [-30, 0.60],
    [-31, 0.25],
    [-90, 0.25],
    [-91, 0],
  ];

  for (const [days, expected] of cases) {
    assert.equal(
      getFormationNeedTimeCoefficient(days),
      expected,
      `unexpected coefficient for ${days} days`
    );
  }
});

test("formation need v2 uses a capacity of 8 when capacity is missing", () => {
  const result = computeFormationNeed({
    capacity: null,
    daysBeforeStart: 10,
  });

  assert.equal(result.hasKnownCapacity, false);
  assert.equal(result.retainedCapacity, 8);
  assert.equal(result.coefficient, 1);
  assert.equal(result.estimatedNeed, 8);
});

test("formation need v2 preserves a known capacity", () => {
  const result = computeFormationNeed({
    capacity: 24,
    daysBeforeStart: 45,
  });

  assert.equal(result.hasKnownCapacity, true);
  assert.equal(result.retainedCapacity, 24);
  assert.equal(result.coefficient, 0.70);
  assert.equal(result.estimatedNeed, 16.8);
});
