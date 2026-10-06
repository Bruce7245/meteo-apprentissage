# ROME Domain Vigilance Engine & Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute, calibrate, publish, and serve a deterministic vigilance level for each professional ROME domain by department.

**Architecture:** Build domain contexts directly from strict daily offer snapshots, calibrate domain baselines independently from occupation baselines, and publish sector runs atomically through dedicated collections. The domain pipeline must never average occupation colors.

**Tech Stack:** Node.js 22, CommonJS, Firebase Admin SDK, Firestore, Firebase Functions v2, node:test.

**Spec:** `docs/superpowers/specs/2026-10-06-rome-domain-first-navigation-design.md`

## Global Constraints

- Unit of calculation: date × department × professional ROME domain.
- Count one offer once per domain even when the offer has several ROME codes in that same domain.
- Use only strict in-department offers.
- Domain vigilance has its own versioned calibration/configuration.
- The quarantined 2026-10-04 data must never enter domain calibration.
- 2026-10-05 contributes only through already quality-gated historical context.
- Draft configs cannot publish.
- Publication is atomic and independent from existing occupation publication.
- No scheduler activation without explicit approval.

## Review Focus

- Multi-ROME offer spanning one domain vs several domains: no double count within one domain.
- Missing/unknown ROME codes: must not create fake domains.
- 05/10 historical data with partial department coverage: only existing validated contexts contribute.
- Domain calibration with sparse domains: exclude domain as insufficient rather than blocking all domains.
- A failed domain run must not modify the last published domain pointer.

---

### Task 1: Build pure domain contexts from strict offers

**Files:**
- Create: `functions/lib/occupation-domain-context.cjs`
- Create: `functions/test/occupation-domain-context.test.cjs`

**Interfaces:**
- Produces: `buildOccupationDomainContexts(input) -> DomainContext[]`
- Input includes `departmentCode`, `date`, strict offer rows, domain reference, population reference.
- Each context contains the fields required by section 6.2 of the spec.

- [ ] **Step 1: Write failing context tests**

Test:
- one offer with `G1204,G1205` counts once in `G12`;
- one offer with `G1204,D1108` counts once in each of `G12` and `D11`;
- out-of-department and unknown-location offers are excluded;
- unknown ROME codes are ignored and diagnosed;
- distinct employer and NAF counts are set-based, not summed from occupation contexts.

- [ ] **Step 2: Verify RED**

`node --test functions/test/occupation-domain-context.test.cjs`

- [ ] **Step 3: Implement minimal pure aggregation**

Use offer-level data to avoid occupation-level double counting.

- [ ] **Step 4: Verify GREEN and full suite**

`npm run test:unit --prefix functions`

- [ ] **Step 5: Commit**

`git commit -m "feat: aggregate daily ROME domain contexts (#50)"`

---

### Task 2: Precompute and persist domain contexts

**Files:**
- Create: `functions/occupation-domain-precompute.cjs`
- Create: `functions/build-occupation-domain-context-stats.cjs`
- Create: `functions/test/occupation-domain-precompute.test.cjs`

**Interfaces:**
- Produces:
  - `occupationDomainContextStats/{date_department_domain}`
  - `occupationDomainContextStatsRuns/{date}`
- Run metadata includes `departmentsProcessed`, `domainContexts`, source versions, quality blockers.

- [ ] **Step 1: Write failing repository/precompute tests**

Prove:
- activeRunId filters offers correctly;
- missing population/domain reference fails closed;
- quarantined snapshot dates are not treated as complete source days;
- a partial historical day can persist only the departments explicitly present.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement repository and script**

Mirror the existing occupation precompute patterns but keep domain collections separate.

- [ ] **Step 4: Run syntax and unit tests**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: precompute domain vigilance contexts (#50)"`

---

### Task 3: Calibrate domain baselines independently

**Files:**
- Create: `functions/lib/occupation-domain-calibration.cjs`
- Create: `functions/scripts/build-occupation-domain-calibration.cjs`
- Create: `functions/test/occupation-domain-calibration.test.cjs`
- Create: `functions/config/occupation-domain-vigilance.v1.schema.json`

**Interfaces:**
- Produces config documents in `occupationDomainVigilanceConfigs`.
- `buildDomainCalibration(history, options) -> { eligibleForValidation, validationBlockers, config, diagnostics }`

- [ ] **Step 1: Write failing calibration tests**

Cover:
- baseline from normalized positive observations;
- zero-offer samples do not collapse ratio quantiles;
- sparse domains are excluded as `insufficient_data` rather than blocking eligible domains;
- calibration window excludes 04/10;
- draft cannot be interpreted as validated;
- deterministic config version/hash.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement calibration**

Do not reuse occupation baselines. Shared statistical helpers may be extracted only after tests are green.

- [ ] **Step 4: Build a draft from current 05/10 + 06/10 contexts**

Run in GitHub Actions with explicit diagnostics only. Do not validate automatically.

- [ ] **Step 5: Review diagnostics**

Record:
- domain count;
- excluded domains/reasons;
- sample count;
- ratio thresholds;
- window start/end.

- [ ] **Step 6: Run full suite and commit**

`git commit -m "feat: calibrate professional ROME domains (#50)"`

---

### Task 4: Implement the deterministic domain engine

**Files:**
- Create: `functions/lib/occupation-domain-vigilance.cjs`
- Create: `functions/test/occupation-domain-vigilance.test.cjs`

**Interfaces:**
- Produces: `computeOccupationDomainVigilance(context, config)`
- Output includes `publishedLevel`, `confidenceLevel`, `expectedOffers`, `observedVsExpectedRatio`, `reasonCodes`.

- [ ] **Step 1: Write failing engine tests**

Cover:
- zero offers → red when data is otherwise sufficient;
- exact ratio boundaries;
- unknown domain → insufficient_data;
- missing baseline → insufficient_data;
- secondary signals absent → neutral, lower confidence;
- config version mismatch → insufficient_data/error according to existing engine convention.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement minimal engine**

Keep offers as the dominant signal. Do not average occupation levels.

- [ ] **Step 4: Run full suite**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add deterministic ROME domain vigilance engine (#50)"`

---

### Task 5: Build atomic domain run and public projections

**Files:**
- Create: `functions/lib/occupation-domain-vigilance-run.cjs`
- Create: `functions/lib/occupation-domain-vigilance-publish.cjs`
- Create: `functions/test/occupation-domain-vigilance-run.test.cjs`
- Create: `functions/test/occupation-domain-vigilance-publish.test.cjs`

**Interfaces:**
- Produces:
  - `occupationDomainVigilanceRuns`
  - `occupationDomainVigilanceSnapshots`
  - `publicOccupationDomainVigilanceMaps`
  - `publicOccupationDomainVigilanceDetails`
  - `publicOccupationDomainVigilanceIndex/current`

- [ ] **Step 1: Write failing run tests**

Prove:
- expected pair count is deterministic;
- public projection contains no private fields;
- invalid projection blocks publication;
- source-date mismatch blocks publication;
- pointer flips only after all validations pass;
- previous pointer remains on failure.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement run/publish libraries**

Follow the already-tested occupation atomic publication pattern.

- [ ] **Step 4: Verify unit suite**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: publish domain vigilance atomically (#50)"`

---

### Task 6: Expose domain vigilance APIs

**Files:**
- Create: `functions/lib/public-occupation-domain-vigilance.cjs`
- Create: `functions/test/public-occupation-domain-vigilance.test.cjs`
- Modify: `functions/index.js`
- Modify: `.github/workflows/deploy-occupation-public-functions.yml`

**Interfaces:**
- Produces:
  - `getPublicOccupationDomainMapHttp`
  - `getPublicOccupationDomainDepartmentHttp`

- [ ] **Step 1: Write failing endpoint projection tests**

Cover 200, 400, 404, 503, missing published run, insufficient_data, and private-field exclusion.

- [ ] **Step 2: Implement pure public readers**

- [ ] **Step 3: Wire HTTP handlers with existing guards/cache**

- [ ] **Step 4: Add only these read-only functions to targeted deploy workflow**

No scheduler.

- [ ] **Step 5: Run lint/build/full unit suite**

Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat: expose public domain vigilance APIs (#50)"`

---

### Task 7: Controlled first domain calibration and publication

**Files:**
- Create: `.github/workflows/prepare-occupation-domain-vigilance-calibration.yml`
- Create: `.github/workflows/publish-occupation-domain-vigilance.yml`

**Interfaces:**
- First workflow creates draft only.
- Second workflow requires an exact approved config version and explicit publication intent.

- [ ] **Step 1: Build 05/10 and 06/10 domain contexts**

Verify 04/10 contributes zero samples.

- [ ] **Step 2: Generate draft calibration**

Stop and review diagnostics before validation.

- [ ] **Step 3: Explicitly validate the reviewed domain config**

No scheduler activation.

- [ ] **Step 4: Run first publication**

Validate pair counts, source dates, projection schemas, and current pointer.

- [ ] **Step 5: Smoke-test at least G12**

Public map endpoint must return HTTP 200 and a valid mix of levels/insufficient_data.

- [ ] **Step 6: Add evidence to Issue #50**

Record run IDs, config version, counts, excluded domains, and smoke-test result.
