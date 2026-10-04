# Occupation Bulletin AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a written occupation bulletin from already-published deterministic vigilance data without allowing AI to influence the vigilance level, metrics or reason codes.

**Architecture:** Build a strict allowlisted prompt payload from a published occupation snapshot, call the existing OpenAI integration only for prose, validate the output against a tiny schema, store it with snapshot/model/prompt provenance, and fall back to deterministic copy whenever generation is absent, stale or invalid.

**Tech Stack:** Node.js 22, Firebase Functions v2, Firestore, existing OpenAI SDK integration, Node `node:test`, React/Vite consumer.

**Spec:** `docs/superpowers/specs/2026-10-04-vigilance-metier-rome-design.md`

## Global Constraints

- Issue: #41, parent #36.
- AI runs only after a vigilance snapshot is calculated and published.
- AI cannot set or alter `publishedLevel`, scores, metrics, reason codes, config or source data.
- AI input is limited to public aggregate metrics, level, deterministic reason labels, date and non-personal context.
- No SIRET, phone, email, recipient id, precise address, raw offer payload or secret can be sent to the model.
- Every bulletin stores `runId`, `departmentCode`, `romeCode`, model, `promptVersion`, `generatedAt` and snapshot fingerprint.
- Invalid/stale/missing AI output never blocks public vigilance and always falls back to deterministic text.
- Relevant controls: ISO-002, ISO-004, ISO-006, ISO-058, ISO-059, ISO-065, ISO-068, ISO-073, ISO-077, ISO-081, ISO-083, ISO-087, ISO-088, RGPD-025, RGPD-031, RGPD-045, RGPD-046.

## Review Focus

- A model response containing a fake level or score must be ignored outside the allowed prose fields.
- A bulletin generated for an old snapshot hash must not be shown for a new snapshot.
- A snapshot containing unexpected private fields must still produce a strictly allowlisted model payload.
- A model timeout/error must return deterministic public copy with no user-visible data loss.
- Prompt/model version changes must remain traceable to the stored bulletin.

---

### Task 1: Deterministic bulletin input and fallback copy

**Files:**
- Create: `functions/lib/occupation-bulletin.cjs`
- Create: `functions/test/occupation-bulletin.test.cjs`

**Interfaces:**
- Produces:
  - `buildOccupationBulletinInput(snapshot) -> object`
  - `buildOccupationSnapshotFingerprint(snapshot) -> string`
  - `buildDeterministicOccupationBulletin(snapshot) -> { title, summary, advice }`
  - `sanitizeOccupationBulletinOutput(value) -> { title, summary, advice } | null`

- [ ] **Step 1: Write failing boundary tests**

Assert:
- allowlisted input contains only ROME label/code, department label/code, date, published level, confidence, active offers, openings, employers, formations, population context, seasonality status and deterministic public reasons;
- private/raw/config fields are absent even if present on input snapshot;
- output accepts only bounded strings `title`, `summary`, `advice`;
- extra level/score/reason fields from the model are discarded;
- fingerprint is deterministic and changes when source snapshot metrics change;
- fallback text states `Données insuffisantes` explicitly when appropriate.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-bulletin.test.cjs`

Expected: FAIL because bulletin helpers are absent.

- [ ] **Step 3: Implement pure helpers**

No OpenAI import is allowed in this pure module.

- [ ] **Step 4: Verify PASS**

Run: `node --test functions/test/occupation-bulletin.test.cjs`

- [ ] **Step 5: Commit**

```bash
git add functions/lib/occupation-bulletin.cjs functions/test/occupation-bulletin.test.cjs
git commit -m "test: define occupation bulletin AI boundary (#41)"
```

### Task 2: Bulletin generation service and provenance

**Files:**
- Create: `functions/occupation-bulletin-generation.cjs`
- Create: `functions/test/occupation-bulletin-generation.test.cjs`
- Modify: `functions/index.js`

**Interfaces:**
- Produces:
  - `generateOccupationBulletin({ snapshot, openaiClient, model, promptVersion }) -> Promise<object>`
  - Firestore `occupationBulletins/{runId_department_rome}`
  - admin/scheduled generation entrypoint exported from `functions/index.js`.

- [ ] **Step 1: Write failing service tests with injected fake model client**

Assert successful prose generation, timeout/error fallback, invalid JSON/schema fallback, exact provenance fields, and no retry loop that blocks vigilance publication.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/occupation-bulletin-generation.test.cjs`

- [ ] **Step 3: Implement service**

Use the existing `OPENAI_API_KEY` secret. The prompt must state that level/metrics are immutable and ask only for concise explanatory prose. Persist sanitized output plus provenance and snapshot fingerprint.

Generation runs after the occupation run is published, never inside the atomic vigilance publish transaction.

- [ ] **Step 4: Verify**

Run:
```bash
node --test functions/test/occupation-bulletin-generation.test.cjs
node --check functions/index.js
npm run test:unit --prefix functions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/occupation-bulletin-generation.cjs functions/test/occupation-bulletin-generation.test.cjs functions/index.js
git commit -m "feat: generate occupation bulletins after publication (#41)"
```

### Task 3: Safe public bulletin projection

**Files:**
- Modify: `functions/lib/public-occupation-vigilance.cjs`
- Modify: `functions/test/public-occupation-vigilance.test.cjs`

**Interfaces:**
- Department detail response may include `bulletin` only when:
  - bulletin snapshot fingerprint equals current published snapshot fingerprint;
  - bulletin runId/department/ROME match the requested snapshot.

- [ ] **Step 1: Write failing projection tests**

Assert stale/mismatched bulletin is omitted and deterministic fallback fields remain available.

- [ ] **Step 2: Run and verify failure**

Run: `node --test functions/test/public-occupation-vigilance.test.cjs`

- [ ] **Step 3: Implement projection check**

Do not return model name or internal prompt text publicly; public payload contains only sanitized prose plus generation date if useful.

- [ ] **Step 4: Verify PASS**

Run: `node --test functions/test/public-occupation-vigilance.test.cjs`

- [ ] **Step 5: Commit**

```bash
git add functions/lib/public-occupation-vigilance.cjs functions/test/public-occupation-vigilance.test.cjs
git commit -m "feat: expose only current occupation bulletin prose (#41)"
```

### Task 4: Department page bulletin rendering

**Files:**
- Modify: `src/pages/public/PublicDepartmentPage.jsx`

**Interfaces:**
- Occupation mode renders current AI bulletin prose when present.
- Otherwise it renders deterministic title/summary/advice from the API.
- Global-mode bulletin behavior stays unchanged.

- [ ] **Step 1: Implement rendering switch without changing level source**

The status badge and metrics must continue to come from the deterministic occupation snapshot, never from bulletin prose.

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Manual failure check**

Simulate/fixture a missing bulletin and confirm the page remains complete and readable.

- [ ] **Step 4: Commit**

```bash
git add src/pages/public/PublicDepartmentPage.jsx
git commit -m "feat: render occupation bulletin with fallback (#41)"
```

### Task 5: Full release verification

- [ ] Run `npm run lint`, `npm run build`, `node --check functions/index.js`, `npm run test:unit --prefix functions`.
- [ ] Inspect one generated model payload and confirm no private fields.
- [ ] Inject model failure and verify vigilance/map/detail remain unchanged.
- [ ] Record model, promptVersion, snapshot fingerprint and CI evidence in Issue #41.
- [ ] Request code review before merge.
