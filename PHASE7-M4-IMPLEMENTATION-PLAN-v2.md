# Phase 7 — Milestone 4: Database & Performance

## Implementation Plan (v2.0 — Corrected)

**Version:** 2.0
**Status:** Ready for implementation (after v1.0 validation + release-blocking review)
**Based on:** PHASE7-VERIFIED-ROADMAP.md, FORENSIC-VALIDATION.md, FINAL-PRODUCTION-READINESS-AUDIT.md
**Corrections from:** PHASE7-M4-PLAN-VALIDATION.md (11 issues — 2 High, 4 Medium, 5 Low) + release-blocking review (6 fixes — 1 High, 2 Medium, 3 Low, §26 rows 12–17)
**Base branch:** feature/phase7-m4 (clean, on v7.3.0)

---

## 1. Objectives

Deliver the Database & Performance milestone: prevent data loss, enforce referential integrity, improve query performance at scale, and standardize cache behavior. This is a **schema-heavy** milestone — the majority of work lands in `prisma/schema.prisma` as migrations, with targeted application-layer fixes in the cache service, usage-tracking service, and inventory module.

**Forensic findings addressed (all confirmed in FORENSIC-VALIDATION.md):**

| Finding   | Verdict                         | Summary                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0-6**  | ✅ Confirmed                    | 19 Tenant/User FK relations missing `onDelete: Cascade`; Prisma default `Restrict` blocks ALL tenant deletes (schema.prisma:1522–3762)                                                                                                                                                                                                                                |
| **P0-7**  | ✅ Confirmed                    | 2 orphaned models — `MembershipHistory` (schema.prisma:1705) and `EventLog` (schema.prisma:2256) — columns exist but zero `@relation` declarations, no FK enforcement                                                                                                                                                                                                 |
| **P1-6**  | ✅ Confirmed                    | 118 models have `tenantId`; 105 of them also have `createdAt` and are the composite-index target; only Customer (schema.prisma:1543) has `@@index([tenantId, createdAt])`                                                                                                                                                                                             |
| **P1-7**  | ✅ Confirmed                    | 28 String status/type fields should be Prisma enums — frozen inventory in §9.9 (20 new enums, 2 reused existing) covering Notification.type, Campaign.type/status, Report.type/status, GiftCard.status/issueType, WebhookDelivery.status, BackupRecord.type/status + 18 more                                                                                          |
| **P1-8**  | ✅ Confirmed                    | 9 Decimal monetary fields missing `@db.Decimal(10,2)` precision                                                                                                                                                                                                                                                                                                       |
| **P1-9**  | ✅ Confirmed                    | Blocking Redis `KEYS` in `CacheService.deletePattern()`/`invalidateTenantCache()` (cache.service.ts:40,49) and `usage-tracking.service.ts:70,106`                                                                                                                                                                                                                     |
| **P1-10** | ✅ Confirmed                    | Order model (schema.prisma:966–977) has 10 single-column indexes, **zero** composite indexes                                                                                                                                                                                                                                                                          |
| **P1-11** | ✅ Confirmed                    | Low-stock/critical-stock/out-of-stock filtered in-memory (`items.filter()`) in inventory.service.ts:1150–1193                                                                                                                                                                                                                                                         |
| **P1-12** | ✅ Confirmed                    | Stock endpoints (inventory.controller.ts:274–287) have no pagination; return raw arrays                                                                                                                                                                                                                                                                               |
| **P1-14** | ✅ Confirmed                    | AuditLog (schema.prisma:396–401) has single-column indexes only; no composite                                                                                                                                                                                                                                                                                         |
| **P2-6**  | ✅ Confirmed                    | 48 models have `deletedAt`; only Customer has `@@index([tenantId, deletedAt])`                                                                                                                                                                                                                                                                                        |
| **P2-7**  | ✅ Confirmed                    | 78 models lack `deletedAt` soft-delete field                                                                                                                                                                                                                                                                                                                          |
| **P2-8**  | ✅ Confirmed                    | 38 models lack an `@updatedAt` attribute (88 already have one)                                                                                                                                                                                                                                                                                                        |
| **P2-12** | ❌ False Positive → **revised** | Shared lib EXISTS (libs/shared/constants/src/index.ts:121–125). Revised task: standardize ALL hardcoded cache TTLs onto shared `CACHE_TTL` constants — orders 30s ×2 (orders.service.ts:238, 266), inventory 120s (inventory.service.ts:588) + 300s ×4 (:156, :266, :375, :516 → `CACHE_TTL.MEDIUM`). G6/§23 require zero hardcoded numeric TTLs in orders/inventory. |

> **Task-numbering footnote:** FINAL-PRODUCTION-READINESS-AUDIT.md §7.4 lists 13 M4 tasks with different numbering (7.4.10=enums, 7.4.12=deletedAt). PHASE7-VERIFIED-ROADMAP.md §7.4 lists the canonical 14 tasks (7.4.1–7.4.14) followed by this plan.

**Score improvement:** Database 5/10 → 7/10, Performance 5.5/10 → 7/10 per ROADMAP §7.4. Overall readiness contribution: 4.0/10 → 5.0/10 trajectory.

---

## 2. Scope

### In Scope — 14 tasks (7.4.1–7.4.14)

| ID     | Task                                                                                                                  | Finding         | Effort   |
| ------ | --------------------------------------------------------------------------------------------------------------------- | --------------- | -------- |
| 7.4.1  | Add `onDelete: Cascade` to all 19 missing Tenant/User FK relations                                                    | P0-6            | 2 hrs    |
| 7.4.2  | Add Prisma `@relation` declarations to MembershipHistory and EventLog                                                 | P0-7            | 2 hrs    |
| 7.4.3  | Add `@@index([tenantId, createdAt])` to all 105 models that have both `tenantId` and `createdAt`                      | P1-6            | 3 hrs    |
| 7.4.4  | Add `@@index([tenantId, deletedAt])` to all 48 soft-delete models                                                     | P2-6            | 2 hrs    |
| 7.4.5  | Add composite indexes to Order: `@@index([tenantId, status, createdAt])`, `@@index([tenantId, branchId, createdAt])`  | P1-10           | 1 hr     |
| 7.4.6  | Replace `CacheService.deletePattern()` KEYS with SCAN cursor-based iteration (incl. usage-tracking.service.ts:70,106) | P1-9            | 1–2 days |
| 7.4.7  | Add composite `@@index([createdAt, isArchived])` on AuditLog                                                          | P1-14           | 30 min   |
| 7.4.8  | Push low-stock/critical-stock filtering into DB query (Prisma WHERE)                                                  | P1-11           | 2 hrs    |
| 7.4.9  | Add pagination (page/limit) to all unbounded stock endpoints                                                          | P1-12           | 2 hrs    |
| 7.4.10 | Add `deletedAt DateTime?` to 78 models that lack soft delete                                                          | P2-7            | 4 hrs    |
| 7.4.11 | Add `updatedAt DateTime @updatedAt` to 38 models that lack an `@updatedAt` attribute                                  | P2-8            | 2 hrs    |
| 7.4.12 | Convert 28 String status/type fields to Prisma enums (reuse existing enums where present)                             | P1-7            | 8 hrs    |
| 7.4.13 | Add `@db.Decimal(10,2)` to 9 monetary fields                                                                          | P1-8            | 1 hr     |
| 7.4.14 | Standardize cache TTL usage onto shared `CACHE_TTL` constants                                                         | P2-12 (revised) | 2 hrs    |

### Explicitly Out of Scope

- **No new modules, no new features** — this milestone fixes existing schema/perf issues only.
- **No security hardening** (MFA, RBAC scopes, body tenant check, webhook secret, JWT blacklist) — these are 7.1/7.5/7.7 scope.
- **No testing-foundation work** (integration/E2E suites) — that is 7.2 scope. M4 only adds targeted unit tests for changed code paths.
- **No observability** (Sentry, metrics auth, Bull Board, DLQ, OpenTelemetry) — 7.5 scope.
- **No API documentation** (response DTOs, Swagger annotations) — 7.6 scope.
- **No Payments module work** — 7.3 (already delivered in M3).
- **No subscriptions module, no enterprise features** — 7.7 scope.
- **No production deployment** — goes live only after 7.8 (Production Certification).
- **No data backfill of business records** — enum conversion backfills only non-conforming values to the mapped enum default (see §16); existing business data is preserved.
- **No schema splitting** (P3-6 single-file schema) — deferred; not part of 7.4.
- **No Redis cluster/sentinel work** (P2-11) — 7.5 scope.
- **No transaction wrapping for inventory mutations** (P1-13) — out of milestone scope, tracked for a later pass.

---

## 3. Architecture

### 3.1 No new modules

M4 introduces **zero** new NestJS modules. All changes modify existing code:

- `common/services/cache.service.ts` — SCAN + TTL standardization
- `modules/usage/usage-tracking.service.ts` — SCAN (2 KEYS call sites)
- `modules/inventory/*` — DB-level filtering + pagination
- `prisma/schema.prisma` — all schema changes (single source of truth)

### 3.2 Data model change flow

```
prisma/schema.prisma  (single source of truth)
   │  7.4.1  onDelete: Cascade         (P0-6)
   │  7.4.2  @relation on 2 orphans    (P0-7)
   │  7.4.3  @@index([tenantId, createdAt])   (105 models)
   │  7.4.4  @@index([tenantId, deletedAt])   (48 models)
   │  7.4.5  Order composite indexes    (P1-10)
   │  7.4.7  AuditLog composite index   (P1-14)
   │  7.4.10 deletedAt  (78 models)     (P2-7)
   │  7.4.11 updatedAt  (38 models)     (P2-8)
   │  7.4.12 enum conversions           (P1-7)
   │  7.4.13 @db.Decimal(10,2)          (P1-8)
   ▼
prisma migrate dev --name m4_<batch>
   │
   ├──→ prisma/migrations/<timestamp>_m4_*  (generated SQL, committed)
   ├──→ prisma generate                     (regenerated client types)
   └──→ npx prisma migrate deploy           (applied to all environments)
```

### 3.3 Cache invalidation flow (after 7.4.6)

```
Before (blocking):                       After (non-blocking):
  client.keys('cache:*')                   let cursor = '0'
  → KEYS O(N) blocks Redis                    do {
      SCAN cursor MATCH 'cache:*' COUNT 100
  deletePattern(tenantId, pattern)            → collect keys in batches
  invalidateTenantCache(tenantId)          } while (cursor !== '0')
                                             client.del(...batch) per batch
```

### 3.4 Stock query flow (after 7.4.8/7.4.9)

```
Before (N+1 / memory):                   After (DB-pushdown + pagination):
  findMany(all items for tenant)            findMany({
    items.filter(qty <= low)                  where: { qty <= threshold, ... },
    return raw array                          take: limit, skip: offset
  })                                         })
  → full table scan in Node.js              → SQL WHERE + LIMIT/OFFSET + count
```

Only `LowStock`/`CriticalStock` filter in-memory today (`items.filter`, lines 1162/1177); `OutOfStock` already applies `currentQuantity: { lte: 0 }` in the SQL WHERE (lines 1180–1193) and only gains pagination + envelope (see §5.3).

### 3.5 Key Design Decisions

1. **One schema file, batched migrations** — all model edits land in `prisma/schema.prisma`; `prisma migrate dev` generates a committed migration per logical batch (§16). Migration order matters: additive columns (7.4.10/7.4.11) and indexes (7.4.3/7.4.4/7.4.5/7.4.7) are non-destructive and safe first; enum conversion (7.4.12) is the highest-risk batch and runs last after a data audit.
2. **Cascade scope is deliberate** — `onDelete: Cascade` is applied ONLY to the 19 named Tenant/User FK relations from P0-6. We do NOT blanket-cascade every relation in the schema (no scope creep); relations with legitimate `Restrict` semantics (e.g., financial history that must survive parent deletion) are left untouched.
3. **Enum conversion keeps application values intact** — enums are defined (or reused where already declared) with member names matching the existing uppercase string values (`'PENDING'`, `'ACTIVE'`, `'DRAFT'`, `'FULL'`, `'MANUAL'`, `'WARNING'`, etc.) so existing data maps 1:1 without a business-data backfill. Where an enum already exists in the schema (e.g., `CampaignStatus`, `CampaignType`), the change is a **field-type conversion only** — the enum is reused, never redefined (see §9.9).
4. **Composite index design follows existing access patterns** — every new index mirrors a query that already filters/orders by that column tuple (tenant + createdAt, tenant + deletedAt, tenant + status + createdAt, tenant + branchId + createdAt, createdAt + isArchived).
5. **SCAN replaces KEYS at all 4 call sites** (cache.service.ts:40,49; usage-tracking.service.ts:70,106) using a shared helper so behavior stays consistent.
6. **TTL standardization preserves current cache durations** — every hardcoded numeric TTL in the three touched files is re-expressed as a `CACHE_TTL` constant rather than silently changing cache lifetimes. Full inventory: orders 30s (orders.service.ts:238, 266); inventory 120s low-stock (inventory.service.ts:588); inventory 300s categories/units/locations/item (inventory.service.ts:156, 266, 375, 516) → existing `CACHE_TTL.MEDIUM`. If no shared constant matches a value (30s, 120s), the shared constants file is extended with a descriptive constant for that duration. After this task, zero hardcoded numeric TTLs remain in orders.service.ts and inventory.service.ts (G6/§23).
7. **Inventory pagination follows the shared pagination contract** — stock handlers accept the existing `QueryInventoryDto` (`page`/`limit`), and the service returns the shared `buildPaginatedResponse` envelope: `{ data: T[], meta: { total, page, limit, totalPages, hasNext, hasPrevious } }` from `@tablofy/shared/utils`. Note: the repo's current inline pagination meta (`{ total, page, limit, totalPages }`, e.g. payments.service.ts:480,514 and most list endpoints) omits `hasNext`/`hasPrevious`; M4 intentionally adopts the fuller shared envelope. Response shape changes are the ONLY contract-breaking change in M4 and are called out in §10/§17.
8. **`prisma generate` regenerates the client** — TypeScript consumers of the 28 converted enum fields are updated where the old `string` literals were compared/assigned; this is contained and verified by build + tests.
9. **No app behavior change for deletedAt/updatedAt additions** — adding nullable `deletedAt` and `updatedAt @updatedAt` to existing models is additive; existing services do not yet filter on the new `deletedAt` (soft-delete behavior is a later milestone). `updatedAt` maintenance is automatic via Prisma `@updatedAt`.
10. **Migrations are committed and reproducible** — generated SQL under `prisma/migrations/`, applied with `migrate deploy` (non-interactive) in CI and all environments; `migrate dev` is only used locally/staging.

---

## 4. Modules

### New Modules

None. M4 is not a feature milestone.

### Modified Modules

| Module         | File(s)                                     | Change                                                   |
| -------------- | ------------------------------------------- | -------------------------------------------------------- |
| Common         | `common/services/cache.service.ts`          | KEYS→SCAN (7.4.6); TTL constants (7.4.14)                |
| Usage Tracking | `modules/usage/usage-tracking.service.ts`   | KEYS→SCAN at lines 70, 106 (7.4.6)                       |
| Inventory      | `modules/inventory/inventory.controller.ts` | `@Query()` DTO + paginated responses (7.4.9)             |
| Inventory      | `modules/inventory/inventory.service.ts`    | DB-level filtering, pagination, TTL (7.4.8/7.4.9/7.4.14) |
| Orders         | `modules/orders/orders.service.ts`          | TTL constants only — no logic change (7.4.14)            |

No `@Global()` changes, no provider-registry changes, no new `@Module()` definitions. `app.module.ts` is **not modified** — the stock endpoints reuse the existing `QueryInventoryDto`, so no module wiring or validator registration change is needed.

---

## 5. Services

### 5.1 `CacheService` (common/services/cache.service.ts) — 7.4.6, 7.4.14

| Method                                      | Change                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `deletePattern(tenantId, pattern)`          | Replace `client.keys()` (line 40) with `scanPattern()` using `SCAN cursor MATCH COUNT` + batched `DEL`           |
| `invalidateTenantCache(tenantId)`           | Replace `client.keys()` (line 49) with `scanPattern()` on `cache:<tenantId>:*`                                   |
| `scanPattern(pattern)` (new private helper) | Cursor-based `SCAN MATCH pattern COUNT 100`, returns all matching keys, batch-size guarded for large result sets |
| `set()` / `getOrSet()`                      | Default TTL stays `CACHE_TTL.MEDIUM` (already correct); document that callers must pass a shared constant        |

### 5.2 `UsageTrackingService` (modules/usage/usage-tracking.service.ts) — 7.4.6

| Line | Change                                  |
| ---- | --------------------------------------- |
| 70   | `client.keys(...)` → `scanPattern(...)` |
| 106  | `client.keys(...)` → `scanPattern(...)` |

### 5.3 `InventoryService` (modules/inventory/inventory.service.ts) — 7.4.8, 7.4.9, 7.4.14

| Method                               | Change                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getLowStockItems(page, limit)`      | Replace `findMany` + `items.filter(...)` (lines 1150–1163) with `findMany({ where: { currentQuantity: { lte: minStock } }, orderBy, take, skip })` + `count()` for meta                                                         |
| `getCriticalStockItems(page, limit)` | Same DB-pushdown (lines 1165–1178) with reorderLevel threshold                                                                                                                                                                  |
| `getOutOfStockItems(page, limit)`    | Already DB-filtered (`currentQuantity: { lte: 0 }`, lines 1180–1193); add pagination + envelope only — no WHERE change                                                                                                          |
| Response shape                       | Return `buildPaginatedResponse(items, total, page, limit)` → `{ data: InventoryItem[], meta: { total, page, limit, totalPages, hasNext, hasPrevious } }`                                                                        |
| Cache TTLs (all sites in this file)  | 120s low-stock cache (line 588) → new `CACHE_TTL` constant; 300s categories/units/locations/item caches (lines 156, 266, 375, 516) → existing `CACHE_TTL.MEDIUM`. Result: zero hardcoded numeric TTLs in this file (7.4.14, G6) |

### 5.4 `OrdersService` (modules/orders/orders.service.ts) — 7.4.14

| Change                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardcoded cache TTLs — `30` at lines 238 and 266 → new shared `CACHE_TTL` constant. No logic change. Result: zero hardcoded numeric TTLs in this file (G6). |

---

## 6. Guards

**No new guards.** M4 adds no authentication or authorization logic. The stock endpoints remain behind the existing global `JwtAuthGuard`/`TenantGuard`/`RolesGuard` registration. This milestone does not add per-route roles to stock endpoints (access-control alignment is 7.1/7.7 scope).

---

## 7. Interceptors

**No new interceptors.** `TransformResponseInterceptor` registration status (P2-3) is not in M4 scope. The inventory pagination response uses the existing `ApiResponse`/`PaginatedResponse` shapes from `@tablofy/shared` so the response envelope is consistent when the interceptor is eventually enabled in 7.6.

---

## 8. Middleware

**No new middleware.** Cache invalidation and SCAN changes are service-layer only; no HTTP middleware is added or modified.

---

## 9. Prisma / Database Changes

All changes are edits to `prisma/schema.prisma` (3,782 lines / 126 models / 58 enums as of v7.3.0) applied via migrations. Exact line numbers below are verified current locations and are re-confirmed at implementation time.

### 9.1 7.4.1 — `onDelete: Cascade` on 19 Tenant/User FK relations (P0-6)

| Location                | Relation                              | Missing cascade |
| ----------------------- | ------------------------------------- | --------------- |
| schema.prisma:1522      | Customer → Tenant                     | ✅ add          |
| schema.prisma:3476      | ScheduledReport → Tenant              | ✅ add          |
| schema.prisma:3498      | ReportExport → Tenant                 | ✅ add          |
| schema.prisma:3515      | AnalyticsDashboard → Tenant           | ✅ add          |
| schema.prisma:3542      | WebhookRegistration → Tenant          | ✅ add          |
| schema.prisma:3570      | WebhookDelivery → WebhookRegistration | ✅ add          |
| schema.prisma:3598–3599 | ApiKey → Tenant, User                 | ✅ add (2)      |
| schema.prisma:3629,3631 | GiftCard → Tenant, User               | ✅ add (2)      |
| schema.prisma:3656–3657 | GiftCardTransaction → GiftCard, User  | ✅ add (2)      |
| schema.prisma:3682–3683 | ConsentRecord → Tenant, User          | ✅ add (2)      |
| schema.prisma:3709      | CookiePreference → Tenant             | ✅ add          |
| schema.prisma:3733–3734 | DataExportRequest → Tenant, User      | ✅ add (2)      |
| schema.prisma:3762      | BackupRecord → Tenant                 | ✅ add          |

The table above enumerates **18 named relations**; forensic report counts **19** (some relations are declared on both sides of a relation pair). **Implementation step:** programmatically verify all 19 by re-running the audit after edits — the 19th is confirmed by script at implementation time, and the verify gate (G5) asserts the exact count.

### 9.2 7.4.2 — `@relation` declarations on orphaned models (P0-7)

| Model             | Line                    | Fields                   | Action                                                                                   |
| ----------------- | ----------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| MembershipHistory | schema.prisma:1705–1719 | `customerId`, `tenantId` | Add `@relation` to Customer and Tenant; add matching back-relations on Customer/Tenant   |
| EventLog          | schema.prisma:2256–2272 | `tenantId`, `ruleId`     | Add `@relation` to Tenant and EventRule; add matching back-relations on Tenant/EventRule |

This enables FK enforcement and cascade cleanup so orphan rows cannot accumulate.

**Pre-migration orphan-data audit (required before M4-01):** because these two models have zero FK enforcement today, orphan rows may already exist. Adding the `@relation` FKs (Postgres FK constraints) **fails if any orphan row remains**. `scripts/m4-audit-orphan-data.js` (new) therefore counts `membership_history` rows whose `customerId`/`tenantId` and `event_logs` rows whose `tenantId`/`ruleId` do not resolve to an existing parent (`Customer`/`Tenant`/`EventRule`). Cleanup procedure (documented in §16 step 2): if the audit reports orphan rows, review the affected-row listing and decide per row — (a) hard-delete the orphan row (if it is a stale fragment with no business value), or (b) backfill the missing parent (if the parent row was lost and can be recreated), or (c) null-out the FK (only where the relation is optional, `ruleId`/`userId`) — and re-run the audit until it reports **0 orphan rows** before M4-01 is generated. The migration must not proceed with orphans present.

### 9.3 7.4.3 — `@@index([tenantId, createdAt])` on 105 models (P1-6)

- Applies to every model that has **both** `tenantId` and `createdAt` — **105 models** (verified at v7.3.0).
- Only Customer currently has it (schema.prisma:1543).
- **Excluded:** 13 tenant-scoped models that lack `createdAt` and therefore do NOT receive this index: `ProductImage`, `ProductAvailability`, `BusinessHours`, `OrderItemModifier`, `ProductIngredient`, `Message`, `CustomerSegmentAssignment`, `CustomerAnalytics`, `CampaignAnalytics`, `PromotionBranchRestriction`, `PromotionProductRestriction`, `PromotionCategoryRestriction`, `PromotionUsage`.
- **Implementation step:** script-extract all models with `tenantId` + `createdAt`; add the composite index to each; verify the count equals **105** via script (§24).

### 9.4 7.4.4 — `@@index([tenantId, deletedAt])` on 48 soft-delete models (P2-6)

- Applies to the 48 models that have `deletedAt`; only Customer has the composite (schema.prisma:1544).

### 9.5 7.4.5 — Order composite indexes (P1-10)

Add to `Order` (schema.prisma:966–977), keeping its existing 10 single-column indexes:

- `@@index([tenantId, status, createdAt])`
- `@@index([tenantId, branchId, createdAt])`

### 9.6 7.4.7 — AuditLog composite index (P1-14)

Add to `AuditLog` (schema.prisma:396–401):

- `@@index([createdAt, isArchived])`

### 9.7 7.4.10 — `deletedAt DateTime?` on 78 models (P2-7)

- Add `deletedAt DateTime?` to the **78** models lacking soft delete (48 already have it; 126 models total).
- **Implementation step:** script-diff the 48 models with `deletedAt` against all 126 models; add the field to the remaining **78**; verify count.

### 9.8 7.4.11 — `updatedAt DateTime @updatedAt` on 38 models (P2-8)

- Add to the **38** models lacking an `@updatedAt` attribute (88 already have one — 87 with a field named `updatedAt`, plus `CookiePreference` with `lastUpdated DateTime @updatedAt` at schema.prisma:3707).
- **CookiePreference is excluded** from the 38: it already has an `@updatedAt` attribute (under the `lastUpdated` name), and Prisma rejects a second `@updatedAt` field on the same model. Script-based addition must not add one.
- `updatedAt` maintenance is automatic via Prisma `@updatedAt`.

### 9.9 7.4.12 — 28 String → enum conversions (P1-7)

Frozen, schema-verified enum inventory (verified against `prisma/schema.prisma` v7.3.0, 3,782 lines / 58 enums; DTO enums and service string literals cross-checked). **28 String fields convert; 11 fields stay String; 1 field is already enum-typed (`InventoryCount.countType` → `CountType`, no work).** The 10 fields originally named in this plan were re-verified at the exact line numbers below; the earlier audit's remaining candidates were enumerated, corrected, and pruned — every candidate that did not exist in the schema was removed (Table 9.9-C records each removal).

Member names must equal the uppercase string values in use (or be `@map`-ped to them where the value is not a valid Prisma identifier, e.g. dotted webhook event names — see rules below); every member set below is reconfirmed by `scripts/m4-audit-enum-data.js` before M4-05 applies.

**Table 9.9-A — Convertible fields (28)**

| Model:Field (line)                   | Current                      | Target enum               | Existing/New              | Members                                                                                                                                                  | Safe  | Justification                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------- | ------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notification.type (1200)             | String                       | `NotificationType`        | New                       | ORDER, PAYMENT, RESERVATION, CUSTOMER, CAMPAIGN, INVENTORY, SYSTEM, ALERT, BILLING, SECURITY, LOW_STOCK, EXPIRY, BIRTHDAY, REFERRAL, MEMBERSHIP, GENERAL | YES\* | No schema default; fallback literal `'GENERAL'` (orders.service.ts:645). \*Full set confirmed by audit before M4-05                                                                                              |
| Report.type (1239)                   | String                       | `ReportType`              | New (mirrors DTO)         | SALES, INVENTORY, KITCHEN, FINANCIAL, CUSTOM                                                                                                             | YES   | DTO `ReportType` has identical members (create-scheduled-report.dto.ts:3)                                                                                                                                        |
| Report.status (1244)                 | String `@default("PENDING")` | `ReportStatus`            | New                       | PENDING, GENERATED, FAILED                                                                                                                               | YES   | Default matches first member                                                                                                                                                                                     |
| Campaign.type (1343)                 | String                       | `CampaignType`            | **Reuse existing** (1942) | EMAIL, SMS, PUSH, WHATSAPP                                                                                                                               | YES   | Enum exists; field-type conversion only                                                                                                                                                                          |
| Campaign.status (1344)               | String `@default("DRAFT")`   | `CampaignStatus`          | **Reuse existing** (1934) | DRAFT, ACTIVE, PAUSED, COMPLETED, CANCELLED                                                                                                              | YES   | Default matches member. Note: existing enum has NO SENT/SCHEDULED members                                                                                                                                        |
| CampaignApproval.status (2116)       | String                       | `ApprovalStatus`          | New (shared)              | PENDING, APPROVED, REJECTED                                                                                                                              | YES   | Same lifecycle as PurchaseOrderApproval.status                                                                                                                                                                   |
| GiftCard.status (3615)               | String `@default("ACTIVE")`  | `GiftCardStatus`          | New                       | ACTIVE, REDEEMED, EXPIRED, DEACTIVATED                                                                                                                   | YES   | Service writes `'DEACTIVATED'` (gift-cards.service.ts:179); cleanup writes `'EXPIRED'`                                                                                                                           |
| GiftCard.issueType (3616)            | String `@default("MANUAL")`  | `GiftCardIssueType`       | New                       | MANUAL, SYSTEM, BULK                                                                                                                                     | YES   | DTO `issueType` changes `@IsString` → `@IsEnum`                                                                                                                                                                  |
| GiftCardTransaction.type (3645)      | String                       | `GiftCardTransactionType` | New                       | ISSUE, RECHARGE, REDEEM, REFUND, VOID                                                                                                                    | YES   | Service writes `ISSUE/RECHARGE/REDEEM` (gift-cards.service.ts:35/103/146)                                                                                                                                        |
| WebhookDelivery.status (3559)        | String `@default("PENDING")` | `WebhookDeliveryStatus`   | New                       | PENDING, SENT, FAILED, RETRYING                                                                                                                          | YES   | Delivery service cycles values                                                                                                                                                                                   |
| WebhookDelivery.eventType (3556)     | String                       | `WebhookEventType`        | New                       | 23 identifier members, each carrying a per-member `@map("<dotted wire value>")` (e.g. `ORDERS_CREATED @map("orders.created")`); full mapping in §9.9.1   | YES   | Mirror `$subscribedEvents` set (webhook-event-emitter.ts:11). Dotted values (`orders.created`, …) are NOT valid Prisma identifiers — `@map` is required so the persisted wire values stay identical (see §9.9.1) |
| BackupRecord.type (3746)             | String `@default("FULL")`    | `BackupRecordType`        | New                       | FULL, INCREMENTAL, MANUAL, AUTOMATED                                                                                                                     | YES   | Service default `'FULL'` (backup.service.ts:15)                                                                                                                                                                  |
| BackupRecord.status (3747)           | String `@default("PENDING")` | `BackupRecordStatus`      | New                       | PENDING, IN_PROGRESS, COMPLETED, FAILED, EXPIRED                                                                                                         | YES   | All 5 written by backup.service.ts                                                                                                                                                                               |
| DataExportRequest.status (3722)      | String `@default("PENDING")` | `BackupRecordStatus`      | Reuse                     | PENDING, IN_PROGRESS, COMPLETED, FAILED, EXPIRED                                                                                                         | YES   | privacy.service.ts:102 writes `'PENDING'`                                                                                                                                                                        |
| DataExportRequest.requestType (3723) | String `@default("FULL")`    | `BackupRecordType`        | Reuse                     | FULL, INCREMENTAL, MANUAL, AUTOMATED                                                                                                                     | YES   | privacy.service.ts:102 writes `'FULL'`                                                                                                                                                                           |
| DataExportRequest.format (3724)      | String `@default("JSON")`    | `ExportFormat`            | New                       | JSON, CSV, EXCEL, PDF                                                                                                                                    | YES   | Default `"JSON"`; DTO `ReportFormat`/`ExportType` have no JSON member, so **no merge**                                                                                                                           |
| PurchaseOrderApproval.status (2689)  | String                       | `ApprovalStatus`          | Reuse                     | PENDING, APPROVED, REJECTED                                                                                                                              | YES   | Same domain as CampaignApproval.status                                                                                                                                                                           |
| SupplierDetail.status (2544)         | String `@default("ACTIVE")`  | `SupplierStatus`          | New                       | ACTIVE, INACTIVE, SUSPENDED, PENDING                                                                                                                     | YES   | Default maps cleanly                                                                                                                                                                                             |
| StockAdjustment.status (2917)        | String `@default("PENDING")` | `StockAdjustmentStatus`   | New                       | PENDING, APPROVED, REJECTED                                                                                                                              | YES   | Default matches first member                                                                                                                                                                                     |
| InventoryCount.status (2984)         | String `@default("PENDING")` | `InventoryCountStatus`    | New                       | DRAFT, IN_PROGRESS, COMPLETED, CANCELLED, VERIFIED                                                                                                       | YES\* | \*AUDIT: default `"PENDING"` vs member `DRAFT` — add `PENDING` member if it is a real lifecycle state                                                                                                            |
| ExpirationAlert.alertType (3005)     | String `@default("WARNING")` | `ExpirationAlertType`     | New                       | WARNING, CRITICAL, EXPIRED                                                                                                                               | YES   | Default matches first member                                                                                                                                                                                     |
| CycleCount.countType (3353)          | String `@default("FULL")`    | `CycleCountType`          | New                       | FULL, CYCLE, PHYSICAL, SPOT                                                                                                                              | YES   | Existing `CountType` (2340) has no `FULL`; **cannot reuse**                                                                                                                                                      |
| ScheduledReport.type (3464)          | String                       | `ReportType`              | Reuse                     | SALES, INVENTORY, KITCHEN, FINANCIAL, CUSTOM                                                                                                             | YES   | DTO + service align exactly                                                                                                                                                                                      |
| ScheduledReport.format (3465)        | String                       | `ReportFormat`            | New (mirrors DTO)         | CSV, EXCEL, PDF                                                                                                                                          | YES   | DTO `ReportFormat` identical (create-scheduled-report.dto.ts:11)                                                                                                                                                 |
| ReportExport.type (3484)             | String                       | `ReportFormat`            | Reuse                     | CSV, EXCEL, PDF                                                                                                                                          | YES   | export-engine writes `dto.type` from `ExportType` (same members)                                                                                                                                                 |
| ReportExport.reportType (3485)       | String                       | `ReportType`              | Reuse                     | SALES, INVENTORY, KITCHEN, FINANCIAL, CUSTOM                                                                                                             | YES   | Bounded by scheduled-report domain                                                                                                                                                                               |
| ReportExport.status (3491)           | String                       | `ReportExportStatus`      | New                       | PENDING, PROCESSING, COMPLETED, FAILED                                                                                                                   | YES   | export-engine.service.ts writes all 4; no `CANCELED` in code                                                                                                                                                     |
| ConsentRecord.type (3672)            | String                       | `ConsentType`             | New                       | MARKETING_EMAIL, SMS, PUSH_NOTIFICATIONS, DATA_PROCESSING, THIRD_PARTY_SHARING                                                                           | YES\* | Consent category domain is bounded. \*Confirmed by audit                                                                                                                                                         |

**Table 9.9-B — Fields kept as String (11)**

| Model:Field (line)                                      | Why it stays String                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| StockMovement.referenceType (2770) `String?`            | Polymorphic model-name reference keyed to `referenceId`; not a closed domain |
| LoyaltyPointsTransaction.referenceType (1664) `String?` | Same polymorphic pattern                                                     |
| WalletTransaction.referenceType (1784) `String?`        | Same polymorphic pattern                                                     |
| CrmTimelineEntry.referenceType (1977) `String?`         | Same polymorphic pattern                                                     |
| GiftCardTransaction.referenceType (3651) `String?`      | Same polymorphic pattern                                                     |
| EventRule.event (2237)                                  | Open domain-event names; any event may be registered                         |
| EventLog.event (2259)                                   | Open domain-event names                                                      |
| Order.source (920)                                      | Open POS/channel provenance                                                  |
| Customer.source (1514)                                  | Open acquisition attribution                                                 |
| Customer.gender (1505)                                  | Free-form / locale-dependent                                                 |
| ReorderSuggestion.priority (3302)                       | Service-derived; DTO enum only, DB field not contractually constrained       |

**Table 9.9-C — Prior candidates removed (did not exist in schema)**

| Removed candidate                                       | Resolution                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Notification.status                                     | `Notification` (1194) has no `status` field                                              |
| ReplenishmentRequest.status / ReplenishmentRequest.type | No `ReplenishmentRequest` model exists                                                   |
| SupplierDetail.type                                     | `SupplierDetail` (2531) has no `type` field (only `status`)                              |
| GoodsReceiptItem.status                                 | `GoodsReceiptItem` (2733) has no `status` field                                          |
| ConsentRecord.consentType                               | `ConsentRecord` (3667) has only `type`                                                   |
| EventLog.source                                         | `EventLog` (2256) has no `source` field                                                  |
| WebhookRegister.status                                  | Model is `WebhookRegistration` (3522); lifecycle flag is `isActive Boolean`, no `status` |
| ApiKey.scope                                            | Field is `scopes String[]` (array, 3588); not a scalar enum candidate                    |
| BackupRequest.requestType / status                      | Actual model is `DataExportRequest` (3718) — covered by rows 14–16                       |
| InventoryCount.countType as String                      | Already enum `CountType` (2975); **no conversion needed**                                |

**Enum reuse / merge map (no duplicate `enum` declarations):**

- `ReportType` ×3 fields: Report.type, ScheduledReport.type, ReportExport.reportType
- `ReportFormat` ×2 fields: ScheduledReport.format, ReportExport.type
- `ApprovalStatus` ×2 fields: CampaignApproval.status, PurchaseOrderApproval.status
- `BackupRecordType` ×2 fields: BackupRecord.type, DataExportRequest.requestType
- `BackupRecordStatus` ×2 fields: BackupRecord.status, DataExportRequest.status
- `CampaignType` / `CampaignStatus`: reuse existing schema enums (1942 / 1934) — field-type conversion only
- `ExportFormat` (JSON/CSV/EXCEL/PDF) is **standalone** for DataExportRequest.format — schema default `"JSON"` rules out merging with `ReportFormat` (CSV/EXCEL/PDF)
- `CountType` is **not** reused for CycleCount.countType (lacks `FULL`); new `CycleCountType { FULL, CYCLE, PHYSICAL, SPOT }`

**9.9.1 — `WebhookEventType` member↔wire mapping (identifier members + `@map`)**

Prisma enum members must be valid identifiers (letters/digits/underscore, starting with a letter) — dotted names are rejected by `prisma validate`. Each member below is declared with an identifier name and a per-member `@map("<wire value>")` so the persisted/stored value is unchanged. The 23 wire values exactly match `$subscribedEvents` (webhook-event-emitter.ts:11).

```prisma
enum WebhookEventType {
  ORDERS_CREATED         @map("orders.created")
  ORDERS_UPDATED         @map("orders.updated")
  ORDERS_COMPLETED       @map("orders.completed")
  ORDERS_CANCELLED       @map("orders.cancelled")
  CUSTOMERS_CREATED      @map("customers.created")
  CUSTOMERS_UPDATED      @map("customers.updated")
  CUSTOMERS_DELETED      @map("customers.deleted")
  INVENTORY_LOW_STOCK    @map("inventory.low_stock")
  INVENTORY_OUT_OF_STOCK @map("inventory.out_of_stock")
  INVENTORY_RECEIVED     @map("inventory.received")
  PAYMENTS_COMPLETED     @map("payments.completed")
  PAYMENTS_FAILED        @map("payments.failed")
  PAYMENTS_REFUNDED      @map("payments.refunded")
  LOYALTY_POINTS_EARNED  @map("loyalty.points_earned")
  LOYALTY_POINTS_REDEEMED @map("loyalty.points_redeemed")
  LOYALTY_TIER_CHANGED   @map("loyalty.tier_changed")
  CAMPAIGNS_SENT         @map("campaigns.sent")
  CAMPAIGNS_OPENED       @map("campaigns.opened")
  CAMPAIGNS_CLICKED      @map("campaigns.clicked")
  SUPPLIERS_CREATED      @map("suppliers.created")
  SUPPLIERS_UPDATED      @map("suppliers.updated")
  TRANSFERS_CREATED      @map("transfers.created")
  TRANSFERS_COMPLETED    @map("transfers.completed")
}
```

The identifiers (`ORDERS_CREATED`, …) are never persisted; the wire values (`orders.created`, …) are the `@map` strings, and all Prisma-facing code (`@default`, queries, generated TS types) uses the identifier form while Redis/JSON/webhook payloads keep the dotted wire values. The audit script validates against the mapped wire values (see §15.4).

**Counts (verified):** 28 convertible fields · 20 new schema enums · 2 existing enums reused (`CampaignType`, `CampaignStatus`) · 11 fields kept String · 1 field already enum-typed (`InventoryCount.countType` → `CountType`). All section counts are reconciled to these figures (see §25/§26).

**Rules for enum conversion:**

- **Reuse before define:** if an enum with the target member set already exists in `prisma/schema.prisma`, reuse it; never redefine a name already declared (a duplicate `enum` declaration fails `prisma validate`/migrate).
- Enum member names MUST equal the uppercase string values in use (case-sensitive match verified by the pre-migration data audit script, §16) — **EXCEPT** where the stored value is not a valid Prisma identifier (e.g. dotted webhook event names). In that case the member is declared as a valid identifier carrying a per-member `@map("<value>")`, so the persisted wire value stays identical (see `WebhookEventType` in §9.9.1).
- Mapped-string coverage: the audit script compares every distinct stored value against each enum's **mapped wire value** (the `@map` string when present, otherwise the member name), never against the Prisma identifier alone (§15.4).
- Defaults are preserved (`@default("PENDING")`, `@default("ACTIVE")`, `@default("FULL")`, `@default("JSON")`, `@default("WARNING")`, etc.).
- Any value in existing data that does not match a member is mapped to the enum default per a mapping table produced by the audit script; the mapping table is part of the migration and reviewed before apply.
- App code that assigns/compares these fields is updated to the regenerated enum types (build + tests gate this).

### 9.10 7.4.13 — `@db.Decimal(10,2)` on 9 monetary fields (P1-8)

| Model:Field                         | Line | Action                  |
| ----------------------------------- | ---- | ----------------------- |
| Wallet.balance                      | 1758 | add `@db.Decimal(10,2)` |
| WalletTransaction.amount            | 1779 | add `@db.Decimal(10,2)` |
| WalletTransaction.balanceBefore     | 1780 | add `@db.Decimal(10,2)` |
| WalletTransaction.balanceAfter      | 1781 | add `@db.Decimal(10,2)` |
| Membership.totalSpent               | 1687 | add `@db.Decimal(10,2)` |
| VisitHistory.totalSpent             | 1595 | add `@db.Decimal(10,2)` |
| CustomerAnalytics.lifetimeValue     | 1868 | add `@db.Decimal(10,2)` |
| CustomerAnalytics.averageOrderValue | 1869 | add `@db.Decimal(10,2)` |
| CustomerAnalytics.totalSpend        | 1872 | add `@db.Decimal(10,2)` |

---

## 10. API Endpoints

### 10.1 Modified — stock endpoints (7.4.9)

| Endpoint                        | Before               | After                                                                                                                                    |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /inventory/low-stock`      | raw array, unbounded | `GET /inventory/low-stock?page=1&limit=20` → `{ data: InventoryItem[], meta: { total, page, limit, totalPages, hasNext, hasPrevious } }` |
| `GET /inventory/critical-stock` | raw array, unbounded | same paginated envelope                                                                                                                  |
| `GET /inventory/out-of-stock`   | raw array, unbounded | same paginated envelope                                                                                                                  |

- Handlers accept the existing `QueryInventoryDto` (`page` default 1, `limit` default 20, min 1, max 100 via `PAGINATION_DEFAULTS` in `@tablofy/shared/constants`).
- All three remain behind global auth guards; route handlers unchanged (controller lines 274–287), only query params + response construction change.

### 10.2 New endpoints

None.

### 10.3 Unchanged endpoints

All other endpoints (auth, tenants, orders, payments, inventory CRUD, etc.) are untouched.

### 10.4 Contract change notice

The stock-endpoint response shape changes from a bare array to the shared paginated envelope `{ data, meta }`. This is the only breaking contract change in M4. Consumers must be updated in lock-step (documented in §17 and PHASE7-M4-CHANGELOG.md).

---

## 11. DTOs

### New DTO

None. The stock endpoints reuse the existing `QueryInventoryDto` at `apps/api/src/modules/inventory/dto/query-inventory.dto.ts:4–53`, which already provides `page?` (`@IsInt()`, `@Min(1)`) and `limit?` (`@IsInt()`, `@Min(1)`, `@Max(100)`) plus `search`/`sortBy`/`sortOrder` filters. No new query DTO is introduced.

### Modified DTOs

None. Existing inventory DTOs (`QueryInventoryDto`, `QueryStockAdjustmentDto`, `QueryWasteEntryDto`, `QueryInventoryCountDto`) are unchanged.

### Consumed shared types

- `PaginatedResponse` / `buildPaginatedResponse` from `@tablofy/shared/types` / `@tablofy/shared/utils` — the inventory responses adopt the shared envelope: `{ data: T[], meta: { total, page, limit, totalPages, hasNext, hasPrevious } }`. (The helper is defined at libs/shared/utils/src/index.ts:3–22; the repo's existing inline meta omits `hasNext`/`hasPrevious`.)

---

## 12. Configuration

| Item                                 | Change                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/constants/src/index.ts` | Extend `CACHE_TTL` (line 121–125) with named constants for the durations currently hardcoded in code: orders 30s (orders.service.ts:238, 266) and inventory 120s (inventory.service.ts:588). Inventory's 300s sites (lines 156, 266, 375, 516) map to the existing `CACHE_TTL.MEDIUM` (300) — no new constant. Existing `SHORT: 60 / MEDIUM: 300 / LONG: 3600` remain. |
| `apps/api/jest.config.ts`            | Add coverage thresholds for `modules/inventory/*` and `common/services/cache.service.ts` files touched by M4 (match existing threshold style for auth/orders/tenants/prisma/payments)                                                                                                                                                                                  |
| `scripts/verify-phase7-m4.js`        | New automated verification harness (see §24)                                                                                                                                                                                                                                                                                                                           |
| `scripts/m4-audit-enum-data.js`      | New pre-migration enum data audit (see §15.4)                                                                                                                                                                                                                                                                                                                          |
| `scripts/m4-audit-orphan-data.js`    | New pre-M4-01 orphan-data audit (see §9.2/§16 step 2)                                                                                                                                                                                                                                                                                                                  |
| `prisma.config.ts`                   | No change expected (already configured for the project DB)                                                                                                                                                                                                                                                                                                             |

---

## 13. Environment Variables

**No new environment variables.**

All M4 changes (schema, cache SCAN, pagination) are configuration-free. `.env.example` is untouched. The pre-migration data audit script reads the existing `DATABASE_URL` from the environment, and `prisma migrate` uses the existing Prisma configuration.

---

## 14. Security Considerations

| #   | Concern                                         | Handling                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | **Tenant deletion currently impossible** (P0-6) | Adding cascade makes tenant deletion possible and GDPR right-to-erasure compliant. This is intentional; deletion is destructive by design — guards must ensure only authorized tenants/roles can invoke delete (existing TenantGuard/RolesGuard cover this). |
| S2  | **Cascade data-loss risk**                      | Cascade is limited to the 19 named relations. Customer's own dependents (orders, wallet history) use their existing cascade/referential rules; we do not broaden cascade beyond the finding.                                                                 |
| S3  | **Enum values from untrusted input**            | After conversion, Prisma validates enum fields at the client layer — invalid status/type strings can no longer be persisted (defense-in-depth beyond class-validator).                                                                                       |
| S4  | **Blocking Redis KEYS → latency**               | SCAN is non-blocking; batched DELs avoid multi-thousand-key `del(...keys)` single calls. No auth/permission surface changes.                                                                                                                                 |
| S5  | **SCAN count safety**                           | `COUNT 100` batch size; loop terminates on `cursor === '0'`; pattern is tenant-prefixed so SCAN only touches the tenant's namespace (no cross-tenant data exposure).                                                                                         |
| S6  | **Soft-delete columns**                         | `deletedAt` is additive and nullable; existing read paths are unchanged, so no accidental data filtering occurs until soft-delete behavior is implemented in a later milestone.                                                                              |
| S7  | **Migration safety**                            | All migrations are additive/index/type-conversion with a pre-apply data audit; `migrate deploy` runs in maintenance window; backups taken before apply (see §16/§17).                                                                                        |
| S8  | **Secrets**                                     | No new secrets, no logging changes, no `.env` changes.                                                                                                                                                                                                       |

---

## 15. Testing Strategy

M4 is primarily a schema/perf milestone. Tests focus on the changed application code; schema changes are validated by migration + verification scripts rather than unit tests.

### 15.1 Unit tests (new/modified)

| Suite                                                                 | Covers                                                                                                                                      | Type                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `common/services/tests/cache.service.spec.ts` (extend — exists)       | `deletePattern`/`invalidateTenantCache`/`scanPattern` use SCAN, batch DEL, terminate on cursor `0`, pass `MATCH` pattern; KEYS never called | Unit (mock `RedisService`)  |
| `modules/usage/tests/usage-tracking.service.spec.ts` (new)            | KEYS call sites (lines 70, 106) replaced with SCAN helper                                                                                   | Unit                        |
| `modules/inventory/tests/inventory.service.spec.ts` (extend — exists) | low/critical/out-of-stock push down WHERE + return `buildPaginatedResponse` meta; thresholds respected                                      | Unit (mock `PrismaService`) |
| `modules/inventory/tests/inventory.controller.spec.ts` (new)          | `@Query` DTO defaults (page=1, limit=20), validation errors on limit>100, envelope shape `{ data, meta }`                                   | Unit                        |

### 15.2 Regression

- Full existing suite (41 suites / 347 tests passing at v7.3.0) must remain green.
- Payment module tests (M3) must pass unchanged.
- Build + lint must pass (see §24). Pre-existing ESLint unused-var errors in `orders.service.ts` (4) are tracked separately and NOT introduced by M4.

### 15.3 Schema verification (scripted, not unit tests)

`scripts/verify-phase7-m4.js` performs static verification against the generated Prisma client and schema text:

- 19 cascade relations present (P0-6) — script-verified count
- MembershipHistory/EventLog have `@relation` (P0-7)
- All **105** models with both `tenantId` and `createdAt` have `@@index([tenantId, createdAt])` (P1-6); the 13 excluded models (no `createdAt`) are NOT indexed
- All 48 soft-delete models have `@@index([tenantId, deletedAt])` (P2-6)
- Order has both composite indexes (P1-10); AuditLog has `[createdAt, isArchived]` (P1-14)
- **78** models have `deletedAt` (P2-7); **38** models added `updatedAt @updatedAt` (P2-8), with `CookiePreference` excluded (already has `@updatedAt` via `lastUpdated`)
- 28 string fields converted to enums (20 new enums, 2 reused existing: `CampaignType`/`CampaignStatus`); 9 Decimal fields have `@db.Decimal(10,2)` (P1-7/P1-8)
- 0 remaining `client.keys(` in cache/usage-tracking services (P1-9)
- 0 hardcoded numeric TTLs in orders/inventory (P2-12 revised)

### 15.4 Pre-migration data audit (7.4.12)

`scripts/m4-audit-enum-data.js` queries each target column and reports:

- distinct values not matching enum members (drift list)
- row counts affected (0 expected for clean conversions)
- produces the value→default mapping table reviewed before the enum migration applies
- **mapped-string member-coverage check (for reused enums):** verifies every distinct stored value is covered by an existing enum's members BEFORE the enum is reused, comparing each stored value against the member's **mapped wire value** (the `@map` string when present, otherwise the member name) — e.g., `CampaignType` EMAIL/SMS/PUSH/WHATSAPP, `CampaignStatus` DRAFT/ACTIVE/PAUSED/COMPLETED/CANCELLED, and every `WebhookEventType` dotted wire value such as `orders.created` (`@map` member, §9.9.1). If any stored value lacks a member, the script lists the value→default mapping and **halts** the M4-05 migration until reviewed.

### 15.5 Coverage

Extend `apps/api/jest.config.ts` thresholds for touched inventory/cache files per existing style. No new global threshold changes.

---

## 16. Migration Strategy

Six Prisma migrations, applied in dependency order. All are committed to `prisma/migrations/`. Batching is deliberate: non-destructive work first, highest-risk (enum) last.

| #     | Migration name                            | Tasks               | Destructive?                      | Notes                                                                                                                                                                                                          |
| ----- | ----------------------------------------- | ------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4-01 | `m4_1_cascade_and_orphan_relations`       | 7.4.1, 7.4.2        | No (schema FK/DELETE rule change) | FK ON DELETE CASCADE alters existing constraints; new MembershipHistory/EventLog FKs require the orphan-data audit to report 0 orphans first (§9.2, §16 step 2); rollback via reverse migration                |
| M4-02 | `m4_2_tenant_createdAt_indexes`           | 7.4.3               | No                                | 105 `CREATE INDEX`                                                                                                                                                                                             |
| M4-03 | `m4_3_soft_delete_and_updated_at_indexes` | 7.4.4, 7.4.5, 7.4.7 | No                                | 48 + Order + AuditLog composite indexes                                                                                                                                                                        |
| M4-04 | `m4_4_deletedAt_and_updatedAt_columns`    | 7.4.10, 7.4.11      | No                                | Additive nullable columns; `@updatedAt` maintenance automatic                                                                                                                                                  |
| M4-05 | `m4_5_enum_conversions`                   | 7.4.12              | **Yes** (column type changes)     | Pre-audit required; mapping table reviewed; highest risk. Reuses existing enums where present (`CampaignType`/`CampaignStatus`); all other enums are new                                                       |
| M4-06 | `m4_6_decimal_precision`                  | 7.4.13              | **Yes** (column type change)      | `Decimal` → `Decimal(10,2)` — **decimal narrowing to (10,2)** from Postgres' unbounded default `numeric`; non-lossy only for existing values within range (≤ 99,999,999.99, scale 2; verified by R8 pre-check) |

### Procedure

1. Local: edit `prisma/schema.prisma` per batch → `npx prisma migrate dev --name m4_N_<slug>` → SQL reviewed → commit.
2. Run `scripts/m4-audit-orphan-data.js` **before M4-01**: counts orphan rows in `membership_history` (by `customerId`/`tenantId`) and `event_logs` (by `tenantId`/`ruleId`). If any orphans are found, review the affected-row listing and clean up per §9.2 (delete orphan rows / backfill missing parents / null optional FKs), then re-run until **0 orphan rows** — otherwise the FK creation inside M4-01 fails.
3. Run `scripts/m4-audit-enum-data.js` **before M4-05**; review drift report + mapping table + mapped-string member-coverage check (incl. `@map` wire values, §9.9.1).
4. Staging: `npx prisma migrate deploy` (non-interactive).
5. `npx prisma generate` after each batch; run build + full test suite.
6. Production: `migrate deploy` in a maintenance window with a fresh DB backup (§17).
7. Verification: `scripts/verify-phase7-m4.js` asserts every finding is closed.

### Dependency note

M4-04 (additive columns) has no dependency on index migrations; M4-05 (enum) must follow the data audit and must not run before M4-04 (enum defaults reference string defaults that are unchanged). All six can be applied in one deployment sequence with the audit inserted before M4-05.

---

## 17. Rollback Strategy

### 17.1 Since no production deployment in this milestone

The repo remains feature-branch work. Primary rollback is git-level:

```bash
# Revert all schema + code changes for the milestone
git checkout -- prisma/schema.prisma
git checkout -- apps/api/src/common/services/cache.service.ts
git checkout -- apps/api/src/modules/usage/usage-tracking.service.ts
git checkout -- apps/api/src/modules/inventory/
git checkout -- libs/shared/constants/src/index.ts
git checkout -- apps/api/jest.config.ts

# Remove generated migrations
Remove-Item -Recurse -Force prisma/migrations/<timestamp>_m4_*

# Re-run client generation and tests
npx prisma generate
npx nx test api
```

### 17.2 Database rollback (dev/staging)

```bash
npx prisma migrate reset            # drops + re-applies all migrations (dev only)
# or
npx prisma migrate resolve --rolled-back <migration_name>   # mark as rolled back
git checkout prisma/schema.prisma   # restore previous schema
npx prisma migrate deploy           # restore previous state
```

### 17.3 Production rollback (future-proofing; not run in M4)

- Every environment gets a full DB backup before the M4 deployment.
- M4-01 through M4-04 are additive/index; a rollback is `migrate resolve --rolled-back` + schema restore (non-destructive).
- M4-05 (enum) and M4-06 (decimal) are type changes; rollback = restore from backup (no destructive down-migration on live data). Because the enum conversion is 1:1 on values and decimal narrowing to (10,2) preserves values within range, forward apply is safe; backwards restore is a restore-from-backup.

### 17.4 Contract rollback

The paginated stock endpoint is a breaking response change. Rollback of the API contract = `git checkout apps/api/src/modules/inventory/` reverts handlers; clients may need coordinated revert (documented in PHASE7-M4-CHANGELOG.md).

---

## 18. Risks and Blockers

| #   | Risk                                                                                                                                                                                                 | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Enum drift** — existing data contains string values that don't match enum members (case, whitespace, legacy values), OR an existing enum's members don't cover stored values being converted to it | Medium     | High   | Pre-migration audit script produces drift report + mapping table + mapped-string member-coverage check for reused enums; mapping reviewed before M4-05; enum members named to match verified values (or `@map`-ped to non-identifier wire values such as dotted webhook event names, §9.9.1); reuse-before-define rule prevents duplicate `enum` declarations |
| R2  | **Large index creation locks tables** (105 + 48 + 3 indexes)                                                                                                                                         | Medium     | Medium | Apply in maintenance window; Postgres `CREATE INDEX` is non-blocking for reads with `CONCURRENTLY` if required (documented, default sequential in migrate dev); verify on staging with representative data                                                                                                                                                    |
| R3  | **Cascade behavior surprises** — after 7.4.1, deleting a Tenant/User deletes dependents that callers did not expect gone                                                                             | Medium     | High   | Cascade limited to the 19 named relations only; review each FK during implementation; tenant delete endpoints already require explicit action                                                                                                                                                                                                                 |
| R4  | **Enum conversion breaks application code** — services compare `type === 'PENDING'` against now-enum fields                                                                                          | High       | Medium | `prisma generate` regenerates types; build + full test suite catch all compare/assign sites; contained sweep over modules that touch the 28 converted fields                                                                                                                                                                                                  |
| R5  | **SCAN vs KEYS semantics** — SCAN may return keys deleted mid-iteration; `MATCH` + count edge cases                                                                                                  | Low        | Low    | SCAN tolerates misses (best-effort invalidation); keys are re-checked with `DEL`; unit tests cover cursor loop + empty + large sets                                                                                                                                                                                                                           |
| R6  | **Paginated response breaks existing consumers** — stock endpoints change from array to envelope                                                                                                     | High       | Medium | Single, documented contract change; aligned to the shared `PaginatedResponse` contract (libs/shared/types); updated in lock-step with changelog; controller spec asserts shape                                                                                                                                                                                |
| R7  | **Big-batch migration review burden** — 105 + 48 + 78 + 38 model edits in one schema file                                                                                                            | Medium     | Low    | Script-extracted and verified counts (§9/§24); schema diff reviewed per batch; verify script asserts exact model counts                                                                                                                                                                                                                                       |
| R8  | **`@db.Decimal(10,2)` value overflow** — existing values exceeding (10,2) range on convert                                                                                                           | Low        | Medium | Pre-migration check for values > 99,999,999.99; report and halt if found (expected none for monetary fields)                                                                                                                                                                                                                                                  |
| R9  | **`prisma migrate dev` drift vs `deploy`** — dev/staging out of sync with migrations                                                                                                                 | Low        | Medium | Always `migrate deploy` non-interactively after dev; verify script checks `prisma migrate status`                                                                                                                                                                                                                                                             |
| R10 | **Coverage threshold failure** — new spec files must meet configured coverage                                                                                                                        | Medium     | Low    | Add thresholds only for files actually covered; run jest with coverage; adjust per existing style                                                                                                                                                                                                                                                             |
| R11 | **Duplicate `@updatedAt` on CookiePreference** — adding a second `@updatedAt` field fails Prisma validation                                                                                          | Low        | High   | CookiePreference already has `@updatedAt` via `lastUpdated` (schema.prisma:3707) and is excluded from the 7.4.11 target list; verify script asserts the count is 38 with CookiePreference excluded                                                                                                                                                            |
| R12 | **Orphan rows block M4-01 FK creation** — MembershipHistory/EventLog have no FK enforcement today; adding the constraints fails if orphan `customerId`/`tenantId`/`ruleId` rows exist                | Medium     | High   | Pre-M4-01 orphan-data audit (`m4-audit-orphan-data.js`, §9.2/§16 step 2) lists orphan rows; cleanup procedure (delete / backfill / null optional FKs) applied; audit re-run to 0 orphans before M4-01 is generated (G10)                                                                                                                                      |

---

## 19. Estimated Effort

| Task                                                | Days            | Parallelizable         | Dependencies                       |
| --------------------------------------------------- | --------------- | ---------------------- | ---------------------------------- |
| 7.4.1 — Cascade on 19 relations (P0-6)              | 0.5             | ✅                     | None                               |
| 7.4.2 — Orphan relations (P0-7)                     | 0.5             | ✅                     | None                               |
| 7.4.3 — tenant/createdAt indexes, 105 models (P1-6) | 0.5             | ✅                     | None                               |
| 7.4.4 — tenant/deletedAt indexes (P2-6)             | 0.5             | ✅                     | None                               |
| 7.4.5 — Order composite indexes (P1-10)             | 0.25            | ✅                     | None                               |
| 7.4.6 — KEYS→SCAN (P1-9)                            | 1–2             | ✅                     | None                               |
| 7.4.7 — AuditLog index (P1-14)                      | 0.25            | ✅                     | None                               |
| 7.4.8 — Stock DB filtering (P1-11)                  | 0.5             | ✅ Parallel with 7.4.9 | None                               |
| 7.4.9 — Stock pagination (P1-12)                    | 0.5             | ✅ Parallel with 7.4.8 | None                               |
| 7.4.10 — deletedAt on 78 models (P2-7)              | 1               | ✅                     | None                               |
| 7.4.11 — updatedAt on 38 models (P2-8)              | 0.5             | ✅                     | None                               |
| 7.4.12 — 28 enum conversions (P1-7)                 | 2–3             | ❌ Requires data audit | Audit, 7.4.10/7.4.11 (batch order) |
| 7.4.13 — Decimal precision (P1-8)                   | 0.5             | ✅                     | None                               |
| 7.4.14 — TTL standardization (P2-12)                | 0.5             | ✅                     | 7.4.6 (same files)                 |
| Migrations + generate + verify script               | 1               | ❌                     | All tasks                          |
| Tests + quality gates + reports                     | 1.5             | ❌                     | All tasks                          |
| **Subtotal**                                        | **~12–14 days** |                        |                                    |
| With 25% buffer                                     | **~15–18 days** |                        |                                    |

### Parallel Execution Groups

```
Group A (parallel, days 1–3):  7.4.1  7.4.2  7.4.3  7.4.4  7.4.5  7.4.7  (schema batch 1–3)
Group B (parallel, days 1–3):  7.4.6  7.4.14 (cache SCAN + TTL)
Group C (parallel, days 2–4):  7.4.8  7.4.9  7.4.10  7.4.11  7.4.13
Group D (days 4–6):            data audit → 7.4.12 (enum conversion)
Group E (days 6–8):            migrate batches 4–6, generate, verify script, full test suite
Group F (days 8–10):           coverage, PHASE7-M4-REPORT.md, CHANGELOG, tag v7.4.0
```

**Calendar estimate:** ~8–10 working days (1 engineer) with parallelization; ~15–18 days serial with buffer. Consistent with roadmap's 2–3 weeks.

---

## 20. Deliverables

### Documentation

- `PHASE7-M4-IMPLEMENTATION-PLAN.md` / `PHASE7-M4-IMPLEMENTATION-PLAN-v2.md` — this document
- `PHASE7-M4-REPORT.md` — milestone completion report (post-implementation)
- `PHASE7-M4-CHANGELOG.md` — per-file change log + contract-change notice (post-implementation)

### Prisma migrations (generated, committed)

- 6 migrations: `m4_1_cascade_and_orphan_relations`, `m4_2_tenant_createdAt_indexes`, `m4_3_soft_delete_and_updated_at_indexes`, `m4_4_deletedAt_and_updatedAt_columns`, `m4_5_enum_conversions`, `m4_6_decimal_precision`

### Verification scripts

- `scripts/verify-phase7-m4.js` — automated pass/fail verification harness (build, lint, tests, static schema/code assertions per finding)
- `scripts/m4-audit-enum-data.js` — pre-M4-05 data drift audit (distinct values per enum column, affected row counts, mapping table, mapped-string member-coverage check)
- `scripts/m4-audit-orphan-data.js` — pre-M4-01 orphan-data audit (orphan `membership_history`/`event_logs` rows by `customerId`/`tenantId`/`ruleId`; must report 0 orphans before M4-01)

### Reports (generated during quality gates)

- Coverage report (`coverage/lcov-report/index.html`)
- Test results (Jest XML output)
- `prisma migrate status` / migration drift check output

### Tag

- `v7.4.0` — milestone completion tag (after quality gates pass)

---

## 21. File Inventory

### Files to Create (7)

```
scripts/verify-phase7-m4.js                              # verification harness
scripts/m4-audit-enum-data.js                            # enum data drift audit + mapped-string member-coverage check
scripts/m4-audit-orphan-data.js                          # pre-M4-01 orphan FK audit (MembershipHistory/EventLog)
apps/api/src/modules/inventory/tests/inventory.controller.spec.ts  # pagination/validation/envelope tests
apps/api/src/modules/usage/tests/usage-tracking.service.spec.ts    # SCAN unit tests
PHASE7-M4-REPORT.md                                      # (post-implementation)
PHASE7-M4-CHANGELOG.md                                   # (post-implementation)
```

Plus 6 generated migration directories under `prisma/migrations/<timestamp>_m4_*/` (each containing `migration.sql` + `migration_lock.toml` update).

### Files to Modify (10 = 8 source/spec + schema + config)

```
prisma/schema.prisma                                        # all 10 schema change groups (7.4.1–7.4.5, 7.4.7, 7.4.10–7.4.13)
apps/api/src/common/services/cache.service.ts               # KEYS→SCAN (7.4.6), TTL (7.4.14)
apps/api/src/modules/usage/usage-tracking.service.ts        # KEYS→SCAN lines 70, 106 (7.4.6)
apps/api/src/modules/inventory/inventory.controller.ts      # @Query DTO + paginated responses (7.4.9)
apps/api/src/modules/inventory/inventory.service.ts         # DB filtering + pagination + TTL (7.4.8/7.4.9/7.4.14)
apps/api/src/modules/orders/orders.service.ts               # TTL constant (7.4.14) — no logic change
libs/shared/constants/src/index.ts                          # extend CACHE_TTL named constants (7.4.14)
apps/api/jest.config.ts                                     # inventory/cache coverage thresholds
apps/api/src/common/services/tests/cache.service.spec.ts    # extend for SCAN (file exists)
apps/api/src/modules/inventory/tests/inventory.service.spec.ts  # extend for DB filtering + pagination (file exists)
```

### Files touched only by `prisma generate` (regenerated, not hand-edited)

```
generated Prisma client (node_modules/.prisma/*)            # enum + Decimal types for 28+9 fields
```

### Files NOT changed (explicit)

`app.module.ts`, `main.ts`, `.env`, `.env.example`, `prisma.config.ts`, all other modules.

---

## 22. Finding-to-Task Mapping

| Forensic Finding | Verdict         | Roadmap Task | Deliverable                                                   |
| ---------------- | --------------- | ------------ | ------------------------------------------------------------- |
| P0-6             | ✅              | 7.4.1        | M4-01 migration + verify assertion                            |
| P0-7             | ✅              | 7.4.2        | M4-01 migration + orphan-data audit + verify assertion        |
| P1-6             | ✅              | 7.4.3        | M4-02 migration + verify assertion                            |
| P2-6             | ✅              | 7.4.4        | M4-03 migration + verify assertion                            |
| P1-10            | ✅              | 7.4.5        | M4-03 migration + verify assertion                            |
| P1-9             | ✅              | 7.4.6        | cache/usage-tracking service changes + specs                  |
| P1-14            | ✅              | 7.4.7        | M4-03 migration + verify assertion                            |
| P1-11            | ✅              | 7.4.8        | inventory.service.ts DB filtering + specs                     |
| P1-12            | ✅              | 7.4.9        | controller/service pagination via QueryInventoryDto + specs   |
| P2-7             | ✅              | 7.4.10       | M4-04 migration + verify assertion                            |
| P2-8             | ✅              | 7.4.11       | M4-04 migration + verify assertion                            |
| P1-7             | ✅              | 7.4.12       | M4-05 migration + audit script + app type sweep               |
| P1-8             | ✅              | 7.4.13       | M4-06 migration + verify assertion                            |
| P2-12 (revised)  | ❌ FP → revised | 7.4.14       | shared constants + cache/orders/inventory TTL standardization |

Every task 7.4.1–7.4.14 maps 1:1 to a verified finding. No task is added that is not backed by a forensic finding.

---

## 23. Success Criteria

- [ ] `prisma migrate status` reports all 6 M4 migrations applied, zero drift
- [ ] All 19 cascade relations confirmed present (script-verified, P0-6)
- [ ] MembershipHistory and EventLog have enforced `@relation` FKs (P0-7)
- [ ] Orphan-data audit reports **0 orphan rows** in `membership_history`/`event_logs` before M4-01 (P0-7, G10)
- [ ] All 105 models with both `tenantId` and `createdAt` have `@@index([tenantId, createdAt])` (P1-6); 13 excluded models (no `createdAt`) are NOT indexed
- [ ] All 48 soft-delete models have `@@index([tenantId, deletedAt])` (P2-6)
- [ ] Order has both composite indexes; AuditLog has `[createdAt, isArchived]` (P1-10, P1-14)
- [ ] 78 models gained `deletedAt`; 38 models gained `updatedAt @updatedAt` (P2-7, P2-8); CookiePreference excluded (already has `@updatedAt` via `lastUpdated`)
- [ ] 28 string fields converted to enums (20 new enums, 2 reused existing) with zero data drift (audit report clean, reuse-before-define applied, P1-7)
- [ ] 9 monetary fields have `@db.Decimal(10,2)` (P1-8)
- [ ] Zero `client.keys(` remaining in cache/usage-tracking services (P1-9)
- [ ] Zero hardcoded numeric cache TTLs in orders/inventory (P2-12 revised)
- [ ] Stock endpoints return the shared `{ data, meta }` envelope with correct `totalPages`/`hasNext`/`hasPrevious`; validation rejects limit>100 (P1-12)
- [ ] Full test suite green (existing 41 suites / 347 tests + new M4 specs), build + lint pass
- [ ] Coverage thresholds met per `jest.config.ts`
- [ ] `PHASE7-M4-REPORT.md` + `PHASE7-M4-CHANGELOG.md` published; tag `v7.4.0` created

---

## 24. Quality Gates

`scripts/verify-phase7-m4.js` runs these gates and reports pass/fail counts (mirrors the M3 harness pattern):

| Gate | Check                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | `npx nx build api` succeeds                                                                                                                                                                                                                                                                                                                                                     |
| G2   | `npx nx lint api` succeeds (no NEW lint errors vs baseline; 4 pre-existing orders.service.ts unused-var errors tracked separately)                                                                                                                                                                                                                                              |
| G3   | `npx nx test api` succeeds (all suites incl. new M4 specs)                                                                                                                                                                                                                                                                                                                      |
| G4   | `npx prisma migrate status` clean                                                                                                                                                                                                                                                                                                                                               |
| G5   | Static schema assertions: 19 cascades (script-verified), 2 orphan relations, 105 tenant/createdAt indexes (13 excluded models NOT indexed), 48 tenant/deletedAt indexes, Order×2 + AuditLog composites, 78+38 new columns (CookiePreference excluded from updatedAt), 20 new enums (28 enum-field conversions incl. 2 reused existing), 9 decimals (grep/parse `schema.prisma`) |
| G6   | Static code assertions: 0 `client.keys(`, 0 hardcoded numeric TTLs in orders/inventory, stock endpoints use `@Query()` DTO                                                                                                                                                                                                                                                      |
| G7   | Enum audit: 0 non-mapping values; reused enums pass the mapped-string member-coverage check (from `m4-audit-enum-data.js` output; compares stored values against `@map` wire values when present, §9.9.1)                                                                                                                                                                       |
| G8   | Migration artifacts exist for all 6 batches with `migration.sql` present                                                                                                                                                                                                                                                                                                        |
| G9   | Coverage thresholds met (jest coverage output)                                                                                                                                                                                                                                                                                                                                  |
| G10  | Orphan-data audit reports **0 orphan rows** in `membership_history`/`event_logs` (from `m4-audit-orphan-data.js` output) — required before M4-01                                                                                                                                                                                                                                |

**Blocking rule:** A gate failure blocks the `v7.4.0` tag. Fix-and-re-run until all gates green.

---

## 25. Internal Consistency Check

| Check                                                                                                                                                                    | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Every roadmap task 7.4.1–7.4.14 has a section in §2 and §9/§10                                                                                                           | ✅     |
| Every task maps to exactly one confirmed forensic finding (§22)                                                                                                          | ✅     |
| No task references a finding outside the 3 source documents                                                                                                              | ✅     |
| Effort table (§19) sums consistent with roadmap's 2–3 weeks                                                                                                              | ✅     |
| Migration batches cover all schema tasks; order documented (§16)                                                                                                         | ✅     |
| Only the stock-endpoint contract changes; all other endpoints unchanged (§10)                                                                                            | ✅     |
| No new modules/guards/interceptors/middleware (sections 4,6,7,8)                                                                                                         | ✅     |
| No new env vars (§13)                                                                                                                                                    | ✅     |
| Verification artifacts (script + audit + report + changelog + tag) all listed (§20, §24)                                                                                 | ✅     |
| File inventory complete — every create/modify item enumerated (§21)                                                                                                      | ✅     |
| Out-of-scope items explicitly listed to prevent creep (§2)                                                                                                               | ✅     |
| Counts match schema verification: 126 models, 58 enums, 118 tenantId, 105 tenant+createdAt, 48 deletedAt, 78 missing deletedAt, 38 missing updatedAt, 88 with @updatedAt | ✅     |
| Paths match repo: `modules/usage/`, `tests/` spec convention, no `modules/usage-tracking/`                                                                               | ✅     |
| Response envelope matches `buildPaginatedResponse` (`{ data, meta }`, no `items` field)                                                                                  | ✅     |
| All 17 corrections reflected — 11 validation + 6 release-review (see §26)                                                                                                | ✅     |

---

## 26. Final Consistency Review

| Requirement                             | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zero scope creep**                    | ✅ 14 tasks, all mapped to verified forensic findings (§22); out-of-scope list unchanged; no new modules, DTOs, env vars, or dependencies                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Zero unresolved validation findings** | ✅ All 11 corrections from PHASE7-M4-PLAN-VALIDATION.md applied (see summary below) + all 6 fixes from the release-blocking review applied (rows 12–17)                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Zero contradictory counts**           | ✅ Every count cross-checked against the schema at v7.3.0: 126 models, 58 enums, 118 tenantId, 105 tenant+createdAt, 48 deletedAt, 78 missing deletedAt, 88 with @updatedAt / 38 missing, 48 soft-delete indexes, 28 enum-field conversions (20 new enums + 2 reused existing, 11 fields kept String, 1 already enum-typed), 9 decimals. Used consistently in §1/§2/§3.2/§9/§15.3/§19/§23/§24/§25                                                                                                                                                       |
| **Zero incorrect paths**                | ✅ `modules/usage/usage-tracking.service.ts` (not `usage-tracking/`); all specs under `<module>/tests/`; `cache.service.spec.ts` and `inventory.service.spec.ts` marked as existing (extend); rollback commands in §17.1 use corrected paths                                                                                                                                                                                                                                                                                                            |
| **Zero incorrect Prisma references**    | ✅ Line numbers verified (1522, 1705, 2256, 1543, 1544, 966–977, 396–401, 1343–1344, 1758–1872, 1934/1942, 2279/2290/2340, 3707); `CampaignType`/`CampaignStatus` reused (never redefine); `CountType` NOT reusable for `CycleCount.countType` (lacks `FULL` — new `CycleCountType`); `StockMovementType`/`PurchaseOrderStatus` not reused (no field maps to them); CookiePreference excluded from @updatedAt target; `WebhookEventType` uses valid identifier members + per-member `@map` (dotted wire values are invalid Prisma identifiers — §9.9.1) |
| **Zero architectural inconsistencies**  | ✅ Response envelope unified to `buildPaginatedResponse` (`{ data, meta }`) in §3.5/§5.3/§10.1/§11/§15.1/§23; `app.module.ts` removed from modified list (§4) and stays in NOT-changed (§21); usage-tracking path consistent across §1/§3.1/§4/§5.2/§17.1/§21                                                                                                                                                                                                                                                                                           |
| **Recalculated deliverables**           | ✅ Files to create: **7**; files to modify: **10** (8 source/spec + schema + config); migrations: **6**; verification scripts: **3** (`verify-phase7-m4.js`, `m4-audit-enum-data.js`, `m4-audit-orphan-data.js`); reports: **2** milestone docs + coverage/jest XML/migrate-status outputs                                                                                                                                                                                                                                                              |

### Summary of every correction applied

| #   | Correction (from validation)                                                                                                                                                                                                                | Applied in v2.0                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **High** — Replace `modules/usage-tracking/` with `apps/api/src/modules/usage/`; move `usage-tracking.service.spec.ts` to Files-to-Create                                                                                                   | §1, §3.1, §4, §5.2, §17.1, §21; new spec at `modules/usage/tests/`                                                                |
| 2   | **High** — `cache.service.spec.ts` already exists (extend, not create); add `tests/` component to all spec paths                                                                                                                            | §15.1, §21; all spec paths use `<module>/tests/`                                                                                  |
| 3   | **Medium** — Remove redundant `stock-list-query.dto.ts`; reuse `QueryInventoryDto` (create 7 → 6)                                                                                                                                           | §3.5, §10.1, §11, §15.1, §21, §22. (Net back to 7 files to create once row 14 adds `m4-audit-orphan-data.js` — see Final counts.) |
| 4   | **Medium** — Correct counts: P1-6 target = 105 (tenantId+createdAt, 13 excluded), P2-7 = 78, tenantId = 118, enums = 58                                                                                                                     | §1, §2, §3.2, §9.3, §9.7, §9 header, §15.3, §23, §24 (G5), §25                                                                    |
| 5   | **Medium** — Align response envelope to real `buildPaginatedResponse`: `{ data: T[], meta: { total, page, limit, totalPages, hasNext, hasPrevious } }`                                                                                      | §3.5, §5.3, §10.1, §11, §15.1, §23                                                                                                |
| 6   | **Medium** — Reuse existing enums (`CampaignType`/`CampaignStatus`); field-type conversion only where enum exists; add Enum status column; frozen 28-field inventory added to §9.9                                                          | §3.5, §9.9, §15.3, §15.4, §16 (M4-05), §23                                                                                        |
| 7   | **Low** — Add member-coverage check for reused enums to audit script; halt M4-05 on unmapped stored values                                                                                                                                  | §15.4, §16, §18 (R1), §24 (G7)                                                                                                    |
| 8   | **Low** — Task-numbering footnote vs FINAL-AUDIT; enums 56 → 58                                                                                                                                                                             | §1 footnote, §9 header                                                                                                            |
| 9   | **Low** — Reconcile P0-6 18-enumerated vs 19-claimed; script-verify the 19th                                                                                                                                                                | §9.1, §15.3, §24 (G5)                                                                                                             |
| 10  | **Low** — CookiePreference excluded from 7.4.11 (has `@updatedAt` via `lastUpdated`, schema.prisma:3707); 88 already have `@updatedAt`                                                                                                      | §1, §9.8, §15.3, §18 (R11), §23, §24 (G5)                                                                                         |
| 11  | **Low** — Remove `app.module.ts` from §4 modified list; keep in §21 NOT-changed                                                                                                                                                             | §4, §21, §25                                                                                                                      |
| 12  | **High** — `WebhookEventType` dotted members are invalid Prisma identifiers; declare identifier members with per-member `@map()` (e.g. `ORDERS_CREATED @map("orders.created")`); audit script validates mapped wire values, not identifiers | §9.9 Table 9.9-A, §9.9.1, §9.9 rules, §15.4, §18 (R1), §24 (G7)                                                                   |
| 13  | **Medium** — Complete TTL inventory: orders 30s ×2 (orders.service.ts:238, 266), inventory 120s (inventory.service.ts:588) + 300s ×4 (:156, :266, :375, :516 → `CACHE_TTL.MEDIUM`); G6/§23 zero-TTL gate now achievable                     | §3.5 (#6), §5.3, §5.4, §12                                                                                                        |
| 14  | **Medium** — Pre-M4-01 orphan-data audit (new `m4-audit-orphan-data.js`) with cleanup procedure (delete/backfill/null) before FK creation; gate G10 added                                                                                   | §9.2, §16, §18 (R12), §20, §21, §22, §23, §24 (G10), §26                                                                          |
| 15  | **Low** — Pagination wording corrected: target follows the shared `buildPaginatedResponse` envelope; removed the inaccurate "M3 payments already uses the same envelope" claim                                                              | §3.5 (#7), §11                                                                                                                    |
| 16  | **Low** — "Decimal widening" replaced with "Decimal narrowing to (10,2)"; overflow verification retained (R8)                                                                                                                               | §16 (M4-06), §17.3, §18 (R8)                                                                                                      |
| 17  | **Low** — Out-of-stock wording corrected: only LowStock/CriticalStock filter in-memory; OutOfStock already DB-filters (`lte: 0`) and needs pagination + envelope only                                                                       | §5.3                                                                                                                              |

### Final counts

| Item                                      | Count                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tasks (roadmap 7.4.1–7.4.14)              | **14**                                                                                                 |
| Prisma migrations                         | **6** (M4-01 … M4-06)                                                                                  |
| Files to create                           | **7** (3 scripts + 2 specs + 2 milestone docs)                                                         |
| Files to modify                           | **10** (8 source/spec + `prisma/schema.prisma` + `apps/api/jest.config.ts`)                            |
| Verification scripts                      | **3** (`verify-phase7-m4.js`, `m4-audit-enum-data.js`, `m4-audit-orphan-data.js`)                      |
| Milestone reports                         | **2** (`PHASE7-M4-REPORT.md`, `PHASE7-M4-CHANGELOG.md`) + coverage / jest XML / migrate-status outputs |
| Models in schema (v7.3.0)                 | **126**                                                                                                |
| Enums in schema (v7.3.0)                  | **58**                                                                                                 |
| Models with `tenantId`                    | **118**                                                                                                |
| P1-6 index target (tenantId + createdAt)  | **105** (13 excluded)                                                                                  |
| Soft-delete models (P2-6 index)           | **48**                                                                                                 |
| Models missing `deletedAt` (P2-7 target)  | **78**                                                                                                 |
| Models with `@updatedAt` attribute        | **88**                                                                                                 |
| Models missing `@updatedAt` (P2-8 target) | **38**                                                                                                 |
| String→enum conversions (P1-7)            | **28**                                                                                                 |
| New enums to define (P1-7)                | **20**                                                                                                 |
| Existing enums reused (P1-7)              | **2** (`CampaignType`, `CampaignStatus`)                                                               |
| String fields intentionally kept (P1-7)   | **11**                                                                                                 |
| Fields already enum-typed (no work)       | **1** (`InventoryCount.countType` → `CountType`)                                                       |
| Decimal precision fields (P1-8)           | **9**                                                                                                  |
| KEYS→SCAN call sites (P1-9)               | **4**                                                                                                  |
| Cascade relations to add (P0-6)           | **19** (18 enumerated, 19 script-verified)                                                             |
| Estimated effort                          | ~12–14 days (+25% buffer = ~15–18 days)                                                                |

---

## Ready for Implementation

**YES** — all 11 validation corrections + all 6 release-blocking review fixes applied (rows 1–17 in §26), all counts and paths re-verified against the repository at v7.3.0, document internally consistent, zero scope creep, zero unresolved findings.
