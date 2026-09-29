# P1 Remediation — Implementation Report

## 1. Document Metadata

- **Title**: P1 Remediation Implementation Report (P1-01, P1-02, P1-03, P1-04)
- **Date**: 2026-08-28
- **Repository**: Tablofy monorepo
- **Baseline HEAD**: `16d70e546d28252babf3e830d85015c55bcb6e00`
- **Preflight reference**: `P1-REMEDIATION-PREFLIGHT-AUDIT.md` (authored and approved before implementation)
- **Authorization reference**: Implementation authorization for the four P1 items with explicit STOP boundaries (no schema changes, no migrations, no deploy, no commit/push).
- **Baseline snapshot**: `C:\Users\ELNOUR~1\AppData\Local\Temp\opencode\deploy-audit\baseline-pre-impl.txt`

## 2. Executive Summary

All four P1 remediation items were implemented within the authorized scope, tested with focused suites, and validated by the full gate suite. Zero schema changes were made, zero migrations were created, and no data in the live database was touched. The live database contains **0 rows** in all tables affected by the remediation (orders, payments, consumption_records, refresh_tokens), so no backfill or data-migration is required.

| P1                                                | Classification                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P1-03 — Prevent unpaid orders being completed     | **IMPLEMENTED_AND_TESTED**                                                                         |
| P1-04 — Hash refresh tokens at rest               | **IMPLEMENTED_AND_TESTED**                                                                         |
| P1-02 — Auto-reconcile PENDING payments           | **IMPLEMENTED_AND_TESTED**                                                                         |
| P1-01 — Consumption records from order deductions | **PARTIALLY_IMPLEMENTED** (creation path only; refund-reversal not authorized — decision required) |

Gate results: full Jest **98 suites / 1262 tests passed**, `tsc --noEmit` clean, ESLint clean, production webpack build succeeded, `prisma validate` OK, `prisma migrate status` up-to-date (24 migrations), schema↔database diff **no difference**.

## 3. Authorization Scope & Boundaries

- Implemented only the four P1 items; no P2/P3 work, no Phase 4, no unrelated refactors.
- **Zero schema changes**; no migrations; no `migrate reset`; no truncate/delete/recreation of data; no Redis wipe.
- Reused existing architecture: `finalizeSucceededPayment` for credit path, the existing scheduler→queue→cleanup processor pattern, existing SHA-256 hashing helpers, and the existing `deductInventoryForOrder` transaction.
- Gateway (provider) I/O is performed **outside** database transactions.
- No commit, push, deploy, image rebuild, or container restart was performed.
- Pre-existing working-tree changes were left untouched (no reset/clean/checkout).

## 4. Baseline Captured

- Git HEAD: `16d70e546d28252babf3e830d85015cbcb6e00`
- Pre-existing tracked working-tree modifications and untracked files were captured to the baseline snapshot path above before any change.
- Live-DB row counts verified before implementation via preflight (0 in orders, payments, consumption_records, refresh_tokens) and re-verified after implementation (identical: 0/0/0/0), confirming no data transformation was surfaced.

## 5. Change Inventory

Files modified in this effort (all scoped to the P1 items):

- `apps/api/src/modules/orders/orders.service.ts` — P1-03 gate
- `apps/api/src/modules/orders/tests/orders.service.spec.ts` — P1-03 tests (+8)
- `apps/api/src/modules/auth/auth.service.ts` — P1-04 hashed refresh tokens
- `apps/api/src/modules/auth/tests/auth.service.spec.ts` — P1-04 tests (+4)
- `apps/api/src/modules/auth/tests/integration/auth-flow.integration.spec.ts` — P1-04 logout assertion updated
- `apps/api/src/modules/payments/payments.service.ts` — P1-02 reconcile engine (+ reuse of finalize path)
- `apps/api/src/modules/queues/cleanup.processor.ts` — P1-02 `reconcile_pending_payments` job type
- `apps/api/src/modules/queues/queue.module.ts` — P1-02 import `PaymentsModule`
- `apps/api/src/modules/scheduler/scheduler.service.ts` — P1-02 cron (every 15 min)
- `apps/api/src/modules/queues/tests/cleanup.processor.spec.ts` — P1-02 tests (+2; 5 constructor updates)
- `apps/api/src/modules/recipes/recipes.service.ts` — P1-01 ConsumptionRecord writer
- `apps/api/src/modules/recipes/tests/recipes.service.deduction.spec.ts` — P1-01 tests (+5)

Files created:

- `apps/api/src/modules/payments/tests/reconcile-pending.spec.ts` — P1-02 tests (13)

Reports:

- `P1-REMEDIATION-PREFLIGHT-AUDIT.md` (pre-authorized, prior session)
- `P1-REMEDIATION-IMPLEMENTATION-REPORT.md` (this document)

No files were deleted. Pre-existing untracked files and tracked modifications were preserved; the only pre-existing untracked file that my work touched is `cleanup.processor.spec.ts` (was already untracked from an earlier remediation, modified only to add the new constructor dependency and reconcile tests).

## 6. P1-03 — Objective & Pre-implementation Findings

**Objective**: prevent orders from reaching `COMPLETED` before they are fully paid.

Pre-implementation trace (from preflight):

- All automatic `Order → COMPLETED` writers are already payment-gated by `totalPaid >= orderTotal`:
  - `payments.service.ts` `finalizeSucceededPayment` (now :161/:172 after formatting)
  - non-provider/cash charge path (:332/:343)
  - split finalize path (:877/:888, :1080/:1091)
  - gateway webhook succeeded path (:1601/:1612)
- `orders.service.changeStatus` was the **only** ungated path (a supervisor/KITCHEN user could complete an unpaid order).
- Only caller of `changeStatus`: `orders.controller.ts` `PATCH orders/:id/status` (route `@Roles('OWNER','MANAGER','CASHIER','KITCHEN')`).
- `paidAmount` is written only in `payments.service` (credit increments :158/:329/:875; refund decrements :585/:687); `orders.addPayment` delegates to `paymentsService.charge`.
- `cleanup.processor` `COMPLETED` literals refer to a different entity (report exports), not `Order`.

## 7. P1-03 — Implementation Summary

In `orders.service.changeStatus`, immediately after `validateTransition(currentStatus, dto.status)`, a payment gate was added:

```ts
if (dto.status === OrderStatus.COMPLETED) {
  const totalPaid = Number(existing.paidAmount ?? 0);
  const orderTotal = Number(existing.total ?? 0);
  if (totalPaid < orderTotal) {
    throw new BadRequestException(
      `Order cannot be completed until fully paid (${totalPaid} of ${orderTotal})`,
    );
  }
}
```

Exception type chosen: `BadRequestException` (the codebase does not use `UnprocessableEntityException`). The gate runs before any transaction or status-history write, so it is un-skewable by concurrent modifications within the same check.

## 8. P1-03 — Evidence & Verification

- Gate location verified at `orders.service.ts:488-496` (before the `$transaction` that performs the status write at :498).
- The same function still terminates the transition on the atomic CAS (`version` mismatch → `ConflictException`, :521-523), so a concurrent payment mid-flight that changes `paidAmount` after this gate runs can still fail the transition safely.
- Free orders (`total = 0`) pass the gate because `totalPaid(0) >= orderTotal(0)`.

## 9. P1-03 — Test Results

8 focused tests added to `orders.service.spec.ts` under the `changeStatus` describe:

1. fully-paid order completes
2. zero-total (free) order completes
3. `it.each` — `PENDING`, `FAILED`, and partial (`paid < total`) are all rejected
4. rejected transitions assert **no** `$transaction` call and no metric increment
5. split payments summing to total complete
6. concurrent CAS conflict → `ConflictException`
7. cross-tenant access → `NotFoundException`

Results: `orders.service.spec` 86 tests passed (10 under `-t changeStatus`); `orders.controller.spec` + `order-crud.integration.spec` 8 passed; all integration suites 7 suites / 45 tests passed.

## 10. P1-03 — Classification

**IMPLEMENTED_AND_TESTED.**
Residual note: the `changeStatus` route still permits KITCHEN users to attempt completion (they will now be blocked for unpaid orders). Tightening the route to exclude KITCHEN was intentionally deferred to keep scope to the gate-only fix; see Section 30.

## 11. P1-04 — Objective & Pre-implementation Findings

**Objective**: never persist raw refresh-token material; store only a SHA-256 digest so a database leak does not yield usable tokens.

Pre-implementation findings:

- The codebase already hashes verification/password-reset tokens with SHA-256 (`auth.service.ts` :451, :657) — refresh tokens were the only token class stored in plaintext.
- Refresh-token lifecycle in plaintext before the fix: `generateTokenPair` created `token: refreshTokenRecord.token` (raw), `refreshTokens()` looked up `where: { token: rawValue }`, `logout()` revoked `where: { token: rawValue, … }`, and rejection (rotation) happened by `id`.
- Auth specs contain **no** result assertions on `tokens.refreshToken`, so returning the raw value to the client is safe.
- Live `refresh_tokens` table has **0 rows** → no legacy plaintext rows to rotate; no migration needed.

## 12. P1-04 — Implementation Summary

`auth.service.ts`:

- New private helper: `private hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }`.
- `refreshTokens()` lookup now uses `where: { token: this.hashToken(refreshTokenValue) }` (:288).
- `logout()` revocation now uses `where: { token: this.hashToken(refreshTokenValue), userId, revokedAt: null }` (:359).
- `generateTokenPair` generates `const refreshTokenValue = randomBytes(40).toString('hex')` (80 hex chars) and persists `token: this.hashToken(refreshTokenValue)` (:857-860); the **raw value is returned to the caller only** (:883).
- Revoke-by-id and revoke-all-by-user paths (which are not token-keyed) are unchanged.

## 13. P1-04 — Evidence & Verification

Post-implementation grep of every `refreshToken.*` production site in `auth.service.ts`:

- create (:857-860) → stored value is `hashToken(refreshTokenValue)`, raw returned to client only.
- findUnique (:287-288) → lookup keyed by hash.
- updateMany logout (:358-359) → keyed by hash.
- update by id (:343-346), revoke-all by user (:518-521, :571-573, :888-891) → not token-value-keyed.

The live DB has 0 refresh_token rows, so there is no plaintext legacy data to address.

## 14. P1-04 — Test Results

Focused tests added/updated:

- `auth.service.spec.ts` (+4): refresh lookup is keyed by the SHA-256 digest; expired token is rejected; the P1-04 describe asserts the persisted token is a 64-hex-char SHA-256 digest of the raw 80-hex-char value and never equal to it; asserts the raw token is not written to logs or session metadata.
- `auth-flow.integration.spec.ts`: logout `where.token` assertion updated to `createHash('sha256').update('refresh-token').digest('hex')`.

Results: the three auth suites (unit + integration) run **86 passed**; the 5 P1-04-focused tests pass under the name filter.

## 15. P1-04 — Classification

**IMPLEMENTED_AND_TESTED.**
Residual/design notes (informational, not new defects):

- The raw token exists in memory and in the client response (required by the bearer-token protocol). SHA-256-hash-at-rest neutralizes DB exfiltration of refresh-token material.
- Entropy is 40 random bytes (160 bits) — consistent with the pre-existing token generation model.
- Rotated/revoked tokens are deleted by `updateMany` and are un-usable even before expiry; replay of an already-rotated token now returns a hash lookup of a revoked record → `UnauthorizedException` (covered by existing refresh rotation/revocation tests).

## 16. P1-02 — Objective & Pre-implementation Findings

**Objective**: automatically recover payments stuck in `PENDING` (e.g., webhook lost/delayed, queue outage) without manual intervention, and without creating double-credit/charge risks.

Pre-implementation findings:

- `reconcile(tenantId, from, to)` exists but is **report-only** (counts matches/mismatches; never mutates).
- Providers expose `getPaymentStatus(transactionId)` returning `success` + `data.status` (`succeeded|failed|pending|processing`) + `amount`/`currency` (Stripe: cents; Paymob: major units as `amount_cents/100` — established provider conventions).
- The credit path already exists and is CAS-safe: `finalizeSucceededPayment` claims `{ id, status: PENDING }` via `updateMany` and bumps order `version` in a transaction.
- The scheduling pattern is scheduler cron → `QueueService.addJob('cleanup', …)` → `CleanupProcessor` type dispatch. All existing cron entries use it.

## 17. P1-02 — Implementation Summary

`payments.service.ts`:

- New public `reconcilePendingPayments({ max?, staleAfterMs? })` — scans `PENDING` payments with a `gatewayRef` and `createdAt <= staleCutoff` (default 15 min), oldest first, bounded by `max` (default 50).
- Per-payment `resolvePendingPayment`:
  - **Gateway lookup first, outside any DB transaction.**
  - `succeeded` + amount match (±1 cent after normalization) → reuse `finalizeSucceededPayment` inside a transaction (CAS claim `{ id, status: PENDING }`, order `version` bump) → credits paidAmount, marks COMPLETED only when `totalPaid >= total`, writes status history, audits, metrics, emits `payments.completed`.
  - `succeeded` + amount mismatch → **NOT credited**; payment left PENDING, `PAYMENT_RECONCILE_MISMATCH` audit, attempt recorded.
  - `failed` → CAS-transition PENDING→FAILED (concurrent-safe), audit, metrics, emit `payments.failed`.
  - `pending`/`processing`/unknown → left PENDING, attempt recorded.
  - network/timeout/`success:false`/throw → **never auto-fails**; left PENDING, attempt recorded. Retried on the next run.
- `gatewayAmountCents(provider, amount)` normalizes to cents per provider unit convention.
- `recordReconcileAttempt` merges `gatewayData.reconcileAttempts / lastReconcileAt / lastReconcileNote` for observability.

Wiring (existing architecture, no new infra):

- `scheduler.service.ts`: `@Cron('*/15 * * * *', { name: 'reconcile_pending_payments' })` → queues cleanup job; entry added to `getRegisteredJobs`.
- `cleanup.processor.ts`: new `reconcile_pending_payments` type calls `paymentsService.reconcilePendingPayments` with `PAYMENT_RECONCILE_MAX` (50) and `PAYMENT_RECONCILE_STALE_AFTER_MS` (900000) config overrides.
- `queue.module.ts`: imports `PaymentsModule` (no module cycle: `PaymentsModule → {AuditLogsModule, CommonModule}`, both leaves; `QueueModule → {ExportEngineModule, PaymentsModule}`).

## 18. P1-02 — Evidence & Verification

- Gateway I/O is strictly outside transactions: `getPaymentStatus` is called in `resolvePendingPayment` before any `$transaction`; DB writes occur only after a gateway verdict. Verified by a dedicated test asserting invocation order.
- Double-credit safety: the CAS claim in `finalizeSucceededPayment` means a concurrent webhook/reconcile winner leaves count 0 for the loser → no double credit, no double order increment. Verified by the race test.
- Amount-mismatch rule: payment never credited on a gateway amount mismatch.
- Webhook replay/race safe: same CAS protects the `applyWebhookSucceeded` path.
- Tenant isolation: each candidate is resolved using its own `tenantId` for the order lookup and writes; a test covers the same order id under two tenants; reconcile scans across tenants in one run without cross-tenant coupling.
- No new infrastructure: uses the existing cron + BullMQ cleanup worker.

## 19. P1-02 — Test Results

- New `reconcile-pending.spec.ts`: **13 tests** — candidate selection/staleness bounds; providerless (CASH/GIFT_CARD) untouched; mock-mode provider untouched; success credit path; gateway-before-transaction ordering; amount mismatch (no credit, audit, attempt recorded); paymob major-unit convention; concurrent already-finalized (no double credit); missing order (no credit, attempt recorded); explicit gateway failure → FAILED; processing → kept PENDING; network/timeout → kept PENDING (not auto-failed); thrown gateway exception.
- `cleanup.processor.spec.ts` (+2): reconcile job delegates with default bounds; configurable `PAYMENT_RECONCILE_*` bounds.
- Full module run: `scheduler|payments|queues` → **15 suites / 211 tests passed**, including `queue-module.di.spec.ts` which compiles the real `QueueModule` + `PaymentsModule` graph (validates the new DI wiring end-to-end).

## 20. P1-02 — Classification

**IMPLEMENTED_AND_TESTED.**

## 21. P1-01 — Objective & Pre-implementation Findings

**Objective**: the consumption-analytics layer has readers (analytics/COGS/forecasting use `consumptionRecord.findMany/aggregate/groupBy`) but **no writer existed** — consumption records were never created, so analytics were empty. Source them from actual fulfilling orders.

Pre-implementation findings:

- Prisma search for `consumptionRecord.create` returned zero production hits; only readers exist.
- `ConsumptionRecord` model (already migrated): `inventoryItemId, tenantId, date, quantity(12,4), unitCost?(12,4), totalCost?(12,4), period(DAILY), source?, referenceId?, deletedAt?`.
- Existing readers do **not** filter `deletedAt`.
- The order-deduction transaction (`recipes.service.deductInventoryForOrder`) already serializes concurrent deductions with row locks and an in-transaction idempotency check, and already computes `actualDeduction`, `unitCost`, `totalCostEntry`.

## 22. P1-01 — Implementation Summary

Inside the existing `$transaction` in `deductInventoryForOrder`, immediately after each `stockMovement.create`, a mirror `ConsumptionRecord` is created:

```ts
await tx.consumptionRecord.create({
  data: {
    inventoryItemId: entry.inventoryItemId,
    tenantId,
    date: new Date(),
    quantity: actualDeduction,
    unitCost,
    totalCost: totalCostEntry,
    period: ConsumptionPeriod.DAILY,
    source: 'ORDER',
    referenceId: orderId,
  },
});
```

Because it lives in the same transaction as the movement, the existing row-lock + in-transaction idempotency guard guarantees exactly one record per actual deduction. `actualDeduction` (not `needed`) is recorded so shortfall-aware, realistic quantities are captured. This scope intentionally covers the **non-refund creation path only**.

## 23. P1-01 — Evidence & Verification

- Only production writer of `consumptionRecord.*` is `recipes.service.ts:707` — verified by repo-wide grep.
- All other `consumptionRecord.*` references are readers (`findMany/aggregate/groupBy`) in inventory-analytics/COGS/forecasting and test mocks.
- The record fields mirror the movement exactly (item, tenant, quantity, unitCost, totalCost) and add `period: DAILY`, `source: 'ORDER'`, `referenceId: orderId`.

## 24. P1-01 — Test Results

`recipes.service.deduction.spec.ts` (+5):

1. one DAILY ORDER consumption record mirrors each deduction inside the same tx (quantity 2, unitCost 6, totalCost 12)
2. partial shortfall records the actually-deducted quantity (1, not 2)
3. concurrent duplicate claim → exactly one consumption record (idempotency preserved)
4. same order id across two tenants → one record per tenant, correctly attributed
5. idempotent no-op path (already deducted) → no transaction, no records

Results: the deduction spec **20 tests passed**; full recipes module **34 tests passed** across 3 suites.

## 25. P1-01 — Classification

**PARTIALLY_IMPLEMENTED.**
The authorized scope was the creation path. **Refund/refund-reversal handling of ConsumptionRecords is NOT implemented** because it was not explicitly authorized (refund-reversal behavior requires a business decision — see Sections 29/30).

## 26. Full Gate Suite Results

| Gate                                                                                             | Result                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Full Jest (`jest --config jest.config.ts`)                                                       | 98 suites / 1262 tests — PASSED                                                                                            |
| Focused suites                                                                                   | orders 86; auth 86; scheduler/payments/queues 211; recipes 34; reconcile-pending 13; cleanup.processor 7 (incl. new tests) |
| `npx tsc --noEmit -p apps/api/tsconfig.app.json`                                                 | clean                                                                                                                      |
| `npx eslint . --ext .ts` (apps/api)                                                              | 0 errors                                                                                                                   |
| Production API build (`nx build api`, webpack, NODE_ENV=production)                              | compiled successfully                                                                                                      |
| `prisma validate`                                                                                | schema valid                                                                                                               |
| `prisma migrate status`                                                                          | up-to-date (24 migrations)                                                                                                 |
| schema↔database diff (`prisma migrate diff --from-schema-datamodel … --to-schema-datasource …`) | **no difference**                                                                                                          |

## 27. Invariant Re-verification Post-Implementation

- **Order completion**: every `COMPLETED` writer in the codebase is now payment-gated (`payments.service.ts` credit sinks) or passes the new `changeStatus` paidAmount gate; no ungated transitions remain (verified by grep of `status: 'COMPLETED'` / `toStatus: 'COMPLETED'` assignments).
- **Refresh tokens**: every token store lookup/revoke now uses `hashToken(...)`; raw value exists only in memory and in the client response.
- **Consumption records**: single writer at `recipes.service.ts:707`.
- **Reconcile callers**: single production chain — `scheduler.service.ts` cron `handleReconcilePendingPayments` → cleanup worker type `reconcile_pending_payments` → `paymentsService.reconcilePendingPayments`.

## 28. Data & Migration Safety

- **0 schema changes**; **0 migrations created**; `prisma migrate status` up-to-date; schema↔DB diff empty.
- Live-DB row counts verified read-only after implementation: `refresh_tokens 0, orders 0, payments 0, consumption_records 0`.
- No `migrate reset`, no truncate/delete, no Redis wipe, no container restart, no deploy.
- Because `refresh_tokens` has 0 rows, hashing-at-rest requires no legacy-token rotation and no migration.
- Because `consumption_records` has 0 rows, the new writer needs no backfill.

## 29. STOP Conditions, Pending Work & Decisions Required

The implementation intentionally STOPS here. No commit, push, deploy, image rebuild, or container restart was performed.

Decisions required:

1. **P1-01 refund-reversal**: when an order is refunded/voided, should inventory consumption and its ConsumptionRecords be reversed on refund, and — if so — should already-written ConsumptionRecords be (a) hard-deleted, (b) soft-deleted (`deletedAt`), or (c) written as an offsetting negative record? Readers currently do not filter `deletedAt`, so a decision must be made before any reversal is implemented. Not authorized in this pass.
2. **P1-03 route role tightening**: optionally remove `KITCHEN` from the `changeStatus` route (or keep the payment-gate-only protection). Gate-only scope was implemented; this is an optional hardening follow-up.

Deferred (out of scope, recommended separately): P2/P3 remediation items; Phase 4; any schema evolution.

## 30. Residual Risk & Recommendations

- **P1-01**: until the refund-reversal decision is made, refunded/voided orders may leave ConsumptionRecords that overstate consumption. Low practical impact while records accrue from the current feature date (table currently empty).
- **P1-04**: raw tokens still transit memory/network by design; acceptable for the bearer protocol. If a higher bar is desired, an HMAC/blinded index under a server secret could be added later — not required for the DB-exfiltration class of threat and not part of this scope.
- **P1-02**: a misfiring provider that repeatedly returns malformed/unknown statuses will keep candidates PENDING and accumulate `reconcileAttempts`; an operator alert (`PAYMENT_RECONCILE_MISMATCH`) is the intended remediation signal. The job is concurrency- and crash-safe (CAS + lock).
- **Deployment**: follow the standard release pipeline after human review; the schema is verified in-sync so no migration step is needed for these changes.
