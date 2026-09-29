# PHASE-1-REMEDIATION-REPORT

Status: Implementation + validation complete for F-001, F-002, F-005 (Phase-1 scope). Working tree uncommitted (per instruction: no commit/push/deploy/rebuild Docker).

## 1. F-001 — Refund/Completion race: fixed

`payments.service.ts` `refund()`, `partialRefund()`, `applyWebhookRefunded()` now, inside their transaction after the payment claim CAS:

- `tx.order.findFirst({ where: { id: payment.orderId, tenantId, deletedAt: null } })` fresh read,
- `tx.order.updateMany({ where: { id, version: fresh.order.version }, data: { version: { increment: 1 } } })` — throw `ConflictException` on 0 rows,
- then apply `paidAmount`/`tip` decrement.

`orders.service.ts` `changeStatus()` no longer trusts the cached `existing` for the COMPLETED gate: it re-reads the order in-tx (`tx.order.findFirst`), validates transition + `paidAmount >= total` against the **fresh** row, and CASes on `fresh.version`. `existing` kept only for validation + audit oldValues.

## 2. F-001 — Race closed?

Yes. Any concurrent refund bumps `order.version`, so a stale completion CAS (`where version: old`) fails with `ConflictException`. Completion both reads fresh state in-tx and CASes fresh version, so an interleaved refund can no longer produce COMPLETED with paidAmount=0. Refunds remain legal on COMPLETED / PARTIALLY_REFUNDED; payment-level claim CAS still blocks double refund; tip decrement stays in-tx.

## 3. F-001 — Regression tests

- `payments.service.spec.ts` (70 tests): refund/partialRefund assert version CAS + ConflictException; webhook refund path same; completion refuses COMPLETED from stale cache when paidAmount dropped mid-flight.
- `orders.service.spec.ts` (94 tests): fresh-version CAS; underpaid completion gate.
- Integration specs (order-crud + payment-flow, mock-Prisma) updated tx mocks (`tx.order.findFirst`/`updateMany`) — green.

## 4. F-002 — Model decision

Chosen: **MODEL C** — original ConsumptionRecord stays intact; compensation is an explicit negative record (`source: 'REVERSAL'`, negative `quantity`/`totalCost`) linked to the original via `reversedFromId`, idempotent via unique `reversalKey`. Matches existing stock-reversal pattern.

## 5. F-002 — Schema + migration

- `prisma/schema.prisma`: added `reversedFromId String?`, `reversalKey String? @unique`, `@@index([reversedFromId])` on ConsumptionRecord.
- Migration applied: `prisma/migrations/20260921214741_add_consumption_reversal_fields` (add columns + unique index + index). `migrate deploy` OK; `migrate status` = up to date (25 migrations); `migrate diff` = no difference.
- `prisma generate` re-run (query-engine DLL conflict resolved by restarting the dev server; new PID 22976 on :3100, health 200).

## 6. F-002 — Reversal semantics

`recipes.service.ts`:

- `reverseConsumptionForRefund()` (public): fresh order read, defers to tx; `$queryRaw ... FOR UPDATE` on the orders row serializes concurrent refund/rollback events; scans originals (`referenceId = orderId, source: 'ORDER', reversedFromId: null`).
- `reverseOriginalRecord()` (private): unique-key dedupe; target = `original.quantity × cumulativeRatio` minus already-reversed magnitude; caps at remaining; Decimal 4dp math; creates negative record linked via `reversedFromId`, `reversalKey = EVENTKEY:originalId`.
- `rollbackDeduction()` restructured: in-tx orders `FOR UPDATE`, in-tx `ROLLBACK:` stockMovement guard (replaces the never-written `ROLLED_BACK` note filter — the plan's double-reversal gap), stock rollback + full (ratio 1) consumption reversal; replay returns `{ rolledBack: false, movementsReversed: 0 }`.
- Wiring: `recipes.processor.ts` `@OnEvent('payments.refunded') onPaymentsRefunded()` → validates fields, calls `reverseConsumptionForRefund`, logs without rethrow. Refund emits enriched with `amount` + `amountRefunded` (cumulative) from `refund()`/`partialRefund()`/`applyWebhookRefunded()` — non-breaking for existing consumers.

## 7. F-002 — Idempotency

Reversal key `REFUND:{paymentId}:{amountRefunded}:{original.id}` / `ROLLBACK:{orderId}:{original.id}` unique index prevents duplicate records on event retry; orders-row `FOR UPDATE` in each tx serializes concurrent events (no P2002 transaction-abort races); `rollbackDeduction` replay is a no-op.

## 8. F-002 — Partial-refund proportionality

Cumulative-ratio semantics: target magnitude = `original.quantity × min(amountRefunded / order.total, 1)`, reversal = `target − alreadyReversed`. Two ×25% refunds → −25 then −25 (net −50, never exceeds original, never below zero). Verified by test (25 of 100 → −25; second 25 of 100 with amountRefunded 50 → −25).

## 9. F-002 — Reversal completeness

Reversal writes `quantity` (negative), `totalCost = −(unitCost × magnitude)`, `unitCost` from original (or derived), `period` copied, `source: 'REVERSAL'`, `referenceId = orderId`, `reversedFromId`, `reversalKey`. Net-zero guarantee enforced by remaining-cap. Tenant scoped throughout.

## 10. F-002 — Reader consistency (SUM nets, COUNT excludes)

- SUM-based readers net naturally (negative rows included): `getTurnover` COGS (`_sum totalCost`), `getConsumptionTrends` byDate raw SQL `SUM`, byPeriod sums, forecasting/financial drivers — verified unchanged/covered.
- COUNT readers exclude reversals: `getClassification` groupBy adds `reversedFromId: null`; `getConsumptionTrends` byPeriod counts use `reversedFromId: null` merged via Map.
- `forecasting-dashboard.getInventoryForecast`: sums net; observation divisor counts **only** originals (`reversedFromId: null` query) — `avgConsumption = sum / obsCount` (0 when no observations).

## 11. F-005 — Webhook amount mismatch

`applyWebhookSucceeded` compares gateway-reported `credited` (major units, converted with the same convention as reconcile) vs `Number(payment.amount)` with 0.02 tolerance → throws new `PaymentAmountMismatchError` → caught → `recordReconcileAttempt` + return; transaction rolls back, payment stays PENDING, no credit, no auto-complete, no metrics. Other errors rethrow. Reconcile (15-min) picks the payment up; never credits mismatch.

## 12. Test suite

- Focused: reversal suite (14) + rollbackDeduction (3) + processor listener (3) + analytics readers (turnover/classification/trends/inventory-forecast) + F-001/F-005 already green.
- Full: **100 suites, 1291 tests, all passing** (baseline 98/1262; +2 suites, +29 tests).

## 13. TypeScript

`npx tsc --noEmit -p apps/api/tsconfig.json` — clean (0 errors).

## 14. ESLint

`eslint src/modules/{recipes,inventory-analytics,forecasting-dashboard,payments,orders}/**` — clean (0 errors/warnings; prettier autocorrected).

## 15. Build

`npx nx build api` — success (fixed TS2322 strict-mode coercion in processor).

## 16. Prisma gates

- `prisma validate` — schema valid.
- `prisma migrate status` — 25 migrations, database up to date.
- `prisma migrate diff --from-url <local prod> --to-schema-datamodel` — no difference.

## 17. Remaining issues / release blockers (out of scope per Phase-1 constraints)

- Not committed/pushed/deployed (F-003 commit + Docker rebuild of stale `docker-api:latest`, dual-instance reconcile, SMTP + prod payment mode config remain release-blocked; the working tree must be committed before any clean checkout can build — `export-storage.service.ts`/`scheduled-reports.cron.ts` untracked).
- Pre-existing non-blocking queue failures on the dev instance (email queue 3 failed — SMTP unavailable; export-engine 7 failed) unrelated to these changes.
- Analytics readers cache 300s — reversal results may be stale up to 5 min post-refund (accepted, matches existing caching; invalidation on reversal is a possible follow-up).
- Runtime reversal spot-check against a live order/payment refund available on demand via :3100 dev server (did not mutate prod-like local DB during validation).
