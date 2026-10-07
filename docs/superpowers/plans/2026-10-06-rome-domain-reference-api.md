# ROME Domain Reference & Public API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import and publish the official ROME professional-domain hierarchy, then expose stable public APIs for sector selection and sector-to-occupation lookup.

**Architecture:** Extend the existing official ROME import path so occupations and professional domains come from the same downloaded source/version. Publish domains into a separate versioned Firestore reference and build a compact public index consumed by new read-only HTTP endpoints.

**Tech Stack:** Node.js 22, CommonJS, Firebase Admin SDK, Firestore, Firebase Functions v2, node:test.

**Spec:** `docs/superpowers/specs/2026-10-06-rome-domain-first-navigation-design.md`

## Global Constraints

- Public “secteur” means the official three-character ROME professional domain.
- Domain labels must come from the official ROME source; no handwritten public labels.
- `domainCode` must match `^[A-Z][0-9]{2}$`.
- Every published `romeCode` must start with its published `domainCode`.
- Domain publication must be traceable to the same ROME source version currently published.
- No raw Firestore access from the browser.
- No AI in taxonomy, mapping, filtering, or calculation.
- Existing ROME search/publication must remain compatible.

## Review Focus

- Official-source payloads where domain labels are nested differently: parser must either extract deterministically or reject the source, never fabricate labels.
- Duplicate domain records across the source: deterministic merge and one canonical label per code.
- ROME entries whose prefix has no official domain entry: exclude from public domain index and report diagnostics.
- Stale mismatch between `occupationReferenceMeta/current` and domain meta: public index build must fail closed.
- Existing `getPublicOccupationSearchHttp` behavior must not change.

---

### Task 1: Parse official ROME professional domains

**Files:**
- Modify: `functions/lib/rome-open-data.cjs`
- Modify: `functions/test/rome-open-data.test.cjs`

**Interfaces:**
- Produces: `extractRomeDomainReferenceEntries(payload, occupationEntries, sourceMeta) -> Array<DomainEntry>`
- `DomainEntry = { domainCode, domainLabel, majorDomainCode, majorDomainLabel, romeCodes, source, sourceVersion }`

- [ ] **Step 1: Write failing parser tests**

Add fixtures with nested official-style hierarchy records proving:
- `G1204` resolves to `G12`;
- domain label comes from source data;
- duplicate domain records merge deterministically;
- invalid or missing labels are rejected;
- `romeCodes` are unique and sorted.

Run:

`node --test functions/test/rome-open-data.test.cjs`

Expected: FAIL because `extractRomeDomainReferenceEntries` does not exist.

- [ ] **Step 2: Implement the minimal parser**

Add normalization helpers only where needed. Do not infer a public label from a ROME occupation label. Permit `domainCode = romeCode.slice(0, 3)` only to attach an occupation to an already-extracted official domain.

- [ ] **Step 3: Re-run parser tests**

Expected: PASS.

- [ ] **Step 4: Run the full Functions unit suite**

`npm run test:unit --prefix functions`

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: parse official ROME professional domains (#49)"`

---

### Task 2: Publish a versioned domain reference with the ROME import

**Files:**
- Modify: `scripts/import-rome-reference.mjs`
- Modify: `.github/workflows/import-rome-and-build-search-index.yml`
- Test: `functions/test/rome-open-data.test.cjs`

**Interfaces:**
- Consumes: `extractRomeDomainReferenceEntries(...)`
- Produces Firestore:
  - `occupationDomainReferenceRuns/{runId}`
  - `occupationDomainReference/{runId_domainCode}`
  - `occupationDomainReferenceMeta/current`

- [ ] **Step 1: Write a failing import projection test**

Add a pure helper test or extract a small pure projection helper proving:
- every domain document carries the ROME run/source version;
- every member ROME starts with the domain code;
- publication refuses a domain set that leaves a material unexplained mismatch with the imported occupation reference.

- [ ] **Step 2: Run the focused test and verify RED**

Expected: FAIL for missing domain publication projection.

- [ ] **Step 3: Extend the importer**

Fetch the source once, derive occupations and domains from the same payload, validate both, then publish both references before changing either `current` pointer. If one side fails, do not advance the domain pointer.

Use schema versions:
- `occupationDomainReference.v1`
- `occupationDomainReferenceRun.v1`
- `occupationDomainReferenceMeta.v1`

- [ ] **Step 4: Add workflow dry-run diagnostics**

The existing workflow must print:
- ROME count;
- domain count;
- ROME entries without a published domain;
- sourceVersion equality.

- [ ] **Step 5: Run tests and syntax checks**

`node --check scripts/import-rome-reference.mjs`  
`npm run test:unit --prefix functions`

Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat: publish versioned ROME domain reference (#49)"`

---

### Task 3: Build the compact public domain index

**Files:**
- Create: `functions/lib/occupation-domain-index.cjs`
- Create: `functions/build-occupation-domain-index.cjs`
- Create: `functions/test/occupation-domain-index.test.cjs`
- Modify: `.github/workflows/import-rome-and-build-search-index.yml`

**Interfaces:**
- Produces:
  - `publicOccupationDomainIndexes/{runId}`
  - `publicOccupationDomainIndexes/{runId}/domains/{domainCode}`
  - `publicOccupationDomainIndexMeta/current`
- Public domain document:
  `{ domainCode, domainLabel, majorDomainCode, majorDomainLabel, occupationsCount, occupations[] }`

- [ ] **Step 1: Write failing index tests**

Prove:
- domains are sorted by major domain then label;
- occupations are sorted by label/code;
- only official member ROME are emitted;
- source version mismatch makes the build ineligible.

- [ ] **Step 2: Verify RED**

`node --test functions/test/occupation-domain-index.test.cjs`

- [ ] **Step 3: Implement the pure index builder**

Keep the public projection minimal. Do not embed private source URLs or internal document IDs.

- [ ] **Step 4: Implement the Firestore builder**

Read only the current occupation/domain references and refuse stale cross-version data.

- [ ] **Step 5: Add it to the existing import workflow**

Run after ROME/domain publication and before declaring the import pipeline complete.

- [ ] **Step 6: Verify full suite**

`npm run test:unit --prefix functions`

Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -m "feat: build public ROME domain index (#49)"`

---

### Task 4: Expose public domain APIs

**Files:**
- Create: `functions/lib/public-occupation-domains.cjs`
- Create: `functions/test/public-occupation-domains.test.cjs`
- Modify: `functions/index.js`
- Modify: `.github/workflows/deploy-occupation-public-functions.yml`

**Interfaces:**
- Produces Functions:
  - `getPublicOccupationDomainsHttp`
  - `getPublicOccupationDomainOccupationsHttp`

- [ ] **Step 1: Write failing API projection tests**

Cover:
- valid domain list response;
- valid `domain=G12`;
- invalid domain syntax → 400;
- unknown domain → 404;
- payload contains no private/internal fields;
- stale/missing public domain index → controlled 503.

- [ ] **Step 2: Verify RED**

`node --test functions/test/public-occupation-domains.test.cjs`

- [ ] **Step 3: Implement pure readers/projections**

Return only fields defined by the spec.

- [ ] **Step 4: Wire HTTP handlers in `functions/index.js`**

Reuse existing CORS, cache, rate-limit, and method guards from occupation public endpoints.

- [ ] **Step 5: Add only the two new functions to the targeted public deploy workflow**

Do not add any scheduler.

- [ ] **Step 6: Verify**

`npm run test:unit --prefix functions`  
`npm run lint`  
`npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -m "feat: expose public ROME domain APIs (#49)"`
