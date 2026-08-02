# Phase 7 — Milestone 4: Database & Performance

## Implementation Plan

**Version:** 1.0  
**Status:** Draft — awaiting approval  
**Based on:** PHASE7-VERIFIED-ROADMAP.md, FORENSIC-VALIDATION.md, FINAL-PRODUCTION-READINESS-AUDIT.md  
**Base branch:** feature/phase7-m4 (clean, on v7.3.0)

---

## 1. Objectives

Deliver the Database & Performance milestone: prevent data loss, enforce referential integrity, improve query performance at scale, and standardize cache behavior. This is a **schema-heavy** milestone — the majority of work lands in `prisma/schema.prisma` as migrations, with targeted application-layer fixes in the cache service, usage-tracking service, and inventory module.

**Forensic findings addressed (all confirmed in FORENSIC-VALIDATION.md):**

| Finding | Verdict | Summary |
|---------|---------|---------|
| **P0-6** | ✅ Confirmed | 19 Tenant/User FK relations missing `onDelete: Cascade`; Prisma default `Restrict` blocks ALL tenant deletes (schema.prisma:1522–3762) |
| **P0-7** | ✅ Confirmed | 2 orphaned models — `MembershipHistory` (schema.prisma:1705) and `EventLog` (schema.prisma:2256) — columns exist but zero `@relation` declarations, no FK enforcement |
| **P1-6** | ✅ Confirmed | ~116 models have `tenantId`; only Customer (schema.prisma:1543) has `@@index([tenantId, createdAt])` |
| **P1-7** | ✅ Confirmed | 24 String status/type fields should be Prisma enums (Notification.type, Campaign.type/status, Report.type/status, GiftCard.status/issueType, WebhookDelivery.status, BackupRecord.type/status + 14 more) |
| **P1-8** | ✅ Confirmed | 9 Decimal monetary fields missing `@db.Decimal(10,2)` precision |
| **P1-9** | ✅ Confirmed | Blocking Redis `KEYS` in `CacheService.deletePattern()`/`invalidateTenantCache()` (cache.service.ts:40,49) and `usage-tracking.service.ts:70,106` |
| **P1-10** | ✅ Confirmed | Order model (schema.prisma:966–977) has 10 single-column indexes, **zero** composite indexes |
| **P1-11** | ✅ Confirmed | Low-stock/critical-stock/out-of-stock filtered in-memory (`items.filter()`) in inventory.service.ts:1150–1193 |
| **P1-12** | ✅ Confirmed | Stock endpoints (inventory.controller.ts:274–287) have no pagination; return raw arrays |
| **P1-14** | ✅ Confirmed | AuditLog (schema.prisma:396–401) has single-column indexes only; no composite |
| **P2-6** | ✅ Confirmed | 48 models have `deletedAt`; only Customer has `@@index([tenantId, deletedAt])` |
| **P2-7** | ✅ Confirmed | 77 models lack `deletedAt` soft-delete field |
| **P2-8** | ✅ Confirmed | 38 models lack `updatedAt @updatedAt` |
| **P2-12** | ❌ False Positive → **revised** | Shared lib EXISTS (libs/shared/constants/src/index.ts:121–125). Revised task: standardize inconsistent hardcoded TTLs (orders hardcode 30s, inventory hardcode 120s) onto shared `CACHE_TTL` constants |

**Score improvement:** Database 5/10 → 7/10, Performance 5.5/10 → 7/10 per ROADMAP §7.4. Overall readiness contribution: 4.0/10 → 5.0/10 trajectory.

---

## 2. Scope

### In Scope — 14 tasks (7.4.1–7.4.14)

| ID | Task | Finding | Effort |
|----|------|---------|--------|
| 7.4.1 | Add `onDelete: Cascade` to all 19 missing Tenant/User FK relations | P0-6 | 2 hrs |
| 7.4.2 | Add Prisma `@relation` declarations to MembershipHistory and EventLog | P0-7 | 2 hrs |
| 7.4.3 | Add `@@index([tenantId, createdAt])` to all ~116 tenant-scoped models | P1-6 | 3 hrs |
| 7.4.4 | Add `@@index([tenantId, deletedAt])` to all 48 soft-delete models | P2-6 | 2 hrs |
| 7.4.5 | Add composite indexes to Order: `@@index([tenantId, status, createdAt])`, `@@index([tenantId, branchId, createdAt])` | P1-10 | 1 hr |
| 7.4.6 | Replace `CacheService.deletePattern()` KEYS with SCAN cursor-based iteration (incl. usage-tracking.service.ts:70,106) | P1-9 | 1–2 days |
| 7.4.7 | Add composite `@@index([createdAt, isArchived])` on AuditLog | P1-14 | 30 min |
| 7.4.8 | Push low-stock/critical-stock filtering into DB query (Prisma WHERE) | P1-11 | 2 hrs |
| 7.4.9 | Add pagination (page/limit) to all unbounded stock endpoints | P1-12 | 2 hrs |
| 7.4.10 | Add `deletedAt DateTime?` to 77 models that lack soft delete | P2-7 | 4 hrs |
| 7.4.11 | Add `updatedAt DateTime @updatedAt` to 38 models that lack it | P2-8 | 2 hrs |
| 7.4.12 | Convert 24 String status/type fields to Prisma enums | P1-7 | 8 hrs |
| 7.4.13 | Add `@db.Decimal(10,2)` to 9 monetary fields | P1-8 | 1 hr |
| 7.4.14 | Standardize cache TTL usage onto shared `CACHE_TTL` constants | P2-12 (revised) | 2 hrs |

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
- `modules/usage-tracking/usage-tracking.service.ts` — SCAN (2 KEYS call sites)
- `modules/inventory/*` — DB-level filtering + pagination
- `prisma/schema.prisma` — all schema changes (single source of truth)

### 3.2 Data model change flow

```
prisma/schema.prisma  (single source of truth)
   │  7.4.1  onDelete: Cascade         (P0-6)
   │  7.4.2  @relation on 2 orphans    (P0-7)
   │  7.4.3  @@index([tenantId, createdAt])   (~116 models)
   │  7.4.4  @@index([tenantId, deletedAt])   (48 models)
   │  7.4.5  Order composite indexes    (P1-10)
   │  7.4.7  AuditLog composite index   (P1-14)
   │  7.4.10 deletedAt  (77 models)     (P2-7)
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

### 3.5 Key Design Decisions

1. **One schema file, batched migrations** — all model edits land in `prisma/schema.prisma`; `prisma migrate dev` generates a committed migration per logical batch (§16). Migration order matters: additive columns (7.4.10/7.4.11) and indexes (7.4.3/7.4.4/7.4.5/7.4.7) are non-destructive and safe first; enum conversion (7.4.12) is the highest-risk batch and runs last after a data audit.
2. **Cascade scope is deliberate** — `onDelete: Cascade` is applied ONLY to the 19 named Tenant/User FK relations from P0-6. We do NOT blanket-cascade every relation in the schema (no scope creep); relations with legitimate `Restrict` semantics (e.g., financial history that must survive parent deletion) are left untouched.
3. **Enum conversion keeps application values intact** — new enums are defined with member names matching the existing uppercase string values (`'PENDING'`, `'ACTIVE'`, `'DRAFT'`, `'FULL'`, `'MANUAL'`, `'WARNING'`, etc.) so existing data maps 1:1 without a business-data backfill.
4. **Composite index design follows existing access patterns** — every new index mirrors a query that already filters/orders by that column tuple (tenant + createdAt, tenant + deletedAt, tenant + status + createdAt, tenant + branchId + createdAt, createdAt + isArchived).
5. **SCAN replaces KEYS at all 4 call sites** (cache.service.ts:40,49; usage-tracking.service.ts:70,106) using a shared helper so behavior stays consistent.
6. **TTL standardization preserves current cache durations** — existing hardcoded TTLs (orders 30s, inventory 120s, etc.) are re-expressed as named `CACHE_TTL` constants rather than silently changing cache lifetimes. If no shared constant matches a value, the shared constants file is extended with a descriptive constant for that duration.
7. **Inventory pagination matches the repo's existing pattern** — query DTO with `page`/`limit`, service returns a meta object `{ total, page, limit, totalPages, items }` identical to `buildPaginatedResponse` in `@tablofy/shared/utils` and the M3 payments pattern. Response shape changes are the ONLY contract-breaking change in M4 and are called out in §10/§17.
8. **`prisma generate` regenerates the client** — TypeScript consumers of the 24 converted enums are updated where the old `string` literals were compared/assigned; this is contained and verified by build + tests.
9. **No app behavior change for deletedAt/updatedAt additions** — adding nullable `deletedAt` and `updatedAt @updatedAt` to existing models is additive; existing services do not yet filter on the new `deletedAt` (soft-delete behavior is a later milestone). `updatedAt` maintenance is automatic via Prisma `@updatedAt`.
10. **Migrations are committed and reproducible** — generated SQL under `prisma/migrations/`, applied with `migrate deploy` (non-interactive) in CI and all environments; `migrate dev` is only used locally/staging.

---

## 4. Modules

### New Modules

None. M4 is not a feature milestone.

### Modified Modules

| Module | File(s) | Change |
|--------|---------|--------|
| Common | `common/services/cache.service.ts` | KEYS→SCAN (7.4.6); TTL constants (7.4.14) |
| Usage Tracking | `modules/usage-tracking/usage-tracking.service.ts` | KEYS→SCAN at lines 70, 106 (7.4.6) |
| Inventory | `modules/inventory/inventory.controller.ts` | `@Query()` DTO + paginated responses (7.4.9) |
| Inventory | `modules/inventory/inventory.service.ts` | DB-level filtering, pagination, TTL (7.4.8/7.4.9/7.4.14) |
| Orders | `modules/orders/orders.service.ts` | TTL constants only — no logic change (7.4.14) |
| App | `apps/api/src/app.module.ts` | Register inventory DTO/validator changes if module wiring requires it (no new module registration expected) |

No `@Global()` changes, no provider-registry changes, no new `@Module()` definitions.

---

## 5. Services

### 5.1 `CacheService` (common/services/cache.service.ts) — 7.4.6, 7.4.14

| Method | Change |
|--------|--------|
| `deletePattern(tenantId, pattern)` | Replace `client.keys()` (line 40) with `scanPattern()` using `SCAN cursor MATCH COUNT` + batched `DEL` |
| `invalidateTenantCache(tenantId)` | Replace `client.keys()` (line 49) with `scanPattern()` on `cache:<tenantId>:*` |
| `scanPattern(pattern)` (new private helper) | Cursor-based `SCAN MATCH pattern COUNT 100`, returns all matching keys, batch-size guarded for large result sets |
| `set()` / `getOrSet()` | Default TTL stays `CACHE_TTL.MEDIUM` (already correct); document that callers must pass a shared constant |

### 5.2 `UsageTrackingService` (modules/usage-tracking/usage-tracking.service.ts) — 7.4.6

| Line | Change |
|------|--------|
| 70 | `client.keys(...)` → `scanPattern(...)` |
| 106 | `client.keys(...)` → `scanPattern(...)` |

### 5.3 `InventoryService` (modules/inventory/inventory.service.ts) — 7.4.8, 7.4.9, 7.4.14

| Method | Change |
|--------|--------|
| `getLowStockItems(page, limit)` | Replace `findMany` + `items.filter(...)` (lines 1150–1163) with `findMany({ where: { quantity: { lte: threshold } }, orderBy, take, skip })` + `count()` for meta |
| `getCriticalStockItems(page, limit)` | Same DB-pushdown (lines 1165–1178) with critical threshold |
| `getOutOfStockItems(page, limit)` | Same DB-pushdown with `quantity: { lte: 0 }` |
| Low-stock TTL | Hardcoded 120s → shared `CACHE_TTL` constant (7.4.14) |

### 5.4 `OrdersService` (modules/orders/orders.service.ts) — 7.4.14

| Change |
|--------|
| Hardcoded cache TTL (30s) → shared `CACHE_TTL` constant. No logic change. |

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

All changes are edits to `prisma/schema.prisma` (3,782 lines / 126 models / 56 enums as of v7.3.0) applied via migrations. Exact line numbers below are verified current locations and are re-confirmed at implementation time.

### 9.1 7.4.1 — `onDelete: Cascade` on 19 Tenant/User FK relations (P0-6)

| Location | Relation | Missing cascade |
|----------|----------|-----------------|
| schema.prisma:1522 | Customer → Tenant | ✅ add |
| schema.prisma:3476 | ScheduledReport → Tenant | ✅ add |
| schema.prisma:3498 | ReportExport → Tenant | ✅ add |
| schema.prisma:3515 | AnalyticsDashboard → Tenant | ✅ add |
| schema.prisma:3542 | WebhookRegistration → Tenant | ✅ add |
| schema.prisma:3570 | WebhookDelivery → WebhookRegistration | ✅ add |
| schema.prisma:3598–3599 | ApiKey → Tenant, User | ✅ add (2) |
| schema.prisma:3629,3631 | GiftCard → Tenant, User | ✅ add (2) |
| schema.prisma:3656–3657 | GiftCardTransaction → GiftCard, User | ✅ add (2) |
| schema.prisma:3682–3683 | ConsentRecord → Tenant, User | ✅ add (2) |
| schema.prisma:3709 | CookiePreference → Tenant | ✅ add |
| schema.prisma:3733–3734 | DataExportRequest → Tenant, User | ✅ add (2) |
| schema.prisma:3762 | BackupRecord → Tenant | ✅ add |

Forensic report counts 19 relations (some relations are declared on both sides of a relation pair); the enumerated list above covers all named relations. **Implementation step:** programmatically verify all 19 by re-running the audit after edits — exact count confirmed at migration time.

### 9.2 7.4.2 — `@relation` declarations on orphaned models (P0-7)

| Model | Line | Fields | Action |
|-------|------|--------|--------|
| MembershipHistory | schema.prisma:1705–1719 | `customerId`, `tenantId` | Add `@relation` to Customer and Tenant; add matching back-relations on Customer/Tenant |
| EventLog | schema.prisma:2256–2272 | `tenantId`, `ruleId` | Add `@relation` to Tenant and EventRule; add matching back-relations on Tenant/EventRule |

This enables FK enforcement and cascade cleanup so orphan rows cannot accumulate.

### 9.3 7.4.3 — `@@index([tenantId, createdAt])` on ~116 models (P1-6)

- Applies to every model that has both `tenantId` and `createdAt`.
- Only Customer currently has it (schema.prisma:1543).
- **Implementation step:** script-extract all models with `tenantId` + `createdAt`; add the composite index to each; verify count via script (§24).

### 9.4 7.4.4 — `@@index([tenantId, deletedAt])` on 48 soft-delete models (P2-6)

- Applies to the 48 models that have `deletedAt`; only Customer has the composite (schema.prisma:1544).

### 9.5 7.4.5 — Order composite indexes (P1-10)

Add to `Order` (schema.prisma:966–977), keeping its existing 10 single-column indexes:
- `@@index([tenantId, status, createdAt])`
- `@@index([tenantId, branchId, createdAt])`

### 9.6 7.4.7 — AuditLog composite index (P1-14)

Add to `AuditLog` (schema.prisma:396–401):
- `@@index([createdAt, isArchived])`

### 9.7 7.4.10 — `deletedAt DateTime?` on 77 models (P2-7)

- Add `deletedAt DateTime?` to the 77 models lacking soft delete.
- **Implementation step:** script-diff the 48 models with `deletedAt` against all 125 models; add the field to the remaining 77; verify count.

### 9.8 7.4.11 — `updatedAt DateTime @updatedAt` on 38 models (P2-8)

- Add to the 38 models lacking it (87 already have it).

### 9.9 7.4.12 — 24 String → enum conversions (P1-7)

New Prisma enums are defined with member names matching existing values. Confirmed fields (13 named in forensic) and the remaining candidates to lock in during implementation:

| Model:Field (schema line) | Current | Enum members |
|---------------------------|---------|--------------|
| Notification.type (1200) | String | `NOTIFICATION_TYPE` = existing values |
| Report.type (1239) | String | `REPORT_TYPE` |
| Report.status (1244) | String `@default("PENDING")` | `REPORT_STATUS` |
| Campaign.type (1343) | String | `CAMPAIGN_TYPE` |
| Campaign.status (1344) | String `@default("DRAFT")` | `CAMPAIGN_STATUS` |
| GiftCard.status (3615) | String `@default("ACTIVE")` | `GIFT_CARD_STATUS` |
| GiftCard.issueType (3616) | String `@default("MANUAL")` | `GIFT_CARD_ISSUE_TYPE` |
| WebhookDelivery.status (3559) | String `@default("PENDING")` | `WEBHOOK_DELIVERY_STATUS` |
| BackupRecord.type (3746) | String `@default("FULL")` | `BACKUP_RECORD_TYPE` |
| BackupRecord.status (3747) | String `@default("PENDING")` | `BACKUP_RECORD_STATUS` |
| + 14 more | String | Enumerated during implementation via audit script (candidates include WebhookDelivery.eventType, ScheduledReport.type, ReportExport.type/reportType/status, GiftCardTransaction.type, ConsentRecord.type, DataExportRequest.status/requestType, CampaignApproval.status, SupplierDetail.status, StockAdjustment.status, InventoryCount.status, ExpirationAlert.alertType, CycleCount.countType, PurchaseOrderApproval.status, referenceType fields, etc.) |

**Rules for enum conversion:**
- Enum member names MUST equal the uppercase string values in use (case-sensitive match verified by the pre-migration data audit script, §16).
- Defaults are preserved (`@default("PENDING")`, `@default("ACTIVE")`, etc.).
- Any value in existing data that does not match a member is mapped to the enum default per a mapping table produced by the audit script; the mapping table is part of the migration and reviewed before apply.
- App code that assigns/compares these fields is updated to the regenerated enum types (build + tests gate this).

### 9.10 7.4.13 — `@db.Decimal(10,2)` on 9 monetary fields (P1-8)

| Model:Field | Line | Action |
|-------------|------|--------|
| Wallet.balance | 1758 | add `@db.Decimal(10,2)` |
| WalletTransaction.amount | 1779 | add `@db.Decimal(10,2)` |
| WalletTransaction.balanceBefore | 1780 | add `@db.Decimal(10,2)` |
| WalletTransaction.balanceAfter | 1781 | add `@db.Decimal(10,2)` |
| Membership.totalSpent | 1687 | add `@db.Decimal(10,2)` |
| VisitHistory.totalSpent | 1595 | add `@db.Decimal(10,2)` |
| CustomerAnalytics.lifetimeValue | 1868 | add `@db.Decimal(10,2)` |
| CustomerAnalytics.averageOrderValue | 1869 | add `@db.Decimal(10,2)` |
| CustomerAnalytics.totalSpend | 1872 | add `@db.Decimal(10,2)` |

---

## 10. API Endpoints

### 10.1 Modified — stock endpoints (7.4.9)

| Endpoint | Before | After |
|----------|--------|-------|
| `GET /inventory/low-stock` | raw array, unbounded | `GET /inventory/low-stock?page=1&limit=20` → `{ data: { items, total, page, limit, totalPages } }` |
| `GET /inventory/critical-stock` | raw array, unbounded | same paginated envelope |
| `GET /inventory/out-of-stock` | raw array, unbounded | same paginated envelope |

- `page` default 1, `limit` default 20 (min 1, max 100) via `PAGINATION_DEFAULTS` in `@tablofy/shared/constants`.
- All three remain behind global auth guards; route handlers unchanged (controller lines 274–287), only query params + response construction change.

### 10.2 New endpoints

None.

### 10.3 Unchanged endpoints

All other endpoints (auth, tenants, orders, payments, inventory CRUD, etc.) are untouched.

### 10.4 Contract change notice

The stock-endpoint response shape changes from a bare array to a paginated envelope. This is the only breaking contract change in M4. Consumers must be updated in lock-step (documented in §17 and PHASE7-M4-CHANGELOG.md).

---

## 11. DTOs

### New DTO

| File | Purpose |
|------|---------|
| `apps/api/src/modules/inventory/dto/stock-list-query.dto.ts` | `page?: number`, `limit?: number` with class-validator `@IsInt()`, `@Min(1)`, `@Max(100)`, `@IsOptional()`, defaulted to `PAGINATION_DEFAULTS` |

### Modified DTOs

None. Existing inventory DTOs are unchanged.

### Consumed shared types

- `PaginatedResponse` / `buildPaginatedResponse` from `@tablofy/shared/types` / `@tablofy/shared/utils` (already used by M3 payments) — the inventory responses adopt the same envelope for consistency.

---

## 12. Configuration

| Item | Change |
|------|--------|
| `libs/shared/constants/src/index.ts` | Extend `CACHE_TTL` (line 121–125) with descriptive named constants for durations currently hardcoded in code (e.g., orders 30s, inventory 120s) so no module hardcodes a magic number. Existing `SHORT: 60 / MEDIUM: 300 / LONG: 3600` remain. |
| `apps/api/jest.config.ts` | Add coverage thresholds for `modules/inventory/*` files touched by M4 (match existing threshold style for auth/orders/tenants/prisma/payments) |
| `scripts/verify-phase7-m4.js` | New automated verification harness (see §24) |
| `prisma.config.ts` | No change expected (already configured for the project DB) |

---

## 13. Environment Variables

**No new environment variables.**

All M4 changes (schema, cache SCAN, pagination) are configuration-free. `.env.example` is untouched. The pre-migration data audit script reads the existing `DATABASE_URL` from the environment, and `prisma migrate` uses the existing Prisma configuration.

---

## 14. Security Considerations

| # | Concern | Handling |
|---|---------|----------|
| S1 | **Tenant deletion currently impossible** (P0-6) | Adding cascade makes tenant deletion possible and GDPR right-to-erasure compliant. This is intentional; deletion is destructive by design — guards must ensure only authorized tenants/roles can invoke delete (existing TenantGuard/RolesGuard cover this). |
| S2 | **Cascade data-loss risk** | Cascade is limited to the 19 named relations. Customer's own dependents (orders, wallet history) use their existing cascade/referential rules; we do not broaden cascade beyond the finding. |
| S3 | **Enum values from untrusted input** | After conversion, Prisma validates enum fields at the client layer — invalid status/type strings can no longer be persisted (defense-in-depth beyond class-validator). |
| S4 | **Blocking Redis KEYS → latency** | SCAN is non-blocking; batched DELs avoid multi-thousand-key `del(...keys)` single calls. No auth/permission surface changes. |
| S5 | **SCAN count safety** | `COUNT 100` batch size; loop terminates on `cursor === '0'`; pattern is tenant-prefixed so SCAN only touches the tenant's namespace (no cross-tenant data exposure). |
| S6 | **Soft-delete columns** | `deletedAt` is additive and nullable; existing read paths are unchanged, so no accidental data filtering occurs until soft-delete behavior is implemented in a later milestone. |
| S7 | **Migration safety** | All migrations are additive/index/type-conversion with a pre-apply data audit; `migrate deploy` runs in maintenance window; backups taken before apply (see §16/§17). |
| S8 | **Secrets** | No new secrets, no logging changes, no `.env` changes. |

---

## 15. Testing Strategy

M4 is primarily a schema/perf milestone. Tests focus on the changed application code; schema changes are validated by migration + verification scripts rather than unit tests.

### 15.1 Unit tests (new/modified)

| Suite | Covers | Type |
|-------|--------|------|
| `cache.service.spec.ts` (new) | `deletePattern`/`invalidateTenantCache`/`scanPattern` use SCAN, batch DEL, terminate on cursor `0`, pass `MATCH` pattern; KEYS never called | Unit (mock `RedisService`) |
| `usage-tracking.service.spec.ts` (extend) | KEYS call sites replaced with SCAN helper | Unit |
| `inventory.service.spec.ts` (extend) | low/critical/out-of-stock push down WHERE + return paginated meta; thresholds respected | Unit (mock `PrismaService`) |
| `inventory.controller.spec.ts` (new) | `@Query` DTO defaults (page=1, limit=20), validation errors on limit>100, envelope shape | Unit |

### 15.2 Regression

- Full existing suite (41 suites / 347 tests passing at v7.3.0) must remain green.
- Payment module tests (M3) must pass unchanged.
- Build + lint must pass (see §24). Pre-existing ESLint unused-var errors in `orders.service.ts` (4) are tracked separately and NOT introduced by M4.

### 15.3 Schema verification (scripted, not unit tests)

`scripts/verify-phase7-m4.js` performs static verification against the generated Prisma client and schema text:
- 19 cascade relations present (P0-6)
- MembershipHistory/EventLog have `@relation` (P0-7)
- All ~116 models have `@@index([tenantId, createdAt])` (P1-6)
- All 48 soft-delete models have `@@index([tenantId, deletedAt])` (P2-6)
- Order has both composite indexes (P1-10); AuditLog has `[createdAt, isArchived]` (P1-14)
- 77 models have `deletedAt` (P2-7); 38 added `updatedAt @updatedAt` (P2-8)
- 24 string fields converted; 9 Decimal fields have `@db.Decimal(10,2)` (P1-7/P1-8)
- 0 remaining `client.keys(` in cache/usage-tracking services (P1-9)
- 0 hardcoded numeric TTLs in orders/inventory (P2-12 revised)

### 15.4 Pre-migration data audit (7.4.12)

`scripts/m4-audit-enum-data.js` (or inline in verify script) queries each target column and reports:
- distinct values not matching enum members (drift list)
- row counts affected (0 expected for clean conversions)
- produces the value→default mapping table reviewed before the enum migration applies

### 15.5 Coverage

Extend `apps/api/jest.config.ts` thresholds for touched inventory/cache files per existing style. No new global threshold changes.

---

## 16. Migration Strategy

Six Prisma migrations, applied in dependency order. All are committed to `prisma/migrations/`. Batching is deliberate: non-destructive work first, highest-risk (enum) last.

| # | Migration name | Tasks | Destructive? | Notes |
|---|----------------|-------|--------------|-------|
| M4-01 | `m4_1_cascade_and_orphan_relations` | 7.4.1, 7.4.2 | No (schema FK/DELETE rule change) | FK ON DELETE CASCADE alters existing constraints; rollback via reverse migration |
| M4-02 | `m4_2_tenant_createdAt_indexes` | 7.4.3 | No | ~116 `CREATE INDEX` |
| M4-03 | `m4_3_soft_delete_and_updated_at_indexes` | 7.4.4, 7.4.5, 7.4.7 | No | 48 + Order + AuditLog composite indexes |
| M4-04 | `m4_4_deletedAt_and_updatedAt_columns` | 7.4.10, 7.4.11 | No | Additive nullable columns; `@updatedAt` maintenance automatic |
| M4-05 | `m4_5_enum_conversions` | 7.4.12 | **Yes** (column type changes) | Pre-audit required; mapping table reviewed; highest risk |
| M4-06 | `m4_6_decimal_precision` | 7.4.13 | **Yes** (column type change) | `Decimal` → `Decimal(10,2)`; widening (10,2) from default is non-lossy for existing values within range |

### Procedure

1. Local: edit `prisma/schema.prisma` per batch → `npx prisma migrate dev --name m4_N_<slug>` → SQL reviewed → commit.
2. Run `scripts/m4-audit-enum-data.js` **before** M4-05; review drift report + mapping table.
3. Staging: `npx prisma migrate deploy` (non-interactive).
4. `npx prisma generate` after each batch; run build + full test suite.
5. Production: `migrate deploy` in a maintenance window with a fresh DB backup (§17).
6. Verification: `scripts/verify-phase7-m4.js` asserts every finding is closed.

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
git checkout -- apps/api/src/modules/usage-tracking/usage-tracking.service.ts
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
- M4-05 (enum) and M4-06 (decimal) are type changes; rollback = restore from backup (no destructive down-migration on live data). Because the enum conversion is 1:1 on values and decimal is widening, forward apply is safe; backwards restore is a restore-from-backup.

### 17.4 Contract rollback

The paginated stock endpoint is a breaking response change. Rollback of the API contract = `git checkout apps/api/src/modules/inventory/` reverts handlers; clients may need coordinated revert (documented in PHASE7-M4-CHANGELOG.md).

---

## 18. Risks and Blockers

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Enum drift** — existing data contains string values that don't match new enum members (case, whitespace, legacy values) | Medium | High | Pre-migration audit script produces drift report + mapping table; mapping reviewed before M4-05; enum members named to match verified values |
| R2 | **Large index creation locks tables** (~116 + 48 + 3 indexes) | Medium | Medium | Apply in maintenance window; Postgres `CREATE INDEX` is non-blocking for reads with `CONCURRENTLY` if required (documented, default sequential in migrate dev); verify on staging with representative data |
| R3 | **Cascade behavior surprises** — after 7.4.1, deleting a Tenant/User deletes dependents that callers did not expect gone | Medium | High | Cascade limited to the 19 named relations only; review each FK during implementation; tenant delete endpoints already require explicit action |
| R4 | **Enum conversion breaks application code** — services compare `type === 'PENDING'` against now-enum fields | High | Medium | `prisma generate` regenerates types; build + full test suite catch all compare/assign sites; contained sweep over modules that touch the 24 fields |
| R5 | **SCAN vs KEYS semantics** — SCAN may return keys deleted mid-iteration; `MATCH` + count edge cases | Low | Low | SCAN tolerates misses (best-effort invalidation); keys are re-checked with `DEL`; unit tests cover cursor loop + empty + large sets |
| R6 | **Paginated response breaks existing consumers** — stock endpoints change from array to envelope | High | Medium | Single, documented contract change; aligned to `PaginatedResponse` already used elsewhere; updated in lock-step with changelog; controller spec asserts shape |
| R7 | **Big-batch migration review burden** — ~116 + 48 + 77 + 38 model edits in one schema file | Medium | Low | Script-extracted and verified counts (§9/§24); schema diff reviewed per batch; verify script asserts exact model counts |
| R8 | **`@db.Decimal(10,2)` value overflow** — existing values exceeding (10,2) range on convert | Low | Medium | Pre-migration check for values > 99,999,999.99; report and halt if found (expected none for monetary fields) |
| R9 | **`prisma migrate dev` drift vs `deploy`** — dev/staging out of sync with migrations | Low | Medium | Always `migrate deploy` non-interactively after dev; verify script checks `prisma migrate status` |
| R10 | **Coverage threshold failure** — new spec files must meet configured coverage | Medium | Low | Add thresholds only for files actually covered; run jest with coverage; adjust per existing style |

---

## 19. Estimated Effort

| Task | Days | Parallelizable | Dependencies |
|------|------|---------------|-------------|
| 7.4.1 — Cascade on 19 relations (P0-6) | 0.5 | ✅ | None |
| 7.4.2 — Orphan relations (P0-7) | 0.5 | ✅ | None |
| 7.4.3 — tenant/createdAt indexes (P1-6) | 0.5 | ✅ | None |
| 7.4.4 — tenant/deletedAt indexes (P2-6) | 0.5 | ✅ | None |
| 7.4.5 — Order composite indexes (P1-10) | 0.25 | ✅ | None |
| 7.4.6 — KEYS→SCAN (P1-9) | 1–2 | ✅ | None |
| 7.4.7 — AuditLog index (P1-14) | 0.25 | ✅ | None |
| 7.4.8 — Stock DB filtering (P1-11) | 0.5 | ✅ Parallel with 7.4.9 | None |
| 7.4.9 — Stock pagination (P1-12) | 0.5 | ✅ Parallel with 7.4.8 | None |
| 7.4.10 — deletedAt on 77 models (P2-7) | 1 | ✅ | None |
| 7.4.11 — updatedAt on 38 models (P2-8) | 0.5 | ✅ | None |
| 7.4.12 — 24 enum conversions (P1-7) | 2–3 | ❌ Requires data audit | Audit, 7.4.10/7.4.11 (batch order) |
| 7.4.13 — Decimal precision (P1-8) | 0.5 | ✅ | None |
| 7.4.14 — TTL standardization (P2-12) | 0.5 | ✅ | 7.4.6 (same files) |
| Migrations + generate + verify script | 1 | ❌ | All tasks |
| Tests + quality gates + reports | 1.5 | ❌ | All tasks |
| **Subtotal** | **~12–14 days** | | |
| With 25% buffer | **~15–18 days** | | |

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
- `PHASE7-M4-IMPLEMENTATION-PLAN.md` — this document
- `PHASE7-M4-REPORT.md` — milestone completion report (post-implementation)
- `PHASE7-M4-CHANGELOG.md` — per-file change log + contract-change notice (post-implementation)

### Prisma migrations (generated, committed)
- 6 migrations: `m4_1_cascade_and_orphan_relations`, `m4_2_tenant_createdAt_indexes`, `m4_3_soft_delete_and_updated_at_indexes`, `m4_4_deletedAt_and_updatedAt_columns`, `m4_5_enum_conversions`, `m4_6_decimal_precision`

### Verification scripts
- `scripts/verify-phase7-m4.js` — automated pass/fail verification harness (build, lint, tests, static schema/code assertions per finding)
- `scripts/m4-audit-enum-data.js` — pre-M4-05 data drift audit (distinct values per enum column, affected row counts, mapping table)

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
scripts/m4-audit-enum-data.js                            # enum data drift audit
apps/api/src/modules/inventory/dto/stock-list-query.dto.ts  # page/limit query DTO
apps/api/src/common/services/cache.service.spec.ts       # SCAN unit tests
apps/api/src/modules/inventory/inventory.controller.spec.ts # pagination/validation tests
PHASE7-M4-REPORT.md                                      # (post-implementation)
PHASE7-M4-CHANGELOG.md                                   # (post-implementation)
```

Plus 6 generated migration directories under `prisma/migrations/<timestamp>_m4_*/` (each containing `migration.sql` + `migration_lock.toml` update).

### Files to Modify (9 + schema + config)

```
prisma/schema.prisma                                        # all 10 schema change groups (7.4.1–7.4.5, 7.4.7, 7.4.10–7.4.13)
apps/api/src/common/services/cache.service.ts               # KEYS→SCAN (7.4.6), TTL (7.4.14)
apps/api/src/modules/usage-tracking/usage-tracking.service.ts  # KEYS→SCAN lines 70, 106 (7.4.6)
apps/api/src/modules/inventory/inventory.controller.ts      # @Query DTO + paginated responses (7.4.9)
apps/api/src/modules/inventory/inventory.service.ts         # DB filtering + pagination + TTL (7.4.8/7.4.9/7.4.14)
apps/api/src/modules/orders/orders.service.ts               # TTL constant (7.4.14) — no logic change
libs/shared/constants/src/index.ts                          # extend CACHE_TTL named constants (7.4.14)
apps/api/jest.config.ts                                     # inventory/cache coverage thresholds
apps/api/src/modules/usage-tracking/usage-tracking.service.spec.ts  # extend for SCAN
apps/api/src/modules/inventory/inventory.service.spec.ts    # extend for DB filtering + pagination
```

### Files touched only by `prisma generate` (regenerated, not hand-edited)
```
generated Prisma client (node_modules/.prisma/*)            # enum + Decimal types for 24+9 fields
```

### Files NOT changed (explicit)
`app.module.ts`, `main.ts`, `.env`, `.env.example`, `prisma.config.ts`, all other modules.

---

## 22. Finding-to-Task Mapping

| Forensic Finding | Verdict | Roadmap Task | Deliverable |
|------------------|---------|--------------|-------------|
| P0-6 | ✅ | 7.4.1 | M4-01 migration + verify assertion |
| P0-7 | ✅ | 7.4.2 | M4-01 migration + verify assertion |
| P1-6 | ✅ | 7.4.3 | M4-02 migration + verify assertion |
| P2-6 | ✅ | 7.4.4 | M4-03 migration + verify assertion |
| P1-10 | ✅ | 7.4.5 | M4-03 migration + verify assertion |
| P1-9 | ✅ | 7.4.6 | cache/usage-tracking service changes + specs |
| P1-14 | ✅ | 7.4.7 | M4-03 migration + verify assertion |
| P1-11 | ✅ | 7.4.8 | inventory.service.ts DB filtering + specs |
| P1-12 | ✅ | 7.4.9 | stock DTO + controller/service pagination + specs |
| P2-7 | ✅ | 7.4.10 | M4-04 migration + verify assertion |
| P2-8 | ✅ | 7.4.11 | M4-04 migration + verify assertion |
| P1-7 | ✅ | 7.4.12 | M4-05 migration + audit script + app type sweep |
| P1-8 | ✅ | 7.4.13 | M4-06 migration + verify assertion |
| P2-12 (revised) | ❌ FP → revised | 7.4.14 | shared constants + cache/orders/inventory TTL standardization |

Every task 7.4.1–7.4.14 maps 1:1 to a verified finding. No task is added that is not backed by a forensic finding.

---

## 23. Success Criteria

- [ ] `prisma migrate status` reports all 6 M4 migrations applied, zero drift
- [ ] All 19 cascade relations confirmed present (script-verified, P0-6)
- [ ] MembershipHistory and EventLog have enforced `@relation` FKs (P0-7)
- [ ] 100% of tenant-scoped models have `@@index([tenantId, createdAt])` (P1-6)
- [ ] 100% of soft-delete models have `@@index([tenantId, deletedAt])` (P2-6)
- [ ] Order has both composite indexes; AuditLog has `[createdAt, isArchived]` (P1-10, P1-14)
- [ ] 77 models gained `deletedAt`; 38 models gained `updatedAt @updatedAt` (P2-7, P2-8)
- [ ] 24 string fields converted to enums with zero data drift (audit report clean, P1-7)
- [ ] 9 monetary fields have `@db.Decimal(10,2)` (P1-8)
- [ ] Zero `client.keys(` remaining in cache/usage-tracking services (P1-9)
- [ ] Zero hardcoded numeric cache TTLs in orders/inventory (P2-12 revised)
- [ ] Stock endpoints return paginated envelopes with correct meta; validation rejects limit>100 (P1-12)
- [ ] Full test suite green (existing 41 suites / 347 tests + new M4 specs), build + lint pass
- [ ] Coverage thresholds met per `jest.config.ts`
- [ ] `PHASE7-M4-REPORT.md` + `PHASE7-M4-CHANGELOG.md` published; tag `v7.4.0` created

---

## 24. Quality Gates

`scripts/verify-phase7-m4.js` runs these gates and reports pass/fail counts (mirrors the M3 harness pattern):

| Gate | Check |
|------|-------|
| G1 | `npx nx build api` succeeds |
| G2 | `npx nx lint api` succeeds (no NEW lint errors vs baseline; 4 pre-existing orders.service.ts unused-var errors tracked separately) |
| G3 | `npx nx test api` succeeds (all suites incl. new M4 specs) |
| G4 | `npx prisma migrate status` clean |
| G5 | Static schema assertions: 19 cascades, 2 orphan relations, ~116 tenant/createdAt indexes, 48 tenant/deletedAt indexes, Order×2 + AuditLog composites, 77+38 new columns, 24 enums, 9 decimals (grep/parse `schema.prisma`) |
| G6 | Static code assertions: 0 `client.keys(`, 0 hardcoded numeric TTLs in orders/inventory, stock endpoints use `@Query()` DTO |
| G7 | Enum audit: 0 non-mapping values (from `m4-audit-enum-data.js` output) |
| G8 | Migration artifacts exist for all 6 batches with `migration.sql` present |
| G9 | Coverage thresholds met (jest coverage output) |

**Blocking rule:** A gate failure blocks the `v7.4.0` tag. Fix-and-re-run until all gates green.

---

## 25. Internal Consistency Check

| Check | Result |
|-------|--------|
| Every roadmap task 7.4.1–7.4.14 has a section in §2 and §9/§10 | ✅ |
| Every task maps to exactly one confirmed forensic finding (§22) | ✅ |
| No task references a finding outside the 3 source documents | ✅ |
| Effort table (§19) sums consistent with roadmap's 2–3 weeks | ✅ |
| Migration batches cover all schema tasks; order documented (§16) | ✅ |
| Only the stock-endpoint contract changes; all other endpoints unchanged (§10) | ✅ |
| No new modules/guards/interceptors/middleware (sections 4,6,7,8) | ✅ |
| No new env vars (§13) | ✅ |
| Verification artifacts (script + audit + report + changelog + tag) all listed (§20, §24) | ✅ |
| File inventory complete — every create/modify item enumerated (§21) | ✅ |
| Out-of-scope items explicitly listed to prevent creep (§2) | ✅ |
