# Independent Forensic Audit — Tablofy API (2026-08-06)

Method: direct source inspection (grep/read), live `nx test api` and `nx lint api` runs (`--skip-nx-cache`), parsing of `coverage/lcov.info` and `prisma/schema.prisma`. No prior report text was used as evidence.

---

## 1. Test-Coverage Matrix (verified from live run)

| Claim              | Verified Result                                           | Evidence                                             |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------- |
| 55 test suites     | **TRUE** — `Test Suites: 55 passed, 55 total`             | `npx nx test api --skip-nx-cache --runInBand`, 47.7s |
| 519 tests passing  | **TRUE** — `Tests: 519 passed, 519 total`, 0 failures     | same run                                             |
| Snapshots          | 0                                                         | same run                                             |
| All modules tested | **FALSE** — 57 service files have no spec in their module | module spec scan (list below)                        |
| Lint clean         | **FALSE** — `api:lint` exits non-zero                     | `eslint . --ext .ts`                                 |

### Real coverage (parsed from `coverage/lcov.info`, generated 2026-08-06 04:16)

- **Lines: 19.72%** (2,779 / 14,095)
- **Functions: 14.89%** (379 / 2,545)
- **Branches: 12.32%** (1,570 / 12,740)
- 453 of 570 non-spec `.ts` files appear in the report; 117 files (21%) are never even loaded by any test.
- `payments.service.ts` is the best-covered large module: 71.7% lines (238/332), 85.3% functions (29/34).

### Modules/services with ZERO tests (57)

Highest-risk untested: `purchasing.service.ts` (1,114 lines, PO/GRN money flow), `recipes.service.ts` (800 lines, ingredient deduction), `transfers.service.ts` (inventory transfers), `campaigns.service.ts` (862 lines, promotion discount math), `costing.service.ts` (inventory valuation), `export-engine.service.ts`, `kds.service.ts`, `warehouses.service.ts`, `webhooks.service.ts` + `webhook-delivery.service.ts`, plus all analytics/dashboard services (`dashboard`, `executive-dashboard`, `financial-analytics`, `sales-analytics`, `kitchen-analytics`, `live-analytics`, `forecasting*`, `inventory-analytics`, `supplier-analytics`, `customer-analytics`, `crm-analytics`, `scheduled-reports`). Common infra also untested: `logger.service.ts`, `metrics.service.ts`, `i18n.service.ts`, `monitoring.service.ts`, `recovery.service.ts`, `correlation.service.ts`.

Full 57-file list recorded in audit working notes (modules missing specs include allergens, api-keys, branch-settings, branches, business-exceptions, business-hours, dining-areas, floors, ingredients, integrations, invitations, menu, modifier-groups, modifiers, nutrition, product-ingredients, product-variants, restaurants, restaurant-settings, service-charges, sessions, suppliers, supplier-performance, tables, tags, tax-rates, units, variant-groups, webhooks).

## 2. Missing Test Scenarios (validated against source)

1. **Stripe provider: real-mode paths untested** — `stripe.provider.spec.ts` runs only `mode='mock'` (`pi_mock_`/`txn_mock_`/`re_mock_`); non-mock request/response/error handling is uncovered. Providers are ALSO excluded from coverage reporting via `collectCoverageFrom: '!<rootDir>/src/modules/payments/providers/*.ts'` (jest.config.ts:28) — deliberately de-gated.
2. **Integration specs are not real-DB** — `payment-flow.integration.spec.ts` uses `prisma: Record<string, jest.Mock>`; `auth-flow.integration.spec.ts` likewise. No test touches a real database.
3. **Gift-card recharge race untested** — see finding Q1. A test firing two concurrent `recharge` calls would expose the lost update. `redeem` has the correct atomic pattern but the race case is not covered.
4. **Split-payment provider failure paths** — `payments.service.ts:671-720` splits loop with provider intent + confirm; no test simulates provider failure mid-split (partial-commit state).
5. **No tests for any analytics/dashboard/reporting service** — every analytics module is 0% covered.
6. **No tests for external-call timing** — `createPaymentIntent`/`confirmPayment` awaited inside a DB `$transaction` (Q3); no test asserts transaction health under slow provider.

## 3. Code-Quality Findings

### Q1 — HIGH / Data Integrity / `gift-cards.service.ts:92-112`

- **Root cause:** `recharge()` is a read-modify-write: reads `currentBalance` via `findOne`, computes `balanceAfter = balanceBefore + amount`, then writes the absolute value with a plain `update`.
- **Impact:** two concurrent recharges lost-update each other (balance undercount); the balance write and the `GiftCardTransaction` create are separate operations in `Promise.all` — not transactional, so a failed create leaves a balance change with no ledger row.
- **Proof:** lines 92-112 (no `$transaction`, no `increment`, no isolation level). Contrast `redeem()` lines 124-147 which is correctly atomic: `updateMany` + `currentBalance: { decrement }` + `currentBalance: { gte }` guard inside `$transaction`.
- **Fix:** mirror `redeem`: `tx.giftCard.updateMany({ where: { id, tenantId, status:'ACTIVE' }, data: { currentBalance: { increment: amount } } })` inside `$transaction`, then create the ledger row in the same tx.

### Q2 — MEDIUM / Performance / N+1 loop queries

- `recipes.service.ts:560-583` — per-ingredient `tx.inventoryItem.findUnique` + `update` + `stockMovement.create` inside `$transaction`.
- `transfers.service.ts:368-371` (and 570) — per-item `tx.inventoryItem.findFirst` + updates in `startTransfer`/complete.
- `product-tags.service.ts:247-254` — per-tagId `productTag.findFirst`.
- **Impact:** O(n) DB round trips per operation; bounded by item/tag counts (low-moderate at current scale, but unbounded as menus/transfers grow).
- **Fix:** batch `findMany({ where: { id: { in } } })` + validate by count; where possible use `updateMany`/`increment`.

### Q3 — LOW-MEDIUM / Transaction anti-pattern / `payments.service.ts:667-720`

- **Root cause:** external provider calls (`createPaymentIntent`, `confirmPayment`) are awaited inside `prisma.$transaction`, holding the DB transaction open across network I/O.
- **Impact:** connection/row locks held for provider latency; retries can double-hold. Claim-based finalize (`finalizeSucceededPayment`, lines 114-131, `updateMany` status claim + `PaymentAlreadyFinalizedError`) is correctly atomic — only the tx boundary placement is suboptimal.
- **Fix:** create PENDING payment row first, commit, then call provider, then finalize in a short second tx (as finalize already does).

### Q4 — LOW / Type safety / `as unknown as` casts

- `plan-throttle.guard.ts:29` (`noop as unknown as PropertyDecorator & MethodDecorator`), `metrics.service.ts:175`, `export-engine.service.ts:200/209/327/332/337`, audit-log `oldValues/newValues` casts in allergens/branches/customers/cycle-counts/dining-areas services.
- `logger.service.ts` — pervasive `message: any`, `optionalParams: any[]`, `extractContext(params: any[])` / `extractMeta(params: any[])`.
- **Impact:** bypasses compile-time guarantees on those paths; low runtime risk.

### Q5 — INFO / God-services / file size

- Largest: `customers.service.ts` 1,511; `orders.service.ts` 1,433; `inventory.service.ts` 1,301; `payments.service.ts` 1,187; `purchasing.service.ts` 1,114; `auth.service.ts` 885; `campaigns.service.ts` 862.
- **Impact:** testability/maintainability risk; consistent with observed low coverage in those files' branches.

### Q6 — Not found (claims from prior reports NOT reproduced)

- `console.log`/`console.error`/`debugger` in src: **0**.
- Empty `catch {}`: **0**.
- `TODO`/`FIXME`/`HACK`/`XXX`: **0**.
- `findMany` without `where`/`take`/`skip`: **0** (238 same-line hits are all false positives — multiline `where` blocks; block-aware scan confirmed every query is bounded).
- Missing DB indexes: **none found** — schema has comprehensive indexes incl. `Order[tenantId,status,createdAt]`, `Payment` unique `[tenantId,idempotencyKey]` + `[status]`/`[orderId]`/`[tenantId,createdAt]`, `KitchenTicket[status]/[tenantId,createdAt]`, `StockMovement[referenceType,referenceId]`, `GiftCard[code]/[status]`.
- `Number()` on user input without validation: **not found** — 553 hits are overwhelmingly `@IsNumber()` class-validator decorators; runtime conversions are internal DB-decimal reads.

## 4. Performance Findings

- **N+1 loops:** 3 confirmed sites (Q2), all item-bounded.
- **Unbounded reads:** 0.
- **Indexes:** adequate across all hot paths (no schema fix required).
- **Largest risk:** analytics/reporting services (dozens of `findMany` over `order`/`orderItem`/`inventoryItem`/`kitchenTicketItem` with date-range `where`) are untested and would be the first to degrade; mitigation (indexes) is in place.
- **Coverage thresholds are calibrated to reality, not aspiration** (jest.config.ts:35-168): e.g. `payments 60%`, `orders 60%`, `customers 25%`, `inventory 20%`, `customer-analytics 10%`, `inventory-analytics 10%`, `sales-analytics 15%`, `crm 20%`, `payments/providers excluded`. The default `nx test api` runs without `--coverage`, so the threshold block is inert in the normal gate; a coverage run passes only because thresholds were set at current levels.

## 5. Actual Gate Results (live, --skip-nx-cache)

| Gate                   | Command                                                  | Result                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit/integration tests | `npx nx test api --skip-nx-cache --runInBand`            | **PASS** — 55/55 suites, 519/519 tests, 0 failures, 47.7s                                                                                                                      |
| Lint                   | `npx nx lint api --skip-nx-cache` (`eslint . --ext .ts`) | **FAIL** — 7 prettier/prettier errors in `apps/api/src/modules/payments/tests/integration/payment-flow.integration.spec.ts:174-182`; all auto-fixable; 0 non-formatting errors |

---

## Bottom line

- **"55 suites / 519 tests passing" is VERIFIED TRUE** for the test target.
- **Lint gate FAILS** (7 prettier violations in one spec file) — a CI gate that runs lint is currently red.
- **Real coverage is ~20% lines / ~15% functions / ~12% branches**, concentrated in auth/payments/orders/inventory/customers/users/crm/common; 57 services (incl. purchasing, recipes, transfers, campaigns, costing, all analytics) have no tests; Stripe provider is mock-mode-only and excluded from coverage.
- **One confirmed HIGH-severity data-integrity bug:** gift-card `recharge` lost-update race (Q1) — notably adjacent to a correctly-written `redeem`.
- Prior-report claims about console-log pollution, empty catches, TODOs, unbounded `findMany`, and missing indexes were **not reproducible** and should not be re-cited.
