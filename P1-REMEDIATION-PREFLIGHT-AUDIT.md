# P1-REMEDIATION-PREFLIGHT-AUDIT.md

**Scope**: READ-ONLY remediation preflight for the four confirmed P1 findings identified by the comprehensive audit.
**Constraint**: No source/tests/schema/migration changes. No migrations created. No deploy, no commit, no push. No DB/Redis restarts. No P2 or opportunistic work. This document is the only artifact produced; the session then STOPS and awaits authorization.

**Method**: Every claim below was independently re-derived from the current working tree (not trusted from any prior audit). Evidence is cited as `path:line` unless the datum is a live-environment value. Read-only probes used: `git`, filesystem reads, and one read-only `psql` count query. No write was executed against any file or database.

## Baseline state (verified this session)

| Item     | Value                                                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git      | Detached HEAD `16d70e546d28252babf3e830d85015c55bcb6e00`. Mission states branch `feature/phase7-m5`, but **no branch is checked out**. 28 tracked diffs, 18 untracked files, `STATUS_LINES=858`. To be reconciled by an authorized operator, not by this preflight. |
| Images   | Local == image == running bundle SHA-256 `7D150B897031E07193BBC26C3749F40BB882B3F555728CD54187BE1213859806` (2,603,079 B). Health/live/ready 200/200/200. API container `9093e84c…` healthy, RestartCount 0. PG `d21bc90d…`, Redis `d15d3124f…` IDs unchanged.      |
| DB state | `refresh_tokens=0`, `consumption_records=0`, `orders=0`, `payments=0` (live read-only `psql` counts).                                                                                                                                                               |
| Gates    | tsc / eslint / jest (97 suites, 1229 tests) / nx build / prisma validate+status(24)+diff all exit 0 (re-run this phase).                                                                                                                                            |

---

## 1. P1-01 · Evidence & Current State

- Model `ConsumptionRecord` (prisma/schema.prisma:3575ff): `inventoryItemId, tenantId, date, quantity Decimal(12,4), unitCost?, totalCost?, period ConsumptionPeriod @default(DAILY), source?, referenceId?`; index `@@index([tenantId, inventoryItemId, date])`. **No unique constraint** (e.g., none on `referenceId`).
- Enum `ConsumptionPeriod` = `DAILY | WEEKLY | MONTHLY` (verified).
- **Writers**: repo-wide search for `consumptionRecord.create / createMany / upsert` returns **zero** matches in `apps/api/src`. The table is structurally complete and read by analytics, but has no producer.
- **Readers** (all scoped by `tenantId` + `inventoryItemId` [+ date window]; **none filter `deletedAt`**):
  - forecasting.service.ts:42 (`findMany` for moving-average input)
  - forecasting.service.ts:420, dashboard.service.ts:105
  - inventory-analytics.service.ts:76 (`_sum totalCost` = COGS), :191 (`groupBy`), :387 (`groupBy byPeriod`), :476 (`groupBy by item+date`)
  - financial-analytics.service.ts:60/:150/:247, forecasting-dashboard.service.ts:328
- The natural producer event already exists: `recipes.service.deductInventoryForOrder` (recipes.service.ts:528-746) runs **inside one `$transaction`**, is triggered by order completion, creates a `StockMovement` of type `CONSUMPTION` per deducted item (quantity negative, `unitCost`, `totalCost`, `referenceType:'ORDER'`, `referenceId:orderId`), and is idempotent (pre-check against existing ORDER movements + `FOR UPDATE` order row-lock serializes concurrent first-time runs; replay returns an idempotent report).
- Mirror reversal exists: `rollbackDeduction` (recipes.service.ts:760-814) runs in a `$transaction`, restores inventory, appends `ADJUSTMENT/ROLLBACK` movements, and logs `DEDUCTION_ROLLED_BACK`.
- Live DB already holds `orders=0`, so there is no historical gap to fill.
- **Classification: READY_TO_IMPLEMENT** (one business default must be explicitly signed off during implementation; see section 4 — the default below is evidence-derived, not invented).

## 2. P1-01 · Root Cause Analysis

The forecasting/COGS stack reads a table nobody writes to. Every dashboard forecast, COGS total, and item-date consumption series therefore returns 0/null. Root cause is **missing producer wiring**, not a schema or query defect: the schema, reader queries, and the deduction event that should feed it all exist independently; the bridge was never implemented. There is no alternative writer path (no CRON, no queue consumer, no other module touches the model).

## 3. P1-01 · Fix Design & Files In Scope

Primary (writer): in `deductInventoryForOrder`'s existing `$transaction` (recipes.service.ts:528-746), for **each** deduction entry that produced a `StockMovement`, also `consumptionRecord.create` with:

- `inventoryItemId`, `tenantId` (from the order/tenant being deducted — do not trust caller-supplied tenant), `date: new Date()`,
- `quantity`: the **actual** deducted quantity (use the entry's `actualDeduction`/shortfall-aware value, not the nominal recipe quantity),
- `unitCost` / `totalCost` from the same entry (nullable-safe),
- `period: ConsumptionPeriod.DAILY`, `source: 'ORDER'`, `referenceId: orderId`.

Mirror reversal: in `rollbackDeduction`'s `$transaction` (recipes.service.ts:760-814), add `consumptionRecord.deleteMany({ where: { tenantId, referenceId: orderId, source: 'ORDER' } })` — a **hard delete**, because readers do not filter `deletedAt` (evidence in section 1), so soft delete would still leak into COGS and forecasts. The rows are derived data, regenerate-on-next-deduction, so hard delete is safe and is the only soft/hard option consistent with the existing readers.

Files in scope: `apps/api/src/modules/recipes/recipes.service.ts` (only). **No schema change, no migration.** Files intentionally out of scope: forecasting/analytics readers (their semantics are correct once rows exist), all other modules.

## 4. P1-01 · Invariant & Business Rules

Derived invariant: **a `ConsumptionRecord` is created for exactly the units that left inventory (the deduction amount), in the same transaction as the deduction, once per order per item; and when a deduction is rolled back, its records are removed atomically.** Formal refs: `∀ stock_movement m (type=CONSUMPTION, referenceType=ORDER) ⇒ ∃ consumption_record (tenantId=m.tenantId, inventoryItemId=m.inventoryItemId, referenceId=m.referenceId)` and the rollback deletes the mirror set.

- Quantity must equal the moved quantity (sign-normalized), `period=DAILY`, `source='ORDER'`.
- Zero-deficit/partial deductions record actuals (cost basis already shortfall-aware).
- **Explicit default to sign off (business decision, not invented)**: cancellation/refund rolls back the derived consumption rows because stock is restored; COGS must not count consumption of restored stock. Recommended default: hard delete (section 3). If product wants refunds to still influence _demand_ forecasts, that must be stated by the owner and implemented as a separate flag — this preflight does not decide that unilaterally.
- Consistency note: after rollback, a re-completion of the same order does not re-deduct (existing movements cause the deduction pre-check to early-return). Mirroring this, consumption rows are not re-created either — coherent with stock behavior.

## 5. P1-01 · Transaction & CAS Model

Both writes ride the **already-serialized** deduction `$transaction`:

1. Order row is locked (`FOR UPDATE` if present or via its own protective read/claim) **before** the movements and the new records are written.
2. Movement pre-check (`existingMovement` for `referenceType:'ORDER'`, `referenceId: orderId`) makes replays idempotent.
3. Two concurrent first-time runs: the second blocks on the order lock, re-reads, sees the first committed, and returns the idempotent report — movements and consumption records are each created exactly once.
4. Rollback tx deletes records under the same serialization.
   Because row writes and deleteMany are inside the same DB transaction as the movements, a crash mid-way rolls back both movement and consumption-record changes atomically (no drift).
   No new uniqueness needed in the schema for this single-writer architecture; **if** a second writer path is ever introduced, a unique index on `(tenantId, inventoryItemId, referenceId)` becomes mandatory (documented, not applied).

## 6. P1-01 · Security, Roles & Multi-Tenancy

- Data is always written with `tenantId` taken from the deduction's tenant context; no cross-tenant reach (every query in the deduction path is tenant-scoped).
- All reads used by analytics are tenant-scoped via `where.tenantId`.
- No new endpoints or roles introduced.
- Audit trail: existing `DEDUCTION_ROLLED_BACK` audit entry is sufficient; optionally add a `CONSUMPTION_RECORDED` entry inside the same tx (implementation detail).
- No secrets, no PII, no logging of record internals.

## 7. P1-01 · Test Plan (incl. adversarial/concurrent)

Unit (recipes.service deduction + rollback specs):

1. Completion-deduction creates N records == N movements, each with correct item/qty(actual)/unitCost/totalCost/`DAILY`/`ORDER`/referenceId/tenant.
2. Partial (shortfall) deduction records actual consumed quantity.
3. Replay of order-completed event creates nothing (idempotent).
4. Concurrent duplicate deduction calls → exactly one set of movements + records.
5. Rollback deletes exactly the order's records; unrelated orders/items untouched; quantities restored.
6. Rollback of an order with no records is a no-op (no exception).
7. Crash rollback: transaction boundaries are asserted via mocked `prisma.$transaction` (all writes in one call).

Integration: 8. `order.completed` → processor → deduction → `consumption_records` rows exist with correct join to `stock_movements`. 9. Cancel/refund flow → rows removed atomically; COGS aggregate no longer counts them.

Regression: full jest + tsc + eslint; inventory-analytics/forecasting specs assert identical output given identical fixtures (they must not change behavior).

## 8. P1-01 · Deployment, Configuration & Rollback

- Deploy: API-only code change. No env vars, no DB migrations, no restart of PG/Redis.
- Rollback: revert to previous image (old code simply stops producing rows; existing rows are unaffected). Rollback cannot corrupt data because records are derived and additive only during deduction.
- Feature-flag: not required; the writer is harmless (tables are empty today).
- Historical data: `orders=0` so **no backfill needed**. If it were needed: derive from `stock_movements (type=CONSUMPTION, referenceType='ORDER')` joined to completed orders, using `order.completedAt` as `date`, in an idempotent batched script. Documented for the generalized case; **not executed**.

## 9. P1-01 · Risks, Open Questions & Classification

Risks:

- Wrong quantity basis (nominal vs actual) would poison COGS/forecasts → mitigation: use actual deduction, asserted by test 2.
- Soft-delete leak (readers ignore `deletedAt`) → mitigation: hard delete, test 6.
- Future second writer unexpectedly duplicating rows → mitigation: documented future unique index + code review gate.
  Open questions (non-blocking, defaults stated):
- Refund-to-forecast semantics (keep demand signal on refund?) — default: reverse with stock (section 4). Await owner sign-off.
- Audit entry for creation (include or omit) — default: include.
  **Final: P1-01 → READY_TO_IMPLEMENT** (single-file change, zero schema/migration, clear test surface; sole sign-off item is the refund-reversal default).

---

## 10. P1-02 · Evidence & Current State

- `PaymentStatus` enum = `PENDING | COMPLETED | FAILED | REFUNDED | PARTIALLY_REFUNDED` (no VOIDED/PROCESSING). Payment state machine (`payment-state-machine.ts`) allows PENDING→COMPLETED/FAILED; COMPLETED→REFUNDED/PARTIALLY_REFUNDED; void of a PENDING payment writes **FAILED** (non-CAS `update`, payments.service.ts:751-757).
- Charge flow (`payments.service.ts`): create PENDING payment (:360-377 with idempotency-key replay), provider `createPaymentIntent` (+ intent-data into `gatewayData`), then `confirmPayment` (:403). On confirmed `succeeded` → `finalizeSucceededPayment` in a `$transaction` (:426-443); on `failed` → PENDING→FAILED (:464-474).
- `finalizeSucceededPayment` (:113-176): CAS `updateMany where {id, status:PENDING}` guarded by `PaymentAlreadyFinalizedError` (:135); order **version CAS** with `ConflictException` (:149); computes `totalPaid`, credits order `paidAmount`, and if `totalPaid >= orderTotal` writes order status `COMPLETED` + `completedAt` (:160-172). Same gated pattern at the non-provider/cash path (:332-343) and the webhook success handler (:1337-1352). Split-pay reuses the same finalize idiom (:1080-1091).
- **Stranded path**: async gateways (Stripe intent / Paymob payment_key) leave the payment `PENDING` with `gatewayRef` set until the client completes at the gateway and the **webhook** arrives. If the webhook is lost / retries exhausted / host was down, or the client abandons, the payment stays `PENDING` forever while `gatewayData` shows an intent. Order stays SERVED; money may or may not have been captured.
- `reconcile()` exists (payments.service.ts:1167-1226): **report-only comparison** — iterates tenant payments, calls `provider.getPaymentStatus(payment.gatewayRef)` (:1196), counts providerMatches/mismatches. It **corrects nothing**. Exposed as `GET /payments/reconcile` @Roles OWNER/MANAGER (payments.controller.ts:42-43). `getPaymentStatus` provider method exists for both providers: stripe.provider.ts:301, paymob.provider.ts:361-397 (mock mode returns `succeeded`).
- **No scheduled reconcile exists**: scheduler.service.ts cron set (verified) = cleanup_expired_sessions, cleanup_expired_tokens (+ 2am variant), archive_audit_logs, cleanup_failed_webhooks, cleanup_stale_jobs, cleanup_expired_data_exports, cleanup_expired_backups, cleanup_stale_gift_cards, cleanup_expired_report_exports. **There is no payments reconcile/reaper job.**
- Live DB: `payments=0` (no stranded rows today), but the defect is structural.
- **Classification: READY_TO_IMPLEMENT** (safe operating rules documented below; no business decision required beyond accepting the conservative defaults).

## 11. P1-02 · Root Cause Analysis

Two compounding causes: (a) the **settlement trigger is solely the webhook** — there is no fallback path, and webhook delivery is a best-effort external channel; (b) the currently provided reconcile operation is **read-only diagnostics**, so nothing can ever recover a stranded PENDING payment, leaving inventory/posture stuck and support without a safe repair tool. Because `finalizeSucceededPayment` is claim-based, a scheduled coroutine that observes settled-but-unfinalized intents is the natural, non-disruptive recovery.

## 12. P1-02 · Fix Design & Files In Scope

Files in scope (code, implementation phase):

- `payments.service.ts` — new public `reconcilePendingPayments(tenantId?, opts)` that: SELECTs `status=PENDING AND gatewayRef IS NOT NULL AND createdAt < NOW()-staleAfter` (tenant-scoped, `deletedAt:null`, batch-limited); for each, calls `provider.getPaymentStatus(gatewayRef)` **outside any DB transaction**; then in a transaction applies a claim-based CAS outcome (below).
- `scheduler.service.ts` — register a `PAYMENT_RECONCILE` cron (default `*/15 * * * *`) calling the new method with `userId:'system'`, guarded by an env switch.
- Refactor point: reuse `finalizeSucceededPayment` for both webhook and reconcile success so the two paths can never diverge; the webhook body at :1337-1352 is the existing consumer. A new `applyProviderFailed` internal (claim PENDING→FAILED + audit) mirrors the existing failed webhook handling.
- Out of scope: provider code, controllers, DTOs, schema.

Operating rules (conservative, explicit, safe):

1. Provider says **succeeded** and provider amount ≈ payment.amount (±0.01) → claim `PENDING→COMPLETED` (reuse finalize; skip if already finalized via `PaymentAlreadyFinalizedError`), credit order with **the payment's own amount**, audit `PAYMENT_RECONCILED`, broadcast.
2. Provider says **failed / expired / canceled / abandoned** → claim `PENDING→FAILED`, audit. No monetary reversal performed by reconcile (reversal is a separate operator action, out of scope).
3. Provider **amount mismatch** (succeeded but amount ≠ payment.amount) → **do not** auto-complete (never credit money we cannot prove); record in `gatewayData.mismatch`, audit; leave PENDING for operator investigation.
4. Provider **unreachable / error / unknown** → leave PENDING, increment `gatewayData.reconcileAttempts`; after `RECONCILE_MAX_ATTEMPTS` (default 5) stop auto-retrying, audit alert, keep PENDING (do **not** auto-FAIL a payment we cannot prove failed — the card may have been captured). Webhook arriving later still finalizes correctly (claim semantics).
5. Mock/test providers: skip schedule execution when provider mode is mock (default: only reconcile live providers), same guard as existing reconcile.
   Every mutation is inside a transaction; gateway network I/O always outside the transaction (never hold a DB transaction while calling an external service).

## 13. P1-02 · Invariant & Transaction Model

Invariant: **a Payment transitions PENDING→terminal exactly once, via a claim, no matter whether the trigger is webhook, synchronous confirm, or reconcile; an order is credited only from terminal(COMPLETED) payments; money is never credited from payments whose status/amount we cannot prove.** Formal: `status: PENDING → {COMPLETED, FAILED}` each transition executed as `updateMany({ where: { id, status: PENDING } })`; order update performed with version CAS; `paidAmount = Σ completed.amount − Σ refunded` (amountRefunded net, as today).

- CAS claim guarantees at-most-once even if webhook and reconcile race: the loser observes `count=0` → treat as already finalized (no double credit, no double status-history).
- Order version CAS: if a concurrent payment also credits this order, the second has entity-state conflict check → `ConflictException`/retry, never an overwrite.
- Reconcile read query must be re-checked at write time (no TOCTOU); the write path re-validates `status=PENDING` in the claim.
- Batch semantics: partial batch failure leaves the remaining rows untouched for the next tick (each row independent, no global rollback of the reconcile run).

## 14. P1-02 · Security, Roles & Multi-Tenancy

- Scheduled job runs as system (`userId:'system'`), tenant-scoped per payment row; every SELECT includes `tenantId` from the row (not from a user input). No new HTTP surface (diagnostics already exist at `GET /payments/reconcile`).
- The reconcile **never** initiates refunds or captures; it cannot move money, only settle/decline states, and only via claim semantics — blast radius is bounded to stuck rows.
- All transitions audited (`PAYMENT_RECONCILED` / `PAYMENT_RECONCILED_FAILED` / `PAYMENT_RECONCILED_MISMATCH`); provider errors are logged at warn (no gateway secrets; existing provider logging hides credentials).
- Tenancy: payments are tenant-scoped by construction; split-pay orders will be handled per-payment (each leg reconciled independently), consistent with how finalize works today.

## 15. P1-02 · Schema & Data Migration Impact

**None.** Reuses `gatewayRef`, `gatewayData` (JSON: `reconcileAttempts`, optional `mismatch`), existing Chinese-`payments` table, existing audit-log infra. No new tables/columns/indexes. `gatewayRef` needs no unique index because claims are guarded by status CAS (not by ref uniqueness) and one intent maps to one payment row by construction.

## 16. P1-02 · Test Plan (incl. adversarial/concurrent)

Unit:

1. Claims only `PENDING ∧ gatewayRef≠null ∧ createdAt<stale` rows, tenant-scoped, batch limit.
2. Succeeded + amount match → COMPLETED + credited exactly once even when **called twice** (idempotency); order auto-completes when fully paid; wrong target status does not credit.
3. Succeeded + amount mismatch → stays PENDING, marked in gatewayData, audited.
4. Failed/expired/canceled → FAILED once; already-FAILED rows untouched.
5. Network error: attempts incremented; `< max` retries; `= max` stops + alert; **never** auto-FAIL on error.
6. No gateway call happens inside the DB transaction (assert ordering with mocked `$transaction`), including on the error path that must not open a tx.
7. Race: webhook and reconcile concurrent on same row → exactly one transition; no double `paidAmount`.
8. Order version conflict during credit → Conflict/retry, no lost update.

Integration: 9. Provider (mock) returns `succeeded` for a stranded intent → row finalized, order credited/auto-completed. 10. Scheduler tick executes under env switch; disabled → no-op; mock-provider tenant skipped at runtime. 11. Full regression of existing reconcile endpoint diagnostics (must not change its contract).

## 17. P1-02 · Deployment, Configuration & Rollback

- Deploy: code-only. New env config (documented, optional defaults): `PAYMENT_RECONCILE_CRON` (`*/15 * * * *`), `PAYMENT_RECONCILE_ENABLED` (`true`), `RECONCILE_STALE_AFTER_MINUTES` (`10`), `RECONCILE_MAX_ATTEMPTS` (`5`), `RECONCILE_BATCH_SIZE` (`50`).
- Rollback: flip `PAYMENT_RECONCILE_ENABLED=false` or revert image. No data migration to undo; in-flight rows simply queue for the next enabled run (claim semantics make this safe).
- Observability: dashboard metric `payments.reconciled.total`, `reconciled.failed`, `reconciled.mismatch`, `reconciled.unreachable`; alert on mismatch/terminal-unreachable.

## 18. P1-02 · Risks, Open Questions & Classification

Risks & mitigations:

- Double credit (webhook+reconcile race) → claim CAS + finalize reuse (test 7).
- Wrongly auto-crediting a failed capture → amount-match + provider-status checks (rules 1–3).
- Wrongly auto-FAILing a captured payment → never auto-FAIL on network/unknown (rule 4).
- Reconcile saturating gateway → batch limit + per-row attempt cap + cron spacing.
- TOCTOU between scan and claim → re-check at write via `updateMany where status=PENDING`.
  Open questions (non-blocking; conservative defaults provided): reconcile cadence/batch (defaults above), stale threshold (10 min), max attempts before operator alert (5).
  **Final: P1-02 → READY_TO_IMPLEMENT** (code+cron only, zero schema/migration; all edge decisions have safe defaults).

---

## 19. P1-03 · Evidence & Current State

- `changeStatus` (orders.service.ts:476-563): version-CAS `updateMany where {id, version: existing.version}`; `ConflictException` on CAS miss; when `dto.status === COMPLETED` sets `completedAt` (:494-496). **Does not consult `paidAmount`, `total`, or any payment state.** Same service also touches `OrderStatus.COMPLETED` at :558 (adjacent helper/refresh path).
- Route `POST /orders/:id/status` is **@Roles('OWNER','MANAGER','CASHIER','KITCHEN')** (orders.controller.ts:97-98) — i.e., a kitchen user may drive the state machine to COMPLETED. State machine allows SERVED→COMPLETED (order-state-machine.ts:30) and COMPLETED→REFUNDED.
- In contrast, all **automatic** completion sites are payment-gated: `finalizeSucceededPayment` (:160-166), non-provider/cash path (:332-343), webhook success (:1337-1352), split legs (:1080-1091). So the codebase already implements "COMPLETED is a fully-paid state" on every automated path — only the manual route diverges.
- `CASH` is a first-class `PaymentMethod` (verified); charging a cash payment uses the non-provider path which immediately creates a COMPLETED payment and credits `paidAmount`. Therefore "a manually completed order has a completed payment" is satisfiable offline without a payment gateway.
- `Order.total` is required `Decimal(10,2)` (zero allowed for outlets/voided items); `Order.paidAmount` default 0 `Decimal(10,2)` (verified).
- Live DB `orders=0`, `payments=0` → no historical invariant violations to remediate today.
- **Classification: READY_TO_IMPLEMENT** (no business decision beyond adopting the invariant the code already expresses on automated paths).

## 20. P1-03 · Root Cause Analysis

The manual transition path bypasses the invariant that every other completer enforces. The state machine (SERVED→COMPLETED) and the route guard (KITCHEN included) place no constraint on settlement, and `changeStatus` never reads `paidAmount`. Net effect: a COMPLETED order with zero or partial payment is independently reachable, which then inflates revenue KPIs, allows credential-free closure, and corrupts downstream (deduction/completion, dashboards). Root cause is a missing invariant check on the only ungated write path, not a schema gap.

## 21. P1-03 · Fix Design & Files In Scope

In `orders.service.changeStatus` (orders.service.ts:476-563), inside the existing update path and **before** constructing the CAS write:

```
if (dto.status === OrderStatus.COMPLETED) {
  const paid  = Number(existing.paidAmount ?? 0);
  const total = Number(existing.total ?? 0);
  if (paid < total) throw new UnprocessableEntityException('Order is not fully paid');
}
```

Where `existing` is the same row snapshot used for the version CAS (same idempotent pre-check + tenant scope). Because the order's version was read from that snapshot, a concurrent settlement bumps the version → CAS miss → `ConflictException` → caller retry/re-reads; the gate is therefore protected against races without a row lock.

Secondary hardening (recommended, optional for the sign-off): restrict COMPLETED transitions to `OWNER/MANAGER/CASHIER` at the handler/guard level (removing `KITCHEN` from the COMPLETED semantic) while leaving KITCHEN able to drive non-terminal statuses; alternatively keep roles and rely on the service gate alone. The service gate is the **primary invariant**; role tightening is defense-in-depth.

Files in scope: `orders.service.ts` only (gate), optionally `orders.controller.ts:97-98` + the status DTO validation (role tightening). No schema change, no migration.

## 22. P1-03 · Invariant & Business Rules

Formal invariant: **status reaches COMPLETED only when paid >= total** (`paidAmount >= total`), where `paidAmount` is the net of completed payments minus refunds as maintained by the payment layer, and zero-total orders (payments not required) satisfy it trivially. Equivalent states: partial-payment orders must remain SERVED until settled; split-pay is handled because each leg credits `paidAmount` before completion is attainable; refunds after completion are legal (COMPLETED→REFUNDED) because they do not re-assert the invariant. The invariant matches the semantics the automated paths already implement, so adopting it is not a new business rule — it is making the last write path consistent.

## 23. P1-03 · Transaction & CAS Model

The gate runs on the snapshot the CAS write is based on. Sequence per request: read `existing` (tenant-scoped, non-deleted) → validate transition (state machine) → validate payment invariant (`paid >= total`) → `updateMany({ where: { id, version: existing.version }, data: { status: COMPLETED, completedAt, version: { increment: 1 }, … } })` → CAS miss yields `ConflictException`. This is optimistic concurrency; no row lock needed. Two concurrent completers: one commits, the other CAS-misses. A concurrent settlement while this request is in flight likewise bumps the version (settlement increments order version), so the manual completer cannot commit stale state. No new transaction structure is introduced.

## 24. P1-03 · Security, Roles & Multi-Tenancy

- Defeats the current ability of KITCHEN (or any role) to complete an unpaid order; the gate is enforced in the service (single choke point), tenant-scoped (`where.tenantId`), and version-safe.
- No new endpoints, no new roles, no weakening of existing guards.
- The route's other transitions (OPEN→IN_PROGRESS→READY→SERVED etc.) remain untouched; only COMPLETED gains the check.
- Recommended role tightening (optional): remove `KITCHEN` from `@Roles` on `POST /:id/status` COMPLETED or scope COMPLETED to OWNER/MANAGER/CASHIER via a nested guard.
- Monetary data: gate reads only two decimal columns; no PII/logging.

## 25. P1-03 · Schema & Data Migration Impact

**None.** Uses existing `total`, `paidAmount`, `status`, `version`, `completedAt` columns. No DDL, no migration, no backfill. Historical integrity scan (recommended optional ops script, not a migration): `SELECT ... FROM orders WHERE status='COMPLETED' AND paidAmount < total` → report-only (0 rows today).

## 26. P1-03 · Test Plan (incl. adversarial/concurrent)

Unit (orders.service):

1. COMPLETED with `paidAmount < total` → 4xx, status unchanged, `completedAt` not set.
2. COMPLETED fully paid → transition + version bump + completedAt.
3. COMPLETED `total = 0` → succeeds (free-order path).
4. CASH payment flow → COMPLETED payment → then manual complete succeeds (offline compatibility).
5. SERVED/other transitions unchanged (no false rejections).
6. Version CAS conflict (concurrent payment) → `ConflictException`, no state change.
7. Concurrent two manual completers → exactly one wins.
8. Split-pay: settled legs satisfy the gate, unsettled does not; refunded final state unaffected.
9. Tenant isolation: gate reads the tenant's own row only; cross-tenant id → NotFound.

Integration: 10. e2e: create → pay (mock provider + cash) → complete → assert order & payment states; attempt unpaid completion → rejected; kitchen role attempt → rejected (if role tightening adopted).
Regression: full jest/tsc/eslint; update affected orders/service/controller specs that currently complete unpaid orders in fixtures (list captured during implementation).

## 27. P1-03 · Deployment, Configuration & Rollback

- Deploy: API-only. No env/config.
- Rollback: revert image (gate disappears; forward-only data implications none given 0 rows).
- Sequencing: ship after P1-02's claim semantics land, so reconcile (P1-02) can only ever strengthen this invariant; but P1-03 is independently shippable since all other completer paths already satisfy the gate.

## 28. P1-03 · Risks, Open Questions & Classification

Risks:

- False rejection of legitimate completions if some offline/legacy flow credits an order without a completed payment row → audit shows no such flow exists (cash path creates a COMPLETED payment synchronously); the only risk is a previously-completed unpaid order needing repair — none exist (0 rows). If one appears operationally, the documented scan+repair covers it.
- Removing KITCHEN from COMPLETED may break kitchens that "close" tickets directly → mitigate by leaving the service gate as the invariant and treating role tightening as opt-in.
  Open question (non-blocking): adopt role tightening (OWNER/MANAGER/CASHIER) or keep roles and rely on the gate? Default for implementation: gate only (minimal surface), flag role tightening to owner.
  **Final: P1-03 → READY_TO_IMPLEMENT** (smallest, highest-value fix; invariant already expressed elsewhere in the codebase).

---

## 29. P1-04 · Evidence & Current State

- `generateTokenPair` (auth.service.ts:825-895) creates the refresh-token row with `token: randomBytes(40).toString('hex')` **stored in plaintext** (:855-863) and returns the raw value to the client; the row is then used on every refresh.
- Lookup/rotation/revocation operate on the raw token: `refreshToken.findUnique({ where: { token } })` (:287), reuse detection on `revokedAt` (:306-321), rotation revocation (:343), bulk logout (`updateMany where token`, :358, and logout path ~:880-895), password-change/reset revocation (:518, :571).
- The codebase already owns the exact hashing primitive needed: `createHash('sha256').update(x).digest('hex')` used for password-reset tokens at auth.service.ts:451, :484, :591, :657.
- `RefreshToken` model (schema :287-305): `token String @unique`, `@@index([token])`, `@@map("refresh_tokens")` — no size constraint (TEXT-backed), so a 64-char hex digest fits; `@unique` and the index remain valid on hashed values.
- Live DB: `refresh_tokens=0` → **no rows to backfill today**; the backfill path is documented for the generalized case but is currently a no-op.
- **Classification: READY_TO_IMPLEMENT** (in-place hashing preserves the entire existing token lifecycle; lookups switch to computed hash; no client-visible change).

## 30. P1-04 · Root Cause Analysis

Tokens at rest are the raw 40-hex (160-bit) random value with no cryptographic transformation. A DB leak or backup compromise exposes live session credentials in plaintext, enabling session hijack without any secret. This contradicts the "hashed-at-rest" posture already applied to reset tokens within the same module. The behavior is a **storage-side** defect: the token lifecycle (rotation, reuse detection, revocation) is otherwise correct. Since lookups are exact-match equality on the token column, a deterministic hash (SHA-256) is a drop-in transformation with no client changes.

## 31. P1-04 · Fix Design & Files In Scope

- Introduce a single private helper in auth.service.ts (e.g., `hashToken(t) = createHash('sha256').update(t).digest('hex')` — the established pattern at :451/:484/:591/:657), and:
  - **Write**: at creation (.855-863) store `token: hash(raw)`, return raw to the caller (unchanged contract).
  - **Read**: refresh lookup (:287) computes `hash(rawFromClient)` before `findUnique`.
  - **Rotation** (:343), **bulk logout** (:358, ~:886), **password-change/reset revocation** (:518/:571) likewise compute the hash in their `where`.
- No client-visible change: the API still returns/accepats the raw value; only at-rest representation changes. All lifecycle behaviors (single-use rotation, reuse-of-revoked detection, explicit logout clearing, expiry) are preserved by construction because they key on the same token column.
- Raw values must never be logged: audit that the raw token variable is used only in memory for the return value and for hashing.
- Data backfill (generalized; **currently a no-op since 0 rows**): for every row where `LENGTH(token) > 64` (legacy raw hex), `UPDATE refresh_tokens SET token = sha256(token)` in batches within a transaction; idempotent (length guard). Because lookups will be by hash as soon as the new code ships, backfill must complete **before** the writer/lookup code flips; with 0 rows nothing needs to run.
  Files in scope (implementation phase): `auth.service.ts`, plus updated `auth.service.spec.ts` / `auth-flow.integration.spec.ts` (they assert raw token storage). No other modules.

## 32. P1-04 · Invariant & Transaction Model

Invariant: **the raw refresh token exists only transiently in memory; it is never stored, logged, or returned by any read path; at rest the column holds only a one-way SHA-256 digest, unique per token.** Formal refs: `∀ row r: r.token = sha256(raw)` and lookups/revocations use `where.token = sha256(rawProvided)`; `@unique` now constrains hashes, which are collision-safe at 256-bit. Rotation sequence stays atomic: single tx performing `update(revokedAt)` on the old (hashed) row then `create` of the new (hashed) row; reuse detection unchanged. No cross-row invariants; nothing else depends on the column's raw form.

## 33. P1-04 · Security, Roles & Multi-Tenancy

- DB/backup compromise no longer yields usable session tokens (one-way digest).
- Uses SHA-256 (already the codebase standard for reset tokens; acceptable given 160-bit input entropy — brute force of a 40-hex random remains infeasible even at rest-with-knowledge-of-column).
- No role/permission surface changed; refresh lookup remains keyed to `token`/`userId` with existing tenant/user checks.
- Log hygiene: no path logs the raw value (verified call sites do not serialize the token); add a guard/test asserting no console/winston output contains a generated token.
- optional rotation-of-rotation hardening out of scope (e.g., keyed HMAC, rotating hash salt) — single secret-hash is sufficient and preserves deterministic lookup.

## 34. P1-04 · Schema & Data Migration Impact

**No DDL.** Column is TEXT-backed (`String` without `@db.VarChar`); 64-char digest fits; `@unique`/`@@index([token])` unaffected.
Migration = **data backfill only**, and currently a **no-op (0 rows)**. Recipe (documented, generalized; NOT executed): batched `UPDATE ... SET token = sha256(token) WHERE LENGTH(token) > 64` inside a transaction, run before the code flip. With 0 rows, nothing runs; the code change alone fully remediates new tokens. A deploy note: if any environment has live users, the backfill SQL must run first; check-and-run is part of the implementation plan.

## 35. P1-04 · Test Plan (incl. adversarial/concurrent)

Unit (auth.service):

1. Created row stores 64-char hex, != raw; returned DTO contains raw (client flow unchanged).
2. Refresh with raw token resolves via computed hash; wrong token → Unauthorized (no row found).
3. Rotation revokes old hashed token and creates new hashed token; replay of old raw → reuse-detection error (unchanged behavior).
4. Logout / password-change / reset revocations clear the correct hashed row.
5. Determinism: same raw → same digest (verify via mocked createHash output or known vector); no raw string appears in any `where`/`data` / log.
6. Expiry/tenant/user checks still apply on hashed rows.
7. idempotent backfill: leftover raw-length tokens are converted once; rerun is a no-op (spec'd at helper level).

Integration (auth-flow): 8. login → rows in `refresh_tokens` are digests (assert via test DB); refresh succeeds; logout clears; concurrent refreshes with same token → exactly one rotation wins. 9. Token rotation storm (N concurrent) → single valid session set, no orphaned reusable tokens.

## 36. P1-04 · Deployment, Configuration & Rollback

- Deploy: code-only; ordering rule — any env with existing rows must run the (idempotent, length-guarded) backfill **before** the writer flips; this repo has 0 rows so deploy order is unconstrained.
- Configuration: none required.
- Rollback (forward-only caveat): reverting to old code would try to look up hashed values as raw tokens and fail → all sessions created under the new code would need re-login. Acceptable: mitigate by documenting 30-day max token TTL; data is not corrupted, only lookup-format changed. Recommend rolling forward any issues rather than back.
- Monitoring: refresh-failure rate dashboard to catch any mixed-state deployments (e.g., a row that somehow remains raw → length check), plus log-error counters.

## FINAL VERDICT & IMPLEMENTATION ORDER

| P1                                   | Classification                                             | Scope                                      | Schema/Migration |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------ | ---------------- |
| P1-01 ConsumptionRecord zero writers | **READY_TO_IMPLEMENT** (sign-off: refund-reversal default) | recipes.service.ts                         | none             |
| P1-02 gateway PENDING stranded       | **READY_TO_IMPLEMENT** (documented safe defaults)          | payments.service.ts + scheduler.service.ts | none             |
| P1-03 COMPLETED w/o payment proof    | **READY_TO_IMPLEMENT** (opt-in: role tightening)           | orders.service.ts (+controller opt-in)     | none             |
| P1-04 plaintext refresh tokens       | **READY_TO_IMPLEMENT** (no-op backfill, 0 rows)            | auth.service.ts + auth specs               | none             |

Recommended order: **P1-03 → P1-04 → P1-02 → P1-01** (smallest/most-valuable first; P1-03 unblocks the completion invariant that P1-01's consumption source depends on; P1-02's claim logic is independent but strengthens P1-03; P1-01 rides the already-serialized deduction tx). All four are code-only, zero-schema, zero-migration, zero new configuration required (P1-02 adds optional env/tuning), and each is individually reversible (P1-04 rollback is forward-only by design). No blocking business decisions exist beyond the one signed-off default in P1-01 section 4 and the optional role tightening in P1-03 section 28.

**END OF REPORT. PREFLIGHT IS READ-ONLY — NO SOURCE, TEST, SCHEMA, OR MIGRATION CHANGES WERE MADE, NO DEPLOY/COMMIT/PUSH OCCURRED. STOPPED AWAITING AUTHORIZATION TO IMPLEMENT.**
