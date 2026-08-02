# Phase 7 — M4 Changelog

## Schema (`prisma/schema.prisma`)

### 7.4.1 — Cascade relations
- 22 relations changed to `onDelete: Cascade` (baseline 100 → 122). Includes new FKs for
  `membership_history` (customerId → customers, tenantId → tenants) and `event_logs`
  (tenantId → tenants, ruleId → event_rules with `onDelete: SetNull`).

### 7.4.3 — Tenant + createdAt indexes
- `@@index([tenantId, createdAt])` added to 105 models.

### 7.4.4 — Tenant + deletedAt indexes
- `@@index([tenantId, deletedAt])` added to 47 models. **Tenant excluded**: root model has no
  `tenantId` field (plan expected 48; corrected, see REPORT).

### 7.4.5 / 7.4.7 — Composite indexes
- Order: `@@index([tenantId, status, createdAt])`, `@@index([tenantId, branchId, createdAt])`
- AuditLog: `@@index([createdAt, isArchived])`

### 7.4.10 / 7.4.11 — Soft delete + updatedAt
- `deletedAt DateTime?` added to all 126 models (78 previously lacked it).
- `updatedAt DateTime @updatedAt` on 125 models (38 added; CookiePreference intentionally excluded).

### 7.4.12 — Enum conversions (28 fields)
- 20 new enums declared (total 58 → 78): `NotificationType, ReportType, ReportStatus,
  ApprovalStatus, GiftCardStatus, GiftCardIssueType, GiftCardTransactionType,
  WebhookDeliveryStatus, WebhookEventType, BackupRecordType, BackupRecordStatus, ExportFormat,
  SupplierStatus, StockAdjustmentStatus, InventoryCountStatus, ExpirationAlertType,
  CycleCountType, ReportFormat, ReportExportStatus, ConsentType`.
- 28 String fields converted (2 reused existing enums `CampaignType`/`CampaignStatus`; shared
  reuse for `ApprovalStatus`, `BackupRecordType`, `BackupRecordStatus`, `ReportType`,
  `ReportFormat`). Defaults preserved. `WebhookEventType` uses per-member `@map("...")` for
  dotted wire values. **Extension (approved):** `WebhookDeliveryStatus` grew to 6 members —
  `DELIVERED`, `DEAD_LETTER` added (code already wrote these values).
- 11 polymorphic/open-domain String fields deliberately kept as String (§9.9-B).

### 7.4.13 — Decimal precision
- `@db.Decimal(10, 2)` on 9 monetary fields: `Wallet.balance`, `WalletTransaction.amount/
  balanceBefore/balanceAfter`, `Membership.totalSpent`, `VisitHistory.totalSpent`,
  `CustomerAnalytics.lifetimeValue/averageOrderValue/totalSpend`.
- R8 pre-check: 0 overflow (>99,999,999.99), 0 excess scale across all 9 columns — lossless.

## Application Code

### Cache / Redis
- `common/services/cache.service.ts` — `deletePattern()` / `invalidateTenantCache()` use SCAN
  (`scanKeys`) cursor iteration instead of Redis `KEYS`; batched deletes (7.4.6).
- `modules/usage/usage-tracking.service.ts` — both KEYS call sites (lines 70, 106) replaced
  with SCAN (`scanKeys`), batched deletes (7.4.6).

### Inventory (`modules/inventory/`)
- `inventory.service.ts` — low/critical/out-of-stock thresholds pushed into Prisma WHERE
  (7.4.8); TTL constants via `CACHE_TTL` (7.4.14); paginated responses (7.4.9).
- `inventory.controller.ts` — stock endpoints accept `@Query() QueryInventoryDto` and return
  the shared `{ data, meta }` envelope (7.4.9).

### Orders (`modules/orders/`)
- `orders.service.ts` — hardcoded `30`s TTLs replaced with `CACHE_TTL.ORDERS` (7.4.14). No
  logic change.

### Shared constants
- `libs/shared/constants/src/index.ts` — `CACHE_TTL` extended with `ORDERS: 30`,
  `LOW_STOCK: 120`; existing `SHORT/MEDIUM/LONG` unchanged (7.4.14).

### Enum type sweep (7.4.12)
- Services/DTOs updated to regenerated enum types: `backup.service.ts`, `crm-analytics.service.ts`,
  `cycle-count.service.ts`, `export-engine.service.ts`, `gift-cards.service.ts`,
  `create-gift-card.dto.ts`, `inventory.service.ts`, `privacy.service.ts`,
  `webhook-delivery.service.ts`.

## Tests

- `modules/inventory/tests/inventory.controller.spec.ts` — pagination/validation/envelope (new)
- `modules/inventory/tests/inventory.service.spec.ts` — DB filtering + pagination (extended)
- `modules/usage/tests/usage-tracking.service.spec.ts` — SCAN unit tests (new)
- `common/services/tests/cache.service.spec.ts` — SCAN tests (extended)

## Contract Change Notice

**Breaking:** `GET /inventory/low-stock`, `GET /inventory/critical-stock`,
`GET /inventory/out-of-stock` response shape changes from a bare array to the shared paginated
envelope `{ data: InventoryItem[], meta: { total, page, limit, totalPages, hasNext,
hasPrevious } }`. Query params `page`/`limit` accepted (defaults 1/20, max 100). Consumers
must update in lock-step. This is the only breaking contract change in M4.

## Verification

- `scripts/verify-phase7-m4.js` — 33 checks (G1–G10), **33 passed / 0 failed**
- Pre-M4-05 enum audit: `scripts/m4-audit-enum-data.js` — PASS, 0 drift
- Pre-M4-01 orphan audit: `scripts/m4-audit-orphan-data.js` — PASS, 0 orphan rows
- `prisma migrate status`: 17 migrations, up to date; `prisma validate`: valid
