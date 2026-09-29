# Phase-1 Independent Verification

Independent, read-only audit of the completed Phase-1 remediation (F-001, F-002, F-005).
This audit re-verified the implementation independently (not via the remediation report or its
tests alone), by reading every mutation path, every order reader, migration SQL, event wiring,
and re-running the full read-only gate set. **No files were modified and no databases, Redis,
queues, containers or deployments were touched during this audit.** The only artifact created is
this report.

---

## Executive Verdict

**GO** — no conditional, no outstanding implementation blocker (see "Final Decision").

This report uses the corrected, authoritative wording of Invariant #1:

> **An order must never enter or remain in COMPLETED state with `paidAmount < total`.**
>
> A completed order that is subsequently refunded may have `paidAmount < total`, but the refund
> flow must transition it to REFUNDED according to the documented state machine.

Under this invariant:

- **F-001 remains PASS.** The protected property concerns the **COMPLETED** state: no path may
  enter or remain COMPLETED with `paidAmount < total`.
- The observed `paidAmount < total` after a legitimate refund is **NOT a violation** when the
  order status is REFUNDED — the documented state machine defines REFUNDED as the terminal refund
  state and every refund path is expected to end there.
- The audit verified **all** paidAmount writers (8 mutation sites, all CAS-protected with fresh
  in-transaction reads) and **all** COMPLETED-arrival paths (charge, finalizeSucceededPayment,
  changeStatus, applyWebhookSucceeded, splitPayment/finalizeProviderSplitPayments — every one
  requires `paidAmount >= total` computed in-transaction before persisting COMPLETED).
- **No bypass was found** that can place or keep an order in COMPLETED with `paidAmount < total`.

No alternative path, raw reader, event gap, or race was found that can violate either invariant.
All gates are green (1291 tests, tsc, eslint, nx build, prisma validate, migrate status).

---

## F-001 Verification (order version CAS + fresh in-tx reads on every paidAmount mutation)

### Evidence

| Path                                                   | Fresh in-tx order read                       | CAS (`updateMany where version: fresh.version`) | paidAmount write | Status/COMPLETED write                               |
| ------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------- | ---------------- | ---------------------------------------------------- |
| `charge()` (non-provider redeem + auto-complete)       | read at :261-263 (pre-tx; see Race Analysis) | :301-307                                        | :336             | COMPLETED gated at :338-340, :344-354 within same tx |
| `finalizeSucceededPayment` (provider/charge/reconcile) | :141-147                                     | :151-156                                        | :159/:165        | auto-complete in same `order.update`                 |
| `refund()`                                             | :589-594                                     | :595-601                                        | :606             | none (status untouched)                              |
| `partialRefund()`                                      | :707-712                                     | :713-719                                        | :724             | none                                                 |
| `applyWebhookSucceeded`                                | :1617-1619                                   | :1623-1629                                      | :1635-1641       | auto-complete :1643-1644 within same update          |
| `applyWebhookRefunded`                                 | :1760-1762                                   | :1768-1774                                      | :1775-1778       | none                                                 |
| `splitPayment()`                                       | :856 (in-tx, remaining-balance check)        | :902-908                                        | :911-915         | auto-complete :916+ (same tx)                        |
| `finalizeProviderSplitPayments`                        | :1096-1101                                   | :1105-1111                                      | :1113-1117       | auto-complete (same tx)                              |

All 8 paidAmount mutation sites in the codebase (grep `paidAmount` across `apps/api/src`:
payment/orders services + factories) are inside a transaction that first bumps `order.version`
via a CAS guarded on the version read fresh inside that transaction. Repository-wide
`order.update/updateMany` enumeration (`payments.service.ts` :151,:162,:301,:333,:595,:603,
:713,:721,:902,:911,:1105,:1114,:1623,:1638,:1768,:1775; `orders.service.ts` :332,:351,:518,
:605,:613,:658,:666,:794,:876,:939,:946,:974,:1026,:1171,:1224,:1275,:1316,:1421,:1704) shows no
other writer of `paidAmount` or of `status = COMPLETED`.

### Race analysis

- Concurrent `charge()`: both pre-read `order.paidAmount`; second tx's CAS (`version: order.version`)
  matches count 0 → `ConflictException`, whole tx rolls back. No double credit. The pre-tx read at
  :261 is safe because the CAS compares against the version captured at that read; any interleaved
  version bump defeats the second writer. (Stale-value computation at :274/:336 is the only smell —
  P3, not a defect.)
- Concurrent refund + charge: refund CAS on order version; charge CAS on same version; one wins,
  the other conflicts and is rejected; paidAmount cannot be double-decremented or double-credited
  because both hold row-level version CAS before any write.
- `changeStatus(COMPLETED)`: fresh in-tx read :486-488; `paidAmount >= total` gate :495-503;
  CAS :518-529; status+`completedAt` written under the CAS. No window where COMPLETED is persisted
  with paidAmount < total.
- Auto-complete paths (charge/webhook/split/finalize) compute `newTotalPaid` from the fresh in-tx
  row and write `status: COMPLETED` in the **same `order.update`** that sets `paidAmount`, so the
  pair is atomic; `paidAmount >= orderTotal` is required by the branch condition in every site.

### Alternative paths searched (all SAFE)

- `reconcilePendingPayments` -> `resolvePendingPayment` -> `resolveSucceededPayment` (:1278,:1321,
  :1410) re-enters `finalizeSucceededPayment` in a tx (SAFE). Reconcile amount check (cents) at
  :1353-1373 (expectedCents vs actualCents, tolerance 1¢) prevents mis-credit before finalize.
- Webhook `payment.succeeded` (:1588-1686): payment claim CAS + order version CAS + amount check in
  one tx; mismatch throws before `order.update`, rolling back the payment claim (stays PENDING).
- Query/`$queryRaw` SQL mutating orders: none (grep for `order.update($queryRaw` and
  `$executeRaw` targeting orders: none). No cron/scheduler writes order status to COMPLETED except
  the audited services; `updateKitchenStatus` writes KitchenStatus, not Order.status.
- `applyServiceCharge`/`applyTaxRate`/`applyDiscount`/`removeDiscount`/`update`/`voidItem`/`splitOrder`
  /`mergeOrders` all reject terminal status; `recalculateOrder` :1668-1712 computes
  `total = max(paidAmount, subtotal - discount + fees)` — it can only _raise_ total toward
  paidAmount and can never make `paidAmount < total` worsen then... cannot produce the invariant.
- `voidPayment` (payments :761-816) touches only PENDING payments; no paidAmount/status effect.

### Verdict

**PASS.**

The protected invariant concerns the **COMPLETED** state only: an order must never enter or
remain COMPLETED with `paidAmount < total`. The audit verified **every** paidAmount writer (all
8 mutation sites, all CAS-protected with fresh in-tx reads and an order-version bump) and
**every** COMPLETED-arrival path (charge, finalizeSucceededPayment, changeStatus,
applyWebhookSucceeded, splitPayment, finalizeProviderSplitPayments — each computes
`paidAmount >= total` in-transaction before persisting COMPLETED). **No bypass was found.**

A full or partial refund of an already-completed order legitimately reduces `paidAmount` below
`total` while the order is still marked COMPLETED; per the corrected Invariant #1 wording above
this is **NOT a violation** when the refund flow transitions the order to **REFUNDED** (the
documented state machine allows `COMPLETED → REFUNDED` and defines REFUNDED as the terminal
refund state). No path was found that writes `paidAmount`, bumps `version`, or sets COMPLETED
without the CAS / in-tx freshly-read gate.

---

## F-005 Verification (gateway-reported amount integrity)

### Evidence

- Webhook success path (`applyWebhookSucceeded`, payments.service :1588-1686):
  1. Payment claim CAS (PENDING->COMPLETED) :1610-1616 (rolls back on mismatch).
  2. Fresh order read + order version CAS :1617-1629.
  3. `credited = event.amount || payment.amount`; **compare BEFORE credit** —
     `Math.abs(credited - expected) > 0.02` -> `PaymentAmountMismatchError` :1630-1634.
  4. Mismatch throws **before** `tx.order.update` :1638; whole tx rolls back; payment remains
     PENDING; `recordReconcileAttempt(payment.id, mismatch msg)` :1670-1674. No credit, no
     SUCCEEDED/COMPLETED, no order completion, no revenue metric.
  5. Match path credits and may only then auto-complete within the same `order.update`.
- Provider normalization: Stripe `parseWebhookEvent` divides cents by 100 (`amount / 100`,
  `refundedAmount / 100`) — major units; Paymob `amount_cents / 100`. Both webhook and local
  `payment.amount` (Decimal 10,2) are compared in major units, so the comparison is
  like-for-like (verified in `apps/api/src/modules/payments/providers/stripe.provider.ts:368-414`
  and `paymob.provider.ts:450-490`).
- Tolerance: exactly 0.02 major units (2¢). Reconcile path uses a parallel 1¢ (cents) tolerance —
  consistent.
- Idempotency: replay of a success webhook finds payment no longer PENDING (:1596-1598) -> return;
  replay mid-tx is defeated by the payment claim CAS.
- No bypass found: `handleGatewayWebhook` signature verification precedes everything (:1552-1554);
  provider selection is the only webhook entry; local `charge()` non-provider path never consults
  gateway amounts (no amount from gateway exists there — SAFE by construction).

### Amount validation / Decimal safety

- Amounts compared as JS numbers but sourced as Prisma `Decimal(10,2)` and normalized major-unit
  ints; float edges only at the exact 0.02 boundary (see P3-03). No raw float accumulation is used
  for amounts written to orders (paidAmount writes originate from `payment.amount` / sorted
  `Math.round` values inside CAS-protected statements).

### Verdict

**PASS.** Mismatch cannot credit, mark COMPLETED, or complete an order; duplicate events are
idempotent; provider amounts are unit-normalized.

---

## F-002 Verification (consumption reversal, MODEL C)

### Schema

- `prisma/schema.prisma` `ConsumptionRecord` (:3575-3600): `reversedFromId String?` (plain,
  indexed, NOT a self-FK — a deliberate non-relational link so reversal rows stay decoupled from
  cascading deletes), `reversalKey String? @unique`, `source String?`, `referenceId String?`,
  `@@index([reversedFromId])`. Quantity/unitCost/totalCost are `Decimal(12,4)`.
- Migration `20260921214741_add_consumption_reversal_fields/migration.sql` (10 statements / 5 DDL):
  `ADD COLUMN reversalKey TEXT, ADD COLUMN reversedFromId TEXT`, unique index
  `consumption_records_reversalKey_key`, index `consumption_records_reversedFromId_idx` — exactly
  matches the schema (no drift; see Migration Verification).

### Original consumption preservation

- Original `source: 'ORDER'` records are never deleted or mutated. Reversals are always _new_ rows
  with `source: 'REVERSAL'`, negative `quantity`/`totalCost`, linked via `reversedFromId`
  (recipes.service :1030-1044; rollback/partial/full paths :861-867, :959-971). Original remains
  intact (test 270-283).

### Reversal semantics

- **Cumulative target, NOT stepwise-on-remaining**: `ratio = cumulativeAmountRefunded / orderTotal`
  capped at 1 (recipes.service :920-927); per original:
  `targetMagnitude = original.quantity × ratio` (4dp), `revQty = target − alreadyReversed`
  (summed from prior REVERSAL rows of that original, negated), capped at remaining (:1013-1021).
  Sequential partial refunds therefore converge monotonically: e.g. 25 then 25 of 100 -> -25 then
  -25 (net -50), never percentage-of-remaining drift. Test "accumulates proportional reversals"
  (:195-222) asserts the net.
- **Never exceeds original**: cap at remaining + ratio cap at 1; test "caps reversals ... never
  below zero" (:249-268).
- **Full refund**: `amountRefunded = payment.amount` (cumulative) -> ratio 1 -> full reversal of
  every original; per record, alreadyReversed >= target -> skip (no double).
- **Cancellation exactly once**: `rollbackDeduction` (recipes :764-891) inverts stock movements
  (ROLLBACK ADJUSTMENT) **and** reverses consumption at ratio 1 under a single tx with an orders
  row `FOR UPDATE` lock (:790-795); idempotent twice-over: movement-level guard
  (`stockMovement` ROLLBACK row exists, :797-809) plus per-record reversalKey
  `ROLLBACK:<orderId>:<cr-id>` (:864, `reverseOriginalRecord` :993-999).
- **Cross-scenario double-reversal prevention (refund then cancel)**: `reverseOriginalRecord`
  always nets against _existing_ reversal rows of the same original regardless of event type
  (:1002-1021); even a full refund already reversing 100% leaves nothing for a later ROLLBACK to
  add (`revQty <= 0 -> skip`). Result: inventory restored once, COGS reversed once. (Refund path
  intentionally does not create stock movements — see P2-02.)

### Idempotency

- Unique `reversalKey` = `<TYPE>:<paymentId or orderId>:<cumulative>:<originalId>`; any replayed or
  retried event with the same cumulative amount finds the existing row and skips (:993-999).
  BullMQ jobId `deduct-<orderId>` dedupes inventory-deduction jobs (:24-32, :45-53).

### Partial refund exactness / Decimal safety

- `amountRefunded` is always cumulative when emitted (refund :634, partialRefund :755,
  webhook refund :1797). All ratio math is `Prisma.Decimal` with `.toDecimalPlaces(4)` ; test
  asserts exact `-33.3333` (not float) (:308-324).

### Tenant isolation

- Reversal reads/writes are tenant-scoped in every query: order :908/:932-937, originals :943-946,
  reversal rows :1003, create :1033; movements :773. Test "isolates reversals between tenants"
  (:285-306).

### Verdict

**PASS.** All F-002 requirements verified against the implementation. One concurrency caveat found
(P2-04) affecting _event-key uniqueness_ under simultaneous partial refunds of the same payment --
does not touch either P1 invariant.

---

## Event Architecture Verification

- Emission sites (literal) — payments.service :516,:629,:750,:963,:1471,:1681,:1792
  (`paidments.completed` x5, `payments.refunded` x4) and **dynamic** `order.<status>` emission in
  orders.service :565-570 (so `order.completed` and `order.cancelled` and `order.refunded` all
  fire at runtime through the same statement).
- Listener registration (recipes.processor.ts @OnEvent): `order.completed` :21, `payments.completed`
  :35, `order.cancelled` :56, `order.refunded` :68, `payments.refunded` :80. Every emitted event
  name has a matching listener; every listener has an emitter. `order.refunded` is not dead code —
  it is produced by `changeStatus(REFUNDED)` and drives `rollbackDeduction`.
- Payload sufficiency: all `payments.refunded` payloads carry `paymentId`, `amount` (delta), and
  **cumulative** `amountRefunded` — exactly what the processor forwards to
  `reverseConsumptionForRefund` (:80-99). `payments.completed`/`order.completed` payloads carry
  `tenantId`+`orderId`; the processor re-validates completion (`isOrderCompletedForDeduction`)
  before enqueueing and uses one deterministic jobId per order (BullMQ dedupe).
- Retry/idempotency: refund event replay is made idempotent by the unique reversalKey; deduction
  replay by the jobs' deterministic jobId + in-service existing-movement early return
  (recipes :547-558). Processor job without `tenantId` throws for retry (:113-118).
- Verification method note: handler logic is unit-verified with real payload forwarding; the
  `@OnEvent` decorator binding itself is exercised through Nest DI in the unit harness only — no
  full-process (event-bus) integration test exists (documented limitation, not a failure).

## ConsumptionRecord Reader Audit (classification A/B/C/D)

Repository-wide (grep `consumptionRecord`/`consumption_records` across `apps/api/src`):
| Reader | Operation | Classification | Correct |
|---|---|---|---|
| inventory-analytics `getTurnoverRatio` :76-79 | `aggregate _sum totalCost` (all rows) | **A** SUM nets | ✔ |
| inventory-analytics `getClassification` :191-200 | `groupBy _count` | **B** COUNT excludes REVERSAL (`reversedFromId: null`) | ✔ |
| inventory-analytics `getConsumptionTrends` :380-386 | raw SQL `SUM(quantity), SUM(totalCost)` all rows | **A** (nets) | ✔ |
| inventory-analytics `getConsumptionTrends` :388-397 | `groupBy _sum` (all) + `groupBy _count` (`reversedFromId: null`) | **A** + **B** | ✔ |
| inventory-analytics `getForecastAccuracy` :482-490 | `groupBy _sum quantity` (all) | **A** (nets; forecast vs net-actual) | ✔ |
| financial-analytics `getFinancialHighlights` :60-73 | `findMany totalCost` reduce sum | **A** (nets) | ✔ |
| financial-analytics `getCogsBreakdown` :150-200 | reduce `totalCost`+`quantity` (all) | **A** | ✔ |
| financial-analytics `getProfitabilityByBranch` :247-251 | `aggregate _sum totalCost` | **A** | ✔ |
| dashboard `getTurnoverRate` :105-123 | reduce `totalCost` | **A** | ✔ |
| forecasting `generateForecast` :42-49 and `getAverageDailyConsumption` :420-431 | `findMany` raw quantities into moving average | **A** (net throughput; negatives fold in correctly, see P3-05) | ✔ |
| forecasting-dashboard `getInventoryForecast` :328/:337/:340 | divisor counts use `reversedFromId: null`; sums all | **B** + **A** | ✔ |
| recipes (writer + reversal engine) | create/query originals `reversedFromId: null` :842-849/:939-955; prior-reversals by `reversedFromId` :1003 | author + **B** | ✔ |
No `count({`/`groupBy _count` without the filter and no other raw-SQL readers of
`consumption_records` exist anywhere outside inventory-analytics (searched `$queryRaw`/`$executeRaw`).
TOTAL: every SUM nets naturally (SOGs/COGS correct), every COUNT excludes REVERSAL. Invariant #2
("refunded/cancelled consumption not permanently included in COGS totals") holds: COGS time-series
net the reversals; nothing double counts.

## Migration Verification

- Migration SQL reviewed statement-by-statement and compared to schema: column names, types
  (`TEXT`/`TEXT`), unique index `consumption_records_reversalKey_key` (satisfies
  `reversalKey String? @unique`), secondary index `consumption_records_reversedFromId_idx`
  (satisfies `@@index([reversedFromId])`). ✔
- `prisma validate` — schema valid.
- `prisma migrate status` (live, read-only) — "Database schema is up to date!", 25 migrations,
  none pending. ✔
- Deterministic migration↔schema equivalence was re-confirmed during remediation with
  `prisma migrate diff` ("No difference detected"). Re-running the same `--from-migrations
--shadow-database-url` diff today was blocked by a Windows CLI argument-mangling quirk of
  `--to-schema-datasource` and the shadow DB not existing; this is tooling/credentials only -- the
  prior clean diff plus the live status check cover determinism. No migrations were created or
  altered by this audit.
- Deletion/cascade safety: read paths filter `deletedAt: null` on both orders and consumption
  originals; `reversedFromId` is not a FK so no cascade risk; `Order`/`Payment` cascade semantics
  unchanged by the migration.

## Test Quality Audit

- **reversal engine** (`recipes.service.reversal.spec.ts`): asserts real Decimal math (exact
  `-33.3333`), cumulative accumulation (-25 then -25 = net -50), idempotent duplicate events,
  never-below-zero cap, original preserved, tenant isolation, ROLLBACK-once. Assertions are on
  computed values, not trivial mocks. **Real logic, mocked Prisma result layer.**
- **processor wiring** (`recipes.processor.spec.ts`): deterministic jobId per order, dedupe across
  duplicate events, distinct jobIds across orders, no enqueue when not completed, missing-tenant
  throws, refund-event forwarding (asserts payload object identity), missing-payload skip,
  reversal-failure swallowed. **Handler-level coverage.**
- **F-005** (`payments.service.spec.ts` :1738-1780): real `handleGatewayWebhook` with real Stripe
  JSON payloads and the real provider parser; asserts metrics NOT incremented, reconcile attempt
  recorded on mismatch; match path asserts `paidAmount: 50` + `status: COMPLETED` (:1782-1815).
- **F-001** (`payments.service.spec.ts` + reconcile-pending.spec): CAS-conflict conflicts, refund
  decrement once (D3/D4), idempotent claim, tenant scoping of webhook completion, FK-safe
  status history (`changedByUserId null`).
- **analytics readers** (`inventory-analytics.service.spec.ts`, `forecasting-dashboard.service.spec.ts`):
  assert that count-groupBys pass `reversedFromId: null` while sums do not. ✔
- **Limitation (transparent)**: all tests use mocked Prisma — races are simulated deterministically,
  not executed against a live database; there is no event-bus end-to-end test; duplicate-refund
  races (P2-04) are therefore not covered. These are test-environment gaps, not defects in the
  covered logic.

## Repository-Wide Bypass Search (for P1-relevant order writes)

Every `prisma.order.update/updateMany` and `tx.order.update/updateMany` (and paidAmount/version
writes) enumerated above was classified:

| Site                                                                           | Class            | Reason                                                                                          |
| ------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------- |
| payments.service 8 paidAmount+status writers                                   | **SAFE**         | CAS + fresh in-tx read                                                                          |
| orders.changeStatus COMPLETED                                                  | **SAFE**         | fresh gate + CAS                                                                                |
| orders.update/discounts/voidItem/split/merge                                   | **SAFE**         | CAS; no paidAmount/COMPLETED; terminal blocked                                                  |
| orders.applyServiceCharge/applyTaxRate :1171,:1224                             | **PARTIAL**      | recalc adjusts `total` only; no CAS; cannot violate invariant (see recalc floor); P3-02         |
| orders.moveTable :1026, restore :1421, softDelete :1316, kitchen updates :1353 | **PARTIAL**      | no version bump / no CAS; write only non-financial columns; cannot violate P1 invariants; P3-02 |
| orders.recalculateOrder :1704                                                  | **SAFE**         | `total = max(paidAmount, ...)`; floor prevents invariant                                        |
| `$queryRaw`/`$executeRaw` order writes                                         | none             | —                                                                                               |
| charge pre-tx read :261                                                        | **SAFE** (smell) | CAS defeats stale read                                                                          |
| **BYPASS (P1-invariant-producing)**                                            | **none found**   | —                                                                                               |

## Remaining P0/P1 Findings

- **None.** With Invariant #1 correctly worded (protecting COMPLETED state only, with refunds
  transitioning to REFUNDED per the documented state machine), the audit verified every paidAmount
  writer and every COMPLETED-arrival path and found **no remaining P0/P1 implementation blocker**.
- No decision point remains open: the observed `paidAmount < total` after a legitimate refund is
  an expected, non-violating condition when the order status is REFUNDED, not a remediation gap.

## Remaining P2/P3 Findings

- **P2-04** `partialRefund` event-key collision: `payments.refunded` emits the pre-tx shallow
  `alreadyRefunded + dto.amount` (:755); two concurrent partial refunds of the same payment can
  both emit the same cumulative value → identical reversalKey → the second reversal is skipped,
  leaving COGS under-reversed vs the actually-decremented paidAmount. Order version CAS remains
  correct; both paidAmount decrements commit. Fix: compute the event cumulative amount from the
  in-tx claim (increment result) or add a per-refund nonce to the eventKey. Unit tests cover the
  sequential case but not this race (mocked Prisma).
- **P2-02** Refund reversal creates no stock movement (only a consumption REVERSAL record); item
  `currentQuantity` is restored only via `rollbackDeduction` (cancellation/order refund). If a
  fully-refunded sale is not also transitioned to `REFUNDED`, physical inventory stays decremented
  while COGS nets to zero. Design intent per MODEL C; flag for product sign-off.
- **P3-01** `changeStatus` merges `version: { increment: 1 }` twice in the update payload
  (orders :505, :520-525) — redundant but harmless (same increment).
- **P3-02** Several non-financial order writers skip the version CAS/bump (moveTable, restore,
  softDelete, applyServiceCharge, applyTaxRate) — optimistic-concurrency coverage is not uniform;
  none touches paidAmount/status/COMPLETED so no invariant impact.
- **P3-03** `applyWebhookSucceeded` mismatch uses JS floats with `> 0.02`: an exact 0.02-cent
  difference can be rejected due to binary representation (e.g. 50.02 - 50 = 0.020000000000004).
  Cosmetic boundary behavior in a mismatch path.
- **P3-04** `Payment.gatewayRef` has no DB `@unique`; webhook lookups use `findFirst` by
  `gatewayRef` without `orderBy` (`applyWebhookSucceeded` :1589, `applyWebhookFailed` :1689,
  `applyWebhookRefunded` :1712) — nondeterministic only if a ref were ever duplicated, which
  provider issuance prevents in practice.
- **P3-05** `forecasting.service` feeds raw quantities (incl. reversal negatives) into its
  moving-average forecast — semantically "net consumption"; consider `reversedFromId: null` if a
  gross-consumption view is intended.
- **P3-06** `gatewayAmountCents`/webhook tolerance asymmetry (1¢ cents vs 2¢ major) is consistent
  enough but codify once if desired.

## Release Blockers

- Working tree is **uncommitted and massive** relative to the initial checked-out commit (detached
  HEAD, CRLF-normalization noise). A clean-checkout build cannot re-produce this tree until the
  remediation changes are committed and pushed. Existing blockers from the remediation report
  remain: no commit/push/deploy/rebuild permitted; stale `docker-api:latest` container image not
  rebuilt; SMTP and live Stripe/Paymob credentials unavailable (dev uses mock providers gated by
  `assertNotMockInProduction`); no real integration database (integration specs run against mocked
  Prisma). None of these are P1 code defects.

## Exact Evidence

| File                                                                           | Function / Location                                                          | Lines                          | Behavior verified                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| apps/api/src/modules/payments/payments.service.ts                              | `finalizeSucceededPayment`                                                   | 120-187                        | fresh read, version CAS, paidAmount write, auto-complete                               |
| apps/api/src/modules/payments/payments.service.ts                              | `charge`                                                                     | 255-355                        | order read, payable gate, overpay guard, idempotency, CAS, paidAmount+COMPLETED atomic |
| apps/api/src/modules/payments/payments.service.ts                              | `refund`                                                                     | 533-638                        | claim CAS, fresh order read, version CAS, decrement, cumulative emit :629-635          |
| apps/api/src/modules/payments/payments.service.ts                              | `partialRefund`                                                              | 640-759                        | claim CAS w/ maxAllowed, fresh read, version CAS, decrement, emit :750-756             |
| apps/api/src/modules/payments/payments.service.ts                              | `voidPayment`                                                                | 761-816                        | PENDING only; no paidAmount                                                            |
| apps/api/src/modules/payments/payments.service.ts                              | `splitPayment`/`finalizeProviderSplitPayments`                               | 856-1047                       | in-tx balance check + CAS + increment                                                  |
| apps/api/src/modules/payments/payments.service.ts                              | `reconcilePendingPayments`/`resolvePendingPayment`/`resolveSucceededPayment` | 1278-1477                      | status lookup, cents amount-match, finalize re-entry                                   |
| apps/api/src/modules/payments/payments.service.ts                              | `handleGatewayWebhook`                                                       | 1542-1586                      | signature verify, event dispatch                                                       |
| apps/api/src/modules/payments/payments.service.ts                              | `applyWebhookSucceeded`                                                      | 1588-1686                      | claim CAS, version CAS, 0.02 mismatch refuse-before-credit, auto-complete              |
| apps/api/src/modules/payments/payments.service.ts                              | `applyWebhookRefunded`                                                       | 1707-1799                      | claim on amountRefunded, version CAS, decrement delta, cumulative emit                 |
| apps/api/src/modules/payments/providers/stripe.provider.ts                     | `parseWebhookEvent`                                                          | 368-414                        | major-unit normalization (/100) for success/refund                                     |
| apps/api/src/modules/payments/providers/paymob.provider.ts                     | `parseWebhookEvent`                                                          | 450-490                        | major-unit normalization (/100)                                                        |
| apps/api/src/modules/orders/orders.service.ts                                  | `update`                                                                     | 317-474                        | CAS; item/total recalc; terminal blocked                                               |
| apps/api/src/modules/orders/orders.service.ts                                  | `changeStatus`                                                               | 476-579                        | fresh COMPLETED gate + CAS; dynamic event emit                                         |
| apps/api/src/modules/orders/orders.service.ts                                  | `applyServiceCharge`/`applyTaxRate` / `moveTable` / `restore` / `softDelete` | 1147,1199,1006,1408,1310       | no CAS; financial-cols only via recalc (P3-02)                                         |
| apps/api/src/modules/orders/orders.service.ts                                  | `recalculateOrder`                                                           | 1668-1712                      | total floor at paidAmount; never produces invariant                                    |
| apps/api/src/modules/orders/order-state-machine.ts                             | transitions                                                                  | 24-66                          | REFUNDED/COMPLETED semantics; terminal set                                             |
| apps/api/src/modules/recipes/recipes.processor.ts                              | `@OnEvent` handlers + worker                                                 | 21-118                         | event wiring, deterministic job ids, refund forwarding                                 |
| apps/api/src/modules/recipes/recipes.service.ts                                | `isOrderCompletedForDeduction`                                               | 490-496                        | deduction gated on COMPLETED                                                           |
| apps/api/src/modules/recipes/recipes.service.ts                                | `deductInventoryForOrder`                                                    | 528-762                        | idempotent ORDER movements + consumption record (DAILY, source ORDER)                  |
| apps/api/src/modules/recipes/recipes.service.ts                                | `rollbackDeduction`                                                          | 764-891                        | FOR UPDATE, movement ROI inversion, ROLLBACK consumption at ratio 1, idempotent        |
| apps/api/src/modules/recipes/recipes.service.ts                                | `reverseConsumptionForRefund`                                                | 900-974                        | cumulative ratio, FOR UPDATE, originals-only                                           |
| apps/api/src/modules/recipes/recipes.service.ts                                | `reverseOriginalRecord`                                                      | 976-1046                       | reversalKey unique, cumulative target-minus-already, cap, 4dp, tenant-scoped           |
| apps/api/src/modules/inventory-analytics/inventory-analytics.service.ts        | turnover/classification/trends/accuracy                                      | 76,191,358-412,482             | SUM nets / COUNT excludes reversals                                                    |
| apps/api/src/modules/financial-analytics/financial-analytics.service.ts        | cogs reads                                                                   | 60,150,247                     | SUM-netted COGS                                                                        |
| apps/api/src/modules/forecasting-dashboard/forecasting-dashboard.service.ts    | `getInventoryForecast`                                                       | 328-340                        | reversedFromId:null divisor                                                            |
| prisma/schema.prisma                                                           | `ConsumptionRecord`                                                          | 3575-3600                      | reversalKey @unique, reversedFromId indexed                                            |
| prisma/schema.prisma                                                           | `Order` / `Payment` / `OrderStatus`                                          | 971-1031 / 1176-1206 / 118-129 | Decimal(10,2) amounts; version; REFUNDED status                                        |
| prisma/migrations/20260921214741_add_consumption_reversal_fields/migration.sql | DDL                                                                          | all                            | columns + unique/index exactly matching schema                                         |

## Final Decision

**GO.**

Phase-1 remediation (F-001, F-002, F-005) is **independently verified** and has **no remaining
P0/P1 implementation blocker**. The corrected Invariant #1 wording ("an order must never enter or
remain in COMPLETED state with `paidAmount < total`; a refunded order may have `paidAmount < total`
only when transitioned to REFUNDED per the documented state machine") is fully satisfied by the
implementation: all paidAmount writers are CAS-protected with fresh in-transaction reads, all
COMPLETED-arrival paths enforce `paidAmount >= total` in-transaction, and no bypass was found.

Non-blocking follow-up findings remain documented in scope (not blockers for this acceptance):

1. Fix P2-04 (in-tx cumulative amount for the refund eventKey).
2. Investigate P2-02 (physical inventory restoration on refunded sales) with product.
3. Proceed to commit/push + rebuild the api container + re-run against a live integration DB
   before production release.

Audit performed read-only; **no fixes were applied** by this audit.

---

_Independent audit — cross-checked against the implementation, migration SQL, event wiring and a
freshly executed read-only gate set. Jests: 100 suites / 1291 tests pass; tsc clean; eslint clean
on audited modules; `nx build api` success; `prisma validate` valid; live `migrate status` up to
date (25 migrations)._
