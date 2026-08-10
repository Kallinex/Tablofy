# POST-P1-BATCH-2-FULL-AUDIT

**Audit date:** 2026-08-08
**Repository:** `D:\New folder (8)\tablofy` (branch `feature/phase7-m5`, HEAD `56aeb5e`, tag `v7.5.0` = `a053516`)
**Scope:** Baseline v7.5.0 → P0 → P1 Batch 1 → P1 Batch 2 → uncommitted working tree (37 tracked modified files + untracked additions).
**Mode:** READ-ONLY. No code, schema, migration, config, test, Docker, or documentation files were modified, committed, or pushed. All runtime probes used throwaway DB rows (deleted after; baseline restored: 1 user, 0 tenants).

---

## FINAL VERDICT: **B — READY WITH FIXES BEFORE P1 BATCH 3**

P1 Batch 2 is substantially correct and its security claims verified live, but **one Batch-2-introduced, user-reachable inventory double-deduction race** (finding F1) must be fixed before P1 Batch 3 starts. All other findings are pre-existing debt (Section 4).

---

## 1. Verdict Rationale (top-level)

| Area                | Result                                                            | Evidence                                                                                                        |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Build               | PASS                                                              | `tsc --noEmit -p apps/api/tsconfig.json` clean; `nx build api` EXIT=0                                           |
| Lint                | 737 errors, 0 warnings, ALL `prettier/prettier`, all `--fix`-able | 728 CRLF `Delete ␍` noise + 9 cosmetic line-collapses in 3 files. Zero semantic impact                          |
| Full test suite     | 60 suites / 645 tests PASS (24.152s), EXIT=0                      | Exact reconciliation of Batch-2 claim; output `C:\Users\ELNOUR~1\AppData\Local\Temp\opencode\full-jest-run.txt` |
| Live runtime matrix | All claims verified                                               | Section 3                                                                                                       |
| New code quality    | High, deny-by-default                                             | Section 2                                                                                                       |
| Blocking defect     | **F1 inventory double-deduction race**                            | Section 4, finding F1                                                                                           |

---

## 2. Batch-2 Change Classification

Every uncommitted change was classified. Summary by file group:

**APPROVED**

- `apps/api/src/common/ssrf/*` (new): SSRF guard + pinned-socket client + blocklists + specs.
- `apps/api/src/common/decorators/authenticated.decorator.ts` (new): `@Authenticated()` → `ANY_AUTHENTICATED_KEY`.
- `apps/api/src/common/rbac/rbac-route-coverage.spec.ts` (new): handler-level tripwire; passes.
- `apps/api/src/common/guards/roles.guard.ts`: deny-by-default (no metadata → Forbidden). Tests added.
- `apps/api/src/common/bull-board/bull-board.module.ts`: Bull Board now requires JWT SUPER_ADMIN + Prisma DB re-fetch + ACTIVE. Tests added.
- `apps/api/src/modules/webhooks/webhook-processor.ts`: axios → `SsrfClientService`; forbidden-header sanitization; blocked ⇒ no retry; non-2xx ⇒ no retry.
- `apps/api/src/modules/webhooks/webhooks.service.ts` + `webhooks.module.ts`: SSRF assertion before persist; `SsrfBlockedError` → 400.
- `apps/api/src/modules/payments/payments.service.ts` + split-payment.dto: gift-card redemption (tenant-scoped, ACTIVE, expiry), version-based optimistic locking, `reference`/`idempotencyKey` length bounds.
- `apps/api/src/modules/customer-analytics/customer-analytics.service.ts`: raw SQL snake_case `@@map` names (`FROM orders`, `wallet_transactions`), parameterized trend queries.
- `apps/api/src/modules/orders/order-state-machine.ts`: `isTerminalStatus` now includes `COMPLETED`.
- ~19 controllers: class-level `@Authenticated()`/`@Permissions` markers; all new permission strings exist in `role-permissions.ts` ALL_PERMISSIONS.
- `apps/api/src/modules/webhooks/tests/*` (new): regression specs.
- `prisma/migrations/.../m4_4*/migration.sql`: DEFAULT+drop pattern proven on populated tables (prior session) — **RISKY cosmetic**: checksum `ed81a8a2…` vs recorded prod `286c6529…` (schema-identical; see F4).

**RISKY / REQUIRES FIX**

- **F1 — `apps/api/src/modules/recipes/recipes.processor.ts`** (modified): the new `@OnEvent('payments.completed')` handler creates a double-deduction race. Details in Section 3 / finding F1.

**UNRELATED / DEBT** — see Section 4.

---

## 3. Verification Evidence

### 3.1 Live runtime matrix (running `docker-api` container = current code; markers `ssrfBlocked`, `redeemGiftCardForPayment`, `anyAuthenticated`, `isOrderCompletedForDeduction` confirmed in `/app/app/main.js`)

| Probe                                                                            | Result                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/v1/metrics` no token                                                   | 401 ✓                                                                                   |
| `GET /api/v1/metrics` with `METRICS_AUTH_TOKEN`                                  | 200 ✓                                                                                   |
| `GET /admin/queues` no token / garbage token                                     | 401 / 401 ✓                                                                             |
| `GET /admin/queues` OWNER token                                                  | 403 ✓                                                                                   |
| `GET /admin/queues` SUPER_ADMIN token                                            | 200 ✓                                                                                   |
| `POST /api/v1/webhooks` (OWNER w/ tenant) `https://127.0.0.1/hook`               | 400 `Webhook URL is not allowed: Address "127.0.0.1"...`                                |
| `https://169.254.169.254/latest/meta-data`                                       | 400 SSRF (metadata)                                                                     |
| `https://10.0.0.1/hook`                                                          | 400 SSRF (private)                                                                      |
| `https://metadata.google.internal/hook`                                          | 400 SSRF (hostname)                                                                     |
| `https://169.254.169.254.nip.io/hook`                                            | 400 SSRF `resolves to a blocked address (169.254.169.254)` — DNS-rebinding defense live |
| `https://172.18.0.1/hook` (docker bridge gateway)                                | 400 SSRF                                                                                |
| `https://tablofy-postgres/…`, `https://tablofy-redis/…`, `https://tablofy-api/…` | 400 DTO (`url must be a URL address`, no TLD) — rejected before DNS                     |
| `https://localhost/hook`                                                         | 400 DTO (no TLD)                                                                        |
| `https://httpbin.org/post`                                                       | 201 created (then row deleted)                                                          |

This **exceeds** the claimed 4×400 (verified 5+ distinct blocked vectors). Blocked-delivery no-retry verified in code + specs (`webhook-processor.spec.ts`).

### 3.2 Webhook delivery integrity (static + specs)

- HMAC SHA-256 signature `v1,<sig>` over canonical JSON payload with per-registration secret (encrypted AES-GCM in DB, `WEBHOOK_ENCRYPTION_KEY`).
- Header sanitization strips hop-by-hop/proxy-spoofing/platform-contract headers + `x-forwarded-*`/`x-original-*`/`x-real-*`/`x-client-*`.
- SSRF-blocked and non-2xx deliveries are marked failed with **no retry**; only network errors retry ≤ `webhook.maxRetries` (5).

### 3.3 Static/DB reconciliation

- No `@Inject(` anywhere; `any` only pre-existing modules + one bounded `(updateData as any)` in orders.service.
- All 72 controllers protected (file-level markers); tripwire checks handler-level metadata.
- Prisma `@@map` names consistent with Batch-2 raw SQL; migrations 18/18 up-to-date on prod; `migrate diff` = "No difference detected".
- Queue wiring: 36 workers, 21 configured queues all have workers; **no producer passes a deterministic `jobId`**.
- Coverage: `jest --coverage` still exits 1 due to pre-existing unmet per-file thresholds (unchanged config). Plain `jest` EXIT=0.

---

## 4. Findings

### 4.1 Batch-2-attributable — REQUIRES FIX

**F1 (HIGH, BLOCKER) — Inventory double-deduction race via split payments + order.completed**

- Trigger paths for `inventory-deduction` / `deduct-inventory` jobs on one order:
  1. `payments.completed` **once per completed split** — `payments.service.ts:940` (loop over results) and `:490` (single payment). In `splitPayment`, the order is already set `COMPLETED` inside the transaction (`payments.service.ts:901-909`) before the loop emits, so **every** completed split in a fully-covering split call passes the `isOrderCompletedForDeduction` gate (`recipes.processor.ts:32-38`).
  2. `order.completed` emitted dynamically on status change — `orders.service.ts:482-483` (`order.${status.toLowerCase()}`) → `recipes.processor.ts:21-28` (no `isOrderCompletedForDeduction` gate).
- **No dedup anywhere:** no deterministic `jobId` (`queue.service.ts:225-235`; caller passes none), worker concurrency 5 (`recipes.processor.ts:15` default), idempotency check reads `existingMovements` **outside** the deduction transaction (`recipes.service.ts:515-523` vs `$transaction` at `:612`), and `StockMovement` has only `@@index([referenceType, referenceId])` — **no unique constraint** (`schema.prisma:2991`).
- **Consequence:** two+ concurrently-processed jobs both pass the empty-movement check and both decrement `currentQuantity`/`availableQuantity` and insert duplicate `CONSUMPTION` movements → double/triple inventory deduction and duplicated stock movements for the same order.
- **Reachability:** bill split 2+ ways where ≥2 splits complete in one call (common flow); also a manual complete (`changeStatus` → COMPLETED) racing the split-payment auto-complete.
- **Coverage:** no test for `onOrderCompleted`, `onPaymentsCompleted`, or concurrent `deductInventoryForOrder` (grep of `apps/api/src/modules/recipes`).
- **Minimal fixes (choose one):** (a) deterministic `jobId` `deduct-${orderId}` in both `addJob` calls → BullMQ dedups; (b) DB-level unique (partial index) on `stock_movements(referenceType, referenceId)` for `type=CONSUMPTION`; (c) move the existing-movement check inside the `$transaction`. (a) is smallest and closes the multi-emission case.

### 4.2 Batch-2-related DEBT (non-blocking)

| ID  | Severity | Finding                                                                                                                                                                                          |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F2  | MED      | Batch-2 customer-analytics raw queries filter/join on `orders.customerPhone` and `customers.phone` — **neither column is indexed** (schema `Order`/`Customer`); perf risk as data grows.         |
| F3  | LOW      | Webhook `CreateWebhookDto.events` (unbounded array) and `headers`/`metadata` (unbounded objects) lack size caps (`ArrayMaxSize`/`ValidateNested`); events not validated against known event set. |
| F4  | MED      | M4.4 working-tree migration checksum differs from recorded prod checksum (schema-identical); RISKY cosmetic — corrected follow-up or replay-with-reset recommended.                              |
| F5  | LOW      | `customer-analytics.service.ts` uses `$queryRawUnsafe` (5 sites, incl. `getWalletTrend` placeholder-string construction) — parameterized and safe today; prefer `Prisma.sql`.                    |
| F6  | LOW      | Lint baseline: 728 CRLF `prettier/prettier` errors on changed files — hygiene only.                                                                                                              |

### 4.3 Pre-existing DEBT (baseline, NOT Batch-2 — recorded for context)

| ID  | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | HIGH     | **Webhook event names never match:** `webhook-event-emitter.ts:11-35` subscribes plural `orders.*`, `customers.*`, `inventory.*`, `loyalty.*`, `campaigns.*`, `suppliers.*`, `transfers.*`; app emits singular `order.*` only (`orders.service.ts:162,389,483`). Only `payments.completed/failed/refunded` can ever dispatch. Order/customer/inventory/loyalty webhooks never fire. (File NOT in the uncommitted diff.) |
| D2  | MED      | `partialRefund` does not track cumulative refunded amount (no `refundedAmount` column); repeated partial refunds can exceed `payment.amount` at app level (gateway is backstop only for card methods).                                                                                                                                                                                                                  |
| D3  | MED      | 24 queue workers registered with no producer (e.g., `inventory-sync`, `forecast-generation`, `print`, `scheduled-reports`); `notification` queue payload mismatch (`title/channel` vs `{items}`/`{alertCount}`); health check monitors only 5/36 queues.                                                                                                                                                                |
| D4  | LOW      | DLQ jobs are consumed+acknowledged by `DeadLetterProcessor` (log only, no alerting), so the depth monitor/alert threshold is moot.                                                                                                                                                                                                                                                                                      |
| D5  | MED      | `prisma:seed` script exists but no `prisma.seed` config and no seed file → `npm run prisma:seed` fails.                                                                                                                                                                                                                                                                                                                 |
| D6  | LOW      | Coverage thresholds unmet under `--coverage` (exit 1), e.g. `http-exception.filter.ts` 90% vs 79.2%, `tenant-body.guard.ts` 0% — config unchanged by Batch-2.                                                                                                                                                                                                                                                           |
| D7  | LOW      | Undeclared deps used (`express`, `@nestjs/websockets`, `@nestjs/mapped-types`, `glob`-via-createRequire); declared-but-unused (`csv-stringify`, `@sentry/integrations`); no `apps/api/package.json`.                                                                                                                                                                                                                    |
| D8  | LOW      | Validation hardening gaps: 266 unvalidated `@Param('id')`, ~39 raw `page`/`limit` query params across 15 controllers, 17 unbounded arrays, 7 `@Body('prop')` primitives, 4 raw-body endpoints (payment-webhooks/export-engine/privacy — raw body intentional where signature verification).                                                                                                                             |
| D9  | LOW      | 23/72 controllers lack `@ApiTags`; 2 declared Swagger tags unused; `health`/`metrics` controllers missing tags.                                                                                                                                                                                                                                                                                                         |
| D10 | LOW      | Prod compose fails fast without env vars (METRICS_AUTH_TOKEN, WEBHOOK_ENCRYPTION_KEY, gateway keys, JWT secrets) — secure but undocumented as boot requirement.                                                                                                                                                                                                                                                         |
| D11 | LOW      | Root `.env` `DATABASE_URL` points to nonexistent `tablofy_dev` (P1000 for local tooling); runtime DB is `tablofy_prod`.                                                                                                                                                                                                                                                                                                 |
| D12 | MED      | N+1: `forecasting.service.ts` per-item consumption queries (sequential in one path); `kds.service.ts` per-station; `customers.service.ts` upsert loop; `recipes.service.ts` `findUnique` in tx loop; `payments.service.ts:1036-1064` per-payment provider HTTP.                                                                                                                                                         |
| D13 | MED      | Missing indexes: `Order.customerPhone` (HIGH), `Customer.phone`, `ConsumptionRecord(tenantId,inventoryItemId,date)`, `WalletTransaction(referenceType,referenceId)` (inconsistent with StockMovement).                                                                                                                                                                                                                  |

---

## 5. Not Verified / Environment-Blocked

- **Live end-to-end order→deduction flow** not exercised at runtime (requires full tenant/restaurant/menu/customer seed); covered only statically and via service specs. The F1 race is a static+trace analysis.
- **Live webhook HTTP round-trip delivery** to a public endpoint not executed (no business event without seed); delivery path covered by `webhook-processor.spec.ts`, `webhook-delivery.service.spec.ts`.
- Root `.env` `tablofy_dev` URL unreachable (environment debt, D11).

## 6. Provenance & Hygiene

- All runtime DB changes were rolled back (temp user/tenant/subscription/webhook rows deleted; counts verified restored: users=1, tenants=0, subscriptions=0, webhook_registrations=0).
- Tokens minted with the container's `JWT_SECRET` for local verification only; secrets remain masked in this report.
- Full-suite evidence: `C:\Users\ELNOUR~1\AppData\Local\Temp\opencode\full-jest-run.txt` (60 suites / 645 tests / 24.152s / EXIT=0).
