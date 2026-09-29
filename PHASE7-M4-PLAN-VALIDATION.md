# Phase 7 M4 — Plan Validation Report

**Plan:** PHASE7-M4-IMPLEMENTATION-PLAN.md (v1.0, 718 lines)
**Validated against:** PHASE7-VERIFIED-ROADMAP.md, FORENSIC-VALIDATION.md, FINAL-PRODUCTION-READINESS-AUDIT.md
**Validation date:** 2026-08-02
**Method:** Forensic review against the three source documents only; every count, path, call-site line number, DTO shape, and helper signature re-verified against the repository at v7.3.0.

---

## 1. Finding-to-Task Mapping

| Check                                              | Result                                                                                                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every task 7.4.1–7.4.14 maps to a verified finding | ✅ All 14 tasks map 1:1 (§22); no orphan tasks                                                                                                                                                        |
| No phantom findings                                | ✅ P0-6, P0-7, P1-6…P1-14, P2-6…P2-8, P2-12 (revised) all confirmed                                                                                                                                   |
| P2-12 correctly revised as False Positive          | ✅ Shared `CACHE_TTL` lib exists (constants:121–125); hardcoded TTLs verified (orders 30s at orders.service.ts:238,266; inventory 120s at inventory.service.ts:588)                                   |
| No task added without a finding                    | ✅ Scope matches the 14-task roadmap list                                                                                                                                                             |
| Audit-vs-roadmap numbering                         | ✅ Plan correctly follows ROADMAP (14 tasks). FINAL-AUDIT's table lists 13 with different numbering (7.4.10=enums, 7.4.12=deletedAt); roadmap is canonical. Add a footnote in the plan (see Issue #8) |

---

## 2. Scope Assessment

| Check                                                       | Result                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| No scope creep                                              | ✅ 14 tasks + out-of-scope list (11 items); no new modules, no features |
| No new env vars / dependencies / modules                    | ✅ None (sections 3, 13)                                                |
| Enum backfill limited to non-conforming values              | ✅ §16 preserves existing business data                                 |
| No schema splitting, Redis cluster, or transaction wrapping | ✅ Correctly deferred per roadmap                                       |
| Missing-risk coverage                                       | ⚠ 3 risks missing (see Issues #7, #10)                                 |

---

## 3. Architecture Consistency

| Check                                                | Result                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| No new modules/guards/interceptors/middleware        | ✅ Sections 4, 6, 7, 8                                                                                            |
| SCAN design sound (cursor + COUNT 100 + batched DEL) | ✅ Non-blocking, tenant-prefixed pattern, terminates on cursor 0                                                  |
| KEYS call-site line numbers correct                  | ✅ cache.service.ts:40,49; usage-tracking.service.ts:70,106 — all 4 verified                                      |
| Stock DB-pushdown approach correct                   | ✅ WHERE + take/skip + count replaces in-memory filter (inventory.service.ts:1150–1193)                           |
| Stock endpoint locations correct                     | ✅ inventory.controller.ts:274–287 (file ends 288)                                                                |
| Usage-tracking module path correct                   | ❌ **Wrong path** (`modules/usage-tracking/` does not exist; actual `apps/api/src/modules/usage/`) — see Issue #1 |
| `app.module.ts` change consistent                    | ❌ §4 lists it as modified; §21 lists it as NOT changed — contradiction — see Issue #11                           |
| Response envelope matches repo helper                | ❌ Contradiction between §10.1, §5.3, and the real `buildPaginatedResponse` — see Issue #6                        |

---

## 4. File Inventory Accuracy

| Check                                               | Result                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Total files to create (claimed 7)                   | ⚠ **Actual: 6** (see Issues #2, #3)                                                                                    |
| Total files to modify (claimed 9 + schema + config) | ⚠ **Actual: 10 + schema + config** (see Issues #1, #2)                                                                 |
| Spec-file paths follow repo convention              | ❌ All spec paths omit the `tests/` subdirectory (repo convention: `<module>/tests/*.spec.ts`) — see Issue #2           |
| cache.service.spec.ts                               | ❌ Claimed "create" but **already exists** at `apps/api/src/common/services/tests/cache.service.spec.ts` — see Issue #2 |
| inventory.controller.spec.ts                        | ✅ Does not exist; create is correct                                                                                    |
| usage-tracking.service.spec.ts                      | ❌ Claimed "extend" but **no spec exists** for the usage module — must be created — see Issue #1                        |
| inventory.service.spec.ts                           | ✅ Exists at `modules/inventory/tests/inventory.service.spec.ts`; extend is correct (fix path)                          |
| stock-list-query.dto.ts                             | ❌ **Unnecessary** — `QueryInventoryDto` already has page/limit (Min 1 / Max 100) — see Issue #3                        |
| Verification script naming                          | ✅ `verify-phase7-m4.js` matches convention (m1/m2/m3 exist)                                                            |

---

## 5. Backward Compatibility

| Check                                       | Result                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| Only the stock endpoint contract changes    | ✅ Single breaking change, documented (§10.4, §17.4) |
| Existing inventory CRUD endpoints untouched | ✅                                                   |
| deletedAt/updatedAt additions are additive  | ✅ No read-path behavior change                      |
| Cascade limited to the 19 named relations   | ✅ No blanket cascading                              |

---

## 6. Timeline and Effort

| Check                                 | Result                                                |
| ------------------------------------- | ----------------------------------------------------- |
| Serial effort (~15–18 days w/ buffer) | ✅ Within roadmap's 2–3 weeks                         |
| Task-level durations match roadmap    | ✅ 7.4.6 = 1–2 days, 7.4.12 = 8 hrs, etc.             |
| Dependencies ordered correctly        | ✅ 7.4.12 depends on audit + batches; migrations last |
| 25% buffer included                   | ✅                                                    |

---

## 7. Verification and Quality Gates

| Check                                     | Result                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Verify script gates cover every finding   | ✅ G1–G9 cover all 14 tasks                                                 |
| Gate assertion counts match actual schema | ❌ G5 asserts wrong numbers (77→78, ~116→105, "56 enums"→58) — see Issue #4 |
| Pre-migration enum audit present          | ✅ `m4-audit-enum-data.js` before M4-05                                     |
| Migration count/order sound               | ✅ 6 migrations, additive-first, enum+decimal last                          |
| Reports/tag consistent                    | ✅ PHASE7-M4-REPORT.md, PHASE7-M4-CHANGELOG.md, v7.4.0                      |

---

## Issues Found

### Issue #1 (High) — Usage-tracking module path is wrong; its spec does not exist

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**   | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Root cause** | The plan refers to `modules/usage-tracking/usage-tracking.service.ts` throughout (§1 table line 25, §3.1, §4, §5.2, §17.1 rollback, §21). No such directory exists. The module lives at `apps/api/src/modules/usage/usage-tracking.service.ts` (with `usage.controller.ts`, `usage.module.ts`; no spec file). Additionally, §15.1/§21 list `usage-tracking.service.spec.ts` under "Files to Modify (extend)" — but no spec exists for the usage module, so it must be **created**, not extended. |
| **Section**    | §1, §3.1, §4, §5.2, §15.1, §17.1, §21                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Correction** | (a) Replace every `modules/usage-tracking/` occurrence with `apps/api/src/modules/usage/`. (b) Move `usage-tracking.service.spec.ts` from Files-to-Modify to Files-to-Create at `apps/api/src/modules/usage/tests/usage-tracking.service.spec.ts`. KEYS line numbers 70/106 are correct and need no change.                                                                                                                                                                                      |

---

### Issue #2 (High) — cache.service.spec.ts already exists; spec paths omit the `tests/` convention

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**   | High                                                                                                                                                                                                                                                                                                                                                                     |
| **Root cause** | §15.1 marks `cache.service.spec.ts` as "(new)" and §21 lists it under Files-to-Create. It **already exists** at `apps/api/src/common/services/tests/cache.service.spec.ts` (uses `createMockRedis`). Creating it again would be a duplicate. Separately, every spec path in §21 omits the repo's `tests/` subdirectory convention (`<module>/tests/*.spec.ts`).          |
| **Section**    | §15.1, §21                                                                                                                                                                                                                                                                                                                                                               |
| **Correction** | (a) Move `cache.service.spec.ts` from Files-to-Create to Files-to-Modify (extend), path `apps/api/src/common/services/tests/cache.service.spec.ts`. (b) Add the `tests/` component to all spec paths: `modules/inventory/tests/inventory.controller.spec.ts`, `modules/inventory/tests/inventory.service.spec.ts`, `modules/usage/tests/usage-tracking.service.spec.ts`. |

---

### Issue #3 (Medium) — `stock-list-query.dto.ts` is unnecessary; reuse QueryInventoryDto

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**   | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Root cause** | §11 proposes a new `stock-list-query.dto.ts` with `page?`/`limit?` + `@IsInt()/@Min(1)/@Max(100)/@IsOptional()`. `QueryInventoryDto` at `apps/api/src/modules/inventory/dto/query-inventory.dto.ts:4–53` **already provides exactly this** (page Min 1, limit Min 1 Max 100, plus sortBy/sortOrder/search filters). `QueryStockAdjustmentDto`, `QueryWasteEntryDto`, and `QueryInventoryCountDto` also carry page/limit. A new DTO is a duplicate and drives the unnecessary `app.module.ts` registration concern (Issue #11). |
| **Section**    | §11, §15.1, §21 (Files-to-Create)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Correction** | Delete the new-DTO proposal; have the three stock handlers accept `QueryInventoryDto`. Defaults already align with `PAGINATION_DEFAULTS` (1 / 20 / 100). This reduces Files-to-Create by one (7 → 6).                                                                                                                                                                                                                                                                                                                          |

---

### Issue #4 (Medium) — P1-6 and P2-7 counts are wrong (script-verified against schema)

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**   | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Root cause** | The plan's counts were carried over from the forensic report's **125-model basis**. The schema has **126 models**. Verified: `tenantId` → **118** (not ~116); models with **both** `tenantId` and `createdAt` (the actual P1-6 index target) → **105** (not ~116); models **missing** `deletedAt` → **78** (not 77); enums → **58** (not 56). 13 tenant-scoped models lack `createdAt` entirely and must NOT receive `@@index([tenantId, createdAt])`: ProductImage, ProductAvailability, BusinessHours, OrderItemModifier, ProductIngredient, Message, CustomerSegmentAssignment, CustomerAnalytics, CampaignAnalytics, PromotionBranchRestriction, PromotionProductRestriction, PromotionCategoryRestriction, PromotionUsage. |
| **Section**    | §1 (P1-6/P2-7 rows), §2, §3.2, §9.3, §9.7, §15.3, §23, §24 (G5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Correction** | Update all counts: P1-6 target = **105** models; P2-7 = **78** models; enums = **58**. §9.3 already states the correct criterion ("every model that has both tenantId and createdAt") — keep it and align the numeric labels (~116 → 105). G5 assertion must read 105 / 48 / 78 / 38.                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

### Issue #5 (Medium) — Response envelope contradicts the shared helper (internal §10.1 vs §5.3)

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**   | Medium                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Root cause** | §10.1 documents the after-shape as `{ data: { items, total, page, limit, totalPages } }`. §5.3/§11 claim meta `{ total, page, limit, totalPages, items }` "identical to buildPaginatedResponse". The real helper at `libs/shared/utils/src/index.ts:3–22` returns `{ data: T[], meta: { total, page, limit, totalPages, hasNext, hasPrevious } }` — `data` is the array, `meta` holds counts, and there is **no `items` field** and **no `totalPages` inside data**. The plan contradicts itself and misstates the helper it says it adopts. |
| **Section**    | §3.5 (#7), §5.3, §10.1, §11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Correction** | Standardize on the actual helper shape everywhere: `GET /inventory/low-stock?page=1&limit=20` → `{ data: InventoryItem[], meta: { total, page, limit, totalPages, hasNext, hasPrevious } }`. Update the §10.1 table, §5.3 table, and the M3-payments-consistency note; assert this exact shape in `inventory.controller.spec.ts`.                                                                                                                                                                                                            |

---

### Issue #6 (Medium) — Campaign enums already exist; "new enums are defined" is wrong for them

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**   | Medium                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Root cause** | §9.9 states "New Prisma enums are defined…" as a blanket rule. But `CampaignStatus` (schema.prisma:1934) and `CampaignType` (1942) **already exist** while `Campaign.type` (1343) / `Campaign.status` (1344) are still `String`. Other target enums also already exist: `StockMovementType` (2279), `PurchaseOrderStatus` (2290), `CountType` (2340). Blindly defining a duplicate enum breaks `prisma validate`/migrate. |
| **Section**    | §9.9, §16 (M4-05), §15.4                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Correction** | For fields whose enums already exist, the migration is a **field-type conversion only** (reference the existing enum; verify member names cover in-use values). Only define new enums where none exist (e.g., Notification.type, Report.type/status, GiftCard.status/issueType, WebhookDelivery.status, BackupRecord.type/status). Add a per-field column to the §9.9 table: "enum exists (reuse)" vs "define new".       |

---

### Issue #7 (Low) — Enum drift risk understates the "enums already exist" case

| Field          | Value                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**   | Low                                                                                                                                                                                                                                                                                                                                             |
| **Root cause** | R1 (enum drift) covers non-matching string values, but not the reverse hazard: an existing enum whose **member names don't match the stored string values**. E.g., if a stored value like `'SMS_BLAST'` is absent from the existing `CampaignType` members (EMAIL/SMS/PUSH/WHATSAPP), reuse converts valid business data to the mapped default. |
| **Section**    | §18 (R1), §15.4                                                                                                                                                                                                                                                                                                                                 |
| **Correction** | Extend `m4-audit-enum-data.js` to (a) verify member-name coverage against distinct stored values **before** reusing an existing enum, and (b) halt the M4-05 migration if any stored value lacks a member, listing the value→default mapping for review.                                                                                        |

---

### Issue #8 (Low) — Task-count footnote vs FINAL-AUDIT numbering; enum count 56 → 58

| Field          | Value                                                                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**   | Low                                                                                                                                                                                                                                                                                    |
| **Root cause** | (a) FINAL-PRODUCTION-READINESS-AUDIT.md §7.4 lists 13 M4 tasks with different numbering (7.4.10=enums, 7.4.12=deletedAt) than the roadmap's 14. The plan follows the roadmap correctly but does not note the audit's divergence. (b) §9 header says "56 enums"; the schema has **58**. |
| **Section**    | §1, §9 header                                                                                                                                                                                                                                                                          |
| **Correction** | (a) Add a footnote: "FINAL-AUDIT §7.4 numbers 13 tasks differently; ROADMAP §7.4 (14 tasks) is canonical and followed here." (b) Change "56 enums" → "58 enums".                                                                                                                       |

---

### Issue #9 (Low) — P0-6 table enumerates 18 relations but claims 19

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**   | Low                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Root cause** | §9.1 lists rows totaling 18 named relations (Customer, ScheduledReport, ReportExport, AnalyticsDashboard, WebhookRegistration, WebhookDelivery, ApiKey×2, GiftCard×2, GiftCardTransaction×2, ConsentRecord×2, CookiePreference, DataExportRequest×2, BackupRecord), while header and §15.3/G5 claim 19. The plan's own mitigation ("programmatically verify all 19") is sound; the enumerated-vs-claimed mismatch is the issue. |
| **Section**    | §9.1, §23, §24 (G5)                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Correction** | Keep the script-verify step (it is the correct resolution) and either reconcile the enumerated count to 19 or annotate the table: "18 relations enumerated here; the 19th is confirmed by script at implementation (some relations declared on both sides of a pair)".                                                                                                                                                          |

---

### Issue #10 (Low) — CookiePreference already has `@updatedAt` (named `lastUpdated`); exclude from 7.4.11

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**   | Low                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Root cause** | §9.8 says "add to the 38 models lacking it (87 already have it)". Verified: **88** models already carry an `@updatedAt` attribute — 87 with a field named `updatedAt` and CookiePreference with `lastUpdated DateTime @updatedAt` (schema.prisma:3707). The 38 models lacking `@updatedAt` are correct, but adding `updatedAt @updatedAt` to CookiePreference would create two `@updatedAt` fields, which Prisma rejects. |
| **Section**    | §9.8, §15.3 (G5), §23                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Correction** | Note that CookiePreference is excluded from the 38 (it already has `@updatedAt` via `lastUpdated`); the "(87 already have it)" parenthetical becomes "(88 already have an @updatedAt field)". Script-based addition must not add a second `@updatedAt` to CookiePreference.                                                                                                                                               |

---

### Issue #11 (Low) — `app.module.ts` contradiction between §4 and §21

| Field          | Value                                                                                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**   | Low                                                                                                                                                                                                                                                                                                          |
| **Root cause** | §4 "Modified Modules" lists `apps/api/src/app.module.ts` ("Register inventory DTO/validator changes if module wiring requires it"), while §21 "Files NOT changed" explicitly includes `app.module.ts`. With Issue #3 resolved (no new DTO — reusing `QueryInventoryDto`), no module wiring change is needed. |
| **Section**    | §4, §21                                                                                                                                                                                                                                                                                                      |
| **Correction** | Remove the `app.module.ts` row from §4 (no change expected). Keep it in the §21 NOT-changed list. This also keeps §17.1 rollback consistent (it already omits app.module.ts).                                                                                                                                |

---

## Summary

| Criterion                                  | Verdict                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| 1. Every task maps to a verified finding   | ✅ Pass (14/14)                                                  |
| 2. No scope creep                          | ✅ Pass                                                          |
| 3. No unnecessary files                    | ⚠ Issue #3 (redundant DTO)                                      |
| 4. No unnecessary services/modules         | ✅ Pass                                                          |
| 5. No unnecessary Prisma changes           | ✅ Pass                                                          |
| 6. No unnecessary environment variables    | ✅ Pass                                                          |
| 7. No architecture contradictions          | ⚠ Issues #1, #5, #11 (path, envelope, app.module)               |
| 8. Missing risks detected                  | ⚠ Issues #7, #10 (enum-reuse drift, @updatedAt dup)             |
| 9. File counts correct                     | ⚠ Issues #1, #2, #3 (create 7→6; modify 9→10; path conventions) |
| 10. Counts against actual schema           | ⚠ Issue #4 (105/118/78/58 vs ~116/~116/77/56)                   |
| 11. Migration count/ordering sound         | ✅ Pass (6 migrations, correct order)                            |
| 12. Verification scripts / reports correct | ⚠ Issues #4, #9 (G5 assertion counts)                           |
| 13. Timeline/effort consistent             | ✅ Pass                                                          |

**Total issues:** 11 (2 High, 4 Medium, 5 Low) — all correctable without changing the plan's architecture, migration strategy, or task set.

**Corrected counts (verified at v7.3.0):**

| Item                                               | Plan says              | Verified                                                       |
| -------------------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| Models in schema                                   | 126                    | **126** ✅                                                     |
| Enums in schema                                    | 56                     | **58**                                                         |
| Models with `tenantId`                             | ~116                   | **118**                                                        |
| Models with `tenantId` + `createdAt` (P1-6 target) | ~116                   | **105**                                                        |
| Models with `deletedAt`                            | 48                     | **48** ✅                                                      |
| Models **missing** `deletedAt` (P2-7 target)       | 77                     | **78**                                                         |
| Models with an `@updatedAt` attribute              | 87                     | **88** (87 named `updatedAt` + CookiePreference `lastUpdated`) |
| Models **missing** `@updatedAt` (P2-8 target)      | 38                     | **38** ✅                                                      |
| KEYS call sites                                    | 4 (40/49/70/106)       | **4** ✅                                                       |
| Files to create                                    | 7                      | **6**                                                          |
| Files to modify                                    | 9 + schema + config    | **10 + schema + config**                                       |
| Enumerated cascade relations                       | 18 listed / 19 claimed | verify by script at implementation                             |

---

## Verdict

**B — APPROVED WITH CORRECTIONS**

The plan is substantively sound: 14 tasks mapped 1:1 to verified findings, correct migration strategy (6 migrations, additive-first, enum/decimal last), sound SCAN design, correct stock DB-pushdown approach, no scope creep, no new modules/env vars/dependencies, and effort consistent with the roadmap's 2–3 weeks. All four KEYS call sites are correctly identified.

**Two High issues must be fixed before implementation:**

1. **§1/§3.1/§4/§5.2/§17.1/§21** — Replace `modules/usage-tracking/` with `apps/api/src/modules/usage/`; move `usage-tracking.service.spec.ts` to Files-to-Create (`modules/usage/tests/`).
2. **§15.1/§21** — `cache.service.spec.ts` already exists (extend it, don't create it); add the `tests/` component to all spec paths.

**Four Medium issues required before implementation:**

3. **§11** — Remove the redundant `stock-list-query.dto.ts`; reuse `QueryInventoryDto` (create count 7 → 6).
4. **§1/§2/§9/§15.3/§23/§24** — Correct counts: P1-6 target = 105 models (both `tenantId`+`createdAt`), P2-7 = 78 models, enums = 58; update G5 assertions.
5. **§3.5/§5.3/§10.1/§11** — Align the response envelope to the real `buildPaginatedResponse`: `{ data: T[], meta: { total, page, limit, totalPages, hasNext, hasPrevious } }`.
6. **§9.9/§16** — For Campaign (and any field whose enum already exists), perform field-type conversion reusing the existing enum; only define new enums where none exist.

**Five Low issues** (#7–#11) should be folded in: enum-reuse drift check in the audit script, CookiePreference `@updatedAt` exclusion, P0-6 count reconciliation note, task-numbering footnote vs FINAL-AUDIT, and removing the `app.module.ts` contradiction.

Recommended flow: apply corrections to PHASE7-M4-IMPLEMENTATION-PLAN.md (v1.1), then proceed with implementation as planned. No architectural redesign required.
