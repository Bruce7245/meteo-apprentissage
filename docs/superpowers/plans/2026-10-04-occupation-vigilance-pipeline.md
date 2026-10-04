# Occupation Vigilance Daily Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Precompute, validate and atomically publish daily `department × ROME` vigilance snapshots without exposing partial runs.

**Architecture:** A daily orchestrator builds a versioned run from already imported offer/context data, evaluates each department/ROME pair through the pure engine, stages internal and public projections, validates counts/schema, then flips one Firestore pointer to make the whole run public. Failed runs leave the previous published run untouched.

**Tech Stack:** Node.js 22, Firebase Functions v2 Scheduler/HTTPS, Firebase Admin, Firestore, Node `node:test`, GitHub Actions for operational backfill/recovery where needed.

**Spec:** `docs/superpowers/specs/2026-10-04-vigilance-metier-rome-design.md`

## Global Constraints

- Issue: #39, parent #36.
- Daily precomputation; no user request may trigger global vigilance calculation.
- Required dependencies must be checked before a run starts.
- Run states: `building`, `validating`, `ready`, `published`, `failed`.
- Public visibility changes only through `publicOccupationVigilanceIndex/current`.
- A failed run must not replace the previous published run.
- Every snapshot stores calculation/config/source versions and `runId`.
- Re-running the same date/config/input fingerprint must be idempotent.
- AI is absent from the calculation/publishing pipeline.
- Relevant controls: ISO-009, ISO-012, ISO-047, ISO-048, ISO-058, ISO-059, ISO-065, ISO-067, ISO-068, ISO-075, ISO-080, ISO-081, ISO-083, ISO-087, ISO-091, ISO-092.

## Review Focus

- A crash halfway through writing snapshots must leave `current` unchanged.
- A rerun with identical inputs must not duplicate or drift results.
- A run with an unvalidated config must fail before staging public projections.
- A department/ROME result marked `insufficient_data` must still be represented in the map projection.
- A source date mismatch must be surfaced as run validation failure, not silently mixed.

---

### Task 1: Run state machine and deterministic identifiers

**Files:**
- Create: `functions/lib/occupation-vigilance-run.cjs`
- Create: `functions/test/occupation-vigilance-run.test.cjs`

**Interfaces:**
- Produces:
  - `buildOccupationRunId({ date, calculationVersion, configVersion, sourceFingerprint }) -> string`
  - `validateRunTransition(from, to) -> boolean`
  - `buildSourceFingerprint(sourceVersions) -> string`
  - `RUN_STATES`

- [ ] **Step 1: Write failing tests**

Assert stable run IDs, ordering-independent source fingerprints and allowed/forbidden state transitions.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-vigilance-run.test.cjs`

- [ ] **Step 3: Implement pure state helpers**

Use a deterministic cryptographic hash from Node core for the source fingerprint; do not include timestamps in the fingerprint.

- [ ] **Step 4: Verify PASS**

Run: `node --test functions/test/occupation-vigilance-run.test.cjs`

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-vigilance-run.cjs functions/test/occupation-vigilance-run.test.cjs
git commit -m "feat: define occupation vigilance run state machine (#39)"
```

### Task 2: Snapshot and public projection builders

**Files:**
- Create: `functions/lib/occupation-vigilance-projection.cjs`
- Create: `functions/test/occupation-vigilance-projection.test.cjs`

**Interfaces:**
- Produces:
  - `buildInternalOccupationSnapshot(input) -> object`
  - `buildPublicOccupationMapEntry(snapshot) -> object`
  - `buildPublicOccupationDepartmentDetail(snapshot) -> object`
  - `validatePublicOccupationProjection(value) -> { ok, errors }`

- [ ] **Step 1: Write failing projection tests**

Assert exact public allowlist and explicit absence of SIRET, raw offer records, private addresses, config internals and source credentials.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-vigilance-projection.test.cjs`

- [ ] **Step 3: Implement projection helpers**

Map entry contains only date, department code/name, ROME code/label, published level, confidence, active offer count and availability flag. Detail may add aggregate metrics/reason codes but no raw/private data.

- [ ] **Step 4: Verify PASS**

Run: `node --test functions/test/occupation-vigilance-projection.test.cjs`

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-vigilance-projection.cjs functions/test/occupation-vigilance-projection.test.cjs
git commit -m "feat: define safe occupation vigilance projections (#39)"
```

### Task 3: Daily run builder

**Files:**
- Create: `functions/occupation-vigilance-daily.cjs`
- Create: `functions/test/occupation-vigilance-daily.test.cjs`

**Interfaces:**
- Consumes:
  - latest completed offer import/snapshot metadata;
  - `occupationContextStats`;
  - `departmentPopulationReferenceMeta/current`;
  - `occupationReferenceMeta/current`;
  - validated `occupationVigilanceConfigs/{version}`;
  - pure engine from #38.
- Produces:
  - `occupationVigilanceRuns/{runId}`
  - `occupationVigilanceSnapshots/{runId_department_rome}`
  - staged public map/detail docs keyed by `runId`.

- [ ] **Step 1: Write failing orchestration tests using dependency injection**

Mock Firestore adapters and assert:
- missing required dependency => failed run;
- config not validated => failed run;
- every candidate pair is evaluated once;
- write batches are chunked safely;
- same fingerprint/date/config returns existing completed run instead of recalculating.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-vigilance-daily.test.cjs`

- [ ] **Step 3: Implement the orchestrator with injected repository functions**

Keep Firestore reads/writes behind small repository callbacks so the run logic remains unit-testable. Store counts `expectedPairs`, `computedPairs`, `insufficientDataPairs`, `failedPairs`.

- [ ] **Step 4: Verify PASS**

Run: `node --test functions/test/occupation-vigilance-daily.test.cjs`

- [ ] **Step 5: Commit**

```bash
git add functions/occupation-vigilance-daily.cjs functions/test/occupation-vigilance-daily.test.cjs
git commit -m "feat: build daily occupation vigilance run (#39)"
```

### Task 4: Atomic validation and publication

**Files:**
- Create: `functions/lib/occupation-vigilance-publish.cjs`
- Create: `functions/test/occupation-vigilance-publish.test.cjs`
- Modify: `functions/occupation-vigilance-daily.cjs`

**Interfaces:**
- Produces:
  - `validateOccupationRun(run, stagedCounts) -> { ok, errors }`
  - `publishOccupationRun(db, runId) -> Promise<void>`
  - pointer `publicOccupationVigilanceIndex/current`

- [ ] **Step 1: Write failing publication tests**

Assert count mismatch, schema failure and source-date mismatch block publication; successful publish changes one pointer; previous pointer remains unchanged on any pre-transaction error.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-vigilance-publish.test.cjs`

- [ ] **Step 3: Implement validation and Firestore transaction**

The transaction must verify the staged run is still `ready`, set it `published`, and update `publicOccupationVigilanceIndex/current` with `runId`, date, config/calculation versions and source fingerprint.

- [ ] **Step 4: Verify PASS**

Run: `node --test functions/test/occupation-vigilance-publish.test.cjs`

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-vigilance-publish.cjs functions/test/occupation-vigilance-publish.test.cjs functions/occupation-vigilance-daily.cjs
git commit -m "feat: publish occupation vigilance atomically (#39)"
```

### Task 5: Scheduler and operational recovery hooks

**Files:**
- Modify: `functions/index.js`
- Create: `.github/workflows/occupation-vigilance-run.yml`
- Create: `functions/test/occupation-vigilance-scheduler.test.cjs`

**Interfaces:**
- Produces:
  - scheduled Cloud Function `buildDailyOccupationVigilance`;
  - authenticated admin HTTP function `runOccupationVigilanceHttp` for explicit recovery/rerun;
  - GitHub Action manual workflow for rerun/status.

- [ ] **Step 1: Write failing scheduler/export tests**

Assert exported function names exist and admin endpoint refuses missing/invalid admin key before any write.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-vigilance-scheduler.test.cjs`

- [ ] **Step 3: Implement exports and workflow**

Schedule runs after the normal offer import window in Europe/Paris, but the function still checks dependency readiness instead of trusting the clock. Manual workflow sends date only; secrets remain in GitHub/Firebase secret stores.

- [ ] **Step 4: Verify**

Run:
```bash
node --test functions/test/occupation-vigilance-scheduler.test.cjs
node --check functions/index.js
npm run test:unit --prefix functions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js functions/test/occupation-vigilance-scheduler.test.cjs .github/workflows/occupation-vigilance-run.yml
git commit -m "ops: schedule occupation vigilance publication (#39)"
```

### Task 6: Full verification and traceability

- [ ] Run `npm run lint`, `npm run build`, `node --check functions/index.js`, `npm run test:unit --prefix functions`.
- [ ] Perform one dry/staged run that does not flip the public pointer and record counts.
- [ ] Perform one controlled publish against a test date/config only after the staged validation is clean.
- [ ] Attach run IDs, counts and CI evidence to Issue #39 before PR review.
