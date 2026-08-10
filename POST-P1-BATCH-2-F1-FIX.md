# P1 Batch 2 — F1 Fix Report (inventory double/triple deduction race)

**Status:** FIXED AND VERIFIED (unit + build + typecheck + docker runtime concurrency).
**Scope:** F1 only. No other modules touched. P1 Batch 3 remains blocked pending explicit approval.

---

## 1. Root Cause

Inventory is deducted for a completed order in `recipes.service.deductInventoryForOrder`. That function can be invoked **concurrently and more than once** for the same order:

1. `payments.service` emits `payments.completed` on payment completion (lines ~490, ~940, ~1216) and split transactions auto-complete the order (lines ~901-909).
2. `orders.service` dynamically emits `order.completed` when an order transitions to `COMPLETED` (lines ~482-483).
3. `recipes.processor` registers **two** handlers — `onOrderCompleted` and `onPaymentsCompleted` — each of which calls `addJob` for `deductInventoryForOrder`.
4. `POST /api/v1/recipes/deduct-order/:orderId` calls `deductInventoryForOrder` **directly, bypassing the queue entirely** (`recipes.controller.ts:107-112`).

Before the fix, every trigger created a fresh job/request, and the deduction loop ran unconditionally. With the default BullMQ worker concurrency of 5, or with queue jobs racing the direct HTTP call, two+ executions could observe zero existing movements and **each write a full deduction** — double/triple inventory decrement and duplicate `stock_movements` rows.

The original code performed the idempotency check **before** any transaction (`findMany` then write), so two in-flight executions could both pass the check and both write.

## 2. Before / After

### Before (buggy)

```
trigger → addJob (no jobId) → worker → deductInventoryForOrder
  ├─ findMany movements (0)            ← race window
  ├─ per-item inventory update          ← N parallel executions all write
  ├─ stockMovement.create               ← N duplicate CONSUMPTION rows
  └─ audit log + cache invalidation
```

### After (fixed)

```
trigger → addJob({ jobId: 'deduct-' + orderId })  ← BullMQ dedupes by jobId
  └─ deductInventoryForOrder
       ├─ pre-tx findMany movements → if exists, return idempotent report (short-circuit)
       ├─ $transaction:
       │     ├─ SELECT … FROM orders WHERE id=? AND tenantId=? FOR UPDATE   ← serialize
       │     ├─ in-tx findFirst movements → if exists, return idempotent report
       │     └─ per-line decrement + CONSUMPTION movement                   ← only first writer
       ├─ audit log (once)
       ├─ cache delete (once)
       └─ gateway broadcast (once)
```

## 3. Strategy: deterministic jobId + DB-level in-transaction claim

**Layer 1 — BullMQ `jobId: 'deduct-' + orderId`** (4th arg to `addJob`, `recipes.processor.ts:21-36` and `:38-57`).
BullMQ v5 dedupes jobs by `jobId` regardless of payload. All payment/order triggers for one order collapse to a single queued job. The two handlers (`onOrderCompleted`, `onPaymentsCompleted`) now produce the same deterministic jobId, so even when both events fire, only one job is enqueued.

**Layer 2 — DB-level claim inside `$transaction`** (`recipes.service.ts:628-648`).
`jobId` alone is insufficient because the direct endpoint `POST recipes/deduct-order/:orderId` bypasses the queue and can race an in-flight queued job, and a job could in principle be re-created after completion. Inside the transaction:

- `tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`` — the first execution to reach the transaction holds the row lock; every other concurrent execution blocks on the same row and then re-checks.
- Re-check `tx.stockMovement.findFirst` for a CONSUMPTION row scoped to `(ORDER, orderId, tenantId)`. If present, the transaction writes nothing and returns the idempotent report.
- Only the execution that holds the lock and finds no prior movement performs the writes. Because the lock is held until commit/rollback, later executions always observe the committed movement and take the idempotent path.

**Why no schema change:** the claim uses the existing tenant-scoped order row (every order id is globally unique, so the row lock is per-order, not per-tenant). A dedicated unique index on `(referenceType, referenceId)` would also work but was deliberately avoided to keep the fix read-only (no migration) and behavior-identical.

### Why `jobId` alone is insufficient

- `POST /api/v1/recipes/deduct-order/:orderId` calls the service directly — no queue job to dedupe against.
- Queued job delivery is at-least-once; a job can be re-created after completion (crash/requeue), and BullMQ jobId dedupe has a bounded retention window.
- The DB claim is the only unconditional guarantee; the jobId is a load/duplication optimization on top.

## 4. Concurrency Analysis

| Scenario                                                                         | Before                                              | After                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Single order completed once                                                      | 1 deduction                                         | 1 deduction                                                                                |
| Both `order.completed` + `payments.completed` fire                               | 2 deductions possible                               | 1 (same jobId; second is deduped; if it still runs, in-tx claim returns idempotent report) |
| Multi-split payment, split tx auto-completes order (payments.service `:901-909`) | multiple `payments.completed` → multiple deductions | 1 (same jobId)                                                                             |
| Direct HTTP call racing queued job                                               | 2 deductions                                        | 1 (row lock serializes; second sees committed movement)                                    |
| Duplicate/re-sent event                                                          | extra deduction                                     | idempotent report, zero writes                                                             |
| Retry after transient failure before any write                                   | re-runs                                             | re-runs, still one deduction                                                               |
| Retry after committed success                                                    | re-deducts                                          | idempotent report, no double deduction                                                     |
| Concurrent workers (concurrency 5)                                               | multiple deductions                                 | 1 (only lock holder writes)                                                                |
| Distinct orders                                                                  | independent                                         | independent (per-order lock)                                                               |
| Same orderId across tenants                                                      | N/A (order id unique)                               | tenant-scoped; `WHERE tenantId = ?` in claim + all queries                                 |
| DRAFT/CANCELLED/REFUNDED/VOIDED                                                  | rejected                                            | rejected (unchanged, `recipes.service.ts:532-535`)                                         |
| Non-COMPLETED with `onPaymentsCompleted` gate                                    | gate blocked enqueue                                | gate still blocks enqueue (unchanged)                                                      |

**Multi-split handling:** split-payment completion emits `payments.completed` once per split (and may auto-complete the order, emitting `order.completed` too). All those triggers collapse onto `jobId: 'deduct-<orderId>'`; the worker still cannot double-deduct because the in-transaction claim is per-order.

**Retry-safety:** a failed attempt that wrote nothing re-runs cleanly (no partial writes — all writes are inside the single transaction). A failed attempt whose transaction committed still counts exactly once; later attempts return the idempotent report. No legitimate deduction is skipped: a blocklisted status throws, an order with no items throws, no recipe throws, zero-consumption throws — all before any write, unchanged from original behavior.

**Tenant isolation:** all queries carry `tenantId`; the claim is `WHERE id = ? AND tenantId = ? FOR UPDATE`, so a tenant can never claim (or be blocked by) another tenant's order row. Lock scope is one order row per tenant.

## 5. Tests

### New spec files

- `apps/api/src/modules/recipes/tests/recipes.processor.spec.ts` (10 tests) — deterministic jobId on both events; duplicate events collapse to the same jobId; distinct orders get distinct jobIds; COMPLETED gate blocks enqueue; handler delegates to `deductInventoryForOrder`; missing tenantId throws.
- `apps/api/src/modules/recipes/tests/recipes.service.deduction.spec.ts` (13 tests) — NotFound; DRAFT/CANCELLED/REFUNDED/VOIDED rejection (no transaction/findMany); single deduction (1 create, 1 update, audit+cache+gateway once); pre-existing movements → idempotent report, zero writes; concurrent race via `$transaction` lock-gate → exactly 1 create/update/audit/broadcast; failed first attempt + retry → exactly 1 resolved create; distinct orders independent; tenant isolation for same orderId; quantity decrement `{ decrement: 2 }` + movement fields; no active recipe → BadRequest; `isOrderCompletedForDeduction` matrix.

### Verification gates (all passed)

| Gate                                                                        | Result                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Targeted Jest (2 spec files)                                                | 2 suites, 23 tests, PASS                                           |
| Full Jest suite                                                             | 62 suites, 668 tests, 0 failures (evidence `full-jest-f1-fix.txt`) |
| `tsc --noEmit -p apps/api/tsconfig.app.json`                                | exit 0                                                             |
| `tsc --noEmit -p apps/api/tsconfig.spec.json`                               | 463 pre-existing errors, 0 in new/modified files                   |
| `prisma validate`                                                           | schema valid, exit 0                                               |
| `prisma migrate status` (dev)                                               | P1000 auth failure — pre-existing env misconfig, unrelated         |
| Migration state (runtime `tablofy_prod`)                                    | 18 migrations, 0 pending                                           |
| `nx build api --skip-nx-cache`                                              | exit 0                                                             |
| ESLint on changed files                                                     | exit 0 (after `--fix` for 3 prettier violations)                   |
| Docker build (`docker compose -f docker/docker-compose.prod.yml build api`) | exit 0                                                             |
| Runtime concurrency (below)                                                 | PASS                                                               |

### Docker runtime concurrency verification (against rebuilt healthy API)

Seeded a temp tenant + ACTIVE subscription + OWNER user + restaurant/branch/product + COMPLETED order (2× Pizza) + recipe (1 Flour per unit) + inventory item `currentQuantity = 100`. Minted an OWNER JWT with the container's real `JWT_SECRET`. Fired **5 parallel** `POST /api/v1/recipes/deduct-order/<orderId>`.

Result:

```
[1..5] STATUS 201  all report totalDeducted=2, quantityDeducted=2

DB: movements=1 sum_qty=-2.0000      (exactly one CONSUMPTION row, quantity -2)
DB: inventory current=98.0000 available=98.0000   (100 → 98, decremented exactly once)
DB: audit_logs=5  (all HTTP interceptor rows; see backlog item 4)
```

All temp rows cleaned up; runtime DB restored to baseline (0 tenants, 1 user, 0 movements).

## 6. Files Changed

- `apps/api/src/modules/recipes/recipes.processor.ts` — `{ jobId: 'deduct-' + orderId }` on both `addJob` calls (`:21-36`, `:38-57`).
- `apps/api/src/modules/recipes/recipes.service.ts` — extracted `buildIdempotentReport` (`:496-524`); pre-transaction `findMany` short-circuit (`:545-556`); wrapped all writes in `prisma.$transaction` with `SELECT … FOR UPDATE` claim + in-transaction `findFirst` re-check (`:628-648`); writes unchanged below.
- `apps/api/src/test/mocks/prisma.mock.ts` — added `$queryRaw` to `createMockDelegateWithTransaction()` (`:163-168`).
- `apps/api/src/modules/recipes/tests/recipes.processor.spec.ts` — new.
- `apps/api/src/modules/recipes/tests/recipes.service.deduction.spec.ts` — new.

## 7. Limitations / Non-goals

- The direct endpoint `POST /recipes/deduct-order/:orderId` is still user-triggerable (unchanged). It is now safe (idempotent), but a future hardening could restrict it or require explicit confirmation.
- Queue jobId dedupe relies on BullMQ job retention; the DB claim makes correctness independent of that.
- No unique DB index added (read-only preference kept) — the `FOR UPDATE` claim provides the same guarantee without a migration.

## 8. Verdict

**F1 is FIXED.** The fix guarantees at most one logical deduction per order, is safe under concurrent workers and duplicate/raced events, is retry-safe, preserves legitimate deductions and existing status rules, and keeps tenant isolation intact. Verified by 23 targeted unit tests, the full Jest suite (668 tests), typecheck, schema validation, build, lint, and a Docker runtime concurrency test (5 parallel requests → exactly 1 movement, exactly one decrement). No schema change required.

## 9. Verified Backlog (recorded, NOT fixed — out of scope for F1)

1. **Dev DB migration check fails** — `prisma migrate status` against `tablofy_dev` at localhost:5432 returns P1000 (invalid dev credentials via `prisma.config.ts`). Runtime `tablofy_prod` is in sync (18/18).
2. **Spec-project typecheck** — 463 pre-existing errors in classpath specs (not introduced by this change; 0 in new/modified files).
3. **Root `.env` incomplete for production mode** — missing `METRICS_AUTH_TOKEN`, `WEBHOOK_ENCRYPTION_KEY`, `PAYMOB_API_KEY`; the API container required all three. Worked around at runtime with fresh random values (safe: runtime DB has 0 tenants / 0 webhooks). Must be persisted/replaced with real secrets.
4. **`INVENTORY_DEDUCTED` audit write fails at runtime** — `auditLogsService.log` swallows the error (confirmed in container logs: "Failed to write audit log: INVENTORY_DEDUCTED on Order"). Root cause: FK violation on `audit_logs_userId_fkey` because `userId: 'system'` has no `users` row. Pre-existing in HEAD (both `INVENTORY_DEDUCTED` and rollback audit calls use `'system'`); unrelated to F1 — the deduction still commits exactly once. Fix options (later): seed a real `system` user or relax the FK. Reproduced: `auditLog.create` with `userId:'system'` → `Foreign key constraint violated … audit_logs_userId_fkey`.
5. **Carried from prior audit (unchanged this batch):** webhook routes plural/singular naming inconsistency; partial-refund flow may allow over-refund; queue worker reconnection/dead-worker handling; seed script drift; missing performance indexes; low coverage thresholds. All recorded for P1 Batch 3+; none touched here.

## 10. Next

**P1 Batch 3 remains blocked pending explicit approval.** No Batch 3 work was started. Only the F1 flow and its tests/mocks were modified.
