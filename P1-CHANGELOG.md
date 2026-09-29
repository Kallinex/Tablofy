# P1 — CHANGELOG

## Batch 3 — 2026-08-08

**Scope:** findings F2–F6 + D1–D6, D13 from `POST-P1-BATCH-2-FULL-AUDIT.md`, per `P1-BATCH-3-PLAN.md`. B3-9 verify-only. Deferred D7–D12/F1-backlog unchanged.

### Files changed (tracked, working tree)

- `apps/api/src/modules/webhooks/webhook-event-emitter.ts` — canonical event dispatch, per-delivery deliveryId, active-webhook lookup.
- `apps/api/src/modules/webhooks/webhooks.service.ts` — event normalization + header/metadata bounds on create/update; `hasSome` active-webhook matching.
- `apps/api/src/modules/webhooks/dto/create-webhook.dto.ts` — `@ArrayMaxSize(50)` + `@MaxLength(100,{each})` on `events`.
- `apps/api/src/modules/webhooks/webhook-processor.ts` — canonical payload handling, delivery logging.
- `apps/api/src/modules/webhooks/webhooks.module.ts` — wires new webhook-events module pieces.
- `apps/api/src/modules/payments/payments.service.ts` — atomic `partialRefund` cumulative cap via `amountRefunded` claim; full-refund guard.
- `apps/api/src/modules/payments/dto/split-payment.dto.ts` — partial-refund-related DTO alignment.
- `apps/api/src/modules/orders/orders.service.ts` — test-driven coverage additions (no runtime behavior change beyond prior batches).
- `apps/api/src/modules/orders/order-state-machine.ts` — coverage-relevant state paths (unchanged semantics).
- `apps/api/src/modules/auth/tests/auth.controller.spec.ts` — 15 tests; branch coverage 59.48%.
- `apps/api/src/modules/customer-analytics/tests/customer-analytics.service.spec.ts` — 11 tests incl. parameterized wallet-activity.
- `apps/api/src/modules/queues/queue.service.ts` — 21-queue monitor coverage.
- `apps/api/src/modules/queues/notification.processor.ts` — canonical NotificationJobPayload consumer + fallback.
- `apps/api/src/modules/queues/dead-letter.processor.ts` — DLQ alert + metric emission.
- `apps/api/src/modules/inventory/inventory.processor.ts` — canonical queue payload producers.
- `apps/api/src/modules/customer-analytics/customer-analytics.service.ts` — 5 raw-query sites converted to `Prisma.sql` tagged templates.
- `apps/api/src/health/bull-health.indicator.ts` — health coverage across all queues.
- `apps/api/src/modules/auth/auth.controller.ts` — coverage-driven branch fix (2fa paths).
- `apps/api/src/common/interceptors/audit-log.interceptor.ts` (+ UA/error paths in specs).
- `apps/api/src/modules/recipes/recipes.processor.ts` — B3-10 formatting only; **F1 `isOrderCompletedForDeduction` gate intact**.
- `apps/api/src/modules/recipes/recipes.service.ts`, `recipes.controller.ts` — formatting only.
- `apps/api/src/common/guards/roles.guard.ts`, `apps/api/src/common/bull-board/bull-board.module.ts`, various `*controller.ts` — formatting only.
- `prisma/schema.prisma` — `Payment.amountRefunded`; +4 lookup indexes.
- `prisma.config.ts` — `migrations.seed: 'node prisma/seed.js'`.
- `apps/api/src/test/mocks/prisma.mock.ts` — mock support for new fields.
- `apps/api/jest.config.ts` — (unchanged thresholds; green via new tests).

### Files added (untracked)

- `apps/api/src/modules/webhooks/webhook-events.ts` — canonical event names/aliases/normalizer.
- `apps/api/src/modules/webhooks/tests/` — `webhook-events.spec.ts`, `webhook-event-emitter.spec.ts`, plus webhook service/processor specs.
- `apps/api/src/modules/recipes/tests/` — `recipes.processor.spec.ts` F1 regression coverage.
- `apps/api/src/health/tests/bull-health.indicator.spec.ts`.
- `prisma/seed.js` — idempotent seed.
- `prisma/migrations/20260808120000_payments_amount_refunded/` — `amountRefunded` column.
- `prisma/migrations/20260808130000_add_lookup_indexes/` — 4 B-tree indexes.
- `P1-BATCH-3-IMPLEMENTATION-REPORT.md`, `P1-BATCH-3-CERTIFICATION-REPORT-2026-08-08.md`.

### Verification summary

- 68 suites / 776 tests pass; `jest --coverage` exit 0.
- `tsc --noEmit`, `nx build api`, `prisma validate`, `prettier --check`, changed-file ESLint: all clean.
- `migrate status` up to date (20 migrations); `migrate diff` → "No difference detected".
- Live health: 200; all 21 BullMQ queues up; auth matrix verified; seed idempotent on scratch DB.
- M4.4 checksum drift confirmed cosmetic (schema-identical); documented, no prod write.
