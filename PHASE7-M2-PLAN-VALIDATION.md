# Phase 7 M2 — Plan Validation

**Source documents cross-referenced:**
- PHASE7-VERIFIED-ROADMAP.md (`ROADMAP`)
- FORENSIC-VALIDATION.md (`FORENSIC`)
- FINAL-PRODUCTION-READINESS-AUDIT.md (`AUDIT`)
- Repository state at `feature/phase7-m2` (`REPO`)

---

## 1. Task-to-Finding Mapping (Rule 1)

Every task MUST map to a verified forensic finding.

| ID | Task | Claimed Finding | Actual Finding Match | Verdict |
|----|------|-----------------|---------------------|---------|
| 7.2.1 | Auth flow integration tests | P0-11, P0-12 | P0-11: ROADMAP §7.2.1 explicitly lists both findings. P0-12: FORENSIC §P0-12 confirms 0 integration tests. | ✅ CORRECT |
| 7.2.2 | Tenant isolation integration | P0-11, P0-12 | P0-11: FORENSIC §P0-11 68/69 controllers untested (tenants controller is one). P0-12: FORENSIC §P0-12. | ✅ CORRECT |
| 7.2.3 | Order CRUD integration | P0-11, P0-12 | P0-11: orders controller untested. P0-12: ROADMAP §7.2.3. | ✅ CORRECT |
| 7.2.4 | RBAC integration (backup/privacy/gift-cards) | P0-11, P0-12 | ROADMAP §7.2.4 depends on 7.1 (done). P0-11: these 3 controllers untested. P0-12: ROADMAP §7.2.4. | ✅ CORRECT |
| 7.2.5 | DTO validation unit tests | P0-11 | ROADMAP §7.2.5 says "all analytics/service DTOs" mapped to P0-11. FORENSIC P0-11 confirms zero DTO tests. | ⚠️ PARTIAL (see §3) |
| 7.2.6 | PrismaService unit tests | P0-11 | ROADMAP §7.2.6 lists P0-11. FORENSIC P0-11 mentions prisma.service.spec.ts exists but coverage is 30%. | ✅ CORRECT |
| 7.2.7 | Exception filter tests | P0-11 | ROADMAP §7.2.7 lists P0-11. Existing spec file at `common/filters/tests/http-exception.filter.spec.ts`. | ✅ CORRECT |
| 7.2.8 | Test factories | P0-11 | ROADMAP §7.2.8 lists P0-11. FORENSIC P0-11 notes 7.9% test-to-code ratio — factories help. | ✅ CORRECT |
| 7.2.9 | Raise coverage thresholds | P0-11 | ROADMAP §7.2.9 explicitly maps to P0-11. | ✅ CORRECT |
| 7.2.10 | E2E tests | P0-12 | ROADMAP §7.2.10 maps to P0-12. Dependencies on 7.3 noted. Deferral is correct. | ✅ CORRECT |
| 7.2.11 | Global test setup | P0-11 | ROADMAP §7.2.11 lists P0-11. FORENSIC P0-11: no global test setup. | ✅ CORRECT |
| 7.2.12 | Remove DTO exclusion | P0-11 | ROADMAP §7.2.12 maps to P0-11. AUDIT §P2-13 mentions DTOs excluded from coverage. | ✅ CORRECT |

---

## 2. Task Classification (Rule 2)

| ID | Task | Classification | Rationale |
|----|------|---------------|-----------|
| 7.2.1 | Auth integration tests | **REQUIRED** | Core regression safety; maps to 2 P0 findings |
| 7.2.2 | Tenant isolation tests | **REQUIRED** | Critical security guarantee; maps to 2 P0 findings |
| 7.2.3 | Order CRUD integration tests | **REQUIRED** | Core business flow; maps to 2 P0 findings |
| 7.2.4 | RBAC integration tests | **REQUIRED** | Validates 7.1 RBAC fixes work; maps to 2 P0 findings |
| 7.2.5 | DTO validation unit tests | ⚠️ **REQUIRED (SCOPE-REDUCED)** | Roadmap says "analytics/service DTOs" — not all service DTOs (see §3) |
| 7.2.6 | PrismaService unit tests | **REQUIRED** | DB connection lifecycle is critical error path |
| 7.2.7 | Exception filter tests | **REQUIRED** | Global error handling needs regression safety |
| 7.2.8 | Test factories | **REQUIRED** | Enables all integration tests above |
| 7.2.9 | Raise coverage thresholds | **REQUIRED** | Mandatory success gate |
| 7.2.10 | E2E tests | **REQUIRED (DEFERRED)** | Blocked on 7.3 Payments; document and defer |
| 7.2.11 | Global test setup | **REQUIRED** | Prerequisite for test reliability |
| 7.2.12 | Remove DTO exclusion | **REQUIRED** | Prerequisite for DTO coverage measurement |

---

## 3. Scope Creep Analysis (Rule 3)

### ISSUE 1: DTO test file list exceeds roadmap scope

**Roadmap says:** `7.2.5 — Create unit tests for all analytics/service DTOs (validation rules)`

**Plan lists 11 files across:**

| Module | In Scope? | Rationale |
|--------|-----------|-----------|
| sales-analytics | ✅ | "Analytics DTO" — explicit match |
| inventory-analytics | ✅ | "Analytics DTO" — explicit match |
| customer-analytics | ✅ | "Analytics DTO" — explicit match |
| crm | ⚠️ Over-scope | CRM is not listed as analytics in the roadmap task |
| customers | ⚠️ Over-scope | Customers is not analytics |
| backup | ⚠️ Over-scope | Backup is not analytics |
| privacy | ⚠️ Over-scope | Privacy is not analytics |
| gift-cards | ⚠️ Over-scope | Gift cards is not analytics |
| webhooks | ⚠️ Over-scope | Webhooks is not analytics |
| tenants | ⚠️ Over-scope | Tenants is not analytics |
| auth | ⚠️ Over-scope | Auth is not analytics |

**CORRECTION:** Reduce to 4 DTO test files: sales-analytics, inventory-analytics, customer-analytics. The "service DTOs" phrase may include CRM since CRM is a customer-analytics-adjacent service. Keep CRM as optionally in scope—remove the other 7.

If "service DTOs" is interpreted as all service-layer DTOs, then all 11 would be in scope. But that interpretation is too broad and risks scope creep. **Reduce to 4 files (3 analytics + CRM).**

### ISSUE 2: New coverage thresholds for M1 files

**Roadmap says:** `7.2.9 — Raise coverage thresholds to 40% minimum; 60% for critical modules (auth, orders, tenants)`

**Plan adds threshold entries for:** backup.controller, privacy.controller, gift-cards.controller, 3 webhook files, redis.service, tenant-body.guard, api-key.guard, logger.service — all files modified in M1.

**Verdict:** ⚠️ The roadmap does not mandate threshold entries for M1 files. Adding them is a reasonable enforcement mechanism but goes beyond what the roadmap specifies. The 40% **overall** target will naturally pressure coverage of these files.

**Recommended correction:** Add only the critical-module threshold bumps (auth, orders, tenants) as explicitly mandated. Do NOT add individual threshold entries for M1 files unless the coverage run reveals they are drags on the 40% overall target.

### ISSUE 3: `setupFilesAfterSetup` is not a valid Jest config property

**Plan says:** Update `setupFilesAfterSetup` in jest.config.ts

**Reality:** The existing config (line 157) has `setupFilesAfterSetup: []` — but this is NOT a valid Jest config property. The correct property is `setupFiles`. The existing line is dead code (silently ignored by Jest).

**Correction:** Replace `setupFilesAfterSetup` with `setupFiles` in both the plan AND the jest.config.ts. This is not scope creep — it's fixing a broken configuration that would prevent the global test setup from ever executing.

---

## 4. File Count Verification (Rule 4)

### New files — Plan says 33, actual count is 28

| Category | Plan Count | Validated Count | Delta | Reason |
|----------|-----------|-----------------|-------|--------|
| Test factories | 10 | 10 | 0 | ✅ |
| Global setup | 1 | 1 | 0 | ✅ |
| Auth integration | 1 | 1 | 0 | ✅ |
| Tenant isolation | 1 | 1 | 0 | ✅ |
| Order CRUD | 1 | 1 | 0 | ✅ |
| RBAC integration | 3 | 3 | 0 | ✅ |
| DTO unit tests | 11 | **4** | **−7** | Scope correction per §3 |
| **Total new** | **33** | **21** | **−12** | |

After correction: **21 new files** (not 33).

### Modified files — Plan says 2, actual count is 4

| File | Plan Count | Validated Count | Delta | Reason |
|------|-----------|-----------------|-------|--------|
| jest.config.ts | 1 | 1 | 0 | ✅ |
| tsconfig.spec.json | 1 | 0(?) | **−1** | ⚠️ Listed as "if needed" but no evidence tsconfig excludes test dir |
| prisma.service.spec.ts | 0 (wrong section) | **1** | **+1** | Listed under "Files to Create" with MODIFY note — should be in modified |
| exception filter spec | 0 (wrong section) | **1** | **+1** | Same as above |
| **Total modified** | **2** | **3** | **+1** | |

### File count summary

| Metric | Plan Claims | Corrected Value |
|--------|-----------|-----------------|
| New files to create | 33 | **21** |
| Files to modify | 2 | **3** |
| Total changes | 35 | **24** |

---

## 5. File Inventory Cross-Check (Rule 5)

### Every test target must exist in the repository

| Test Target | Module | Controller Exists? | Service Exists? | Verified |
|------------|--------|-------------------|-----------------|----------|
| Auth flow | auth | `auth.controller.ts` (REPO) | `auth.service.ts` | ✅ |
| Tenant isolation | tenants | `tenants.controller.ts` (REPO) | `tenants.service.ts` | ✅ |
| Order CRUD | orders | `orders.controller.ts` (REPO) | `orders.service.ts` | ✅ |
| RBAC (backup) | backup | `backup.controller.ts` (REPO) | `backup.service.ts` | ✅ |
| RBAC (privacy) | privacy | `privacy.controller.ts` (REPO) | `privacy.service.ts` | ✅ |
| RBAC (gift-cards) | gift-cards | `gift-cards.controller.ts` (REPO) | `gift-cards.service.ts` | ✅ |
| PrismaService | prisma | — | `prisma.service.ts` (REPO) | ✅ |
| Exception filter | common/filters | — | `http-exception.filter.ts` (REPO) | ✅ |

**All test targets exist.** No test would reference a non-existent module. ✅

### No production source file is modified

The plan asserts "no production code changes" and the only non-test file listed is `jest.config.ts` (test configuration). However, `tsconfig.spec.json` could be considered production infrastructure. Confirm during implementation that no change to tsconfig.spec.json is actually needed.

**Verdict:** No production source files are modified. ✅

---

## 6. Coverage Target Verification (Rule 8)

| Target | Plan Value | Assessment |
|--------|-----------|------------|
| Overall line coverage | 40% | Based on ROADMAP. Current: 12.8%. Aggressive but achievable with 21+ new test files covering the most critical paths. |
| Auth module | 60% | ROADMAP explicitly lists auth as critical. Current auth.service.ts at 75% lines. Achievable. |
| Orders module | 60% | ROADMAP explicitly lists orders as critical. Current: 25% lines. Requires ~3× coverage increase. Achievable with integration tests. |
| Tenants module | 60% | ROADMAP explicitly lists tenants as critical. Current: 35% lines. Achievable. |

**Realistic?** Going from 12.8% → 40% in one milestone is aggressive but the existing test infrastructure (26 spec files) provides a baseline. Adding 21+ new files covering core business flows should lift coverage significantly. **Target is realistic with the corrected (reduced) DTO scope.**

---

## 7. Dependency Verification

### Plan claims hard dependency: 7.2.8 (factories) → 7.2.1/2/3/4 (integration tests)

**Reality:** Factories are a convenience, not a prerequisite. Integration tests can create inline test data objects as the existing 26 spec files already do. Making factories a hard gate will cause unnecessary serialization.

**Correction:** Change dependency from **hard** to **soft recommendation**. Schedule factories first but do not block integration tests if factories are incomplete. Integration tests can use inline data and refactor to use factories later.

---

## 8. `setupFilesAfterSetup` — Jest Config Error

### Existing config (line 157):

```ts
setupFilesAfterSetup: [],
```

### Issue

`setupFilesAfterSetup` is **not a valid Jest configuration property**. Jest silently ignores unknown properties. This means:
1. The existing line is dead code.
2. Adding a path here will have zero effect — the setup file will never execute.
3. Any test relying on environment variables set by the setup file will fail with confusing errors.

### Required correction

Replace with Jest's valid property for per-suite setup:

```ts
setupFiles: ['<rootDir>/src/test/setup/global-test-setup.ts'],
```

`setupFiles` runs before each test file, installs environment variables into `process.env`, and is the correct hook for what 7.2.11 describes.

### Impact

This is NOT scope creep. The current config has a non-functional setup mechanism. Fixing it is a prerequisite for 7.2.11 to work at all.

---

## 9. Risks and Blockers (Rule 9)

### Blockers

| Blocker | Description | Severity |
|---------|-------------|----------|
| **7.2.10 blocked** | E2E tests need payments module (7.3). Cannot implement until 7.3 is done. | 🔴 Hard block — task must be deferred |
| **No running DB in CI** | All integration tests must mock PrismaService. Tests are not "true" integration tests; they are "wired module" tests. | 🟡 Not a blocker — plan already accounts for this |

### New Risks (not in the plan)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `setupFiles`/`setupFilesAfterSetup` confusion | High | High — env vars not set, tests fail silently | Fix config property name before writing setup file |
| 40% coverage target may fail on first run | High | Medium — will need iteration to adjust thresholds | Run `npx jest --coverage` BEFORE setting final thresholds; set achievable numbers based on actual result |
| DTO test file count (4 vs 11) may be insufficient for 40% target | Medium | Low — DTOs are small files; coverage impact is marginal | Focus on service/controller coverage instead |
| Aggressive effort estimate (14.5 days for 21 new files) | Medium | Medium — actual effort may be 18–20 days | Add 25% buffer to estimate |

### Existing risks in the plan (verified)

| Risk | Assessment |
|------|------------|
| New integration tests create flaky tests | ✅ Valid — mitigated by deterministic mocks and clearMocks:true |
| Coverage thresholds fail on first run | ✅ Valid — mitigation: measure first, then set thresholds |
| DTO tests miss edge cases | ✅ Valid — mitigation: happy path + 2 error cases per DTO |
| Test factories duplicate existing patterns | ✅ Valid — mitigation: review src/test/mocks/ first |
| Integration tests too slow | ✅ Valid — mitigation: <50 cases per file, mocked Prisma |

---

## 10. Corrected Plan Summary

### Scope Changes

| Item | Before | After |
|------|--------|-------|
| DTO test files | 11 files (maximal) | **4 files** (sales-analytics, inventory-analytics, customer-analytics, CRM) |
| New files to create | 33 | **21** |
| Files to modify | 2 | **3** (jest.config.ts, prisma.service.spec.ts, exception-filter.spec.ts) |
| Total changes | 35 | **24** |

### Config Fix

| Property | Before (broken) | After (correct) |
|----------|----------------|-----------------|
| Setup hook | `setupFilesAfterSetup: []` | `setupFiles: ['<rootDir>/src/test/setup/global-test-setup.ts']` |

### Dependency Correction

| Dependency | Before | After |
|------------|--------|-------|
| 7.2.8 → 7.2.1–4 | Hard dependency | **Soft recommendation** — factories can be done in parallel with integration tests |

### Coverage Threshold Changes

| Threshold | Plan Scope | Recommended Scope |
|-----------|-----------|-------------------|
| auth.service.ts | lines:80 (from 75) | ✅ Keep |
| orders.service.ts | lines:60 (from 25) | ✅ Keep |
| tenants.service.ts | lines:60 (from 35) | ✅ Keep |
| prisma.service.ts | lines:80 (from 30) | ✅ Keep |
| All other tracked files | lines:40 min | ✅ Keep |
| **New entries for M1 files** | **13 new threshold entries** | ❌ **Remove** — not mandated by roadmap; rely on 40% overall target |

### Effort Re-estimate

| Task | Before | After | Reason |
|------|--------|-------|--------|
| 7.2.5 — DTO tests | 2 days | **0.5 days** | 4 files instead of 11 |
| **Total** | **14.5 days** | **~13 days** | Reduced DTO scope |
| With 25% buffer | — | **~16 days** | Realistic estimate |

---

## 11. Final Verdict

| Check | Result |
|-------|--------|
| All tasks map to verified findings | ✅ Pass — 12/12 map to P0-11 or P0-12 |
| No scope creep | ⚠️ Conditionally pass — after removing 7 over-scope DTO files and M1 threshold entries |
| File counts verified | ❌ **Failed** — 33 claimed vs 21 actual new files; 2 claimed vs 3 actual modified files |
| All test targets exist | ✅ Pass |
| No production code modified | ✅ Pass |
| Coverage targets realistic | ✅ Pass — aggressive but achievable with corrected scope |
| Risks documented | ⚠️ Pass — 1 missing risk (setupFiles property) added, 1 dependency corrected |
| `setupFilesAfterSetup` repair | ✅ Required fix — existing config property is dead code |

**Verdict: APPROVED WITH CORRECTIONS** — The 9 corrections above must be applied before implementation begins.

---

## 12. Required Corrections (Checklist)

- [ ] 1. **Fix file count**: Change "33 files to create" → **21 files to create**; change "2 files to modify" → **3 files to modify**
- [ ] 2. **Reduce DTO tests**: Change 7.2.5 scope from 11 files to **4 files** (sales-analytics, inventory-analytics, customer-analytics, CRM)
- [ ] 3. **Fix `setupFilesAfterSetup` → `setupFiles`**: Correct the invalid Jest config property in both the plan and jest.config.ts
- [ ] 4. **Dependency correction**: Change 7.2.8 from hard prerequisite to **soft recommendation** for 7.2.1–4
- [ ] 5. **Remove M1 threshold entries**: Do not add individual coverage thresholds for backup, webhook, redis, logger, guard files — rely on 40% overall target
- [ ] 6. **Move prisma.service.spec.ts and exception filter spec**: Reclassify from "Files to Create" to "Files to Modify" section
- [ ] 7. **Add setupFiles risk** to the risks table
- [ ] 8. **Update effort**: Reduce 7.2.5 from 2 days to 0.5 days; reduce total from 14.5 to ~13 days (16 with buffer)
- [ ] 9. **Remove tsconfig.spec.json** from Files to Modify unless confirmed necessary
