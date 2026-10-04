# Occupation Search Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic public search layer for ROME occupations and imported training records, with no AI inference and no private organisation data in public responses.

**Architecture:** Import an official, versioned ROME reference into Firestore, build a deduplicated public training/occupation search index, and expose a minimal Cloud Function search endpoint. Search uses deterministic normalization plus precomputed prefixes so public requests do not scan whole collections.

**Tech Stack:** Node.js 22, Firebase Admin SDK, Firebase Functions v2, Firestore, Node `node:test`, existing React/Vite frontend.

**Spec:** `docs/superpowers/specs/2026-10-04-vigilance-metier-rome-design.md`

## Global Constraints

- Issue: #37, parent architecture issue: #36.
- Search and ROME mapping must not use AI.
- ROME results must come from an official imported reference.
- Training results must expose only public identifiers, labels and ROME mappings; never SIRET, UAI, addresses, raw catalogue payloads or internal estimates.
- Query length: minimum 2 normalized characters, maximum 80 input characters.
- Public result cap: 12 total results.
- Search requests are not persisted in application logs.
- Every stored reference/index document carries source and source-version metadata.
- TDD: every new public projection or parser behavior starts with a failing test.
- Relevant audit controls: ISO-002, ISO-004, ISO-005, ISO-009, ISO-019, ISO-057, ISO-065, ISO-068, ISO-069, ISO-074, ISO-077, ISO-083, ISO-087, RGPD-045, RGPD-046.

## Review Focus

- Accents/punctuation/case in a query such as `Développeur web` must match the normalized official label.
- A one-character or over-80-character query must fail fast without a Firestore search.
- A training with multiple ROME codes must return all validated codes and never choose one automatically.
- A formation document containing SIRET/UAI/address/raw fields must not leak any of them.
- A ROME source import that yields an implausibly small reference must fail instead of replacing the current reference.

---

### Task 1: Pure occupation search normalization and projections

**Files:**
- Create: `functions/lib/occupation-search.cjs`
- Create: `functions/test/occupation-search.test.cjs`

**Interfaces:**
- Produces:
  - `normalizeOccupationSearchText(value) -> string`
  - `normalizeRomeCode(value) -> string | null`
  - `buildSearchPrefixes(values, { minLength = 2, maxLength = 32 }) -> string[]`
  - `sanitizePublicOccupationEntry(data) -> object | null`
  - `sanitizePublicTrainingEntry(data) -> object | null`

- [ ] **Step 1: Write the failing tests**

Cover accent removal, punctuation collapse, valid/invalid ROME codes, deterministic prefix generation, multi-ROME training projection, and explicit rejection of private fields.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `node --test functions/test/occupation-search.test.cjs`

Expected: FAIL because `functions/lib/occupation-search.cjs` does not exist or required functions are undefined.

- [ ] **Step 3: Implement the pure helpers**

Normalization must be locale-stable, lowercase, diacritic-free and whitespace-normalized. ROME validation accepts only `^[A-Z][0-9]{4}$`. Public projections return only the approved fields.

- [ ] **Step 4: Run the focused test and verify PASS**

Run: `node --test functions/test/occupation-search.test.cjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-search.cjs functions/test/occupation-search.test.cjs
git commit -m "test: define occupation search contracts (#37)"
```

### Task 2: Official ROME reference importer

**Files:**
- Create: `functions/lib/rome-open-data.cjs`
- Create: `functions/test/rome-open-data.test.cjs`
- Create: `scripts/import-rome-reference.mjs`
- Reference existing source logic: `scripts/patch-rome-labels-from-francetravail-open-data.mjs`

**Interfaces:**
- Consumes official France Travail / data.gouv open-data payloads already referenced by the repository.
- Produces:
  - `extractRomeReferenceEntries(payload, sourceMeta) -> Array<{ romeCode, label, normalizedLabel, source, sourceVersion }>`
  - Firestore collection `occupationReference/{romeCode}`
  - Metadata document `occupationReferenceMeta/current`

- [ ] **Step 1: Write failing parser tests**

Fixtures must include nested JSON, CSV-shaped rows, duplicate ROME codes, invalid codes, blank labels and conflicting duplicate labels. Assert deterministic deduplication.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/rome-open-data.test.cjs`

Expected: FAIL because parser is missing.

- [ ] **Step 3: Implement parser and importer**

The importer must:
- try official sources in a fixed order;
- write only valid ROME code/label pairs;
- refuse to publish if fewer than 1,000 distinct valid ROME codes are extracted;
- write source URL/name, imported timestamp and a deterministic source version/hash into metadata;
- write a new import run first, then update `occupationReferenceMeta/current` only after the batch succeeds.

No manual override table is part of the public reference path.

- [ ] **Step 4: Verify unit tests**

Run: `node --test functions/test/rome-open-data.test.cjs`

Expected: PASS.

- [ ] **Step 5: Verify script syntax**

Run: `node --check scripts/import-rome-reference.mjs`

Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add functions/lib/rome-open-data.cjs functions/test/rome-open-data.test.cjs scripts/import-rome-reference.mjs
git commit -m "feat: import versioned ROME reference (#37)"
```

### Task 3: Build the public occupation/training search index

**Files:**
- Create: `functions/lib/occupation-search-index.cjs`
- Create: `functions/test/occupation-search-index.test.cjs`
- Create: `functions/build-occupation-search-index.cjs`

**Interfaces:**
- Consumes:
  - `occupationReference`
  - `occupationReferenceMeta/current`
  - `formationDetails`
- Produces:
  - `publicOccupationSearchEntries/{entryId}`
  - `publicOccupationSearchIndexMeta/current`
  - `buildOccupationIndexEntry(reference) -> object`
  - `buildTrainingIndexEntries(formations) -> object[]`

- [ ] **Step 1: Write failing index tests**

Assert:
- occupation IDs are `occupation_<ROME>`;
- training entries deduplicate by RNCP when present, otherwise normalized title;
- only valid ROME codes survive;
- one training can retain multiple ROME codes;
- prefixes include label prefixes and RNCP tokens;
- private organisation/location/raw fields are absent.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-search-index.test.cjs`

Expected: FAIL because index builder is missing.

- [ ] **Step 3: Implement the pure index builder and Firestore batch script**

Each public search entry must contain only:
`type`, `label`, `normalizedLabel`, `searchPrefixes`, `romeCode` or `romeCodes`, optional `rncp`, `source`, `sourceVersion`, `asOfDate`.

Use a new run identifier and update the current index metadata only after all writes succeed.

- [ ] **Step 4: Run focused tests**

Run: `node --test functions/test/occupation-search-index.test.cjs`

Expected: PASS.

- [ ] **Step 5: Verify script syntax**

Run: `node --check functions/build-occupation-search-index.cjs`

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add functions/lib/occupation-search-index.cjs functions/test/occupation-search-index.test.cjs functions/build-occupation-search-index.cjs
git commit -m "feat: build public occupation search index (#37)"
```

### Task 4: Public occupation search HTTP endpoint

**Files:**
- Create: `functions/lib/public-occupation-search.cjs`
- Create: `functions/test/public-occupation-search.test.cjs`
- Modify: `functions/index.js`

**Interfaces:**
- Produces:
  - `validatePublicOccupationQuery(value) -> { ok: true, normalizedQuery } | { ok: false, status, message }`
  - `mergeOccupationSearchResults({ occupations, trainings, limit = 12 }) -> object[]`
  - Cloud Function `getPublicOccupationSearchHttp`
- HTTP response:
  - `200 { exists: true, query, results: [...] }`
  - `400` for invalid query length
  - `200 { exists: true, query, results: [] }` for no match

- [ ] **Step 1: Write failing endpoint-helper tests**

Assert min/max lengths, stable ordering (exact label match, then prefix match, occupation before training only on equal score), result cap 12, and projection safety.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/public-occupation-search.test.cjs`

Expected: FAIL because helper functions are absent.

- [ ] **Step 3: Implement helper logic and endpoint**

Endpoint behavior:
- CORS GET/OPTIONS only;
- no persistence of `q`;
- normalize before Firestore access;
- query `publicOccupationSearchEntries` using `searchPrefixes array-contains normalizedQuery`;
- limit each Firestore query before merge;
- return only sanitized entries;
- `Cache-Control: public, max-age=300`.

- [ ] **Step 4: Run focused tests**

Run: `node --test functions/test/public-occupation-search.test.cjs`

Expected: PASS.

- [ ] **Step 5: Run the complete Functions suite**

Run: `npm run test:unit --prefix functions`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/lib/public-occupation-search.cjs functions/test/public-occupation-search.test.cjs functions/index.js
git commit -m "feat: expose public occupation search endpoint (#37)"
```

### Task 5: CI and traceability gate

**Files:**
- Modify only if required by test discovery: `.github/workflows/ci.yml`
- No product code changes in this task.

**Interfaces:**
- Produces verification evidence linked to #37.

- [ ] **Step 1: Run repository verification**

Run:
```bash
npm run lint
npm run build
node --check functions/index.js
npm run test:unit --prefix functions
```

Expected: every command succeeds.

- [ ] **Step 2: Confirm diff excludes secrets/private fields**

Review the diff for any SIRET, UAI, raw formation payload or user-search logging in public output code.

- [ ] **Step 3: Commit only if CI config changed**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: cover occupation search validation (#37)"
```

- [ ] **Step 4: Update Issue #37 and open a PR**

Include requirement mapping, test evidence, source metadata behavior and explicit statement that AI is not used in search.
