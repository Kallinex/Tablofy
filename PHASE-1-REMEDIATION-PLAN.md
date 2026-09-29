# PHASE-1-REMEDIATION-PLAN

Scope: first remediation milestone only. Verification basis: `FINAL-SYSTEM-INDEPENDENT-AUDIT.md` (F-001..F-028) plus independent re-verification of the code paths below (this session). No source has been modified. Not committed, not deployed.

## 1. F-001 EXACT FIX — Payment / Refund / Completion Race

### Verified defect

- `orders.service.ts:483` — `changeStatus` loads `existing` via `findOne()` which returns the **cached** order (`one:${id}`, TTL `CACHE_TTL.ORDERS` = 30s, `orders.service.ts:289-291`).
- `orders.service.ts:488-496` — COMPLETED gate compares `existing.paidAmount` (stale/cached) against `existing.total`.
- `orders.service.ts:512-523` — completion CAS: `order.updateMany({ where: { id, version: existing.version } })`.
- `payments.service.ts:532-595` (`refund`) — external gateway refund (`:550-562`), then in-tx payment claim CAS (`:565-577`), then `order.update` **decrements paidAmount/tip WITHOUT incrementing or checking `order.version`** (`:582-588`).
- `payments.service.ts:617-720` (`partialRefund`) — same flaw: `order.update` decrements paidAmount with no version participation (`:684-689`).
- `payments.service.ts:293-300` (`charge`) and `:144-150` (`finalizeSucceededPayment`) DO CAS-bump `order.version` — the race exists because refunds do not.

### Deterministic race

Order O: paidAmount=100, total=100, version=5, status=SERVED. Payment P: COMPLETED, amountRefunded=0.

1. Thread A (`refund P`): reads P (COMPLETED, amountRefunded 0); calls gateway (async).
2. Thread B (`changeStatus O->COMPLETED`): `findOne` returns cached O (paidAmount=100, version=5); gate passes; opens tx.
3. Thread A: tx claims P `PENDING->REFUNDED`; `order.update` sets paidAmount=0, tip=0. **order.version stays 5**. Commits.
4. Thread B: CAS `where { id: O, version: 5 }` **matches** (refund never bumped the version) -> sets COMPLETED, version=6. Commits.

Result: **COMPLETED order with paidAmount=0** (underfunded). If B instead used a fresh DB read, the outcome is identical because refund does not participate in the order version concurrency model at all.

### Minimal correct fix

1. `payments.service.ts` `refund()` and `partialRefund()`:
   - Inside the existing transaction, before decrementing paidAmount, read the fresh order (`tx.order.findFirst({ where: { id: payment.orderId } })`) and perform an order-CAS like `charge`:
     `tx.order.updateMany({ where: { id, version: freshOrder.version }, data: { version: { increment: 1 } } })`; throw `ConflictException` on 0 rows.
   - Then apply the `paidAmount`/`tip` decrement in the same tx (no `order.update` bypass).
   - This makes any concurrent completion CAS fail (version bumped) and forces the completion to retry.
2. `orders.service.ts` `changeStatus()`:
   - Do not trust the cached `existing` for the payment gate. Re-read the order inside the transaction (`tx.order.findFirst({ where: { id, tenantId, deletedAt: null } })`), compute the COMPLETED gate against the **fresh** `paidAmount`/`total`, and use the **fresh** `version` in the CAS `updateMany`.
   - Keep the `existing` object only for status-transition validation and audit `oldValues`.
3. Preserve legitimate refund behavior: refunds remain allowed on COMPLETED / PARTIALLY_REFUNDED; the payment-level CAS claim (`amountRefunded: 0`) continues to prevent double refund; tip decrement stays inside the tx. The change only adds order-version participation.

## 2. F-002 EXACT BUSINESS DECISION + CHOSEN IMPLEMENTATION PATH (placeholder)

Status: **BLOCKED_BUSINESS_DECISION** — owner decision required; implementation path below is a placeholder pending that decision.

### Three candidate models (analysis in main response B)

- MODEL A — hard delete original ConsumptionRecord.
- MODEL B — soft delete original (`deletedAt` already on the model, but no reader honors it).
- MODEL C — create an explicit compensating/reversal ConsumptionRecord with negative quantity/totalCost linked to the original (matches existing stock-reversal pattern: `rollbackDeduction` writes offsetting ADJUSTMENT movements referencing the original movement id).

### Recommended architectural option (not a business decision)

MODEL C — see response B for the full 11-dimension comparison.

### Placeholder implementation path (once decision is made)

- [ ] Decide model (A / B / C).
- [ ] If C: add reversal-link column (e.g. `reversedFromId String?` + unique index) or equivalent idempotency key; create reversal record(s) inside `rollbackDeduction` (`recipes.service.ts:764-832`) and any partial-refund reversal path; ensure `_count`-based readers (fast/slow moving, byPeriod) filter `source='ORDER'`.
- [ ] If B: add `deletedAt: null` to every ConsumptionRecord reader (dashboard, financial-analytics x3, inventory-analytics aggregate + raw SQL, forecasting x2, forecasting-dashboard) and invalidate the affected analytics cache keys.
- [ ] Wire refund path to reversal (currently `refund()/partialRefund()` emit `payments.refunded`, which `recipes.processor.ts` does NOT listen to; consumption reversal currently only fires on order-status `CANCELLED`/`REFUNDED` events).
- [ ] Reinstate an effective rollback idempotency guard (rollback currently checks a `ROLLED_BACK` marker that is never written — double-reversal possible).

## 3. F-005 EXACT FIX — Webhook Amount Mismatch

### Verified defect

- Webhook success path (`payments.service.ts`, ~`:1570-1618`): claims payment `PENDING->COMPLETED`, re-reads fresh order, version CAS (correct), then credits **payload `amount`** with no mismatch check: `const credited = amount && amount > 0 ? amount : Number(payment.amount)` (`:1591`); auto-completes when `newTotalPaid >= orderTotal` (`:1600-1602`).
- Reconcile path already validates mismatch and **never credits** on mismatch (`:1314-1334`). The webhook path bypasses this.

### Minimal correct fix

- On webhook success, compare payload amount (converted to the payment's unit convention via the same rule used in reconcile) against `payment.amount` before crediting.
- On mismatch: do not credit the payload amount, do not auto-complete; log, mark the payment FAILED/flagged for review, and enqueue the payment for reconcile (or reject the webhook with an error that triggers reconcile retry).
- Keep the auto-complete logic but drive it only from verified credited totals.

## 4. REQUIRED TESTS

- F-001: unit tests for `refund`/`partialRefund` asserting an order version increment + CAS conflict behavior when a concurrent completion is simulated; test that completion re-reads fresh state (uncached) and refuses COMPLETED when paidAmount dropped mid-flight; regression test that refunds still succeed on COMPLETED/PARTIALLY_REFUNDED and double-refund still blocked.
- F-002 (after decision): test that cancelled/refunded orders produce the chosen reversal semantics (row removed / soft-deleted / offsetting record); test idempotency (double rollback yields a single reversed state); test every ConsumptionRecord reader ignores or includes the reversal as designed; test partial-refund reversal proportional amount.
- F-005: webhook handler credits only verified amounts; mismatch webhooks never auto-complete and are routed to reconcile.
- Integration (mocked-Prisma only, as today) + full Jest suite must pass after each change.

## 5. ACCEPTANCE CRITERIA

- F-001: no execution path exists where a refund commits after a payment/completion lookup and a stale `paidAmount` still gates COMPLETED; refunds participate in `order.version` concurrency; all existing tests plus new F-001 tests green.
- F-002: cancelled/refunded orders reverse consumption exactly as the chosen model specifies; double-invocation is idempotent; all ConsumptionRecord readers consistent with the model; COGS/analytics net effect matches the business decision.
- F-005: every webhook credit is amount-verified; mismatch cannot auto-complete an order; reconcile count matches.
- Gates remain green: `npx jest` (98 suites/1262+), `tsc --noEmit`, eslint, `nx build api`, `prisma validate`, `prisma migrate status` (up-to-date), `prisma migrate diff` (no difference).
- Release: commit the full working tree (fixes F-003).

## 6. REGRESSION RISKS

- Order-version CAS changes to refund/partialRefund: legitimate concurrent payment+refund flows will now surface `ConflictException`; callers must retry/re-read (check controller handlers for proper 409 handling).
- Re-reading inside `changeStatus`: marginally longer COMPLETED tx; cached `one:${id}` may briefly be stale for other consumers (already the case).
- F-002 reconstruction: analytics readers that cache (300s) must be invalidated on reversal or they will serve stale COGS for up to 5 minutes.
- F-005 stricter webhook validation: legitimate gateway amount/POS mismatches will stop completing orders — reconcile must pick them up within the next 15-min cycle; lower `payments.completed` event volume (dashboards/webhooks) until reconciled.

## 7. DEPLOYMENT REQUIREMENTS

- Commit the entire working tree before build (fixes F-003: untracked `export-storage.service.ts`, `scheduled-reports.cron.ts` + tests are imported by tracked files — clean checkout currently cannot build).
- Rebuild the stale Docker image (`docker-api:latest` built 2026-08-28) so `:3000` matches source; reconcile the dual-instance (:3000 container + :3100 dev server share one Redis) before go-live to avoid cron-lock contention.
- Apply Prisma migration for F-002 schema additions (if Model C/B requires any) and verify `prisma migrate deploy` on the target database; verify schema/DB diff is empty after.
- Configure SMTP before enabling email-dependent flows; confirm payment mode/provider settings per environment (mock in dev, live in prod).
- Run full migration + smoke check on `/api/v1/health` and the reconcile cron.
