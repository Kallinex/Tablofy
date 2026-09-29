# POST-P1-05-P1-06-FINAL-INDEPENDENT-DECISION-AUDIT

**Date:** 2026-08-11
**Auditor:** Independent forensic re-audit (no source code modified)
**Repository:** `D:\New folder (8)\tablofy`, branch `feature/phase7-m5`, HEAD `bbba2a4`
**Mode:** READ-ONLY. No files, schema, migrations, env, or credentials were modified.

---

## 1. Executive Summary

This audit re-verified, from the actual repository, live database, test suite, and runtime, every claim made by the P1-05/P1-06 remediation. All regression gates re-passed (84/84 suites, 1044/1044 tests, tsc/eslint/build clean, prisma validate, 24/24 migrations, `/api/v1/health/live` 200). The P1-05 core invariant — _cancelling GRN A can never reverse inventory attributed to GRN B_ — is **correctly implemented** via an id-targeted, gte-guarded batch CAS keyed on `GoodsReceiptItem.inventoryBatchId`, with a database-level unique natural key on `inventory_batches` and a SET-NULL FK. P1-06 is substantially fixed: `updateItem` has a real version CAS with `ConflictException`; adjustments, waste, cycle-count reconcile, transfers, and recipe deduction are all atomic/claimed/locked.

However, the audit found **one genuine P1-06-scope residual lost-update** (`createGRN` computes `averageCost` from a read outside any CAS/lock — `purchasing.service.ts:959-976`), plus material caveats: the "production" database is effectively **empty of transactional data** (all migration-safety and existing-data claims are unverified against real data), Redis authentication remains **optional by default** (P1-08/P1-09 only partially supported), several persisted money computations use JS float arithmetic, and the entire remediation is **uncommitted**.

**Final verdict: CONDITIONAL GO.** Phase 3 must not begin until: (1) the `averageCost` race in `createGRN` is fixed and covered by a test, (2) the Redis-auth default decision is made (password enforced or a documented accept of loopback-only), and (3) the remediation batch is committed/pushed. See §29–§31.

---

## 2. Scope

- Re-verify P1-01 → P1-10 from repository evidence (no trust of prior CLOSED labels).
- Deep audit P1-05 (GRN batch attribution) and P1-06 (inventory mutation concurrency).
- Money safety, concurrency, tenant isolation, RBAC, Redis, KDS, payments, database/migrations, test quality, regression, fresh vulnerability search, production readiness.
- Explicitly NOT trusted: prior report claims. Every claim below was re-derived from `file:line` code, live SQL, or fresh test/gate runs.

---

## 3. Repository State

- Monorepo: `apps/api` (NestJS), `prisma` (schema + 24 migrations), `docker`, `libs`, `docs`, many top-level audit report `.md` files.
- Modules present (67 files under `apps/api/src/modules`): auth, users, customers (contains wallet+loyalty logic), orders, payments (+providers stripe/paymob +webhooks), purchasing, inventory, cycle-counts, transfers, recipes, kds, gift-cards, queues (+processors), subscriptions, sessions, webhooks/webhook-delivery, and analytics modules.
- No separate `wallet`/`loyalty` service — those live in `customers.service.ts` (loyalty `earnPoints`/`redeemPoints`, wallet transactions).

---

## 4. Git State

- Branch `feature/phase7-m5`; HEAD `bbba2a4` ("chore(config): resolve DB ambiguity, add PAYMENTS_MODE=test, guard destructive Prisma scripts").
- **Nothing is committed or pushed.** `git status` shows **23 modified files** + 4 untracked:
  - Modified (selection): `prisma/schema.prisma`, `purchasing.service.ts`, `inventory.service.ts`, `cycle-count.service.ts`, `transfers.service.ts`, `recipes.service.ts`, `orders.service.ts`, `payments.service.ts`, `kds.service.ts`, `customers.service.ts`, `redis.config.ts`, `redis.service.ts`, `queue.service.ts`, `docker-compose.yml`, `docker-compose.prod.yml`, plus spec files.
  - Untracked: `P1-05-P1-06-FINAL-REMEDIATION-REPORT.md`, `apps/api/src/config/redis.config.spec.ts`, `apps/api/src/config/docker-compose.spec.ts`, `prisma/migrations/20260811000000_add_kitchen_ticket_item_unique_order_item/`, `prisma/migrations/20260811120000_add_grn_batch_attribution/`.
- Diff stat: **2,816 insertions / 391 deletions** across 23 files.
- The entire P1 remediation (P1-01…P1-10) exists only in the working tree. Delivery risk: none of it is version-controlled.

---

## 5. P1 Matrix

| P1    | Area                                         | Prior claim | Independent classification                                      |
| ----- | -------------------------------------------- | ----------- | --------------------------------------------------------------- |
| P1-01 | Full-refund CAS                              | CLOSED      | **CLOSED** (residual: gateway-before-CAS ordering, §22)         |
| P1-02 | Split/Merge order CAS + authoritative recalc | CLOSED      | **CLOSED**                                                      |
| P1-03 | KDS duplicate ticket / idempotency           | CLOSED      | **CLOSED** (residual: partial-batch repair, §21)                |
| P1-04 | GRN receive-cap / numbering                  | CLOSED      | **CLOSED**                                                      |
| P1-05 | GRN cancellation attribution                 | CLOSED      | **CLOSED** (core invariant proven; see §10 caveats)             |
| P1-06 | Inventory mutation concurrency               | CLOSED      | **PARTIAL** (one real residual: `averageCost` lost update, §11) |
| P1-07 | Atomic loyalty earnPoints                    | CLOSED      | **CLOSED**                                                      |
| P1-08 | Redis password/TLS configuration             | CLOSED      | **PARTIAL** (plumbing done; auth optional by default)           |
| P1-09 | Redis Docker hardening                       | CLOSED      | **PARTIAL** (loopback binding done; requirepass optional)       |
| P1-10 | Split-payment three-phase architecture       | CLOSED      | **CLOSED**                                                      |

---

## 6. P1-01 — Full-Refund CAS

- Previous vulnerability: concurrent refunds could both pass a read-time check and double-refund / double-decrement `paidAmount`.
- Claimed fix: DB-level CAS on the payment row.
- Actual implementation: `payments.service.ts:565-580` — `payment.updateMany({ where: { id, status: { in: [COMPLETED, PARTIALLY_REFUNDED] }, amountRefunded: 0 }, data: { status: REFUNDED, amountRefunded: payment.amount, ... } })`; `claimed.count === 0 → ConflictException` (578-580). Partial refund: `:665-682` — `amountRefunded: { lte: maxAllowedRefunded }` + `increment`, 0-claims → `ConflictException`.
- Database invariant: single `payments` row; `amountRefunded` monotonic, guarded by CAS predicate evaluated in Postgres.
- Transaction boundary: CAS tx `:564-595`; `order.paidAmount` decrement inside same tx `:582-588`.
- Concurrency behavior: two racing refunds — exactly one CAS wins; loser 409.
- Tenant isolation: payment pre-read scoped `{ id, tenantId }` (`:532-534`).
- Authorization: controller `payments.controller.ts:57` (refund) — route gated (RBAC tripwire, §19).
- Idempotency: gateway idempotency key `refund_${payment.id}` / `partial_refund_${payment.id}` (`:556,654`).
- Failure behavior: gateway refund executes **before** the DB CAS (`:550-562, 644-660`); a lost CAS leaves real gateway money refunded while the ledger row is unchanged and the caller receives 409 → gateway/ledger divergence until reconciliation. Residual RISK (not a code-integrity failure of the CAS itself).
- Proving tests: `payments.service.spec.ts` (P1-01 CAS cases, suite green).
- Remaining weakness: no `gte` guard on `order.paidAmount` decrement (`:585,687`) — theoretical negative paidAmount under exotic multi-payment races; float `paidAmount` compute (§16).
- **Final classification: CLOSED** (core CAS correct; ordering caveat tracked in §22).

## 7. P1-02 — Split/Merge Order CAS + Authoritative Recalculation

- Previous vulnerability: split/merge used read→write without version guard; totals recomputed from stale state.
- Claimed fix: version CAS + authoritative recalc.
- Actual implementation: `orders.service.ts:742-748` — source order `updateMany({ where: { id, version: existing.version }, data: { version: { increment: 1 } } })`, 0-claims → `ConflictException`. Merge `:887-899` — **both** target and source version-CAS'd. Both paths call `recalculateOrder` (`:829-830`, `:927`), defined at `:1527`.
- Database invariant: `orders.version`; `order_items` totals are the source of truth recomputed by `recalculateOrder`.
- Transaction boundary: single interactive tx; order number generation inside tx with `withOrderNumberRetry` (`:741`).
- Concurrency behavior: concurrent splits/merges of the same order → one wins; loser 409.
- Tenant isolation: `findOne(id, tenantId)` (`:734,877-880`).
- Authorization: controller `orders.controller.ts:203/220` — gated.
- Idempotency: order number unique (`schema.prisma` order model) + P2002 retry.
- Failure behavior: version conflict aborts whole tx → no partial split/merge.
- Proving tests: `orders.service.spec.ts` (split/merge CAS cases).
- Remaining weakness: none material.
- **Final classification: CLOSED.**

## 8. P1-03 — KDS Duplicate Ticket / Idempotency

- Previous vulnerability: duplicate `kitchen_ticket_items` for one orderItem on retry/replay.
- Claimed fix: DB unique constraint + P2002 handling.
- Actual implementation: `prisma/schema.prisma:1166` (`KitchenTicket @@unique([orderId, ticketNumber])`), `:1529` (`KitchenTicketItem @@unique([orderItemId])`); migration `20260811000000_add_kitchen_ticket_item_unique_order_item/migration.sql:2`. Service: `kds.service.ts:441-450` pre-check skip-if-any-ticket; `:458-485` P2002 retry loop (max 3): ticket-number conflict → retry (`:468-472`), orderItemId conflict → treated as idempotent success (`:473-477`).
- Database invariant: unique index on `kitchen_ticket_items(orderItemId)`.
- Concurrency behavior: concurrent order-confirm events for same order — DB unique enforced.
- Queue: `kitchen` queue `queue.service.ts:48`, processor `queues/kitchen.processor.ts:11-35` is **log-only** → retries cannot double-apply.
- Proving tests: `kds.service.spec.ts:234-306` (skip idempotent, concurrent P2002 idempotent, error propagation, persistent-conflict throw).
- Remaining weakness: (1) pre-check `:441-450` skips the entire batch if **any** ticket exists → an interrupted partial batch is never repaired; (2) `isOrderItemTicketConflict` (`:581-587`) treats any orderItemId P2002 as success, assuming the winner committed the whole batch — UNCERTAIN under partial-commit; (3) the unique index was created with no de-duplication step — would fail `migrate deploy` on real data containing duplicates (DB is empty today, §23).
- **Final classification: CLOSED** (duplicate-prevention proven; repair gaps tracked in §21).

## 9. P1-04 — GRN Receive-Cap / Numbering

- Previous vulnerability: over-receipt against PO line; GRN number collision (findFirst→create race).
- Claimed fix: PO-line receive-cap CAS + unique GRN/PO numbers with P2002 retry.
- Actual implementation: `purchasing.service.ts:928-941` — `purchaseOrderItem.updateMany({ where: { id, receivedQuantity: { lte: remainingAllowed } }, data: { receivedQuantity: { increment: qty } } })`, 0-claims → `BadRequestException` (over-receipt rejected). GRN number: `generateGRNNumber` inside tx (`:1391-1411`), `withGRNNumberRetry` (`:780-800`) with `isGRNNumberConflict` (`:756-765`).
- Database invariant: `@@unique([tenantId, grnNumber, deletedAt])` (`schema.prisma:2932`); `@@unique([tenantId, poNumber, deletedAt])` (`:2845`).
- Concurrency behavior: two concurrent GRN creates for same PO — the PO-line CAS lets exactly the allowed amount through; GRN-number P2002 aborts and retries the whole tx.
- Tenant isolation: PO read scoped `{ id, tenantId }` (`:867-870`); inventory items verified tenant-scoped (`:892-898`).
- Failure behavior: over-receipt → 400; number collision → retry (max 5) then 409.
- Proving tests: `purchasing.service.spec.ts` P1-04 cases.
- Remaining weakness: none material.
- **Final classification: CLOSED.**

## 10. P1-05 — GRN Cancellation Attribution (deep)

### 10.1 Data model

- `GoodsReceiptItem.inventoryBatchId String?` + FK → `inventory_batches` `ON DELETE SET NULL` (`schema.prisma:2956,2965`; migration `20260811120000_add_grn_batch_attribution/migration.sql:7,16`).
- `InventoryBatch @@unique([inventoryItemId, tenantId, batchNumber, lotNumber, expiryDate])` (`schema.prisma:2715`; migration `:13`) — database-enforced batch natural key.
- Verified live: FK `goods_receipt_items_inventoryBatchId_fkey` (SET NULL), unique index `inventory_batches_inventoryItemId_tenantId_batchNumber_lotN_key`, index on `goods_receipt_items(inventoryBatchId)` — all present in `tablofy_prod`.

### 10.2 createGRN (`purchasing.service.ts:866-1133`)

- PO status pre-check ORDERED/PARTIALLY_RECEIVED (`:872-879`); PO-line receive-cap CAS (`:928-941`).
- Per-line: atomic item increment + `stock_movement` PURCHASE (`:971-999`), then batch resolve (`:1001-1058`): existing active batch → atomic increment; else `create` with **P2002 fallback** (`:1040-1056`) → re-find winner + atomically increment. `GoodsReceiptItem.inventoryBatchId` recorded (`:1060-1074`).
- **Race analysis:** batch create is the only non-atomic step and is DB-guarded by the unique natural key with deterministic P2002 reuse. ✓
- **Residual (P1-06):** `averageCost` is read → computed → written with **no version/lock** (`:959-976`): `newAvgCost` derived from `invItem.currentQuantity`/`averageCost` read at `:943`, written at `:971-981` while quantity increments atomically. Two concurrent GRNs for the same item produce a last-writer-wins `averageCost` computed from a stale read → inventory valuation lost update. Confirmed defect.

### 10.3 cancelGRN (`purchasing.service.ts:1255-1389`)

- Status claim: `goodsReceipt.updateMany({ where: { id, status: { not: CANCELLED } } })` (`:1266-1272`) — serializes cancellation; repeat cancel → 400 (fast-path `:1261-1263`).
- Item-level reversal: `inventoryItem.updateMany({ where: { id, tenantId, currentQuantity: { gte }, availableQuantity: { gte } }, data: { decrement, version: { increment: 1 } } })` + count check (`:1286-1303`) — CAS, no clamp, never negative.
- Exactly one ADJUSTMENT movement, created inside the tx with `referenceId = grn.id` (`:1305-1323`).
- **Batch reversal is id-targeted:** `inventoryBatch.updateMany({ where: { id: item.inventoryBatchId, isActive: true, quantity: { gte: receivedQty } }, data: { quantity: { decrement: receivedQty } } })` + count check (`:1329-1345`). Legacy rows (`inventoryBatchId = null`) intentionally skipped (`:1329` gate).
- PO status recompute + version bump (`:1348-1368`).

### 10.4 Audit scenario walkthrough (GRN A → Batch X qty 3; GRN B → Batch X qty 5)

- Batch X = 8 after both receipts; each GRN line carries `inventoryBatchId = X`.
- **Cancel A:** batch CAS `{ id: X, quantity: { gte: 3 } }` → X = 5. ✓ (item CAS: 8 − 3 = 5). Remaining = 5 = B's stock. **Invariant holds.**
- **Cancel B:** batch CAS `{ id: X, quantity: { gte: 5 } }` → X = 0. ✓ Remaining = 0.
- **Concurrent cancel A and B:** both run UPDATEs on row X; Postgres row-lock serializes them; the second re-evaluates `quantity >= q` against the post-first value. 8−3=5 then 5−5=0 (or 8−5=3 then 3−3=0). **No negative, no excess reversal.** The gte guard is evaluated under the row lock, so this is correct at the DB level.
- **Repeat cancel:** status claim blocks; no movement written (`:1261-1263`, test `purchasing.service.spec.ts:801-813`).
- **Cross-batch:** cancel A touches `WHERE id = batch-a` only — never batch-b (`:1330`; test `:1203-1254`).
- Legacy rows: no batch row exists → item-level reversal only (pre-fix semantics), consistent with the item being fungible.

### 10.5 Proving tests (10 scenarios, `purchasing.service.spec.ts:726-1296`)

Barrier-based two-party concurrency with final-state asserts: shared-batch drain `[3,5]` → 0 (`:865-928`); same-GRN concurrent cancel → exactly one movement (`:815-863`); P2002 winner-reuse (`:1055-1147`); id-targeted reversal (`:764-799`); batch-id recording (`:930-992`); batch reuse (`:994-1053`); null-attribution (`:1149-1201`); cross-batch never touched (`:1203-1254`); exact movement −3.4 / −6.8 (`:1256-1295`); repeat-cancel idempotent (`:801-813`).

### 10.6 Limitations of evidence

- All concurrency tests are **mocked-Prisma unit tests** (the mock faithfully models row-lock serialization, but real Postgres `UPDATE … WHERE quantity >= x` semantics are not exercised). No DB-integration test exists. (§24)
- The live DB has **zero** `goods_receipts`, `goods_receipt_items`, `inventory_batches` rows → legacy-row and batch-ownership behavior is proven by code+tests only, not by data. (§23)

### 10.7 Remaining weakness

- Batch `isActive: true` + inactive batch with same natural key → P2002 fallback re-find fails (`:1044-1048`) → GRN creation fails; deactivated lot blocks new receipts of the same lot (design question, LOW).
- `item.purchaseOrderItemId!` / `item.inventoryItemId!` non-null assertions (`:1276,1287,1311`) can 500 if the referenced PO item / inventory item was deleted (SET NULL legacy), instead of a clean 400. LOW.
- **Final classification: CLOSED** — the invariant "cancel A can never reverse B's batch stock" is implemented and provable. Caveat: overall inventory-_valuation_ is affected by the §11 `averageCost` residual.

## 11. P1-06 — Inventory Mutation CAS (deep)

| Mutation                       | File:Line                        | READ                              | COMPUTE                               | CLAIM                                                    | WRITE                                                                                       | Guard                                 | Class                 |
| ------------------------------ | -------------------------------- | --------------------------------- | ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------- |
| `updateItem`                   | `inventory.service.ts:461-530`   | version read `:462`               | available = current − reserved `:476` | —                                                        | `updateMany { version: item.version }` `:478-505`, count 0 → `ConflictException` `:506-510` | version CAS                           | **SAFE**              |
| `createAdjustment` INCREASE    | `:708-738`                       | —                                 | —                                     | —                                                        | atomic `increment` + count `:711-721`                                                       | atomic                                | **SAFE**              |
| `createAdjustment` DECREASE    | `:690-706`                       | —                                 | —                                     | —                                                        | creates PENDING (no stock change)                                                           | status                                | **SAFE**              |
| `approveAdjustment`            | `:763-865`                       | —                                 | —                                     | status claim `updateMany { status: PENDING }` `:780-784` | INCREASE atomic; DECREASE `gte` decrement + count `:787-827`                                | status CAS + gte                      | **SAFE** (clamp note) |
| `createWasteEntry`             | `:913-1014`                      | pre-check `:919-924`              | —                                     | —                                                        | `gte` decrement + count `:946-974`                                                          | gte CAS                               | **SAFE** (clamp note) |
| Cycle-count `reconcile`        | `cycle-count.service.ts:242-330` | —                                 | Decimal variance `:281`               | status claim `:258-276`                                  | `gte`-guarded decrement / atomic increment + version `:288-302`                             | status CAS + gte                      | **SAFE**              |
| Transfer `start`               | `transfers.service.ts:357-462`   | —                                 | —                                     | status claim `:368-374`                                  | `gte` decrement + version `:396-413`                                                        | status CAS + gte                      | **SAFE**              |
| Transfer `receive`             | `:464-584`                       | —                                 | —                                     | status claim `:475-485`                                  | atomic increment + version `:522-529`                                                       | status CAS + atomic                   | **SAFE**              |
| Transfer `cancel` (IN_TRANSIT) | `:586-655`                       | —                                 | —                                     | status claim `:602-619`                                  | atomic increment (reversal) `:631-638`                                                      | status CAS                            | **SAFE**              |
| Recipe deduction               | `recipes.service.ts:626-714`     | —                                 | —                                     | order row lock `:629-634`; item row lock `:654-659`      | read→compute→write under `FOR UPDATE` `:661-679`                                            | row lock                              | **SAFE**              |
| GRN receive item               | `purchasing.service.ts:971-981`  | `averageCost` read `:943,959-960` | newAvgCost `:962-969`                 | —                                                        | `update` atomic increments + **`averageCost` absolute write** `:971-981`                    | atomic qty; **averageCost UNGUARDED** | **RISK**              |
| GRN cancel                     | `:1286-1345`                     | —                                 | —                                     | GRN status claim `:1266-1272`                            | item gte CAS `:1286-1303`; batch id-targeted gte CAS `:1329-1345`                           | status + gte + id                     | **SAFE**              |

- **Residual lost-update (the one real finding in scope):** `createGRN` averageCost read→compute→write without version/lock (`purchasing.service.ts:959-976`). Concurrent GRNs for the same inventory item will persist a stale `averageCost` → incorrect weighted-average valuation. Quantity integrity is unaffected (increments are atomic), and P1-05 batch attribution is unaffected. No test covers this path.
- **Clamp-to-zero fallback (design note, not the P1-05 batch path):** when `availableQuantity < decrementQty` but `currentQuantity` covers it, `approveAdjustment`/`createWasteEntry` set `availableQuantity: 0` (`inventory.service.ts:822-825, 970-973`) — a silent data mutation (reserved gap widens), not a negative; flag as LOW.
- Overdraw: rejected via `gte` CAS everywhere; losers receive 400/409, never silent clamp on currentQuantity.
- Stale writers: `updateItem` → `ConflictException`; all others reject via count checks.
- Proving tests (10 scenarios): `inventory.service.spec.ts:605-808` — version-in-WHERE `:617-637`, ConflictException `:639-649`, concurrent version serialization `:651-684`, same-adjustment exactly-once `:686-745`, cross-adjustment gte overdraw rejection `:747-808`. All mocked; **no DB-integration test**.
- **Final classification: PARTIAL** (not CLOSED): one in-scope lost-update remains (`createGRN.averageCost`), plus clamp-to-zero fallbacks, plus absence of any DB-integration concurrency test.

## 12. P1-07 — Atomic Loyalty earnPoints

- `customers.service.ts:400-465`: atomic `membership.updateMany` increment + count check (`:409-417`); `loyaltyPointsTransaction.create` with `@@unique([tenantId, referenceType, referenceId])` (`schema.prisma:1804`) and P2002 → `ConflictException` (`:438-442`). `balanceAfter` read post-increment inside tx (`:419-421`).
- `redeemPoints` `:467-...`: `points: { gte: dto.points }` decrement + count (`:476-489`).
- **Final classification: CLOSED.**

## 13. P1-08 — Redis Password/TLS Configuration

- Plumbing verified: single Redis client `redis/redis.service.ts:18` via `buildRedisConnectionOptions` (`config/redis.config.ts:19-39`); BullMQ (`queue.service.ts:84-156`) and redis locks (`redis-lock.service.ts:15`) reuse it. TLS toggle via `REDIS_TLS` (`redis.config.ts:8,27`). Specs `config/redis.config.spec.ts` (untracked) assert passthrough/omit behavior.
- **Weakness:** `REDIS_PASSWORD` optional everywhere — `env.validation.ts:60-62` (`@IsOptional`), root `.env` has `REDIS_PASSWORD=` (empty), both compose files default `${REDIS_PASSWORD:-}`. No production-time enforcement. Security depends on loopback-only binding.
- **Final classification: PARTIAL** (config plumbing correct; default deployment has **no Redis auth**).

## 14. P1-09 — Redis Docker Hardening

- Verified live from `docker/docker-compose.yml:24-42` and `.prod.yml:24-42`: loopback bind `127.0.0.1:6379:6379` (was `6379:6379`), named volume `redis_data`, healthcheck `redis-cli … -a $REDIS_PASSWORD ping`, requirepass **conditional** (`${REDIS_PASSWORD:+--requirepass ...}`).
- **Weakness:** password optional; `docker/.env` has no `REDIS_PASSWORD`. Hardening is incomplete without operator-set credentials.
- **Final classification: PARTIAL.**

## 15. P1-10 — Split-Payment Three-Phase Gateway Architecture

- Verified: `splitPayment` (`payments.service.ts:779`) → `executeProviderSplitPayments` (`:942`) runs provider calls **outside** the create tx → `finalizeProviderSplitPayments` (`:1017`) with payment-status CAS (`:1028-1036`) and **order `version` CAS** (`:1066-1072`). In-tx path limited to cash/gift-card (`:842-855`). Integration spec `payments/tests/integration/payment-flow.integration.spec.ts` modified.
- **Final classification: CLOSED** (three-phase with authoritative finalize CAS; not live-provider-certified — §22).

---

## 16. Money Safety

Schema: 141 Decimal columns across 50 models (money `Decimal(10,2)`, quantities/costs `Decimal(12,4)`, `InventoryValuation.totalValue Decimal(16,4)`).

Persisted float-arithmetic on money/quantity (RISK, ordered by severity):

1. `recipes.service.ts:879-883,899-900` — recipe `cost` and `foodCostPercentage` from float multiply → persisted `Recipe.cost` (12,4).
2. `inventory.service.ts:687-688,700,731` (adjustment), `:926-927,938,984` (waste), `:1067-1069,1082` (count) — `qty * unitCost` float → `totalCost`/`varianceCost` persisted.
3. `transfers.service.ts:422-425,538-541` — `Number(unitCost) * qty` → `StockMovement.totalCost`.
4. `payments.service.ts:152,158` — `totalPaid = Number(paidAmount) + amount` → `order.paidAmount` persisted (float round-trip at 2dp; version-CAS protected against lost update but float-compared `:160,166` for COMPLETED status).
5. `costing.service.ts:28-58` — `Number(currentQuantity) * unitCost` → `InventoryValuation.totalValue` (16,4; largest accumulation surface).
6. `cycle-count.service.ts:352-362,439` — `Number(expectedQuantity)`, `actualQty - expectedQty` → persisted variance.
7. `customers.service.ts:1302-1348` — `Number(totalSpent)` reduces → lifetime value persisted; `:837-913` wallet roundMoney→number→Decimal.

Pattern root cause: `common/money/money.util.ts` computes correctly with `Prisma.Decimal` but **every helper returns `number`** (`:13 .toNumber()` etc.), so even "correct" order/payment paths round-trip Decimal→float64→Decimal.

Comparison: float boundary checks `payments.service.ts:160-166,267-270,331-337` (`Number(paidAmount)+amount >= Number(total)`) can mis-flip COMPLETED status at exact-boundary rounding.

Classification summary: **~10 persisted float computations** (medium precision risk, low current magnitude at 2dp/4dp), **~30 total occurrences** including API-only. No raw `parseFloat` on a _stored_ monetary input in the critical order/payment write path (DTOs are typed Decimal/number and validated). This is a systemic hardening item, not a P1-blocker at current precision.

## 17. Concurrency

- read→compute→write **without** version/lock: **one confirmed** — `purchasing.service.ts:959-976` (`averageCost`). All other quantity/money mutations are atomic increments/decrements, `gte` CAS, status-claim CAS, version CAS, or `FOR UPDATE` (verified list in §11).
- Generated numbers inside transactions: PO (`purchasing.service.ts:843-860,740-752`), GRN (`:1391-1411,780-800`), order (`orders.service.ts` withOrderNumberRetry) — all protected by per-tenant unique constraints + P2002 retry. Verified unique indexes: `schema.prisma:2845,2932`.
- `updateMany` without count check: found none in the audited mutation paths (all count-checked).
- Idempotency: payment `@@unique([tenantId, idempotencyKey])` (`schema.prisma:1204`) + P2002 replay (`payments.service.ts:364-377`); KDS orderItemId unique; recipe deduction pre-check + order row lock + `jobId: deduct-${orderId}` (`recipes.processor.ts:31,52`).
- Provider-in-tx: none — provider calls are outside DB transactions in charge/refund/split (§22).
- Queue retry double-apply: recipe deduction idempotent ✓; email/webhook-delivery re-send risk (non-idempotent side effects) §20; forecast/scheduled-report/waste duplicate-row risk on retry (minor).

## 18. Tenant Isolation

- Service-layer scoping: all critical mutation entry queries are tenant-scoped — purchasing `purchasing.service.ts:867-870,1256-1259`; inventory `inventory.service.ts:462-464,682-685`; orders `orders.service.ts` findOne(id, tenantId); payments `:532-534`; transfers `:358-361`; cycle-count `:243-246`; recipes `:629-634` (order lock includes tenantId); customers loyalty `:409-411`.
- Batch ownership: `inventory_batches` carries `tenantId`; GRN batch resolve filters `tenantId` (`purchasing.service.ts:1005`); cancelGRN batch reversal is by batch `id` (globally unique PK) — no tenant key needed, but the row was created tenant-scoped. The natural-key unique includes `tenantId` (`schema.prisma:2715`).
- Verified weaknesses (LOW): `TenantBodyGuard` (`common/guards/tenant-body.guard.ts`) is **not registered** in global guards (`app/app.module.ts:242-258` — only JwtAuthGuard, RolesGuard, TenantGuard, PlanThrottleGuard); TenantGuard checks only `params.tenantId`. Controllers pass `user.tenantId!` from the JWT, and services re-scope queries, so no exploitable IDOR was found in the audited paths. `auth.service.ts` `register` treats email as globally unique (`:63-66`) vs per-tenant uniqueness in `users.service.create` — inconsistency, not IDOR.
- No ID-only mutation found that reaches an un-validated row in the critical modules (subsequent `update({ where: { id } })` calls are always preceded by a tenant-scoped read/claim).

## 19. RBAC

- Global guard chain `app.module.ts:242-258`: JwtAuthGuard → RolesGuard → TenantGuard → PlanThrottleGuard.
- JWT strategy re-validates on every request: iss/aud, Redis jti blacklist, user ACTIVE/deleted/locked, tenant status + subscription (`strategies/jwt.strategy.ts:48-97`).
- Refresh: rotation + revoke-on-reuse (theft detection) `auth.service.ts:283-346`; logout blacklists jti `:351-366`; reset/change-password revoke all `:479-521,536-...`.
- Tripwire: `common/rbac/rbac-route-coverage.spec.ts` globs **all** `**/*.controller.ts` and asserts every route handler carries Roles/Permissions/Authenticated/Public metadata (test passed → zero ungated handlers).
- Sensitive endpoints confirmed gated: GRN create `@Roles(OWNER, MANAGER, PURCHASING, CASHIER)` / cancel `@Roles(OWNER, MANAGER)` (`purchasing.controller.ts:141,173`); refunds/splits/voids via payments/orders controllers (gated per tripwire).
- Minor: refresh token stored plaintext in DB column (`auth.service.ts:343-346` randomBytes hex) — hardening note.

## 20. Redis

- One client, all consumers share the builder — no unauth'd connection path (`redis.service.ts:18`; `queue.service.ts:84-156`; `redis-lock.service.ts:15`; bull-board reuses them).
- TLS configurable but no CA/verify options; `REDIS_URL` is dead config (never consumed).
- **Default deployment runs Redis without `requirepass`** (root `.env` empty password; compose `${REDIS_PASSWORD:-}`), mitigated only by loopback binding. Healthcheck/queue/board all tied to the same client → consistent, but unauthenticated when password unset.
- No direct publish/sub bypassing config found.

## 21. KDS

- Duplicate prevention: DB unique `kitchen_ticket_items(orderItemId)` + service P2002 handling + idempotent skip + log-only queue processor. Retries cannot create duplicate tickets (unit-tested, `kds.service.spec.ts:234-306`).
- Gaps: partial-batch never repaired (pre-check skips whole batch if any ticket exists, `kds.service.ts:441-450`); orderItemId P2002 treated as unconditional success (`:473-477`).

## 22. Payments

- Refund CAS, partial-refund CAS, idempotency key, webhook CAS re-finalization, provider-outside-tx, PAYMENTS_MODE validation — all verified (§6, §11, §15).
- **Gateway-before-DB-CAS ordering** (`payments.service.ts:550-562, 644-660, 740-749`): a lost DB CAS still refunded real gateway money; idempotency keys dedupe the gateway but the ledger can diverge until reconcile. Medium residual.
- Webhook signature: Stripe HMAC verified but **no timestamp tolerance** (`stripe.provider.ts:338-366`) → replay window; impact bounded by the status/amount CAS. `STRIPE_WEBHOOK_SECRET` unset in `docker/.env` → live webhooks currently fail closed.
- Mock-provider silent fallback when `NODE_ENV !== 'production'` (`payments.module.ts:19-24,44-49`; guard `payments.service.ts:72-81`) → fake payments can be recorded on misconfigured dev/staging hosts.
- Classification clarity: **CODE VERIFIED** for all the above; **DB VERIFIED** for schema constraints (live); **LIVE PROVIDER NOT VERIFIED** — no credentials available; the payments-certification report (`P1-C-PAYMENTS-LIVE-CERTIFICATION-REPORT-2026-08-10.md`) cannot be independently confirmed from this repo without provider credentials.

## 23. Database / Migration

- 24/24 migrations applied and recorded with checksums in `_prisma_migrations` (live query); `prisma migrate status` = "Database schema is up to date!" (no drift).
- Constraints verified live: GRN batch FK (SET NULL), natural-key unique index, batch/item indexes; `loyalty_points_transactions` index rename present with new name.
- **`20260811120000_add_grn_batch_attribution` is additive** to the schema (ADD COLUMN + CREATE INDEX + ADD FK) — but it **also bundles an unrelated `RenameIndex`** on `loyalty_points_transactions` (`migration.sql:18-19`): not a pure P1-05 delta. Operationally safe (index exists under the new name) but a process deviation.
- **`20260811000000`** and **`20260811120000`** create **unique indexes on possibly non-unique existing data** (kitchen_ticket_items.orderItemId; inventory_batches natural key). Today the DB has **0 rows** in those tables, so they applied cleanly; on a real dataset with duplicates, `migrate deploy` would **fail**. Existing-data compatibility is **UNVERIFIED**.
- **CRITICAL CONTEXT:** the live `tablofy_prod` database is effectively empty — full row-count sweep shows only `audit_logs` 126, `orders` 4, `order_items` 4, `users` 4, `tenants` 2, `subscriptions` 2, `refresh_tokens` 11, `branches` 1, `restaurants` 1, `products` 1; **every purchasing/inventory/payments/KDS/loyalty/customer table = 0 rows**. All "production migration safety" claims rest on an empty schema, not real data.

## 24. Tests

- Full suite re-run fresh (`--skip-nx-cache`): **84 suites / 1044 tests PASS** (matches claimed 84/1044).
- P1-05: 10 scenarios with two-party `Promise.allSettled` gates and final-state asserts — good _unit-level_ concurrency modeling (mock faithfully models row-lock serialization).
- P1-06: 5 new scenarios + pre-existing — version CAS, ConflictException, same-adjustment claim, gte overdraw.
- **Classification:** all concurrency tests are **UNIT** (mocked Prisma). There is **no DATABASE/INTEGRATION concurrency test** exercising real Postgres row-locking/unique constraints, and **no test** for the `averageCost` residual. The `payment-flow.integration.spec.ts` is supertest/mock-level integration, not live-provider. No mocked test was treated as live verification in this audit.

## 25. Regression (fresh runs, cache skipped)

| Gate      | Command                                                    | Result                                   |
| --------- | ---------------------------------------------------------- | ---------------------------------------- |
| Tests     | `npx nx test api --skip-nx-cache`                          | **PASS** — 84/84 suites, 1044/1044 tests |
| Typecheck | `npx tsc --noEmit -p apps/api/tsconfig.app.json`           | **PASS** (no output)                     |
| Lint      | `npx nx lint api --skip-nx-cache`                          | **PASS** — 0 errors                      |
| Build     | `npx nx build api --skip-nx-cache`                         | **PASS** — webpack compiled successfully |
| Prisma    | `npx prisma validate`                                      | **PASS** — schema valid                  |
| Prisma    | `npx prisma migrate status`                                | **PASS** — 24/24 up to date              |
| Runtime   | `GET /api/v1/health/live` on built `dist/apps/api/main.js` | **200** `{database: up, redis: up}`      |

## 26. New Findings (fresh search, beyond the P1 list)

| #   | Severity               | Finding                                                                                                                                          | Evidence                                                                   |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| N1  | **HIGH (P1-06 scope)** | `createGRN` averageCost read→compute→write lost update                                                                                           | `purchasing.service.ts:959-976`                                            |
| N2  | MEDIUM                 | Redis auth optional by default (dev+prod compose)                                                                                                | `docker/docker-compose*.yml:24-42`; `env.validation.ts:60-62`; root `.env` |
| N3  | MEDIUM                 | Gateway refund/void before DB CAS → gateway/ledger divergence on lost CAS                                                                        | `payments.service.ts:550-562,644-660,740-749`                              |
| N4  | MEDIUM                 | Stripe webhook signature lacks timestamp tolerance (replay window)                                                                               | `stripe.provider.ts:338-366`                                               |
| N5  | MEDIUM                 | Outbound webhook non-2xx → parked `RETRYING`, `getPendingRetries` never invoked → stalls forever                                                 | `webhook-delivery.service.ts:139-161`; `webhook-processor.ts:143-152`      |
| N6  | MEDIUM                 | Unique-index migrations on possibly non-unique data would fail deploy on real data                                                               | `migration.sql:13`; `20260811000000/migration.sql:2` (DB empty today)      |
| N7  | MEDIUM                 | ~10 persisted float money computations (recipes cost, adjustment/waste/count costs, transfers totalCost, payments paidAmount, costing valuation) | §16 evidence list                                                          |
| N8  | LOW                    | `createBatch` lacks P2002 handling → duplicate batch = 500                                                                                       | `inventory.service.ts:1164-1174`                                           |
| N9  | LOW                    | KDS partial-batch never repaired; orderItemId P2002 = unconditional success                                                                      | `kds.service.ts:441-450,473-477`                                           |
| N10 | LOW                    | Mock provider can silently succeed if `NODE_ENV !== production` and key missing                                                                  | `payments.module.ts:19-24,44-49`                                           |
| N11 | LOW                    | `cancelGRN` non-null assertions (`!`) can 500 on deleted referenced rows                                                                         | `purchasing.service.ts:1276,1287,1311`                                     |
| N12 | LOW                    | `approveAdjustment`/`createWasteEntry` clamp `availableQuantity` to 0 when reserved gap present                                                  | `inventory.service.ts:822-825,970-973`                                     |
| N13 | LOW                    | `TenantBodyGuard` not registered (body/query tenantId unchecked); no exploit found                                                               | `app/app.module.ts:242-258`                                                |
| N14 | PROCESS                | Remediation entirely uncommitted; 2,816 insertions live only in working tree                                                                     | `git status`                                                               |
| N15 | PROCESS                | P1-05 migration bundles unrelated index rename                                                                                                   | `20260811120000/migration.sql:18-19`                                       |

## 27. Risk Matrix

| Area             | Status                  | Evidence                                                       | Risk                          | Required Action                                |
| ---------------- | ----------------------- | -------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| P1-01            | CLOSED                  | `payments.service.ts:565-580,665-682`                          | Low (gateway-ordering caveat) | Track N3 in reconcile design                   |
| P1-02            | CLOSED                  | `orders.service.ts:742-748,887-899,1527`                       | Low                           | —                                              |
| P1-03            | CLOSED                  | schema:1166/1529; migration; `kds.service.ts:458-485`          | Low                           | Repair partial batches (N9)                    |
| P1-04            | CLOSED                  | `purchasing.service.ts:928-941`; schema:2932/2845              | Low                           | —                                              |
| P1-05            | CLOSED                  | `purchasing.service.ts:1329-1345`; schema:2715/2956; migration | Low (invariant proven)        | DB-integration test on real data               |
| P1-06            | **PARTIAL**             | `inventory.service.ts:478-510`; others §11                     | **Medium (N1)**               | Fix `averageCost` CAS (N1)                     |
| P1-07            | CLOSED                  | `customers.service.ts:409-442`; schema:1804                    | Low                           | —                                              |
| P1-08            | PARTIAL                 | `redis.config.ts`; `env.validation.ts:60-62`                   | Medium (N2)                   | Enforce password in prod config                |
| P1-09            | PARTIAL                 | compose files                                                  | Medium (N2)                   | Require `REDIS_PASSWORD` in prod               |
| P1-10            | CLOSED                  | `payments.service.ts:779,942,1017`                             | Low                           | Live-provider cert pending creds               |
| Money safety     | PARTIAL                 | §16                                                            | Medium (N7)                   | Decimal-first money util                       |
| Tenant isolation | PASS (no exploit found) | §18                                                            | Low                           | Register TenantBodyGuard (N13)                 |
| RBAC             | PASS                    | tripwire spec; jwt.strategy                                    | Low                           | —                                              |
| Redis            | PARTIAL                 | §20                                                            | Medium (N2)                   | Password enforcement                           |
| KDS              | CLOSED (gap N9)         | §21                                                            | Low                           | Partial-batch repair                           |
| Payments         | CODE/DB verified        | §22                                                            | Medium (N3,N4,N10)            | Gateway/DB ordering; replay bounds             |
| Inventory        | PARTIAL (N1)            | §11                                                            | Medium                        | averageCost CAS                                |
| Purchasing       | CLOSED (N11,N12)        | §10                                                            | Low                           | Edge-case hardening                            |
| Authentication   | PASS                    | jwt.strategy; auth.service                                     | Low                           | —                                              |
| Database         | PASS (empty DB caveat)  | §23                                                            | **Medium (N6)**               | Validate migrations on real data before deploy |
| Queues           | PASS (N5)               | §20                                                            | Medium (N5)                   | Fix webhook retry stall                        |

## 28. Production Readiness

- **Security:** good (RBAC tripwire, per-request user/tenant/subscription re-validation, token rotation/blacklist, bcrypt). Redis-auth default gap.
- **Data integrity:** strong on quantities (CAS everywhere); **averageCost residual** and float money round-trips remain.
- **Concurrency:** strong pattern coverage; missing DB-integration proof and one lost-update.
- **Financial correctness:** CAS-protected refunds/splits; float-precision systemic hardening pending.
- **Tenant isolation:** no exploitable IDOR found in audited modules.
- **Observability/error handling:** health 200; audit logs on mutations; some silent processor swallows (webhook dispatch, notification processor) and one retry stall (N5).
- **Testing:** broad unit suite (1044), zero integration tests against a real Postgres for the concurrency claims.
- **Database migrations:** clean on an **empty** database; real-data compatibility unproven (N6).
- **Configuration:** `PAYMENTS_MODE=test` accepted; mock fallback risk (N10); Redis password default empty (N2).

## 29. Phase 3 Gate

| Gate                                         | Status                                                                                     | Evidence                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| No OPEN P1                                   | **FAIL** — P1-06 classified PARTIAL                                                        | N1 (`purchasing.service.ts:959-976`) |
| No REGRESSED P1                              | PASS                                                                                       | §25                                  |
| No unresolved critical data-integrity issue  | **FAIL** — `averageCost` lost update (inventory valuation)                                 | N1                                   |
| No unresolved tenant-isolation vulnerability | PASS                                                                                       | §18                                  |
| No unresolved financial-safety vulnerability | BORDERLINE — no lost-update on money (version-CAS), but float precision + gateway-ordering | N3, N7                               |
| Migrations healthy                           | PASS on empty DB / **UNVERIFIED on real data**                                             | §23, N6                              |
| Regression green                             | PASS                                                                                       | §25                                  |
| Production build green                       | PASS                                                                                       | §25                                  |

**Phase 3 MUST NOT start yet.** External-credential blocker (live payment certification) is separated from the code blockers (N1, N2, N6, N14) below.

## 30. Exact Required Actions

1. **BLOCKING — N1:** Make `createGRN`'s averageCost write atomic — re-read `currentQuantity`/`averageCost` under a `SELECT … FOR UPDATE` (as `recipes.service.ts:654-659` does) or fold into the same row lock as the quantity increments, then write `averageCost`; add a barrier-based unit test + a DB-integration test with two concurrent GRNs for the same item asserting the final weighted-average cost. (`purchasing.service.ts:959-981`)
2. **BLOCKING — N2:** Decide and enforce Redis auth: require `REDIS_PASSWORD` (non-empty) in prod compose (`${REDIS_PASSWORD:?}`) and `env.validation.ts` for `NODE_ENV=production`, or explicitly document and accept loopback-only.
3. **BLOCKING — N6 before any real-data deploy:** dry-run `prisma migrate diff`/`migrate deploy` against a copy of real data; add pre-migration de-duplication for `kitchen_ticket_items.orderItemId` and `inventory_batches` natural keys if duplicates exist.
4. **BLOCKING — N14:** Commit and push the remediation batch (23 modified + 4 untracked files) so the audited state is version-controlled.
5. **REQUIRED — N5:** Wire `getPendingRetries` into a scheduler/queue driver, or dead-letter `RETRYING` deliveries; add a webhook-retry integration test.
6. **REQUIRED — N3/N4:** Move gateway refund/void after a DB "refund-in-progress" claim or add a reconcile job for gateway↔DB divergence; add Stripe webhook timestamp-tolerance.
7. **REQUIRED — N7:** Convert `common/money/money.util.ts` to return `Prisma.Decimal`; replace the §16 persisted float computations with Decimal ops; add precision tests at the persistence boundary.
8. **RECOMMENDED — N9/N12/N13:** KDS partial-batch repair; document/clamp-aware reservation math; register `TenantBodyGuard`.
9. **RECOMMENDED — §24:** Add at least one DATABASE-level concurrency integration test (real Postgres) for the P1-05 shared-batch cancel and P1-06 `updateItem` CAS.
10. **SEPARATE (not a code blocker):** Live-provider payment certification remains pending real credentials.

## 31. Final Verdict

**CONDITIONAL GO.**

The P1-05 remediation is genuinely effective: the shared-batch attribution invariant is implemented and provable at code and schema level (id-targeted gte-CAS on `inventory_batches`, DB unique natural key, SET-NULL FK), and 10 barrier-based unit scenarios substantiate it. P1-01/02/03/04/07/10 are confirmed CLOSED from repo evidence. Every regression gate re-passed independently.

But P1-06 cannot be certified CLOSED: the `createGRN` averageCost read→compute→write is a real, in-scope lost-update (N1), no DB-integration concurrency test exists, Redis auth is optional by default (P1-08/P1-09 PARTIAL), the "production" database contains no transactional data so migration existing-data safety is unproven (N6), and the entire remediation is uncommitted (N14).

Per the Phase 3 gate (§29), Phase 3 must not start until required actions 1–4 (N1, N2, N6, N14) are complete. Once those land and gates re-run green, the backend will be genuinely safe enough to begin Phase 3.
