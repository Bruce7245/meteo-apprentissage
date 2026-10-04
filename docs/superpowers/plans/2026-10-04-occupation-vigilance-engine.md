# Occupation Vigilance Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, versioned occupation-vigilance engine where active offers are the dominant signal and demographic/employer/training/seasonal factors only contextualize expected volume.

**Architecture:** Import an official INSEE departmental population reference, derive reusable ROME-level context aggregates, and calculate vigilance through a pure library driven by an explicit versioned configuration. Production publication is disabled until a calibration artifact has been generated and validated.

**Tech Stack:** Node.js 22, Firebase Admin, Firestore, INSEE Melodi API/open data, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-04-vigilance-metier-rome-design.md`

## Global Constraints

- Issue: #38, parent #36.
- Active ROME-matched offers are the primary signal.
- Population, employer context, training pressure, diversity and seasonality are bounded contextual factors.
- AI is forbidden from the calculation path.
- Missing secondary data uses neutral factors and lowers confidence; missing primary offer signal or invalid config yields `insufficient_data`.
- Production coefficients may not be invented manually; they come from a stored calibration artifact.
- Population reference: official INSEE population data, with total population plus ages 15–19, 20–24 and 25–29 summed as `population15To29`.
- Population reference year/source/version must be stored.
- Relevant controls: ISO-002, ISO-004, ISO-005, ISO-012, ISO-065, ISO-066, ISO-068, ISO-074, ISO-077, ISO-081, ISO-083, ISO-087.

## Review Focus

- Zero active offers must never become green because contextual factors are favorable.
- Missing seasonality must be neutral, not pessimistic or optimistic.
- Very small expected volumes must not create divide-by-zero or explosive ratios.
- Population data for Corsica/DROM must preserve department codes exactly.
- An unvalidated calibration config must never be usable for a publishable result.

---

### Task 1: INSEE departmental population reference

**Files:**
- Create: `functions/lib/insee-population.cjs`
- Create: `functions/test/insee-population.test.cjs`
- Create: `scripts/import-insee-population.mjs`

**Interfaces:**
- Produces:
  - `buildDepartmentPopulation(rows, referenceYear) -> Map<departmentCode, { populationTotal, population15To29 }>`
  - Firestore `departmentPopulationReference/{departmentCode}`
  - `departmentPopulationReferenceMeta/current`

- [ ] **Step 1: Write failing tests**

Use harmonized INSEE-style rows with `GEO`, `SEX`, `AGE`, `TIME_PERIOD`, `OBS_VALUE_NIVEAU`. Assert:
- only department-level `GEO` rows are retained;
- `SEX=_T` is used;
- total population comes from `AGE=_T`;
- `population15To29 = Y15T19 + Y20T24 + Y25T29`;
- invalid/non-numeric values fail validation rather than becoming zero.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/insee-population.test.cjs`

Expected: FAIL because parser is missing.

- [ ] **Step 3: Implement parser and importer**

Use the official INSEE Melodi dataset `DS_RP_TD_POPULATION_AGESEX_PRINC`. Query/fetch only the current published reference dataset; store source dataset id, year and import timestamp. The script must stage writes and update the current metadata pointer only after all department rows validate.

- [ ] **Step 4: Run tests and syntax validation**

Run:
```bash
node --test functions/test/insee-population.test.cjs
node --check scripts/import-insee-population.mjs
```

Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/insee-population.cjs functions/test/insee-population.test.cjs scripts/import-insee-population.mjs
git commit -m "feat: import INSEE population reference (#38)"
```

### Task 2: ROME-level formation and employer context aggregation

**Files:**
- Create: `functions/lib/occupation-context.cjs`
- Create: `functions/test/occupation-context.test.cjs`
- Create: `functions/build-occupation-context-stats.cjs`

**Interfaces:**
- Consumes `formationDetails`, offer snapshots/aggregates, `departmentPopulationReference`.
- Produces `occupationContextStats/{date_department_rome}`.
- Pure helper:
  - `aggregateOccupationContext({ departmentCode, romeCode, offers, formations, population }) -> object`

- [ ] **Step 1: Write failing tests**

Assert distinct employer count, distinct NAF count, concentration calculation, formation/session counts, RNCP count, population attachment and deterministic handling of duplicate offers/formations.

- [ ] **Step 2: Verify failure**

Run: `node --test functions/test/occupation-context.test.cjs`

- [ ] **Step 3: Implement pure aggregation and Firestore builder**

Employer diversity is based on observed offers only in v1. No legal-eligibility inference. Formation aggregation uses only explicit `romeCodes`.

- [ ] **Step 4: Verify focused tests**

Run: `node --test functions/test/occupation-context.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-context.cjs functions/test/occupation-context.test.cjs functions/build-occupation-context-stats.cjs
git commit -m "feat: aggregate ROME market context (#38)"
```

### Task 3: Recent trend and seasonality profile

**Files:**
- Create: `functions/lib/occupation-history.cjs`
- Create: `functions/test/occupation-history.test.cjs`
- Create: `functions/build-occupation-history-stats.cjs`

**Interfaces:**
- Produces:
  - `computeRecentOfferTrend(dailyHistory) -> { status, changeRatio, observations }`
  - `computeSeasonalityProfile(monthlyHistory, { asOfMonth, minActiveMonths = 24, completenessThreshold }) -> { status, factor, sampleMonths, completeness }`
  - Firestore `occupationHistoryStats/{department_rome}`

- [ ] **Step 1: Write failing history tests**

Assert:
- fewer than 2 usable daily observations => recent trend `unknown`;
- fewer than 12 complete monthly observations => seasonality `unavailable`, factor `1`;
- 12–23 complete monthly observations => seasonality `descriptive`, factor `1`;
- at least 24 complete monthly observations and sufficient completeness => `active`;
- an active seasonal factor is calculated from the historical month-vs-baseline ratio and then clamped by the config bounds;
- missing months reduce completeness rather than being treated as zero offers.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-history.test.cjs`

Expected: FAIL because history helpers are absent.

- [ ] **Step 3: Implement history helpers and builder**

Use existing daily/monthly ROME offer aggregates. The builder stores only aggregates and coverage metadata. It must never manufacture missing months as zero.

- [ ] **Step 4: Verify**

Run:
```bash
node --test functions/test/occupation-history.test.cjs
node --check functions/build-occupation-history-stats.cjs
```

Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-history.cjs functions/test/occupation-history.test.cjs functions/build-occupation-history-stats.cjs
git commit -m "feat: derive occupation trend and seasonality (#38)"
```

### Task 4: Versioned pure vigilance engine

**Files:**
- Create: `functions/lib/occupation-vigilance.cjs`
- Create: `functions/test/occupation-vigilance.test.cjs`
- Create: `functions/config/occupation-vigilance.v1.schema.json`

**Interfaces:**
- Produces:
  - `validateOccupationVigilanceConfig(config) -> { ok, errors }`
  - `computeExpectedOffers(input, config) -> { expectedOffers, factors, confidencePenalty }`
  - `computeOccupationVigilance(input, config) -> { publishedLevel, confidenceLevel, expectedOffers, observedVsExpectedRatio, reasonCodes, factors }`

- [ ] **Step 1: Write failing tests**

Cover zero offers, low/high population, neutral missing factor, bounded factor extremes, zero/near-zero expected volume, invalid config, unknown ROME, insufficient primary data and exact threshold boundaries.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-vigilance.test.cjs`

- [ ] **Step 3: Implement the pure engine**

Rules:
- no hard-coded production threshold outside config;
- every contextual factor is clamped to config bounds;
- if seasonality unavailable, factor is exactly `1`;
- diversity modifies confidence first and may only influence expected volume within configured bounds;
- `activeOffersCount === 0` cannot yield `green`;
- `reasonCodes` come from a closed enum.

- [ ] **Step 4: Run focused tests**

Run: `node --test functions/test/occupation-vigilance.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-vigilance.cjs functions/test/occupation-vigilance.test.cjs functions/config/occupation-vigilance.v1.schema.json
git commit -m "feat: add deterministic ROME vigilance engine (#38)"
```

### Task 5: Calibration artifact builder

**Files:**
- Create: `functions/lib/occupation-calibration.cjs`
- Create: `functions/test/occupation-calibration.test.cjs`
- Create: `functions/scripts/build-occupation-calibration.cjs`

**Interfaces:**
- Produces:
  - `buildCalibration(history) -> calibration`
  - Firestore `occupationVigilanceConfigs/{version}`
  - fields: `status: draft|validated`, `calculationVersion`, thresholds, factor bounds, calibration window, source counts, createdAt.

- [ ] **Step 1: Write failing calibration tests**

Use fixed synthetic history and assert deterministic medians/quantiles, minimum sample rules and refusal to validate sparse history.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-calibration.test.cjs`

- [ ] **Step 3: Implement calibration builder**

The builder derives baselines/threshold candidates from historical monthly/daily ROME aggregates. It writes `status: draft` by default. A separate explicit validation flag/action is required to mark a config `validated`.

- [ ] **Step 4: Verify**

Run:
```bash
node --test functions/test/occupation-calibration.test.cjs
node --check functions/scripts/build-occupation-calibration.cjs
npm run test:unit --prefix functions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-calibration.cjs functions/test/occupation-calibration.test.cjs functions/scripts/build-occupation-calibration.cjs
git commit -m "feat: derive versioned occupation calibration (#38)"
```

### Task 6: Full verification and Issue evidence

- [ ] Run `npm run lint`, `npm run build`, `node --check functions/index.js`, and `npm run test:unit --prefix functions`.
- [ ] Confirm no AI/OpenAI dependency is imported by the engine/config/calibration modules.
- [ ] Add evidence to Issue #38 and open the PR only after all checks are green.
