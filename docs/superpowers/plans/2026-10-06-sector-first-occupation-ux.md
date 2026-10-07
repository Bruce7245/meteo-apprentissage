# Sector-First Occupation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the métier-first public flow with a sector-first guided flow while preserving direct occupation search and all existing ROME URLs.

**Architecture:** Add an explicit domain state to URL utilities and public services, introduce two accessible selectors, and let the existing map page switch deterministically between general, domain, and occupation modes. Existing free search stays as a shortcut and synchronizes the selected domain from the official public reference.

**Tech Stack:** React 19, Vite 8, existing CSS system, native fetch, node:test for frontend utilities.

**Spec:** `docs/superpowers/specs/2026-10-06-rome-domain-first-navigation-design.md`

## Global Constraints

- Main flow: sector first, occupation optional.
- “Sector” means official professional ROME domain.
- Existing `?rome=` URLs remain valid.
- Selecting a métier automatically selects its official domain.
- Clearing a métier returns to sector mode.
- Clearing the sector returns to general mode.
- No client-side calculation of vigilance levels.
- Sector and occupation endpoints are precomputed/public read-only APIs.
- Accessibility and keyboard navigation are required.
- `insufficient_data` must remain visually/textually distinct from green.

## Review Focus

- Legacy URL `?rome=G1204` before domain reference finishes loading: render stable loading state, then infer G12.
- URL with mismatched `domain=D11&rome=G1204`: canonicalize to G12 instead of showing contradictory state.
- Free-search selection from a training with several ROME codes: explicit ROME choice must still happen.
- Switching rapidly between domains/métiers: abort stale requests and never show an old map under a new heading.
- Domain API unavailable while métier URL is directly valid: occupation mode must remain usable where possible.

---

### Task 1: Add domain-aware URL state

**Files:**
- Modify: `src/utils/occupationUtils.js`
- Create: `functions/test/occupation-domain-url.test.cjs`

**Interfaces:**
- Produces:
  - `normalizeOccupationDomainCode(value)`
  - `getOccupationNavigationState(search)`
  - `buildOccupationDomainMapUrl(domainCode)`
  - updated `buildOccupationMapUrl(romeCode, domainCode?)`
  - updated department URL helper accepting domain.

- [ ] **Step 1: Write failing URL tests**

Cover:
- `?domain=G12`;
- `?domain=G12&rome=G1204`;
- invalid domain;
- existing `?rome=G1204`;
- canonical URL builders;
- department URLs preserve domain.

- [ ] **Step 2: Verify RED**

`node --test functions/test/occupation-domain-url.test.cjs`

- [ ] **Step 3: Implement minimal URL helpers**

Keep existing exports backward compatible where feasible.

- [ ] **Step 4: Run full suite**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add domain-aware occupation URLs (#51)"`

---

### Task 2: Add public domain service calls

**Files:**
- Modify: `src/services/occupationPublicService.js`
- Create: `src/utils/occupationDomainUtils.js`
- Create: `functions/test/occupation-domain-ui-utils.test.cjs`

**Interfaces:**
- Produces:
  - `getPublicOccupationDomains(options)`
  - `getPublicOccupationDomainOccupations(domainCode, options)`
  - `getPublicOccupationDomainMap(domainCode, options)`
  - `getPublicOccupationDomainDepartment(departmentCode, domainCode, options)`
  - pure lookup helpers for métier → domain synchronization.

- [ ] **Step 1: Write failing pure-helper tests**

Prove domain membership lookup, sorting/grouping, and mismatch canonicalization.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement utilities and service calls**

Reuse `parsePublicResponse` error semantics.

- [ ] **Step 4: Run full tests/build**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add public domain client services (#51)"`

---

### Task 3: Build accessible sector and métier selectors

**Files:**
- Create: `src/components/occupation/OccupationDomainSelect.jsx`
- Create: `src/components/occupation/OccupationWithinDomainSelect.jsx`
- Modify: `src/occupation.css`

**Interfaces:**
- `OccupationDomainSelect({ domains, value, onChange, loading, error })`
- `OccupationWithinDomainSelect({ occupations, value, onChange, disabled, loading, error })`

- [ ] **Step 1: Add failing component-contract tests where feasible**

If the repository has no DOM test harness, test extracted pure option-building utilities first and validate markup through build/lint plus explicit manual accessibility checklist.

- [ ] **Step 2: Implement sector selector**

Group options under major-domain labels. Empty value means “Choisir un secteur”.

- [ ] **Step 3: Implement métier selector**

First option: “Tous les métiers du secteur”. Disable until a sector is selected.

- [ ] **Step 4: Add keyboard/focus semantics**

Use native select semantics unless the existing design system requires a custom combobox. Prefer native controls for robustness.

- [ ] **Step 5: Build/lint**

Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat: add sector and métier selectors (#51)"`

---

### Task 4: Convert `PublicOccupationMapPage` to three explicit modes

**Files:**
- Modify: `src/pages/public/PublicOccupationMapPage.jsx`
- Modify: `src/occupation.css`
- Test: `functions/test/occupation-search-ui.test.cjs`
- Test: `functions/test/occupation-domain-ui-utils.test.cjs`

**Interfaces:**
- Modes:
  - `general`
  - `domain`
  - `occupation`

- [ ] **Step 1: Write failing state-transition tests in pure helpers**

Cover:
- no filters → general;
- G12 → domain;
- G12 + G1204 → occupation;
- direct G1204 selection infers G12;
- clearing métier → G12;
- clearing G12 → general;
- mismatched domain+ROME canonicalizes.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Refactor page state/load logic**

Use separate abortable requests per selected mode. Do not silently fall back from a failed domain/occupation request to another color source.

- [ ] **Step 4: Replace the current single search card**

Order:
1. Secteur;
2. Métier — facultatif;
3. separator/copy;
4. direct métier/formation search.

- [ ] **Step 5: Synchronize free search**

On occupation selection, derive the domain from loaded official reference and navigate to `?domain=...&rome=...`.

- [ ] **Step 6: Update headings/copy**

Domain mode:
- title “Vigilance secteur : …”
- explanation that it is an aggregated professional-domain view;
- CTA/copy encouraging métier refinement.

Occupation mode retains métier-specific wording.

- [ ] **Step 7: Verify build/lint/full tests**

Expected: PASS.

- [ ] **Step 8: Commit**

`git commit -m "feat: make sector-first navigation the primary map flow (#51)"`

---

### Task 5: Preserve sector context on department detail pages

**Files:**
- Modify: `src/pages/public/PublicDepartmentPage.jsx`
- Modify: `src/services/occupationPublicService.js`
- Modify: `src/utils/occupationUtils.js`
- Create or modify relevant department-mode tests under `functions/test/`

**Interfaces:**
- Department modes:
  - general;
  - domain;
  - occupation.

- [ ] **Step 1: Write failing navigation/detail-mode tests**

Cover:
- `/departement/72?domain=G12`;
- `/departement/72?domain=G12&rome=G1204`;
- back link preserves current mode;
- mismatch canonicalization.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement domain detail load**

Use `getPublicOccupationDomainDepartment` for sector mode.

- [ ] **Step 4: Keep occupation detail behavior unchanged**

ROME mode remains more specific than domain mode.

- [ ] **Step 5: Verify full suite/build**

Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat: preserve sector context in department detail (#51)"`

---

### Task 6: Update methodology and public explanatory copy

**Files:**
- Modify existing public methodology component/page if present; otherwise add copy to the relevant public information surface.
- Modify: `src/pages/public/PublicOccupationMapPage.jsx` as needed.

**Interfaces:**
- Must explain:
  - official ROME professional domain;
  - sector color is directly calculated from aggregated sector data;
  - not an average of métier colors;
  - choosing a métier refines the reading;
  - sector and métier levels can differ.

- [ ] **Step 1: Add copy assertions to existing text/static tests if available**

- [ ] **Step 2: Implement concise public copy**

Avoid internal terms like baseline/config/runId on the main public UI.

- [ ] **Step 3: Build/lint**

Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "docs: explain sector-to-métier vigilance methodology (#51)"`

---

### Task 7: End-to-end public verification

**Files:**
- Create: `.github/workflows/validate-sector-first-public-flow.yml`

**Interfaces:**
- Read-only smoke checks against production endpoints and built frontend.

- [ ] **Step 1: Add workflow checks**

Validate:
- domain list endpoint 200;
- G12 domain occupations endpoint 200 and contains G1204;
- G12 map endpoint 200 after sector publication;
- G1204 occupation map still 200;
- no public payload includes SIRET/internal fields.

- [ ] **Step 2: Run CI**

Require lint, build, full Functions unit suite.

- [ ] **Step 3: Perform manual UX smoke test**

Check desktop and narrow viewport:
- sector select;
- “Tous les métiers du secteur”;
- métier refinement;
- free search;
- back/forward navigation;
- direct legacy URL;
- keyboard navigation;
- insufficient_data labels.

- [ ] **Step 4: Add evidence to Issue #51**

Record workflow IDs and screenshots/observations without changing calculation logic.
