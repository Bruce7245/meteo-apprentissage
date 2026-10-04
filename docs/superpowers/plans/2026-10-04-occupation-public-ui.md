# Occupation Public API and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a public user search a profession or training, recolor the existing national map for the selected ROME code, and open a department detail that preserves that occupation context.

**Architecture:** Add three minimal public HTTP read APIs backed by the atomically published occupation run, a frontend occupation service, a `/metiers` page that reuses `VigilanceMap`, and occupation-aware department rendering via the existing `/departement/:code?rome=...` route. The global map remains unchanged when no ROME is selected.

**Tech Stack:** React 19, Vite 8, Chakra UI 3, Firebase Functions v2, Firestore, existing SVG department map and public layout, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-04-vigilance-metier-rome-design.md`

## Global Constraints

- Issue: #40, parent #36.
- One national map component; no duplicate occupation-specific map implementation.
- Global mode remains the default at `/`.
- `/metiers?rome=<ROME>` shows occupation mode.
- Department navigation preserves the ROME query parameter.
- Training selection with multiple ROME codes requires an explicit user choice.
- `insufficient_data` is visually and semantically distinct from green.
- Color is never the only status signal.
- Search/list/map interactions must be keyboard accessible and have visible focus/accessible names.
- Public APIs expose aggregates/projections only.
- AI is not used for search, mapping, filtering or vigilance color.
- Relevant controls: ISO-003, ISO-007, ISO-009, ISO-017, ISO-019, ISO-020, ISO-021, ISO-023, ISO-026, ISO-027, ISO-029, ISO-033, ISO-034, ISO-035, ISO-036, ISO-057, ISO-065, ISO-067, ISO-077, ISO-083, ISO-087, RGPD-046.

## Review Focus

- Loading `/metiers?rome=BAD` must show a recoverable invalid-selection state, not silently fall back to global green.
- Back/forward navigation must keep map mode and selected ROME synchronized with the URL.
- A training result with several ROME codes must never auto-select the first one.
- A department with `insufficient_data` must not use green styling or copy.
- A failed occupation endpoint must leave the global public map usable and show a clear error only in occupation mode.

---

### Task 1: Safe public occupation map/detail APIs

**Files:**
- Create: `functions/lib/public-occupation-vigilance.cjs`
- Create: `functions/test/public-occupation-vigilance.test.cjs`
- Modify: `functions/index.js`
- Modify: `functions/lba-daily-offers.js`
- Modify: `functions/lib/public-offers.cjs`
- Modify: `functions/test/public-offers.test.cjs`

**Interfaces:**
- Produces:
  - `sanitizePublicOccupationMap(payload) -> object`
  - `sanitizePublicOccupationDepartment(payload) -> object`
  - `getPublicOccupationMapHttp?rome=D1108`
  - `getPublicOccupationDepartmentHttp?department=72&rome=D1108`
  - `getPublicDepartmentOffersHttp?department=72&rome=D1108&limit=20` filtering on exact ROME membership.

- [ ] **Step 1: Write failing tests**

Assert:
- valid ROME format only;
- current published run pointer is required;
- map response contains all staged departments including `insufficient_data`;
- detail projection exposes approved aggregate fields/reason codes only;
- offers endpoint with ROME returns only offers whose `romeCodes` contain the selected code;
- no SIRET, phone, recipient, address, geopoint, raw payload or run-internal configuration leaks.

- [ ] **Step 2: Run focused tests and verify failure**

Run:
```bash
node --test functions/test/public-occupation-vigilance.test.cjs
node --test functions/test/public-offers.test.cjs
```

Expected: FAIL for missing occupation API/filter behavior.

- [ ] **Step 3: Implement pure sanitizers and Functions**

Use `publicOccupationVigilanceIndex/current` to resolve one published `runId`. Never read a run with another status. Add `Cache-Control: public, max-age=300` to map/detail responses.

For occupation-filtered offers, filter on exact normalized ROME codes before public projection and before applying the public list cap.

- [ ] **Step 4: Verify focused and full Functions tests**

Run:
```bash
node --test functions/test/public-occupation-vigilance.test.cjs
node --test functions/test/public-offers.test.cjs
npm run test:unit --prefix functions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/public-occupation-vigilance.cjs functions/test/public-occupation-vigilance.test.cjs functions/index.js functions/lba-daily-offers.js functions/lib/public-offers.cjs functions/test/public-offers.test.cjs
git commit -m "feat: expose occupation vigilance public APIs (#40)"
```

### Task 2: Frontend occupation data service and URL state

**Files:**
- Create: `src/services/occupationPublicService.js`
- Create: `src/utils/occupationUtils.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Produces:
  - `normalizeRomeCode(value) -> string`
  - `getRomeFromSearchParams(search = window.location.search) -> string`
  - `buildOccupationDepartmentUrl(departmentCode, romeCode) -> string`
  - `searchPublicOccupations(query) -> Promise<object[]>`
  - `getPublicOccupationMap(romeCode) -> Promise<object>`
  - `getPublicOccupationDepartment(departmentCode, romeCode) -> Promise<object>`
  - route `/metiers` -> `PublicOccupationMapPage`.

- [ ] **Step 1: Add failing utility tests using the repository's available frontend test approach**

If no frontend test runner exists, keep URL/normalization logic in a CommonJS-compatible pure helper under `functions/lib` only if shared; otherwise add a minimal Node test file under `functions/test` that imports no browser globals and mirrors the exact URL contract.

Assertions: ROME normalization, invalid ROME rejection, encoded department URL, preservation/removal of `rome`.

- [ ] **Step 2: Verify failure**

Run the new focused Node test.

- [ ] **Step 3: Implement utilities, service and route**

Do not add a routing dependency. Follow the existing pathname/query handling in `src/App.jsx`.

- [ ] **Step 4: Run `npm run build`**

Expected: Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/services/occupationPublicService.js src/utils/occupationUtils.js src/App.jsx functions/test/occupation-public-url.test.cjs
git commit -m "feat: add public occupation route and service (#40)"
```

### Task 3: Public navigation and occupation search control

**Files:**
- Modify: `src/layouts/PublicLayout.jsx`
- Create: `src/components/occupation/OccupationSearch.jsx`
- Modify: `src/App.css`

**Interfaces:**
- `OccupationSearch({ onOccupationSelect, initialRomeCode })`
- Emits either an occupation selection `{ type: 'occupation', romeCode, label }` or a training selection requiring a second ROME choice.

- [ ] **Step 1: Define acceptance checks before component code**

Manual/DOM acceptance:
- keyboard can focus input, results and ROME choices;
- Escape closes results without clearing committed selection;
- Enter selects the highlighted result;
- loading, no-results and endpoint-error states are textual;
- training with multiple ROME codes opens a choice list instead of auto-selecting.

- [ ] **Step 2: Implement public header navigation**

Add `Carte nationale` and `Métiers & formations` links with current-page semantics.

- [ ] **Step 3: Implement `OccupationSearch`**

Debounce requests by 250 ms after at least 2 normalized characters. Cancel/ignore stale responses using an `AbortController`-compatible request token or sequence guard. Use a semantic combobox/listbox pattern and visible focus styles.

- [ ] **Step 4: Build verification**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/PublicLayout.jsx src/components/occupation/OccupationSearch.jsx src/App.css
git commit -m "feat: add accessible occupation search navigation (#40)"
```

### Task 4: Reuse the national map in occupation mode

**Files:**
- Create: `src/pages/public/PublicOccupationMapPage.jsx`
- Modify: `src/components/maps/VigilanceMap.jsx`
- Modify: `src/components/vigilance/VigilanceLegend.jsx`
- Modify: `src/App.css`

**Interfaces:**
- `VigilanceMap` accepts a department list whose level may be `insufficient_data`.
- Occupation page loads search context and `getPublicOccupationMap(rome)`.
- Department links become `/departement/<code>?rome=<ROME>`.

- [ ] **Step 1: Add/extend pure map-level normalization tests**

Assert `insufficient_data` is preserved and never normalized to green; accessible label includes department name, ROME label and textual level.

- [ ] **Step 2: Verify failure**

Run focused test.

- [ ] **Step 3: Implement the occupation page**

Page states:
- no ROME: search prompt plus unchanged national map context;
- valid ROME loading;
- valid ROME map;
- invalid ROME;
- no published occupation run;
- endpoint failure.

Heading must explicitly say `Vigilance métier : <label>`. Provide a visible `Revenir à la situation générale` action.

- [ ] **Step 4: Extend legend/map rendering**

Add a neutral/hatch or dedicated class for `insufficient_data` plus text label `Données insuffisantes`. Do not rely on color alone.

- [ ] **Step 5: Verify build and manual keyboard path**

Run: `npm run build`.

Manual path: search -> choose ROME -> tab to map -> open department -> browser back -> selection remains.

- [ ] **Step 6: Commit**

```bash
git add src/pages/public/PublicOccupationMapPage.jsx src/components/maps/VigilanceMap.jsx src/components/vigilance/VigilanceLegend.jsx src/App.css
git commit -m "feat: show occupation vigilance on national map (#40)"
```

### Task 5: Occupation-aware department detail

**Files:**
- Modify: `src/pages/public/PublicDepartmentPage.jsx`
- Modify: `src/services/publicOffersService.js`
- Modify: `src/App.css`

**Interfaces:**
- Department page reads optional ROME from `window.location.search`.
- Global path behavior is unchanged when no ROME exists.
- Occupation mode uses `getPublicOccupationDepartment` plus ROME-filtered public offers.

- [ ] **Step 1: Define failing/pure state tests**

Assert occupation mode chooses occupation detail rather than global fallback, propagates ROME to offer requests and never falls back to global green on occupation-data absence.

- [ ] **Step 2: Implement mode switch**

Occupation mode header shows `<department> — <occupation>`; status badge uses occupation level; KPI set uses active offers, openings, observed employers, formations/sessions and contextual population only when present.

Bulletin tab uses deterministic reason labels until an AI bulletin exists. Offers tab is filtered by exact ROME.

- [ ] **Step 3: Preserve navigation context**

Breadcrumb back link points to `/metiers?rome=<ROME>`; global mode keeps `/`.

- [ ] **Step 4: Verify build**

Run: `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/public/PublicDepartmentPage.jsx src/services/publicOffersService.js src/App.css
git commit -m "feat: preserve ROME context in department detail (#40)"
```

### Task 6: Written bulletin integration with strict AI boundary

**Files:**
- Create: `functions/lib/occupation-bulletin.cjs`
- Create: `functions/test/occupation-bulletin.test.cjs`
- Modify: `functions/index.js`
- Modify: `src/pages/public/PublicDepartmentPage.jsx`

**Interfaces:**
- `buildOccupationBulletinInput(snapshot) -> object` allowlists aggregate metrics, level and deterministic reasons.
- AI output schema: `{ title: string, summary: string, advice: string }` only.
- Stored bulletin includes `runId`, department, ROME, model, promptVersion, generatedAt and snapshot hash.

- [ ] **Step 1: Write failing boundary tests**

Assert input cannot contain private/raw/config fields; AI output cannot set level/score/reason codes; snapshot hash mismatch invalidates a stored bulletin.

- [ ] **Step 2: Verify failure**

Run: `node --test functions/test/occupation-bulletin.test.cjs`.

- [ ] **Step 3: Implement bulletin generation and deterministic fallback**

OpenAI failure/invalid output must not affect published vigilance. Frontend uses deterministic reason text when bulletin is absent/stale.

- [ ] **Step 4: Verify**

Run:
```bash
node --test functions/test/occupation-bulletin.test.cjs
npm run test:unit --prefix functions
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-bulletin.cjs functions/test/occupation-bulletin.test.cjs functions/index.js src/pages/public/PublicDepartmentPage.jsx
git commit -m "feat: add occupation bulletin narration boundary (#40)"
```

### Task 7: ISO/RGPD, accessibility and release verification

**Files:**
- Update Issue #40 / PR evidence.
- Modify code only for defects found by verification.

**Interfaces:**
- Produces release evidence against the referenced audit controls.

- [ ] Run full local verification:

```bash
npm run lint
npm run build
node --check functions/index.js
npm run test:unit --prefix functions
```

- [ ] Inspect network payloads: no SIRET/UAI/address/raw/config secret in search/map/detail/bulletin payloads.
- [ ] Keyboard-test search, result selection, ROME choice, map, breadcrumb and tabs.
- [ ] Verify color-independent labels for all five states including `insufficient_data`.
- [ ] Verify one global-mode regression path and one occupation-mode full path.
- [ ] Record requirement → commit → test evidence in Issue #40 and request code review before merge.
