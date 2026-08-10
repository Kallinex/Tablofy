# P1 BATCH 3 — IMPLEMENTATION PLAN

**Derived from (ONLY scope sources):**

- `POST-P1-BATCH-2-FULL-AUDIT.md` findings F2–F6 (Batch-2 debt) and D1–D13 (pre-existing debt).
- `POST-P1-BATCH-2-F1-FIX.md` §9.5 "recorded for P1 Batch 3+": webhook naming (D1), partial-refund over-refund (D2), queue worker/dead-worker handling (D3/D4), seed drift (D5), missing indexes (D13), coverage thresholds (D6).
- F1 (inventory deduction) is already runtime-verified and is NOT modified unless a task uncovers a concrete regression.

**Mode:** Each task gets root cause → smallest safe fix → unit/regression tests → runtime Docker verification where practical → per-task gates before the next task.

---

## Task List (mapped to findings)

| Task  | Finding  | Severity | Summary                                                                                                                                                                                                    |
| ----- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B3-1  | D1       | HIGH     | Webhook event names never match: app emits `order.*` (singular) but `WebhookEventEmitter.subscribedEvents` uses `orders.*` (plural). Only `payments.*` ever dispatches.                                    |
| B3-2  | D2       | MED      | `partialRefund` has no cumulative-refund cap; repeated partial refunds can exceed `payment.amount`.                                                                                                        |
| B3-3  | D3 + D4  | MED/LOW  | `notification` queue payload mismatch (`{items}`/`{alertCount}` vs expected `{title,channel}`); DLQ jobs are consumed+acknowledged with no alerting (depth monitor moot); health monitor only 5/36 queues. |
| B3-4  | D5       | MED      | `prisma:seed` script has no `prisma.seed` config and no seed file → `npm run prisma:seed` fails.                                                                                                           |
| B3-5  | D13 + F2 | MED/HIGH | Missing indexes: `Order.customerPhone`, `Customer.phone`, `ConsumptionRecord(tenantId,inventoryItemId,date)`, `WalletTransaction(referenceType,referenceId)`.                                              |
| B3-6  | D6       | LOW      | Coverage thresholds unmet under `jest --coverage` (exit 1); thresholds not enforced in CI.                                                                                                                 |
| B3-7  | F3       | LOW      | Webhook DTO `events` unbounded array (no cap, not validated against known event set); `headers`/`metadata` unbounded.                                                                                      |
| B3-8  | F5       | LOW      | `customer-analytics.service.ts` uses `$queryRawUnsafe` (5 sites) — parameterized today, prefer `Prisma.sql`.                                                                                               |
| B3-9  | F4       | MED      | M4.4 working-tree migration checksum differs from recorded prod checksum (schema-identical, "RISKY cosmetic").                                                                                             |
| B3-10 | F6       | LOW      | Lint CRLF `prettier/prettier` hygiene on changed files.                                                                                                                                                    |

**Explicitly deferred (NOT in Batch 3):** D7 (dep hygiene), D8 (validation hardening), D9 (`@ApiTags`), D10 (compose boot docs), D11 (root `.env` dev URL), D12 (N+1), F1 audit-log FK backlog. These are outside the recorded Batch-3 scope; fixing them now would violate the "smallest safe fix / do not touch unrelated modules" rule.

---

## B3-1 — Webhook event routing (D1, HIGH)

**Root cause (verified):** `apps/api/src/modules/webhooks/webhook-event-emitter.ts:11-35` subscribes `@OnEvent('**')` and matches against a hardcoded `subscribedEvents` set using **plural** names (`orders.created`, `customers.created`, `inventory.low_stock`, `loyalty.points_earned`, `campaigns.sent`, `suppliers.created`, `transfers.completed`). The app emits **singular** names: `orders.service.ts:162` `order.created`, `:389` `order.updated`, `:483` dynamic `order.<status>.toLowerCase()` (e.g. `order.completed`), `:1009` `order.duplicated`, `:1207` `order.deleted`, `:792` `order.split`; `:864` `orders.merged` (plural, one-off); `campaigns.service.ts` emits `campaign.created` etc. Only `payments.completed/failed/refunded` match, so only payments webhooks ever dispatch.

**Affected files:**

- `apps/api/src/modules/webhooks/webhook-event-emitter.ts` (subscriber set + event-name normalization)
- `apps/api/src/modules/webhooks/tests/webhook-event-emitter.spec.ts` (NEW)
- Possibly `apps/api/src/modules/webhooks/webhooks.service.ts` `getActiveWebhooksForEvent` (event matching)

**Expected behavior:** Every business event emitted by the app that has a corresponding webhook subscription dispatches to registered webhooks for that tenant. Event names normalized (singular canonical), subscriptions validated against a known event set at registration (ties into B3-7).

**Security/data-integrity risks:** None new (webhooks are tenant-scoped; delivery already SSRF-guarded in Batch 2). Careful not to create duplicate dispatches (events must stay idempotent per deliveryId). Do not emit new events from services (no architecture change) — only correct the subscriber matching.

**Test strategy:** Unit spec: handler dispatches for `order.created`, `order.completed`, `order.cancelled`, `customers.created`, `inventory.low_stock`, `payments.completed`; ignores unknown/non-tenant events; uses canonical matching; no double dispatch. Verify against the actual emitted-name inventory.

**Runtime verification:** Docker: register a webhook for `order.created`, create a real order (seeded tenant), assert a delivery row is created for the webhook registration.

---

## B3-2 — Partial-refund over-refund cap (D2, MED)

**Root cause (verified):** `payments.service.ts:608` only checks `dto.amount > payment.amount`. No cumulative refunded amount is tracked (`Payment` has no `refundedAmount` column; `partialRefund` sets `PARTIALLY_REFUNDED` repeatedly). Consecutive partial refunds can exceed the original payment amount at the application level.

**Affected files:**

- `apps/api/src/modules/payments/payments.service.ts` (`partialRefund`, `refundPayment`)
- `apps/api/src/modules/payments/tests/payments.service.spec.ts` (extend)

**Expected behavior:** Cumulative refunded amount for a payment never exceeds `payment.amount`. Enforce in-transaction (concurrency-safe): within the `$transaction`, read current refunded total (sum of existing REFUND movements or a computed field), reject when `dto.amount + alreadyRefunded > payment.amount`.

**Security/data-integrity risks:** Must be concurrency-safe (two concurrent partial refunds must not both pass). Gateway is only a backstop for card methods — app-level enforcement required. Do NOT change `refundPayment` (full refund) semantics.

**Test strategy:** Unit: single partial refund OK; cumulative refunds bounded; exceeding total → BadRequest; concurrent refunds → exactly one wins (transaction claim). Tenant-isolation: refund on other tenant's payment → NotFound.

**Runtime verification:** Docker: seed payment, run partial refunds summing to amount, third → 400; assert payment status/paidAmount consistent.

---

## B3-3 — Queue alignment + DLQ alerting (D3/D4, MED/LOW)

**Root cause (verified):**

- `notification.processor.ts:18-23` expects payload `{ title, message, type, channel }`, but producers `inventory.processor.ts:121-124` (and `:208`) enqueue `payload: { items: [...] }` → notifications "delivered" with undefined title/channel.
- `dead-letter.processor.ts:23-39` consumes + acknowledges DLQ jobs (log only) → `startDlqMonitor` depth stays 0 → `QUEUE_DLQ_ALERT_THRESHOLD` alert never fires.
- Health monitor monitors only 5/36 queues.

**Affected files:**

- `apps/api/src/modules/inventory/inventory.processor.ts` (align payload OR make notification processor tolerate both)
- `apps/api/src/modules/queues/notification.processor.ts`
- `apps/api/src/modules/queues/dead-letter.processor.ts` (alerting on consume; optionally stop auto-ack → keep in DLQ for depth visibility)
- `apps/api/src/modules/queues/queue.service.ts` (health/monitor coverage)
- `apps/api/src/modules/queues/tests/*.spec.ts` (extend)

**Expected behavior:** Notification jobs deliver meaningful payload; DLQ consumption emits alert/metric and increments a counter; health check reflects all configured queues.

**Security/data-integrity risks:** Do not break queue/worker startup (36 workers). Changing DLQ consume semantics must not cause job loss. Keep worker count and queue names stable.

**Test strategy:** Unit specs for notification payload normalization, DLQ alert-on-consume, monitor coverage list. Runtime: enqueue a notification job, assert payload handled; enqueue a failing job, assert DLQ depth/monitor behavior.

---

## B3-4 — Seed script (D5, MED)

**Root cause (verified):** `package.json` has `"prisma:seed": "npx prisma db seed"` (line 14) but no `"prisma": { "seed": "..." }` config and no seed file.

**Affected files:**

- `package.json` (`prisma.seed` config + script path)
- `prisma/seed.ts` (or `prisma/seed.js`) (NEW, minimal)

**Expected behavior:** `npm run prisma:seed` runs a minimal, idempotent seed (existing prod DB already has 1 super-admin user; seed must not duplicate or destroy). Seed must be safe on a populated DB.

**Security/data-integrity risks:** Seed must not wipe data or create duplicate unique rows; must not introduce plaintext secrets. Use idempotent upserts.

**Test strategy:** Unit: none (script). Runtime: run seed against a scratch DB/schema (or dev), assert idempotent second run.

---

## B3-5 — Missing indexes (D13 + F2, MED/HIGH)

**Root cause (verified):**

- `schema.prisma:1027-1041` `Order` — no `@@index([customerPhone])`.
- `schema.prisma:1650-1655` `Customer` — no `@@index([phone])`.
- `schema.prisma:3581-3586` `ConsumptionRecord` — no `@@index([tenantId, inventoryItemId, date])`.
- `schema.prisma:1929-1935` `WalletTransaction` — no `@@index([referenceType, referenceId])`.
- Batch-2 `customer-analytics.service.ts` raw queries filter/join on `orders.customerPhone`/`customers.phone` (F2).

**Affected files:**

- `prisma/schema.prisma` (+4 indexes)
- `prisma/migrations/<new>/migration.sql` (generated, non-destructive)

**Expected behavior:** New B-tree indexes created; migration deployable with zero downtime on populated tables (CREATE INDEX … CONCURRENTLY where supported; if not, plain CREATE INDEX — table sizes are small in runtime).

**Security/data-integrity risks:** Index-only migration; no data change. Must not conflict with existing index names. Verify migration applies cleanly and `migrate status` stays up to date.

**Test strategy:** `prisma validate`; migration generated; `prisma migrate dev`/`deploy` against scratch; query planner check (optional).

**Runtime verification:** Docker: run migration, assert 4 new indexes exist (`\di`), app boot healthy.

---

## B3-6 — Coverage thresholds (D6, LOW)

**Root cause (verified):** `jest --coverage` exits 1 due to unmet per-file thresholds (e.g. `http-exception.filter.ts` 90% vs 79.2%, `tenant-body.guard.ts` 0%); config unchanged by Batch 2.

**Affected files:**

- `apps/api/jest.config.ts` (thresholds) and/or new tests to raise the flagged files.

**Expected behavior:** `jest --coverage` exits 0 while keeping meaningful thresholds (no cherry-picking — raise the flagged files via tests or set threshold to current-passing value with a documented rationale).

**Security/data-integrity risks:** None. Must not delete tests or lower global coverage to absurd levels.

**Test strategy:** Run `jest --coverage`; assert exit 0; full suite still passes.

---

## B3-7 — Webhook DTO caps + event-set validation (F3, LOW)

**Root cause (verified):** `create-webhook.dto.ts:28-30` `events!: string[]` unbounded and unvalidated; `:46` `headers?: Record<string,string>` and `:54` `metadata?: Record<string,unknown>` unbounded. `update-webhook.dto.ts` same for events.

**Affected files:**

- `apps/api/src/modules/webhooks/dto/create-webhook.dto.ts`
- `apps/api/src/modules/webhooks/dto/update-webhook.dto.ts`
- `apps/api/src/modules/webhooks/webhooks.service.ts` (validate event names against known event set)
- Shared event-name constants (single source of truth, reused by B3-1)

**Expected behavior:** `events` capped (e.g. `ArrayMaxSize(50)`) and each event validated against the canonical known-event set; `headers`/`metadata` capped (e.g. max keys/`MaxLength` values). Reject unknown events with a clear 400.

**Security/data-integrity risks:** Must not break existing webhook registrations (backward compat): accept both old and canonical names? No — reject truly unknown, normalize singular/plural mapping to canonical. Ensure B3-1 canonical list is the validation source.

---

## B3-8 — customer-analytics `Prisma.sql` hygiene (F5, LOW)

**Root cause (verified):** `customer-analytics.service.ts` uses `$queryRawUnsafe` at 5 sites (incl. `getWalletTrend` placeholder-string construction). Parameterized and safe today.

**Affected files:**

- `apps/api/src/modules/customer-analytics/customer-analytics.service.ts`

**Expected behavior:** All raw queries use `Prisma.sql` (tagged template) — no interpolated SQL strings. Behavior identical.

**Security/data-integrity risks:** None (behavior-preserving refactor). Regression risk: exact SQL must stay identical (snake_case `@@map` names preserved).

**Test strategy:** Existing specs must pass; add a spec asserting the wallet-trend query executes with parameters (mock).

---

## B3-9 — M4.4 migration checksum reconciliation (F4, MED)

**Root cause (verified):** Working-tree migration `m4_4*/migration.sql` checksum `ed81a8a2…` differs from recorded prod checksum `286c6529…` (schema-identical; DEFAULT+drop pattern). Marked "RISKY cosmetic — corrected follow-up or replay-with-reset recommended."

**Affected files:**

- `prisma/migrations/.../m4_4*/migration.sql` (if a corrected/rebased migration is produced)

**Expected behavior:** `_prisma_migrations` checksums in the runtime DB match the working-tree migration files; `prisma migrate status` clean; `prisma migrate diff` = "No difference detected". Do NOT reset prod data.

**Security/data-integrity risks:** HIGH if done wrong. Replaying migrations on a populated DB is destructive. Safest: verify with `prisma migrate diff` and `migrate status`; if checksum drift is cosmetic, correct the recorded checksum in `_prisma_migrations` via a documented, DB-only UPDATE (no schema change) OR leave as documented debt. **Decision required from user before touching prod migrations.**

---

## B3-10 — Lint hygiene (F6, LOW)

**Root cause (verified):** 728 CRLF `prettier/prettier` `Delete ␍` errors on changed files; 9 cosmetic line-collapses in 3 files.

**Affected files:** all Batch-3 changed files (ensure `endOfLine: "lf"`).

**Expected behavior:** `eslint` clean (0 errors) on all Batch-3 changed files.

---

## Dependencies

```
B3-1  ← B3-7 (shared canonical event set; do B3-7 constants first or together)
B3-2  (independent)
B3-3  (independent)
B3-4  (independent)
B3-5  (independent)
B3-6  (after B3-1..B3-10 code, since it depends on final coverage numbers; run last)
B3-7  ← B3-1 (canonical event set)
B3-8  (independent)
B3-9  (independent; requires user decision)
B3-10 (last, cosmetic)
```

Execution order: B3-1 → B3-7 → B3-2 → B3-3 → B3-4 → B3-5 → B3-8 → B3-9 (pending decision) → B3-6 → B3-10 → full certification pipeline.

---

## Certification pipeline (after all tasks)

`tsc --noEmit` · `nx test api` · `nx build api` · `nx lint api` · `prisma validate` · `prisma migrate status` · Phase 7 harnesses · Docker compose prod boot · health/readiness · auth/RBAC matrix · Redis/BullMQ verification · DB integrity · migration verification · targeted security/concurrency tests · regression audit (M1–M5, P0, Batch 1, Batch 2, F1).

Deliverables: `P1-BATCH-3-IMPLEMENTATION-REPORT.md`, `P1-BATCH-3-CERTIFICATION-REPORT.md`, `P1-BATCH-3-CHANGELOG.md`.

**Final verdict:** ✅ CERTIFIED / ⚠️ CERTIFIED WITH NON-BLOCKING DEBT / ❌ NOT CERTIFIED.
