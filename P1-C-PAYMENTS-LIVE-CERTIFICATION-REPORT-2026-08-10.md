# P1-C PAYMENTS LIVE CERTIFICATION REPORT

**Date:** 2026-08-10
**Repository:** `tablofy` monorepo — `D:\New folder (8)\tablofy`
**Scope:** P1-C — payments live sanity & production certification: charge / refund / partial-refund / void / webhooks / idempotency / concurrency / RBAC, verified against the real `tablofy_prod` database through the live Docker API.
**Method:** Every claim below was verified against the real running stack (`tablofy-api` / `tablofy-redis` / `tablofy-postgres`, `GET /api/v1/health` → 200, `PAYMENTS_MODE=live`) via direct SQL on `tablofy_prod` plus HTTP calls, signed Stripe webhooks with locally computed HMACs, and concurrent request runs. Unit/integration tests were run for regression. Gateway API calls are BLOCKED (placeholder key `sk_live_dev_…`), so provider-network claims are explicitly marked BLOCKED; all DB / state-machine / idempotency / concurrency claims are real-DB verified.

---

## 1. Executive Summary

| Area                                                             | Result                                                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Payments charge flow (CASH) — partial, tip, auto-complete, audit | **PASS** (live)                                                                                                                    |
| Idempotency — same-order replay                                  | **PASS** (live)                                                                                                                    |
| Idempotency — concurrent duplicate charges                       | **PASS** (live, 5× parallel, single credit)                                                                                        |
| Idempotency — cross-order key reuse                              | **FIXED** (bug P1C-1, live-verified)                                                                                               |
| Partial refund — exact remaining balance                         | **FIXED** (bug P1C-2, live-verified)                                                                                               |
| Webhook refunds — `amountRefunded` ledger                        | **FIXED** (bug P1C-3, live-verified)                                                                                               |
| Webhook refund replay — double-decrement                         | **FIXED** (bug P1C-4, live-verified)                                                                                               |
| Webhook signature / replay / state transitions                   | **PASS** (live, raw-body HMAC)                                                                                                     |
| Webhook delivery (outbox→queue→HTTP)                             | **PASS** (fixes P1C-5/P1C-6 from earlier session, live E2E)                                                                        |
| Void — guard + provider wiring                                   | **PASS** (provider call BLOCKED by placeholder key)                                                                                |
| RBAC route matrix                                                | **PASS** (live)                                                                                                                    |
| Unit / integration tests                                         | **PASS — 72 suites, 825 tests**                                                                                                    |
| TypeScript / lint / build                                        | **PASS**                                                                                                                           |
| Prisma validate / migrate status                                 | **PASS** — schema valid, 21 migrations up to date                                                                                  |
| Test-data hygiene                                                | Restored to baseline: 0 test payments, 0 P1C orders, 0 P1C users, 0 test webhooks/deliveries; 4 pre-existing fixture orders intact |

**Verdict: ⚠️ P1-C CERTIFIED WITH FIXES.** Four payments defects were discovered during live verification; all four were fixed, unit-tested, regression-tested, and **re-verified live** against the real database. No defects remain open from P1-C scope.

---

## 2. Bugs Found, Fixed & Verified

### P1C-1 — Idempotency key is tenant-global, not order-scoped (HIGH)

- **Severity:** HIGH — data-integrity / cross-order misattribution.
- **Root cause:** `Payment` has `@@unique([tenantId, idempotencyKey])` and `charge()` looks the key up by tenant only (`payments.service.ts:265`), returning the first payment regardless of the order it belongs to. The P2002 recovery path (`payments.service.ts:354`) had the same flaw.
- **Before:** Reusing key `p1c-concurrent-1` (bound to order `99704550…`, payment `6ea41e98…`) on a different order silently returned the _old order's_ payment (HTTP 200); the new order stayed underpaid with no indication.
- **Expected:** A client that reuses a key across orders must receive a clear error, not another order's payment.
- **Fixed:** `payments.service.ts:265-277` (pre-check) and `:354-366` (P2002 recovery) now compare `existing.orderId !== orderId` and throw `ConflictException('Idempotency key was already used for a different order')`. Same-order replay is unchanged (still returns the original payment). No schema change required.
- **Regression test:** `should reject reuse of an idempotency key for a different order` (`payments.service.spec.ts`).
- **Live verification:** order `f6013310…` charged with key `p1c-concurrent-1` → **409** with the new message; no payment row created. Same-order replay on order `894add64…` returned the identical payment `50ce274e…` both times (no regression).

### P1C-2 — Partial refund equal to the remaining balance is rejected (MEDIUM)

- **Severity:** MEDIUM — a valid refund is refused; `PARTIALLY_REFUNDED` can never reach `REFUNDED` via partials.
- **Root cause:** `partialRefund()` computed the claim cap as `maxAllowedRefunded = remaining - dto.amount` where `remaining = amount - alreadyRefunded` (`payments.service.ts:642` pre-fix), so refunding exactly the remaining balance produced a cap of `0` and the `updateMany` claim (`amountRefunded: { lte: 0 }`) always failed.
- **Before:** Payment with `amountRefunded=60` on a 100 payment: partial refund of 40 → **409** `Refund exceeds remaining refundable amount…`.
- **Expected:** Refunding exactly the remaining balance should succeed and accumulate `amountRefunded` to the full amount.
- **Fixed:** `payments.service.ts:648` now uses `maxAllowedRefunded = Number(payment.amount) - dto.amount`, so the exact-remaining case passes and concurrent over-refund is still blocked by the CAS claim.
- **Regression test:** `should allow a partial refund equal to the remaining balance after prior partials (D3 fix)` (`payments.service.spec.ts`).
- **Live verification:** payment `e77b4a24…` (order `ee73da32…`, 100): partial 60 → OK; partial 40 (exact remaining) → **OK**, final `amountRefunded = 100.00` in DB.

### P1C-3 — Webhook refunds mark `REFUNDED` but leave `amountRefunded = 0` (HIGH)

- **Severity:** HIGH — the refund ledger on the payment row is factually wrong and defeats the full/partial refund guards for subsequent API refunds.
- **Root cause:** `applyWebhookRefunded()` set `status`, `refundedAt`, `refundReason` and decremented `order.paidAmount` but never wrote `amountRefunded` (`payments.service.ts` pre-fix).
- **Before:** `charge.refunded` full on payment `4a000003…` → status `REFUNDED`, `amountRefunded = 0.00`, order `paidAmount` 100 → 0.
- **Expected:** `amountRefunded` must equal the refunded total so the ledger and the API refund guards are consistent.
- **Fixed:** `applyWebhookRefunded()` (`payments.service.ts:1271-1335`) now computes an absolute `newTotalRefunded` (see P1C-4) and writes `amountRefunded: newTotalRefunded`, applying only the delta to `order.paidAmount` (and reversing `tip` on full refund).
- **Regression test:** `full charge.refunded sets amountRefunded and decrements paidAmount once (D3/D4 fix)` (`payments.service.spec.ts`).
- **Live verification:** payment `4a000005…` (order `cb2e5879…`, 100 + tip 10): full `charge.refunded` → status `REFUNDED`, `amountRefunded = 100.00`, order `paidAmount` 0, `tip` 0.

### P1C-4 — Webhook partial-refund replay double-decrements `order.paidAmount` (HIGH)

- **Severity:** HIGH — money-motion double count on duplicate delivery.
- **Root cause:** `applyWebhookRefunded()` claimed on status alone and decremented `paidAmount` by the reported refund on every delivery; a duplicate delivery of the same event subtracted again.
- **Before:** `charge.refunded` (3000/10000) on payment `4a000004…`: first delivery → order `paidAmount` 100 → 70; **replay → 40**. The same $30 was refunded twice.
- **Expected:** Replays of the same refund event are no-ops.
- **Fixed:** The provider now declares the semantics of `refundedAmount` via the new optional `GatewayWebhookEvent.refundedAmountIsTotal` flag (interface `payment-provider.interface.ts:29-31`): Stripe `charge.refunded` (`amount_refunded`, cumulative) sets it `true` (`stripe.provider.ts:402`); Stripe `refund.created` and Paymob `refund.transaction.updated` (per-refund deltas) set it `false` (`stripe.provider.ts:412`, `paymob.provider.ts:489`). `applyWebhookRefunded()` computes `newTotalRefunded = min(reported, amount)` for cumulative events or `min(alreadyRefunded + reported, amount)` for incremental ones, skips when `delta <= 0`, and claims with a CAS on `amountRefunded: alreadyRefunded` inside the transaction, so concurrent and duplicate deliveries can never double-apply.
- **Regression tests:** `partial charge.refunded does not double-decrement on replay (D4 fix)` (`payments.service.spec.ts`); provider flag assertions in `stripe.provider.spec.ts` / `paymob.provider.spec.ts`.
- **Live verification:** payment `4a000006…` (order `9c58e176…`): `charge.refunded` 3000/10000 → `PARTIALLY_REFUNDED`, `amountRefunded = 30.00`, order 100 → 70; **replay → unchanged** (still 30.00 / 70). Advancing cumulative 6000/10000 → 60.00 / 40; replay → unchanged.
- **Residual limitation (documented, not observed in tests):** for _incremental_ refund events (`refund.created`, Paymob) an out-of-order replay of an old refund after a newer one could over-count, because a per-refund event carries no globally-unique anchor. Sequential replays and concurrent deliveries are fully protected by the CAS + monotonic-total logic. A production mitigation would require tracking applied refund IDs (no schema column exists; out of scope).

### P1C-5 — Webhook delivery: wildcard listener never dispatched (fixed earlier session)

- **Severity:** HIGH. `WebhookEventEmitter` used `@OnEvent('**')` with `(payload, eventName)`, but `eventemitter2` wildcard-tree listeners receive only the payload, so orders (which emit no `eventType`) never triggered deliveries. Rewritten to register `this.eventEmitter.onAny((eventName, payload) => …)` in the constructor (empirically confirmed signature). Live-verified end-to-end: order → `webhook_deliveries` row → BullMQ `deliver-order.created` job → HTTP POST to `https://example.com/wh-test` → 405 → `RETRYING`.

### P1C-6 — Webhook delivery: DB enum rejected canonical event names (fixed earlier session)

- **Severity:** MEDIUM. `webhook_deliveries.eventType` was the 22-value plural legacy enum, rejecting canonical names such as `order.created`. Column changed to `String` (migration `20260809223125_webhook_delivery_event_type_text`, applied manually + `migrate resolve --applied`, non-destructive), unsafe cast removed in `webhook-delivery.service.ts`.

---

## 3. Live Payment Verification Matrix (real DB)

| Test                          | Fixture                                                     | Result                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order state gate              | order `41a041bf…` advanced DRAFT→PENDING→CONFIRMED          | PASS — DRAFT→CONFIRMED rejected; payments accepted only on payable statuses                                                                                     |
| Partial charge + tip          | CASH 10 + tip 2 on 20 order → payment `7d293126…` COMPLETED | PASS — `paidAmount` 10, tip 2                                                                                                                                   |
| Over-charge                   | further 20 on remaining 10                                  | PASS — **400** `Payment amount exceeds remaining balance`                                                                                                       |
| Second charge completes order | CASH 10 → payment `c0377391…`                               | PASS — order COMPLETED, `paidAmount` 20, `version` 5, `completedAt` set, status-history `CONFIRMED→COMPLETED` reason `Payment completed`, audit `PAYMENT_ADDED` |
| Same-key replay               | re-charge `p1c-idem-1`                                      | PASS — same payment returned, no new row                                                                                                                        |
| Concurrent identical charges  | 5× parallel $10, fresh key `5c2bba3f…` on order `25dec3bb…` | PASS — all 5 returned the same payment `efb5dec6…`; **1 DB row**; `paidAmount` 10, `version` 4; no double credit                                                |
| Full refund (API)             | payment `01cb2ee2…` on order `b5a7bd6a…`                    | PASS — `REFUNDED`, `amountRefunded` 100, order `paidAmount` 0, `refundedAt`/`refundReason` set; repeat full → **400**                                           |
| Partial refunds (API)         | payment `0ffc624f…` on order `9998170d…`                    | PASS — 40 → `PARTIALLY_REFUNDED`; over-refund 60 → **400** `Refund amount exceeds remaining refundable amount of 50.00`; full-after-partial → **400**           |
| Concurrent refunds            | 2× $70 on $100 payment `06859180…`                          | PASS — one claimed (70 → `PARTIALLY_REFUNDED`, order 100 → 30), one **400**; no double-decrement                                                                |
| Void guard                    | void on `PARTIALLY_REFUNDED`/`COMPLETED`                    | PASS — **400** `cannot be voided`                                                                                                                               |
| Void provider path            | void PENDING `CREDIT_CARD` (`4a000007…`)                    | PASS (BLOCKED) — reached real Stripe with placeholder key → **400** `Invalid API Key`; payment left untouched (still PENDING)                                   |

## 4. Live Webhook Verification Matrix (real raw-body HMAC)

Signed with `p1c_test_whsec_00000000000000000000000000000001` (injected via compose env during the tests), delivered to `POST /api/v1/webhooks/stripe`.

| Event                              | Fixture                                                         | Result                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_intent.succeeded`         | `pi_test_p1c_wh_success_1` / order `0d207b27…`                  | PASS — payment `4a000001…` COMPLETED, order COMPLETED (`paidAmount` 100, `version` 4, `completedAt`), status-history `CONFIRMED→COMPLETED` `changedBy=system`, `changedByUserId=NULL` (FK-safe) |
| Replay ×3                          | same event re-sent 3 times                                      | PASS — **no double credit** (`paidAmount` still 100, `version` 4, `processedAt` unchanged)                                                                                                      |
| `payment_intent.canceled`          | `pi_test_p1c_wh_cancel_1` / order `203f1bcd…`                   | PASS — payment `4a000002…` FAILED, order untouched (`paidAmount` 0)                                                                                                                             |
| `charge.refunded` full             | `pi_test_p1c_wh_refund_full_1`                                  | PASS (post-fix) — REFUNDED, `amountRefunded` 100, order 0 (P1C-3)                                                                                                                               |
| `charge.refunded` partial + replay | `pi_test_p1c_wh_refund_partial_1`                               | PASS (post-fix) — PARTIALLY_REFUNDED, `amountRefunded` 30, order 70; replay no-op (P1C-4)                                                                                                       |
| Invalid signature                  | tampered HMAC                                                   | PASS — **400** `Invalid webhook signature`, no state change                                                                                                                                     |
| Paymob signature path              | provider verified by unit tests (real Paymob creds unavailable) | BLOCKED — real Paymob credentials not available; unit coverage only                                                                                                                             |

## 5. RBAC / Authorization Verification (live)

| Route                                | Allowed (roles)                       | Denied (live-confirmed)                           | Result |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------- | ------ |
| `POST …/payments` (charge)           | OWNER/MANAGER/CASHIER                 | VIEWER/STAFF/KITCHEN/WAITER → **403**             | PASS   |
| `GET …/payments` (list)              | OWNER/MANAGER/CASHIER                 | VIEWER → **403**; CASHIER → **200**               | PASS   |
| `POST …/payments/:id/partial-refund` | OWNER/MANAGER                         | VIEWER/STAFF/CASHIER → **403**; MANAGER → **200** | PASS   |
| Refund / void / split role mapping   | per `payments.controller.ts` role map | consistent with unit coverage                     | PASS   |

Tenant isolation: every payments service read/claim is scoped by the authenticated user's `tenantId` (`payments.service.ts` — `findFirst({ id, tenantId })` etc.), never client-supplied; the `findAll`/`findOne` tenant-isolation unit tests pass. Live cross-tenant access test is **BLOCKED** — no tenant-B (`10000000-…-b`) credentials are available (only the OWNER row exists; password unknown). Verified by code inspection + unit tests.

## 6. Static Gates

| Gate       | Command                                            | Result                          |
| ---------- | -------------------------------------------------- | ------------------------------- |
| TypeScript | `npx tsc --noEmit -p tsconfig.app.json` (apps/api) | PASS (exit 0)                   |
| Build      | `nx build api --configuration=production`          | PASS                            |
| ESLint     | on all changed files                               | PASS (0 errors, prettier-fixed) |
| Prisma     | `npx prisma validate`                              | PASS — schema valid             |

## 7. Test Gates

| Gate                                          | Result                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Full Jest suite (`nx run-many --target=test`) | **PASS — 72 suites, 825 tests** (was 72/821 before P1-C bug fixes; +4 new tests, zero regressions)  |
| Payments unit coverage                        | 83 tests in the three payments suites incl. the four new bug-fix tests and provider flag assertions |

## 8. Database / Migration Gates

| Gate                               | Result                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate status` (prod URL) | PASS — **21 migrations, "Database schema is up to date!"**                                                                                                                                      |
| Schema change footprint            | No new migration required for P1-C fixes (interface + provider + service only). Webhook eventType text migration `20260809223125_webhook_delivery_event_type_text` (P1C-6) applied and recorded |
| Pre-existing drift                 | The earlier `20260802120914_m4_4_soft_delete_updated_at` drift was resolved via `migrate resolve --applied`; migrate status is now clean                                                        |

## 9. Environment State & Test-Data Hygiene

- API / Redis / Postgres healthy; `GET /api/v1/health` → `status: ok` after the final rebuild and after removing the test webhook secret.
- The test-only `STRIPE_WEBHOOK_SECRET=p1c_test_whsec_…` was **removed** from `docker/.env` and replaced with a comment stating the live deployment must provide the real endpoint secret (StripeProvider correctly logs "webhook secret not configured" without it).
- Cleanup performed transactionally and verified (0 rows left): all 19 test payments, all 17 `P1C%` orders (cascading payments, order_items, order_notes, kitchen_tickets, order_status_history), the 6 `p1c-*@example.com` RBAC users, 85 test audit-log rows, the test webhook registration (`echo-test` → `https://example.com/wh-test`) and all 18 of its deliveries.
- Pre-existing fixture data untouched: 4 DRAFT orders with empty customer names remain; tenant A fixture restaurant/branch/product/owner intact.
- Helper scripts under the temp dir will be removed as part of cleanup.

## 10. Known Deviations / Residual

1. **BLOCKED — real gateway calls** (Stripe/Paymob create/confirm/refund/void over the network): placeholder key `sk_live_dev_…`; the void test provably reached Stripe's API and got `Invalid API Key`, confirming wiring — but a genuine end-to-end provider transaction could not be exercised and is not claimed.
2. **BLOCKED — Paymob webhooks and refunds live:** no real Paymob credentials; unit-tested only (HMAC field order + `refund.transaction.updated` mapping, incremental semantics).
3. **BLOCKED — live cross-tenant access test:** no tenant-B credentials available; isolation verified by code inspection + unit tests.
4. **Residual (P1C-4):** out-of-order replay of an old _incremental_ refund event after a newer one could over-count (no refund-ID anchor column); sequential replays and concurrency are protected. Suggested production follow-up: persist applied refund IDs (schema change) or configure Stripe to deliver `charge.refunded` only (cumulative, fully idempotent).
5. **Observation (no change):** a payment fully refunded via _partial_ refunds stays labeled `PARTIALLY_REFUNDED` with `amountRefunded == amount`; the ledger is consistent (further refunds are correctly blocked by both guards), only the display label is arguably misleading. Left as-is per minimal-change rule.
6. **Observation (no change):** replaying a charge key after its order auto-completed returns **400** `Cannot add payment to order in COMPLETED status` (the status guard runs before the idempotency lookup). No double-charge is possible; the error message could be clearer but behavior is safe.

## 11. Verdict

> **⚠️ P1-C CERTIFIED WITH FIXES.** All P1-C payments scope was verified against the real database and live API. Four defects were discovered and are fully fixed, unit-tested, regression-tested (72 suites / 825 tests, zero regressions), and **re-verified live**: cross-order idempotency-key misattribution (P1C-1), exact-remaining partial refund rejection (P1C-2), webhook refund `amountRefunded` ledger (P1C-3), and webhook refund replay double-decrement (P1C-4). The two earlier webhook-delivery fixes (P1C-5/P1C-6) remain verified. Charge/refund/idempotency/concurrency/RBAC/webhook-signature behavior is correct in live mode; provider-network transactions are BLOCKED by the placeholder key and not claimed. No P0/P1 security or data-integrity defects remain open. Nothing has been committed or pushed.
