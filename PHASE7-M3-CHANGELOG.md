# Phase 7 — M3 Changelog

## New Module: Payments (`src/modules/payments/`)

### Added
- **PaymentsModule** — NestJS module wiring providers, controller, and exports
- **PaymentsController** — REST API: `POST /charge`, `POST /:id/refund`, `POST /:id/partial-refund`, `POST /:id/void`, `POST /split`, `GET /`, `GET /:id`, `POST /reconcile`
- **PaymentsService** — Core business logic:
  - `charge()` — Optimistic concurrency via version check; optional provider payment intent; auto-completes order on full payment
  - `refund()` — Full refund with provider delegation; decrements paid amounts
  - `partialRefund()` — Partial refund to PARTIALLY_REFUNDED status
  - `voidPayment()` — Voids PENDING payments to FAILED status
  - `splitPayment()` — Splits payment across methods (cash + card, etc.)
  - `findAll()` / `findOne()` — Tenant-scoped payment queries with pagination
  - `reconcile()` — Basic reconciliation stub
- **PaymentStateMachine** — Validated transitions: PENDING→COMPLETED/FAILED, COMPLETED→REFUNDED/PARTIALLY_REFUNDED, PARTIALLY_REFUNDED→REFUNDED; terminal states: FAILED, REFUNDED
- **DTOs** — 7 validation classes with class-validator decorators
- **StripeProvider / PaymobProvider** — Mock provider implementations of existing `PaymentProvider` interface
- **Tests** — 62 new tests: 28 unit (service), 18 state machine, 10 provider, 5 integration flow, 1 Stripe/Paymob provider spec

### Modified
- **app.module.ts** — Added `PaymentsModule` to root imports
- **orders.service.ts** — `addPayment()` and `refundPayment()` now delegate to `PaymentsService`; existing behavior preserved
- **orders.module.ts** — Imports `PaymentsModule` for dependency injection
- **metrics.service.ts** — Added `incrementPaymentsCompleted()`, `incrementPaymentsFailed()`, `incrementPaymentsRefunded()` counters
- **jest.config.ts** — Coverage thresholds: `payments.service.ts` ≥60% lines, `payment-state-machine.ts` ≥90% branches; provider files excluded

### Fixed
- **orders.service.spec.ts** — Added `PaymentsService` mock to resolve DI error
- **order-crud.integration.spec.ts** — Added `PaymentsService` mock to resolve DI error

### Design Decisions
- Circular dependency avoided by using PrismaService directly in PaymentsService for order lookups
- Provider registry pattern with per-method resolution (CREDIT_CARD/DEBIT_CARD → Stripe, MOBILE_PAYMENT → Paymob)
- Optimistic concurrency via `version` field on Order model during charge
- Tenant isolation enforced on all payment queries
