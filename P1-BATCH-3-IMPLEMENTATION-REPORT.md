# P1 BATCH 3 — IMPLEMENTATION REPORT

**Date:** 2026-08-09
**Scope source:** `P1-BATCH-3-PLAN.md` (derived from `POST-P1-BATCH-2-FULL-AUDIT.md` findings F2–F6 + D1–D13 and `POST-P1-BATCH-2-F1-FIX.md` §9.5). Deferred items D7–D12 and the F1 backlog were NOT touched per plan scope rules.

**Approved decisions applied:**

- B3-9: verify-only + document (no writes to the production `_prisma_migrations` table).
- B3-6: raise the flagged files via tests; coverage config unchanged (no threshold loosening).

---

## B3-1 — Webhook event routing (D1, HIGH) — COMPLETE

**Root cause:** `webhook-event-emitter.ts` subscribed to plural event names (`orders.*`, `customers.*`, …) while the app emits singular names (`order.*`, …); only `payments.*` ever matched.

**Fix (smallest safe):**

- NEW `apps/api/src/modules/webhooks/webhook-events.ts` — single source of truth:
  - `WEBHOOK_EVENT_NAMES` (frozen, ~75 canonical names across order/payment/campaign/crm/nutrition/menu/table/restaurant/recovery).
  - `WEBHOOK_EVENT_ALIASES` (plural→singular normalization; `order.merged`→`orders.merged`).
  - `normalizeWebhookEventName()`, `isValidWebhookEventName()`, `webhookEventCandidates()` (canonical + aliases).
- `webhook-event-emitter.ts`:
  - Keeps `@OnEvent('**')` + wildcard module config (no architecture change).
  - Canonicalizes `eventName || payload?.eventType`.
  - Looks up `getActiveWebhooksForEvent(canonical, tenantId)`.
  - Per-delivery `deliveryId`; `addJob('webhook-delivery', 'deliver-${eventType}', data)` (BullMQ job name, idempotent per deliveryId).

**Tests:** NEW `webhook-events.spec.ts` (11) + `webhook-event-emitter.spec.ts` (8) — all pass. Covers `order.created/completed/cancelled`, `customers.created`, `inventory.low_stock`, `payments.completed`, alias normalization, unknown-event rejection, no double dispatch.

---

## B3-2 — Partial-refund over-refund cap (D2, MED) — COMPLETE

**Root cause:** `partialRefund` only checked `dto.amount > payment.amount`; no cumulative-refunded tracking existed, so repeated partial refunds could exceed the original payment.

**Fix:**

- `Payment.amountRefunded Decimal @default(0)` in `schema.prisma` + migration `20260808120000_payments_amount_refunded`.
- `payments.service.ts` `partialRefund`: in-transaction atomic claim —
  `updateMany({ where: { id, amountRefunded: { lte: remaining − dto.amount } }, data: { amountRefunded: { increment: dto.amount } } })`; 0 rows → `ConflictException`.
- Full `refund()` refuses when `amountRefunded > 0`.

**Tests:** 36 payments service tests pass, incl. cumulative-bound and concurrent-refund (exactly one wins) cases. Tenant-isolation refund → NotFound covered.

**Runtime verification (previous session, re-confirmed in this report's pipeline):** two concurrent 60-of-100 refunds → `UPDATE 1` / `UPDATE 0`, final `amountRefunded = 60.00`.

---

## B3-3 — Queue alignment + DLQ alerting (D3/D4, MED/LOW) — COMPLETE

**Root cause:** notification worker expected `{title, channel, ...}` but producers enqueued `{items}`/`{alertCount}`; DLQ jobs were consumed+acked with no alerting; health monitor covered only 5/36 queues.

**Fix:**

- `QUEUE_NAMES` (21 queues) in queue config.
- `NotificationJobPayload` type; `notification.processor.ts` consumes canonical payload, warns on mismatch, falls back to `userId`.
- `inventory.processor.ts` producers enqueue canonical payloads.
- `dead-letter.processor.ts` emits alert + metric/counter on DLQ consume (keeps depth visibility).
- Health monitor (`queue.service.ts`) covers all 21 queues.

**Tests:** `notification.processor.spec.ts`, `dead-letter.processor.spec.ts`, `inventory.processor.spec.ts`, `bull-health.indicator.spec.ts` pass.

**Runtime (this pipeline):** `GET /api/v1/health` reports all 21 BullMQ queues `up`; Redis contains `bull:*` keys for every queue incl. `dead-letter`.

---

## B3-4 — Seed script (D5, MED) — COMPLETE

**Root cause:** `prisma:seed` script had no seed wiring and no seed file.

**Fix:** `prisma.config.ts` (`migrations.seed: 'node prisma/seed.js'`) + NEW `prisma/seed.js` — idempotent, upsert-keyed (tenant by slug, user by `tenantId_email`, restaurant by `tenantId_slug`, branch by `restaurantId_slug`, subscription by tenantId). No wipe/destroy path, no plaintext secrets.

**Runtime (this pipeline):** scratch DB `tablofy_seed_test` created → `migrate deploy` (20 migrations OK) → `npx prisma db seed` run twice → exactly 1 tenant / 1 user / 1 restaurant / 1 branch / 1 subscription after both runs. Scratch DB dropped.

---

## B3-5 — Missing indexes (D13 + F2, MED/HIGH) — COMPLETE

**Root cause:** no indexes on `Order.customerPhone`, `Customer.phone`, `ConsumptionRecord(tenantId,inventoryItemId,date)`, `WalletTransaction(referenceType,referenceId)`; Batch-2 analytics raw queries filter/join on the first two.

**Fix:** +4 B-tree indexes in `schema.prisma` + migration `20260808130000_add_lookup_indexes` (pure `CREATE INDEX`, non-destructive).

**Runtime (this pipeline):** all 4 indexes verified present in the live DB (`pg_indexes`); `prisma migrate status` up to date; `prisma migrate diff` → "No difference detected".

---

## B3-6 — Coverage thresholds (D6, LOW) — COMPLETE

**Root cause:** `jest --coverage` exited 1 on unmet per-file thresholds.

**Fix (tests only; config unchanged):**

- `auth.controller.spec.ts` → `auth.controller.ts`: branches 59.48% (≥50), statements/lines/functions 100%.
- `orders.service.spec.ts` → `orders.service.ts` (58 tests): statements 85.1% (≥60), lines 81.32% (≥60), functions 92.45% (≥50), branches 58.8% (≥30). Added coverage for `applyDiscount`, `removeDiscount`, `addPayment`, `refundPayment`, `addNote`, `splitOrder`, `mergeOrders`, `moveTable`, `duplicateOrder`, `applyServiceCharge`, `applyTaxRate`, `voidItem`, `updateItemKitchenStatus`, `findKitchenTickets`, `updateKitchenTicketStatus`, `restore` (incl. error/terminal/tenant paths).
- `audit-log.interceptor.spec.ts` → `audit-log.interceptor.ts`: functions 100% (≥90); Edge/Firefox UA branches + error-path log-failure swallow covered.
- D6-flagged `http-exception.filter.ts` and `tenant-body.guard.ts` now also pass thresholds.

**Result:** `jest --coverage` exits 0; full suite passes (see certification report).

---

## B3-7 — Webhook DTO caps + event-set validation (F3, LOW) — COMPLETE

**Root cause:** `events` unbounded/unvalidated; `headers`/`metadata` unbounded.

**Fix:**

- `create-webhook.dto.ts`: `@ArrayMaxSize(50)` + `@MaxLength(100, { each: true })` on `events`.
- `webhooks.service.ts`: `normalizeEvents()` (rejects empty / >50 / unknown, canonicalizes on create+update), `assertHeaderBounds()` (≤20 keys, keys/values ≤256), `assertMetadataBounds()` (≤20 keys, keys ≤256, scalar values ≤1000); `getActiveWebhooksForEvent` matches `{ hasSome: webhookEventCandidates(...) }`, returns `[]` pre-query for unknown events.

**Runtime (previous session, HTTP-verified):** 50-event create → 400 `"events must contain no more than 50 elements"`; unknown `bogus.event` → 400 `"Unknown webhook event(s): bogus.event"`; valid webhook incl. alias `orders.merged` → 201 with canonical events stored.

---

## B3-8 — customer-analytics `Prisma.sql` hygiene (F5, LOW) — COMPLETE

**Root cause:** 5 `$queryRawUnsafe` sites (incl. wallet-trend placeholder-string construction) — parameterized but not tagged.

**Fix:** all 5 sites converted to `Prisma.sql` tagged templates; exact SQL (snake_case `@@map` names) preserved.

**Tests:** `customer-analytics.service.spec.ts` (11 tests) passes; wallet-trend spec asserts the query executes with parameters (tenantId + Date range, `wallet_transactions` text).

---

## B3-9 — M4.4 migration checksum reconciliation (F4, MED) — VERIFY-ONLY + DOCUMENT

**Approved decision:** no production writes. Verification results:

- Working-tree `20260802120914_m4_4_soft_delete_updated_at/migration.sql` SHA-256 = `ED81A8A2EAC4921C…` (matches the audit-recorded `ed81a8a2…`).
- Live `_prisma_migrations` recorded checksum = `286c65297f5328319e…` (matches the audit-recorded `286c6529…`).
- `prisma migrate status` → "Database schema is up to date!" (20 migrations, all applied).
- `prisma migrate diff --from-url … --to-schema-datamodel …` → **"No difference detected"** (exit 0).

**Conclusion:** the checksum drift is confirmed **cosmetic** (schema-identical DEFAULT+drop pattern); `migrate status` and `migrate diff` are clean. Documented as known cosmetic debt; no DB-only UPDATE performed (per approved verify-only decision).

---

## B3-10 — Lint hygiene (F6, LOW) — COMPLETE

**Fix:** `prettier --write` applied to all changed files (`endOfLine: lf` per `.prettierrc`); verified `prettier --check` clean on every changed file; `eslint` clean (0 errors, 0 warnings) on every Batch-3 changed file.

---

## Deferred (explicitly out of scope)

D7 (dep hygiene), D8 (validation hardening), D9 (`@ApiTags`), D10 (compose boot docs), D11 (root `.env` dev URL), D12 (N+1), F1 audit-log FK backlog, and the D12–D14 row: untouched.
