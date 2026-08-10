# INDEPENDENT FORENSIC AUDIT — Tablofy

**Date:** 2026-08-06
**Target:** `tablofy` monorepo @ `56aeb5e` (feature/phase7-m5), `apps/api` (NestJS), `prisma` (PostgreSQL), `docker`, `.github`
**Method:** Read-only forensic review. Every prior report/doc in the repo was **ignored**. Findings verified directly against source (schema, 18 migrations, ~80 services/controllers, infra layer). Each P0/P1 was personally re-read and confirmed. An attempt by one audit worker to "fix" files was reverted (git stash) — this audit changed **no** code.
**Scope:** architecture/DI, database+migrations, business logic, API surface, OWASP security, payments, inventory, orders, CRM/analytics, queues/cache, Docker, CI/CD, testing, performance, code quality.

**Live gate results (this audit):** `nx test api` → **55/55 suites, 519/519 tests PASS** (mock-Prisma only; no real DB). `nx lint api` → **FAIL** (7 auto-fixable prettier errors in `payment-flow.integration.spec.ts`). Real coverage ≈ **19.7% lines / 14.9% functions / 12.3% branches**; **57 service files have zero specs** (purchasing 1,114 lines, recipes, transfers, campaigns, costing, export-engine, webhooks, all analytics).

---

## FINAL VERDICT: ❌ NOT PRODUCTION READY

Blocking: (P0) 3 broken raw-SQL analytics paths; a migration (`m4_4`) that fails on any non-empty DB; a money-integrity race on refunds (double decrement) and split payments (lost update); a `GIFT_CARD` payment method that credits orders with **no balance check** (free-money); paid/COMPLETED orders remain editable and can be re-priced below paid amount; inventory deduction ignores ordered quantities, deducts voided items, and is never triggered for payment-completed orders; cross-tenant order-item editing; 87 authenticated endpoints with no role restriction exposing financials/PII to WAITER/CASHIER; cross-tenant Bull Board; SSRF webhook URLs; inert rate limiting; unauthenticated Redis/Postgres in the shipped prod compose; and a Docker CMD that never delivers SIGTERM to Node.

---

# P0 — CRITICAL (verified)

## P0-1. Customer retention analytics always 500s — raw SQL targets non-existent table `"Order"`

- **Category:** Runtime / SQL / functionality
- **File/Function/Line:** `apps/api/src/modules/customer-analytics/customer-analytics.service.ts`, `getRetention`, line 131
- **Root cause:** `Order` maps to table `orders` (`@@map("orders")`); the CTE quotes the Prisma model name as a case-sensitive identifier.
- **Impact:** `GET /customer-analytics/retention` fails unconditionally (`relation "Order" does not exist`).
- **Proof:** line 125 `FROM orders WHERE ...` (correct) vs line 131 `FROM "Order" o` (broken).
- **Reproduction:** call the retention endpoint.
- **Fix:** `FROM orders o`.
- **Regression risk:** none.

## P0-2. Wallet analytics dead — raw SQL targets non-existent table `"WalletTransaction"`

- **Category:** Runtime / SQL
- **File/Line:** same service, `getWalletAnalytics`, line 606
- **Root cause:** model `@@map("wallet_transactions")`.
- **Impact:** daily-spend trend query always throws; endpoint partially dead. Also `$3` placeholder is passed positionally with conditional dates (off-by-one when only `endDate` is set).
- **Proof:** line 606 `FROM "WalletTransaction" WHERE "tenantId" = $1`; lines 610–614 build a 1-, 2- or 3-param array against SQL that always references `$2`/`$3`.
- **Fix:** `FROM wallet_transactions`; parameterize placeholders consistently.
- **Regression risk:** none.

## P0-3. Referral analytics does not compile — `rewardAmount` does not exist

- **Category:** Compile/runtime schema mismatch
- **File/Line:** same service, `getReferralPerformance`, lines 653, 659, 678, 683
- **Root cause:** `Referral` model (`schema.prisma:1938-1966`) has `rewardPoints Int`/`rewardGiven Boolean` — **no `rewardAmount`** field or column anywhere.
- **Impact:** `tsc` fails; against a stale client, `column "rewardAmount" does not exist`.
- **Proof:** line 653 `select: { id, status, rewardAmount, referrerId, createdAt }`.
- **Reproduction:** `npx tsc --noEmit` in `apps/api`.
- **Fix:** use `rewardPoints` (Int) or add a real column via migration.
- **Regression risk:** low.

## P0-4. Migration `m4_4` blocks all non-empty databases — `NOT NULL updatedAt` without default

- **Category:** Deployment / migration
- **File:** `prisma/migrations/20260802120914_m4_4_soft_delete_updated_at/migration.sql` (lines 60, 64, 86, 93, 106, … 312: 31 tables)
- **Root cause:** `ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL` with no `DEFAULT` on tables that can already contain rows.
- **Impact:** `prisma migrate deploy` fails with `column "updatedAt" contains null values` on any populated DB; blocks m4_5/m4_5_1/m4_6 and therefore **deployment**.
- **Proof:** line 60 `business_exceptions ... ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL;`
- **Reproduction:** `migrate deploy` against non-empty DB.
- **Fix:** `DEFAULT CURRENT_TIMESTAMP` (then drop default) or backfill before adding NOT NULL.
- **Regression risk:** low if default matches `@updatedAt`.

## P0-5. Refund double-decrement race (manual refund vs gateway refund webhook / two concurrent refunds)

- **Category:** Money integrity / race
- **File/Function:** `apps/api/src/modules/payments/payments.service.ts`, `refund()` 432-503, `partialRefund()` 505-587, `applyWebhookRefunded()` 1115-1149
- **Root cause:** completion paths claim `PENDING` atomically (`updateMany`), but refund paths are check-then-act: status checked from a pre-transaction snapshot, then **unconditional** `tx.payment.update` + **unconditional** `tx.order.update({ paidAmount: { decrement } })`. The webhook path (1115-1141) does the same against COMPLETED. Both a manual refund and a Stripe/Paymob `charge.refunded` event (delivered async, with retries) can pass the check and **both** decrement.
- **Impact:** `order.paidAmount`/`tip` decremented twice for one refund → ledger undercounts (can go negative, no floor). Double-tap "Refund" on two devices reproduces it.
- **Proof:** lines 465-480 and 546-560 and 1126-1140 — no status-conditioned update; contrast atomic claim at 1028-1034.
- **Reproduction:** two concurrent `refund()` calls on one COMPLETED payment.
- **Fix:** atomic claim `payment.updateMany({ where: { id, status: { in: [COMPLETED, PARTIALLY_REFUNDED] } }, ... })`; only decrement order when `count === 1`.
- **Regression risk:** low; late webhook after manual refund becomes a no-op (desired).

## P0-6. Split payments: lost update on `order.paidAmount` + no payable-status guard + no version CAS

- **Category:** Money integrity / race / state machine
- **File/Function:** `payments.service.ts`, `splitPayment()` 646-829
- **Root cause:** order read once **before** the transaction (652); the credit writes an absolute `newTotalPaid = Number(order.paidAmount) + completedAmount` (773) from that stale snapshot with **no version claim** (unlike `charge()` 214-220) and no `payableStatuses` check (unlike `charge()` 185-188). It can race a `charge()`/webhook finalize or another split, and can mark a DRAFT/CANCELLED/VOIDED order COMPLETED (772-795).
- **Impact:** two cashiers splitting one order concurrently → both payments recorded COMPLETED but `paidAmount` reflects only one (money collected twice, ledger counts once); dead orders can be "paid"; `VOIDED→COMPLETED` transitions recorded.
- **Proof:** 652 (read outside tx) → 773 (stale absolute write) → 774 (`tx.order.update`, no `where: { version }`); 660-665 (no status check).
- **Reproduction:** `Promise.all([splitPayment(A,50), splitPayment(A,50)])` on a 100 order.
- **Fix:** inside tx: re-read order, conditional `updateMany({ where: { id, version } , data: { version: increment } })`, then `paidAmount: { increment: completedAmount }`; enforce payable status; 409 on conflict.
- **Regression risk:** medium (clients must handle 409/retry).

## P0-7. `GIFT_CARD` payment method credits orders without any gift-card balance check — free money

- **Category:** Financial fraud / broken integration
- **File:** `payments.service.ts` `charge()` 222-246, `splitPayment()` 687-695, `getProviderForMethod()` 1151-1159; `PaymentMethod` enum has `GIFT_CARD` (`schema.prisma:101`)
- **Root cause:** `getProviderForMethod` maps only CREDIT/DEBIT→stripe, MOBILE→paymob; everything else (GIFT_CARD, CASH) returns null → the "no provider" branch marks a payment **COMPLETED** and increments `paidAmount` with zero lookup/decrement of any card. The gift-card module is entirely disconnected from payments (grep `GIFT_CARD` in `apps/api/src` = 0 hits outside schema).
- **Impact:** any CASHIER pays any order with `method: GIFT_CARD, amount: <anything>` → free revenue; gift-card sales unreconcilable.
- **Proof:** 687-695 (non-provider branch creates COMPLETED payment); 1151-1159 (GIFT_CARD not mapped).
- **Reproduction:** `POST /orders/:id/payments {method:'GIFT_CARD', amount:9999}`.
- **Fix:** wire GIFT_CARD through a tenant-scoped atomic redeem (reuse `gift-cards.redeem` transaction) that decrements balance and credits the order in one tx.
- **Regression risk:** low.

## P0-8. Paid (COMPLETED) orders remain editable; total can be pushed below `paidAmount`

- **Category:** Financial integrity / state machine
- **File:** `orders.service.ts` `update()` 275-359, `applyDiscount`, `removeDiscount`, `applyServiceCharge`, `applyTaxRate`, `voidItem`; `order-state-machine.ts` 59-63
- **Root cause:** `isTerminalStatus` = {CANCELLED, REFUNDED, VOIDED} only — **COMPLETED is not terminal**. All mutators guard only with `isTerminalStatus`. `recalculateOrder` clamps `total >= 0` with no `paidAmount` floor.
- **Impact:** staff can lower quantities/prices/discounts after full payment → `total < paidAmount` (or raised), revenue silently altered; `paidAmount > total` with no invariant.
- **Proof:** `order-state-machine.ts:60` terminal list; `orders.service.ts:278` guard; `recalculateOrder:1422` `Math.max(0, total - discount)`.
- **Reproduction:** pay an order fully, then `PUT /orders/:id` with a quantity change → total drops below paidAmount.
- **Fix:** treat any order with `paidAmount > 0` (or COMPLETED) as non-editable without an explicit re-open/refund flow; enforce `total >= paidAmount` in `recalculateOrder`.
- **Regression risk:** low–moderate (add a correction endpoint).

## P0-9. Order-item/modifier edits are not scoped to the order or tenant (cross-tenant write)

- **Category:** IDOR / broken object-level authorization
- **File:** `orders.service.ts` `update()` 305-354
- **Root cause:** `tx.orderItem.update({ where: { id: itemDto.id } })` (328) and `orderItemModifier.update` (333) use client-supplied IDs with no `orderId`/`tenantId` verification; only the top-level order is tenant-checked.
- **Impact:** a caller with access to order A can modify (price/quantity/discount) items of order B, including another tenant's, given the UUID.
- **Proof:** line 328 bare `where: { id }`.
- **Reproduction:** `PUT /orders/A` with `items:[{ id: <item-of-order-B>, quantity: 0 }]`.
- **Fix:** scope updates `where: { id, orderId: id, tenantId }` after resolving item ownership.
- **Regression risk:** low.

## P0-10. Inventory deduction: ignores ordered quantity, deducts voided items, no status guard, not idempotent

- **Category:** Inventory / money / stock integrity
- **File:** `recipes.service.ts` `deductInventoryForOrder()` 488-638; `recipes.processor.ts` 21-64
- **Root cause:** orderItems fetched only for `productIds` (494-502); `quantityNeeded = Number(item.quantity)` per recipe, **never multiplied by `orderItem.quantity`** (541); no `voidedAt` filter (494-496); no order-status check (489-492); no idempotency (manual `POST /recipes/deduction/:orderId` + BullMQ retry re-deduct; movements have no unique key). `rollbackDeduction` (640-690) also isn't idempotent (reversal guard `notes NOT contains 'ROLLED_BACK'` never marks the original movement; async deduct vs sync rollback can race).
- **Impact:** ordering 5 burgers deducts ingredients for 1; voided lines consume stock; retries double-deduct; a cancel before the queue job runs then deducts a cancelled order. Stock ledger permanently wrong.
- **Proof:** 541 (`Number(item.quantity)` inside recipe loop only); 494-496 (no `voidedAt`); `recipes.processor.ts:21` (`@OnEvent('order.completed')` only).
- **Reproduction:** complete an order with qty 5; inspect CONSUMPTION movement.
- **Fix:** map recipes→orderItems, multiply by quantity, exclude voided items, add `(referenceType, referenceId, inventoryItemId)` uniqueness or a processed flag, add status guard.
- **Regression risk:** medium (needs stock data reconciliation after fix).

## P0-11. Payment-completed orders never trigger inventory deduction

- **Category:** Inventory / eventing
- **File:** `payments.service.ts` (completes orders, emits `payments.completed` at 813, 1089); `recipes.processor.ts:21` (listens only to `order.completed`)
- **Root cause:** every payment path that auto-completes an order emits `payments.completed`; the sole deduction listener subscribes to `order.completed`, which only `orders.service.changeStatus` emits (manual completion).
- **Impact:** card-paid orders (the common path) are never deducted from stock; manual completions are — inconsistent, overstated inventory.
- **Proof:** grep shows exactly one `@OnEvent('order.completed')` and zero `@OnEvent('payments.completed')`.
- **Fix:** emit `order.completed` (or add a `payments.completed` listener) from the same transaction that auto-completes.
- **Regression risk:** low.

---

# P1 — HIGH (verified / cross-verified)

## P1-1. 87 authenticated endpoints have no `@Roles`/`@Permissions`; `RolesGuard` fails open

- **Category:** Broken access control (in-tenant privilege escalation / PII & financial exposure)
- **File:** `common/guards/roles.guard.ts:26-28` (`if (!hasRoles && !hasPermissionCheck) return true;`); examples: `customers.controller.ts` (14 GETs incl. wallet/loyalty/PII), `inventory.controller.ts` (13 GETs incl. low-stock/costing-adjacent), `dashboard.controller.ts` (7), `live-analytics.controller.ts` (6), `warehouses.controller.ts` (6), `purchasing.controller.ts` (5, POs/GRNs = supplier pricing), `transfers.controller.ts` (5), `recipes.controller.ts` (4, incl. cost breakdown), `forecasting.controller.ts` (4), `supplier-performance.controller.ts` (4), `export-engine.controller.ts` (3, incl. file download), `barcodes`, `cycle-counts`, `costing`, `scheduled-reports`, `crm` timeline, `campaigns` validate.
- **Impact:** WAITER/KITCHEN/CASHIER/VIEWER can read financial analytics, purchase costs, recipe margins, customer wallet/PII, and download export files. Tenant isolation at the service layer is strong (verified), so impact is in-tenant data exposure.
- **Proof:** `roles.guard.ts:26-28`; e.g. `GET /customers/:id/wallet` and `GET /export-engine/exports/:id/download` carry no role decorator.
- **Reproduction:** login as WAITER, call `GET /api/v1/customers` and `GET /api/v1/dashboard/valuation-summary`.
- **Fix:** deny-by-default in RolesGuard (or add minimum-role), then role-gate every listed endpoint (analytics/dashboards → OWNER/MANAGER/VIEWER; customer PII → OWNER/MANAGER/STAFF/CASHIER; financial/export → OWNER/MANAGER).
- **Regression risk:** low (may need to audit each endpoint).

## P1-2. Bull Board exposes all tenants' queue jobs to any tenant OWNER

- **Category:** Cross-tenant data exposure / DoS
- **File:** `common/bull-board/bull-board.module.ts:103-106`
- **Root cause:** auth verifies JWT + `role === 'OWNER'` only; BullMQ is a single shared namespace with no tenant scoping.
- **Impact:** any tenant OWNER can read job payloads (webhook deliveries with order/customer PII, email jobs with reset tokens) and pause/retry/discard every tenant's jobs. Also: board trusts the JWT `role` claim without re-fetching the user → a demoted user retains access for the token lifetime.
- **Proof:** line 103 `if (payload.role !== 'OWNER')`.
- **Fix:** SUPER_ADMIN/ops-only; re-fetch user from DB; never expose raw payloads.
- **Regression risk:** low.

## P1-3. SSRF via tenant-supplied webhook URLs

- **Category:** A9 SSRF
- **File:** `webhooks/webhook-processor.ts:69` (`axios.post(registration.url, ..., { headers })`); `webhooks.service.ts` (stored/updated), `create-webhook.dto.ts:19` (https-only, no host/range validation)
- **Impact:** server-side POST to internal HTTPS hosts, private ranges, DNS-rebinding targets; up to 5 retries amplifies internal DoS; response bodies persisted in delivery logs.
- **Proof:** line 69 with `validateStatus: () => true` and user-controlled `headers` merged at line 63.
- **Fix:** resolve+validate host → reject private/link-local/reserved; re-resolve at send time; cap redirects; strip `Host`/`X-Forwarded-*` from user headers.
- **Regression risk:** medium (allowlist needed for legit CDN targets).

## P1-4. Rate limiting is bypassable: `@Throttle` inert (ThrottlerGuard not registered); PlanThrottle keyed on `request.url` (incl. query string)

- **Category:** A4 Rate limiting / abuse
- **File:** `app/app.module.ts:240-256` (only JwtAuth/Roles/Tenant/PlanThrottle registered — no ThrottlerGuard); `common/guards/plan-throttle.guard.ts:62`
- **Impact:** `@Throttle(register 20/min, login 30/min, forgot 3/min)` decorators are decorative; attackers reset plan/IP counters by rotating query params (`?r=1..N`). Brute force and account-abuse protections far weaker than documented.
- **Proof:** `plan-throttle.guard.ts:62` `${keyPrefix}:${request.url}`; grep: no `ThrottlerGuard` anywhere.
- **Fix:** register ThrottlerGuard or remove dead decorators; key the plan limiter on path without query string (per IP+user).
- **Regression risk:** low.

## P1-5. Account lockout is a trivial DoS and enumerates accounts (5 fails → 15 min)

- **Category:** A4 / availability + enumeration
- **File:** `auth.service.ts:199-226` (lockout after 5 bad passwords); `:160-162` (unknown email returns immediately vs bcrypt compare for known → timing oracle)
- **Impact:** anyone with a known email can lock the account out indefinitely (repeat every 15 min); attacker can distinguish registered emails by response timing; no per-IP cap compounds with P1-4.
- **Fix:** per-IP backoff before account lockout; short temporary locks; uniform bcrypt cost on unknown-email path.
- **Regression risk:** medium.

## P1-6. Access-token revocation is ineffective — blacklist never populated

- **Category:** AUTHN session/token revocation
- **File:** `redis/redis.service.ts:71` (`blacklistToken` defined; only used in tests); `auth.service.ts` logout/logoutAllDevices/changePassword/resetPassword/disableTwoFactor
- **Impact:** a stolen access token survives password change, "log out all devices", and 2FA disable for up to 15 min (`JWT_EXPIRATION`), enabling account takeover (compounds P1-7).
- **Proof:** grep — `blacklistToken` appears only in definition + specs.
- **Fix:** call `blacklistToken(payload.jti, ttl)` on logout/reset/2FA changes; or check `iat` vs `lastPasswordChange`.
- **Regression risk:** low.

## P1-7. 2FA setup/disable require no password; token revocation unavailable → takeover

- **Category:** AUTHN 2FA lifecycle
- **File:** `auth.service.ts` `setupTwoFactor`/`enableTwoFactor` 685-741
- **Root cause:** any authenticated user (or holder of a stolen token, per P1-6) can overwrite `twoFactorSecret` and enable their own 2FA without the current password; disable requires only a TOTP code.
- **Impact:** attacker enrolls their 2FA → legitimate owner locked out; password reset still blocks at the 2FA step.
- **Fix:** require `currentPassword` (+ re-issue tokens) for 2FA setup/enable/disable.
- **Regression risk:** medium (UX).

## P1-8. Refresh tokens stored in plaintext (and invitation tokens plaintext)

- **Category:** A2 secrets at rest
- **File:** `auth.service.ts:815` (`token: randomBytes(40).toString('hex')` stored raw, looked up raw); `invitations.service.ts:66-74` (raw token in DB + Redis)
- **Impact:** a DB read → full session hijack / accept any pending invitation up to OWNER role; contrast reset/verify tokens which are SHA-256 hashed.
- **Proof:** line 815.
- **Fix:** store SHA-256 and index it; rotate existing rows.
- **Regression risk:** medium (migration of existing rows).

## P1-9. Paymob `gatewayRef` identity mismatch breaks refunds/voids/webhooks for sync-succeeded payments

- **Category:** Provider integration
- **File:** `paymob.provider.ts` `confirmPayment` 225-247 (`transactionId: String(tx.id)`), `parseWebhookEvent` 450-464 (`reference = String(orderId ?? obj.id ?? obj.transaction_id)`); `payments.service.ts` `charge()` 341 (`gatewayRef = confirmed.transactionId ?? intentResult.data.id`)
- **Root cause:** `createPaymentIntent` returns the Paymob **order id**; a synchronously-succeeded confirm returns the **transaction id**, which `charge()` stores as `gatewayRef`. Webhook/refund/void lookups prefer the order id → mismatch.
- **Impact:** Paymob refunds/voids fail (`no transaction found`) and success webhooks are dropped for every payment confirmed synchronously.
- **Proof:** 236 (tx id returned) vs 463-464 (order id preferred) vs 341 (tx id stored).
- **Fix:** store one canonical external id (order id) everywhere; resolve transaction via inquiry for refund/void.
- **Regression risk:** low.

## P1-10. Refund idempotency keys are amount-blind; splits have no client idempotency key

- **Category:** Idempotency / duplicate charges
- **File:** `payments.service.ts` `refund()` 456 (`refund_${payment.id}`), `partialRefund()` 537 (`partial_refund_${payment.id}`), `splitPayment()` 673 (`randomUUID()`)
- **Root cause:** partial-refund key is constant per payment → Stripe returns the cached first refund while the service decrements the new amount (ledger ≠ gateway); splits generate a fresh UUID and accept no client key → any retry duplicates every split/charge.
- **Impact:** silent ledger/gateway divergence; duplicate charges on retry after timeout.
- **Fix:** key = `..._${payment.id}_${amount}_${nonce}`; add an idempotency field to `SplitPaymentDto` and dedupe whole splits like `charge()`.
- **Regression risk:** low–medium.

## P1-11. Partial refunds can over-refund; cumulative refunded amounts not tracked

- **Category:** Refund correctness
- **File:** `payments.service.ts` `partialRefund()` 519-525; `applyWebhookRefunded()` 1119-1140
- **Root cause:** validation is only `dto.amount > payment.amount` (no cumulative refunded total — no column, no sum); Stripe's cumulative `charge.refunded` webhook is skipped once status is PARTIALLY_REFUNDED (1119) so subsequent refunds never hit the ledger.
- **Impact:** over-refund accepted (mock) or under-credited ledger (webhook-driven); `paidAmount` can go negative.
- **Fix:** add `refundedAmount` column; validate `dto.amount + refundedAmount <= payment.amount`; process per-refund events.
- **Regression risk:** low.

## P1-12. Split payment holds a DB transaction across up to 20 gateway HTTP calls (15 s each)

- **Category:** Availability / transaction anti-pattern
- **File:** `payments.service.ts` `splitPayment()` 667-799
- **Impact:** a single split tx can hold a connection for minutes → pool exhaustion under load; any non-HTTP throw mid-loop rolls back already-"completed" CASH splits.
- **Fix:** create/claim payment rows and gateway calls in short transactions; keep the order credit in a final short tx.
- **Regression risk:** high if done carelessly (recommend split-only change).

## P1-13. Inventory stock writes are read-modify-write without atomic guards (TOCTOU) across 5+ functions

- **Category:** Concurrency / stock integrity
- **File:** `inventory.service.ts` `createAdjustment` 672-731, `approveAdjustment` 753-807, `createWasteEntry` 876-959; `purchasing.service.ts` `cancelGRN` 1009-1020; `transfers.service.ts` `startTransfer` 378-394; `cycle-count.service.ts` `reconcile` 267-277
- **Root cause:** read `currentQuantity` → absolute `newCurrent` write; `version: { increment }` is applied but never checked in `where`; pre-checks run against stale pre-tx snapshots.
- **Impact:** concurrent waste/GRN/transfer/adjustment on the same item silently lose updates; negative stock when two guarded checks pass before either decrement.
- **Fix:** conditional `decrement`/`increment` with `gte` guards (or `updateMany` CAS on version).
- **Regression risk:** medium.

## P1-14. GRN over-receiving not blocked; lines not validated against the PO

- **Category:** Procurement integrity
- **File:** `purchasing.service.ts` `createGRN` 668-809 (line 713-719 `purchaseOrderItem.update({ where: { id } , data: { receivedQuantity: { increment } } })`, no cap, no `purchaseOrderId`/`inventoryItemId` membership check)
- **Impact:** unlimited over-receipt inflates stock; a GRN can bump another PO's receivedQuantity; duplicate lines double-apply.
- **Fix:** validate all line IDs against PO items; enforce `receivedQuantity + qty <= quantity`.
- **Regression risk:** medium.

## P1-15. Cross-tenant delete in warehouses

- **Category:** IDOR / destructive cross-tenant write
- **File:** `warehouses.service.ts` `removeBranch` 638-646 (mapping query has no `tenantId`)
- **Impact:** any OWNER/MANAGER can delete another tenant's warehouse↔branch mapping given two UUIDs.
- **Fix:** resolve the warehouse with `tenantId` before the mapping query.
- **Regression risk:** low.

## P1-16. Dashboard/live-analytics expose financial/inventory data to low roles

- **Category:** Broken access control
- **File:** `dashboard.controller.ts` (all routes), `live-analytics.controller.ts` (all routes)
- **Impact:** WAITER/STAFF can read valuation, COGS, turnover, supplier performance, reorder alerts.
- **Fix:** `@Roles('OWNER','MANAGER','VIEWER')` (or permission decorators).
- **Regression risk:** low.

## P1-17. Compose ships unauthenticated Redis + default-password Postgres bound to host

- **Category:** Secrets / exposure
- **File:** `docker/docker-compose.prod.yml` lines 10-13, 28-29, 39, 55
- **Impact:** any host/network process can connect to Postgres with `tablofy_prod` default and to Redis with no password — reading sessions, refresh-token maps, JWT blacklists, cache, BullMQ jobs (incl. password-reset token bodies, P1-18) and purging the DLQ.
- **Proof:** `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-tablofy_prod}`; `ports: 5432`; `ports: 6379`; `command: redis-server --appendonly yes` (no requirepass).
- **Fix:** require `POSTGRES_PASSWORD` (no default), bind ports to 127.0.0.1 or drop publishing, start Redis with `--requirepass`.
- **Regression risk:** medium — must fix P1-19 simultaneously.

## P1-18. Plaintext reset/verify tokens persist in Redis job data and the 7-day dead-letter queue

- **Category:** Secrets at rest
- **File:** `auth.service.ts:416-424,622-630` (token embedded in email body → stored as `job.data`); `queue.service.ts:52` (`dead-letter` retains jobs 7 days)
- **Impact:** tokens granting password reset / email verification recoverable from Redis or backups (compounds unauthenticated Redis, P1-17).
- **Fix:** store only a reference/id in the email job; redact job data; shorter email/DLQ retention.
- **Regression risk:** medium.

## P1-19. BullMQ ignores Redis auth/TLS entirely — enabling Redis password silently kills all queues

- **Category:** Config drift / availability
- **File:** `queue.service.ts:66-76` (connection built from host/port only; `password`/`tls`/`redis.url` never passed, while `redis.service.ts` does use them)
- **Impact:** hardening Redis (as P1-17 suggests) makes every queue/worker silently unable to connect while `/health` stays green; emails, webhooks, cleanup, campaigns stop.
- **Fix:** share one connection factory between RedisService and QueueService; fail health when queues are unreachable.
- **Regression risk:** low–medium.

## P1-20. Webhook delivery retries have no backoff; failing webhooks are hammered 5× instantly

- **Category:** Queue reliability
- **File:** `webhook-processor.ts:102-116` (on failure: markFailed, enqueue `webhook-retry` immediately, **return without throwing** → job COMPLETED); `webhook-delivery.service.ts:155-161` (`getPendingRetries` = dead code, no callers)
- **Impact:** `attempts:5`/backoff on the delivery job is never exercised; failing endpoints hit 5× back-to-back then DEAD_LETTER.
- **Fix:** throw on transient failure so BullMQ backoff drives retries, or apply `delay`; remove dead `getPendingRetries`.
- **Regression risk:** medium.

## P1-21. Webhook delivery payloads (PII) retained forever; cleanup never runs

- **Category:** Data retention / GDPR
- **File:** `webhook-delivery.service.ts:177-186` (`cleanupOldDeliveries` defined, never invoked); `queue/cleanup.processor.ts:72-81` (deletes only FAILED rows)
- **Impact:** DELIVERED/DEAD_LETTER deliveries with customer order/contact data accumulate unboundedly.
- **Fix:** schedule `cleanupOldDeliveries` for DELIVERED+DEAD_LETTER.
- **Regression risk:** low.

## P1-22. Silent no-op processors: campaigns, CRM/notifications, kitchen, print, dead-letter only log and succeed

- **Category:** Silent functional gap
- **File:** `campaigns/campaigns.processor.ts:13-39`, `crm/crm.processor.ts:13-31`, `queues/{notification,kitchen,print,dead-letter}.processor.ts`
- **Impact:** jobs report completed while campaign sends, notifications, kitchen printing never happen; DLQ has no alerting; `JSON.stringify(payload)` logs PII.
- **Fix:** implement real handlers or fail loudly; add a DLQ alert channel.
- **Regression risk:** low (product decision).

## P1-23. Customer/CRM analytics had cross-tenant aggregation; spend-wallet race

- **Category:** Tenant isolation / money
- **File (audited pre-fix, reverted — bug present in tree):** `crm-analytics.service.ts:48` aggregate lacked `where: { tenantId }` (sums every tenant's revenue); `customers.service.ts` `spendWallet:841` was check-then-decrement.
- **Note:** a worker temporarily patched these during the audit; the changes were **reverted** (stash `audit-agent-unrequested-changes`). The original defects are present in the audited tree.
- **Impact:** analytics dashboards show cross-tenant totals; wallet spend can overshoot balance under concurrency.
- **Fix:** re-apply the tenant-scoped aggregates and the atomic `updateMany({ where: { balance: { gte } } })` decrement (as a remediation task, not during an audit).
- **Regression risk:** low.

## P1-24. `m4_6` Decimal(65,30)→Decimal(10,2) precision narrowing with no data pre-check

- **Category:** Migration / data-loss risk
- **File:** `prisma/migrations/20260802180442_m4_6_decimal_precision/migration.sql`
- **Impact:** silent rounding of >2-decimal values; overflow error for values ≥ 100,000,000.
- **Fix:** pre-flight range/precision query before migrate.
- **Regression risk:** none if pre-flight passes.

---

# P2 — MEDIUM (consolidated)

| #     | Category       | File / Function / Line                                                                                                                                                                                                                | Issue                                                                                                                                      |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-1  | Soft-delete    | `payments.service.ts` `splitPayment` 652-654                                                                                                                                                                                          | Order lookup omits `deletedAt: null` → splits on soft-deleted orders                                                                       |
| P2-2  | Webhook        | `payments.service.ts` `applyWebhookFailed/Refunded` 1096-1149                                                                                                                                                                         | Lookup by `gatewayRef` only, no `tenantId`; refund path doesn't revalidate status/amount                                                   |
| P2-3  | State machine  | `payments.service.ts` `voidPayment` 618-641                                                                                                                                                                                           | Void writes `FAILED` + failure metrics + `payments.failed` (no VOIDED enum); `processedAt` never set                                       |
| P2-4  | Dead code      | `payment-state-machine.ts`                                                                                                                                                                                                            | `validatePaymentTransition` never imported; matrix bypassed (ad-hoc predicates only)                                                       |
| P2-5  | Money math     | `payments.service.ts` 291/701                                                                                                                                                                                                         | Hard-coded `currency: 'usd'` for Paymob (EGP market); no per-tenant currency                                                               |
| P2-6  | Timeouts       | `charge()` 298-325; `splitPayment` 708-768; `applyWebhookSucceeded` 1014                                                                                                                                                              | Gateway timeout → hard `FAILED`; webhook can't recover (PENDING-only gate) → double charge on retry                                        |
| P2-7  | Reconciliation | `reconcile()` 920-937                                                                                                                                                                                                                 | `provider=pending & local=PENDING` counted as consistent forever; no PENDING reaper                                                        |
| P2-8  | Audit          | `applyWebhookSucceeded/Failed/Refunded`                                                                                                                                                                                               | No audit rows for webhook-driven state changes                                                                                             |
| P2-9  | Mock/live      | `payments.module.ts` 21-23/46-48                                                                                                                                                                                                      | Silent live→mock downgrade on missing key (only caught in NODE_ENV=production)                                                             |
| P2-10 | Money          | `payments.service.ts` 474-480/555-560/1134-1140                                                                                                                                                                                       | `paidAmount` can go negative (no floor); tip handling inconsistent across refund types                                                     |
| P2-11 | Events         | `splitPayment` 801-826                                                                                                                                                                                                                | Re-emits `payments.completed`/metrics for payments already completed by webhook (double count)                                             |
| P2-12 | Idempotency    | `charge()` 199-204; schema 1202                                                                                                                                                                                                       | Idempotency key scoped to tenant only, not orderId → cross-order reuse returns wrong payment                                               |
| P2-13 | Money          | gift-cards `recharge()` 92-112                                                                                                                                                                                                        | Read-modify-write outside transaction; absolute balance write; ledger balanceBefore/After from stale snapshot (redeem is correctly atomic) |
| P2-14 | Gift cards     | `redeem()` 152-165                                                                                                                                                                                                                    | No unique `(tenantId, referenceId, referenceType)` → duplicate redemption replay                                                           |
| P2-15 | Gift cards     | `generateCode` 196-198                                                                                                                                                                                                                | 48-bit entropy; P2002 collision no retry; no expiry sweep job; no transfer feature                                                         |
| P2-16 | Billing        | `orders.service.ts` `create` 84-90                                                                                                                                                                                                    | Initial `total` excludes `deliveryFee` (added by later recalc) → fee not charged until next touch                                          |
| P2-17 | Billing        | `orders.service.ts` `create` 72/123; `duplicateOrder`                                                                                                                                                                                 | Modifier money excluded from order subtotal/total at creation while `item.total` includes it → totals jump on recalc                       |
| P2-18 | Routing        | `payments.controller.ts` 42 vs 104                                                                                                                                                                                                    | `@Get(':id')` declared before `@Get('reconcile')` → `GET /payments/reconcile` captured by `:id` → unreachable (404)                        |
| P2-19 | Concurrency    | `applyServiceCharge`, `applyTaxRate`, `moveTable`, `splitOrder`, `mergeOrders`, `addNote`                                                                                                                                             | No version claim → lost-update races vs versioned writers                                                                                  |
| P2-20 | Math           | `orders.service.ts` `update` 318-326 vs `create` 107-110                                                                                                                                                                              | Modifier-total formula differs (Σ price·modQty vs Σ price·itemQty) → inconsistent line totals                                              |
| P2-21 | Order num      | `orders.service.ts` `create` 69-71                                                                                                                                                                                                    | `generateOrderNumber` (max+1) outside create tx → concurrent P2002 500, no retry                                                           |
| P2-22 | State          | `orders.service.ts` `softDelete` 1171-1199                                                                                                                                                                                            | Soft-deletes paid/COMPLETED orders with no refund/rollback guard; restore unconditional                                                    |
| P2-23 | Split          | `orders.service.ts` `splitOrder` 671-790                                                                                                                                                                                              | Moving full quantity leaves source item unchanged → item duplicated; modifiers not copied; voided items resurrect; no version guard        |
| P2-24 | Refund sync    | `refund()` 474-480 + `changeStatus` 403-433                                                                                                                                                                                           | Refunding a payment never touches order status/history/events; order can be REFUNDED while payments stay COMPLETED                         |
| P2-25 | State          | `changeStatus→COMPLETED` requires no payment; COMPLETED un-payable                                                                                                                                                                    | Mis-clicked completion of unpaid order cannot be paid or reopened                                                                          |
| P2-26 | Tenant         | `orders.service.ts` `update` 292                                                                                                                                                                                                      | `table = { connect: { id: dto.tableId } }` without tenant/branch existence check (P2025 500)                                               |
| P2-27 | Tenant         | `orders.service.ts` `addNote` 637-669                                                                                                                                                                                                 | Note created on client-supplied orderId with no ownership check (cross-tenant write)                                                       |
| P2-28 | Costing        | `costing.service.ts` 162-172                                                                                                                                                                                                          | Weighted-average cost sums `unitCost` instead of `qty·unitCost` when averageCost=0                                                         |
| P2-29 | Cycle count    | `cycle-count.service.ts` 242-299                                                                                                                                                                                                      | Reconcile can double-run (status checked pre-tx); no StockMovement created for variance                                                    |
| P2-30 | Forecasting    | `forecasting.service.ts` 416-432/214-285                                                                                                                                                                                              | Average daily consumption divides by fixed 30 days (young items under-forecast); reorder suggestions duplicated                            |
| P2-31 | Batch          | `inventory.service.ts` `createBatch` 1103-1140                                                                                                                                                                                        | Batch creation never touches `currentQuantity` → perpetual mismatch                                                                        |
| P2-32 | Transfer       | `transfers.service.ts` 445-533                                                                                                                                                                                                        | Zero/partial receive lines; partial receive closes the transfer (shortfall lost); duplicate lines double-add                               |
| P2-33 | GRN cancel     | `purchasing.service.ts` 980-1051                                                                                                                                                                                                      | Cancels COMPLETED GRNs post-consumption; reversal clamps negative away; batch `updateMany` corrupts batches                                |
| P2-34 | Metrics        | `incrementOrdersCompleted` fires per payment (split loop)                                                                                                                                                                             | Dashboard order-completion inflation                                                                                                       |
| P2-35 | Validation     | `export-engine.controller.ts` 37-41 (raw `Record<string, unknown>`), `campaigns.controller.ts` 163-171 (raw body), `generate-export.dto.ts` `reportType` (no `@IsEnum`), `transfers.controller.ts` 122-143 (unvalidated inline query) | Unvalidated input reaching query builders; invalid enums → 500                                                                             |
| P2-36 | Dead code      | `common/guards/tenant-body.guard.ts` (never registered); `TenantMiddleware` (runs before guards, `req.user` unset); `TransformResponseInterceptor` (defined, not registered); `REDIS_URL` (never used)                                | Misleading/no-op infrastructure                                                                                                            |
| P2-37 | Roles          | `recipes.controller.ts` uses `'CHEF'`, `purchasing.controller.ts` uses `'PURCHASING'`                                                                                                                                                 | Neither exists in `UserRole` enum → intended role checks silently restrict to OWNER/MANAGER                                                |
| P2-38 | CI             | `.github/workflows/docker-publish.yml`                                                                                                                                                                                                | Image published with no `needs:` gating on CI; actions pinned to mutable major tags; no image SCA                                          |
| P2-39 | Health         | `bull-health.indicator.ts:13`                                                                                                                                                                                                         | Covers only 5 of 15+ queues → `/ready` green while webhook/campaign processing dead                                                        |
| P2-40 | Queues         | `queue.controller.ts:12-17`                                                                                                                                                                                                           | Any OWNER/MANAGER can get stats for any queue by name; `getQueue(name)` materializes arbitrary queue instances (resource amplification)    |
| P2-41 | Redis          | `cache.service.ts:19`, `redis.service.ts:119/170`                                                                                                                                                                                     | Unguarded `JSON.parse` on cached values → corrupt cache 500s requests                                                                      |
| P2-42 | Perf           | `plan-throttle.guard.ts:50-53`                                                                                                                                                                                                        | Per-request Prisma subscription lookup on the hot path                                                                                     |
| P2-43 | Tenancy        | schema `Referral @@unique([code])`                                                                                                                                                                                                    | Global uniqueness + soft-delete → tenant B can never reuse a code tenant A claimed (even deleted)                                          |

---

# P3 — LOW (selected)

- `stripe.provider.ts:338-360` & `paymob.provider.ts:403-446` — webhook signature has no timestamp age check (replay window).
- `metrics.controller.ts` — `/metrics` open when token unset; health/live/ready + `/docs` (Swagger) unauthenticated.
- `email verification optional` — register() never creates an EMAIL_VERIFICATION token; login/JWT don't check `emailVerified`.
- `payment-webhooks.controller.ts:37-39` — Paymob HMAC read from body (`body.hmac`) rather than an `hmac` header (fail-closed risk in real gateway delivery).
- `voidPayment` sets `refundReason` and skips `processedAt`; `getPaymentStatus` cents/dollars mismatch across providers (stripe cents vs paymob dollars); float `Number(Decimal)` comparisons for completion thresholds.
- `allergen remove` uses POST/201 (should DELETE); nutrition upsert always 201; `2fa/setup` returns 200 (creation); audit-logs `page/limit` unguarded parseInt.
- Scheduler: `cleanup_expired_tokens` cron duplicated (EVERY_12_HOURS + 2am); `@SkipPlanThrottle` decorator is a no-op; feature-flag keys not namespaced; CSP allows `'unsafe-inline'`; `CORS_CREDENTIALS=true` + `origin: true` outside production.
- `CacheService.getOrSet` has no single-flight (thundering herd on cold analytics).
- Lint currently fails (7 prettier errors, auto-fixable, spec file only). Coverage ≈ 20% lines; 57 services untested; providers excluded from coverage; integration specs use mocked Prisma (no real DB).

---

# VERIFIED OK (positives, confirmed from source)

1. **Payment completion claim is atomic** — `finalizeSucceededPayment`, `applyWebhookSucceeded`, and split's success branch all `updateMany({ where: { id, status: PENDING } })`; charge-vs-webhook and duplicate-webhook cannot double-credit the same payment; `PaymentAlreadyFinalizedError` handled.
2. **Cash `charge()` path is version-CAS guarded** (214-220) — sequential-concurrency double-credit prevented (split path is the gap, P0-6).
3. **Stripe/Paymob HMAC verification is correct** (parsing, `timingSafeEqual`, raw body via `rawBody: true`); unknown webhook events return 200 no-op without crashing; FAILED webhooks only touch PENDING.
4. **HTTP timeouts exist** on both providers (15 s); cents conversion consistent at the service boundary; no unbounded provider hangs.
5. **Gift-card `redeem()` is atomic** — `updateMany({ where: { currentBalance: { gte } } })` + decrement in one transaction; balance cannot go negative; cross-tenant blocked.
6. **Tenant isolation at service layer is consistently strong** across orders, inventory, customers, payments (all reads `findFirst({ id, tenantId })`); no input DTO accepts `tenantId` (only a response DTO). `SuperAdmin` cross-tenant read is by design but **unlogged/undifferentiated** (see security report F18).
7. **Password storage**: bcrypt cost 12; reset/verify tokens 256-bit, SHA-256-hashed at rest, single-use; refresh rotation + reuse detection revokes all sessions.
8. **TOTP** is RFC 6238-correct (SHA1, 30 s, 6 digits, 20-byte secrets), enforced at login when enabled.
9. **RBAC hierarchy** (`canAssignRole`/`canManageUser`) enforced in users/invitations create/update and re-validated at invitation accept; JWT re-fetches role/status/tenant/subscription from DB on every request (except Bull Board).
10. **Global hardening**: `ValidationPipe(whitelist, forbidNonWhitelisted, transform)`, helmet+HSTS+CSP, request redaction logger, audit interceptor (no body/header capture), exception filter hides internals, `X-Correlation-Id`.
11. **Env validation** enforces production: JWT ≥32 chars, `METRICS_AUTH_TOKEN ≥16`, `WEBHOOK_ENCRYPTION_KEY ≥32`, `PAYMENTS_MODE=mock` forbidden, CORS wildcard rejected.
12. **Indexes are comprehensive** — `[tenantId, createdAt]`, `Order[tenantId,status,createdAt]`, Payment uniques, StockMovement `[referenceType,referenceId]`, GiftCard `[code]`; no missing index identified on hot paths.
13. **Redis usage**: SCAN (never KEYS), bounded retry strategy, tenant namespaced cache keys, RedisLock (`SET NX PX` + Lua) around all crons.
14. **No debug leftovers**: zero `console.log`/`debugger`/empty `catch`/TODO/FIXME in src; no unbounded `findMany`; all raw SQL parameterized.

---

## Priority remediation order

1. P0-1..P0-3 (analytics SQL + compile) — 30 min
2. P0-4 (m4_4 default) — blocks all deploys
3. P0-5/P0-6/P0-7 (refund/split/GIFT_CARD money integrity)
4. P0-8/P0-9 (order post-payment editing + item IDOR)
5. P0-10/P0-11 (inventory deduction)
6. P1-1..P1-4 (authz deny-by-default, Bull Board, SSRF, rate limiting)
7. P1-5..P1-8 (login lockout/timing, revocation, 2FA, token-at-rest)
8. P1-9..P1-12 (paymob identity, refund idempotency, split tx)
9. P1-13..P1-19 (stock TOCTOU, GRN, warehouses, compose hardening, BullMQ Redis auth)
10. P1-20..P1-22 (webhook retries/retention, no-op processors)
