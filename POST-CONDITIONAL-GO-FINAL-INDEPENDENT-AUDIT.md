# POST-CONDITIONAL-GO-FINAL-INDEPENDENT-AUDIT

- **Date**: 2026-08-12
- **Scope**: Conditional-GO closure mission — gates **P0-A, P0-F, P0-H, P0-I, P0-J** + database/migration bookkeeping, gate verification, deploy of `tablofy-api`, final verdict.
- **Repository**: `D:\New folder (8)\tablofy`
- **Environment**: Windows host, Docker Compose (postgres 16, redis 7, api node:22-alpine), NestJS + Prisma 6.19.3, PostgreSQL `tablofy_prod`.
- **Classifier rule**: gates are `CLOSED | PARTIAL | OPEN | BLOCKED_EXTERNAL`. No BLOCKED→PASS conversion. No invented credentials. Final verdict `GO FOR PHASE 3`, `CONDITIONAL GO`, or `NO-GO`.

---

## 1. Mission Summary

Execute the conditional-GO closure for the five P0 gates plus DB bookkeeping: repair the migration ledger non-destructively, implement only the safety-critical logic the gates require, prove each gate with tests and live verification, deploy **only** `tablofy-api`, and issue a final verdict. No Phase-3 features were added.

## 2. Audit Method

Independent verification: every prior report was treated as untrusted. Each claim was re-derived from the source tree, the test suite, direct Postgres queries, and live container state. The deployed bundle was checksummed and compared byte-for-byte against the locally built production bundle produced from the audited source.

## 3. Environment Snapshot (Pre-Work)

- Working tree was a git repo with pre-existing uncommitted changes (see §28).
- DB: `tablofy_prod`, 127 tables, 0 data rows.
- `_prisma_migrations` ledger was absent → `prisma migrate status` reported 24 pending.
- Postgres logs showed an external `DROP TABLE _prisma_migrations` attempt at `2026-08-12 00:03:56`.
- Root cause: the CLI-visible `.env` had a **quoted** `DATABASE_URL` (`"postgresql://..."`), so the CLI (dotenv) resolved the datasource URL literally with quotes and could not reach the DB; the runtime container used the compose-injected **unquoted** URL and was unaffected.
- Deployed bundle: md5 `882f250e063111137ab35e4a7c880a78` (2,580,995 bytes).

## 4. DB Bookkeeping — Non-Destructive Ledger Repair

- Applied only `prisma migrate resolve --applied` for all 24 migration directories.
- No SQL executed, no schema change, no data written, no `migrate reset`, no DB recreation, no fabricated migration files.
- The only writes were the 24 ledger rows in `_prisma_migrations` (a table restore), which is the documented repair for a missing-but-in-tact schema.

## 5. DB Bookkeeping — Integrity Verification (Post-Work)

- `prisma validate`: schema valid.
- `prisma migrate status`: `Database schema is up to date!` (24/24 applied).
- `prisma migrate diff --from-url <prod> --to-schema-datamodel schema.prisma --exit-code`: `No difference detected.` (exit 0).
- Direct SQL: `_prisma_migrations` = 24 rows, 24 with `finished_at IS NOT NULL`; 127 tables.
- Data rows in key tables remain 0 (users, orders, payments, products, recipe_items, purchase_orders) — no data loss, none fabricated.
- Bookkeeping classification: **CLOSED**.

## 6. Runner Impact

The Dockerfile entrypoint runs `npx prisma migrate deploy` at boot. With the ledger repaired, boot logs show `No pending migrations to apply.` after redeploy — a no-op, as intended.

---

## 7. Five-Gate Matrix

| Gate     | Area                                            | Classification | Evidence                                          |
| -------- | ----------------------------------------------- | -------------- | ------------------------------------------------- |
| **P0-A** | Payment reconciliation read-only / no DB writes | **CLOSED**     | Code inspection + 12 contract tests (§8)          |
| **P0-F** | Inventory costing weighted-average              | **CLOSED**     | Bug fix + 8 tests (§9)                            |
| **P0-H** | Recipe update atomicity                         | **CLOSED**     | `$transaction` wrap + 6 tests (§10)               |
| **P0-I** | Dangling `PURCHASING` role strings              | **CLOSED**     | 6 routes cleaned + 3 tests + fixed tripwire (§11) |
| **P0-J** | Client-price trust (forged order prices)        | **PARTIAL**    | 6 tests + bounded residual (§12)                  |

---

## 8. P0-A — Reconcile Read-Only (CLOSED)

- `payments.service.ts` `reconcile()` (lines 1167–1215 pre-change; unchanged) performs only `findMany` / provider `getPaymentStatus` reads. No create/update/`$transaction`.
- `payments/tests/payments.service.spec.ts:1075` — `reconcile` suite replaced the single minimal test with **12 contract tests** (`1092–1280`):
  - returns report; **strictly read-only** (asserts no `create`/`update`/`$transaction` invocation); tenant isolation (`where.tenantId`); no `gatewayRef` → matched; mock provider → matched; succeeded+`COMPLETED` → match; succeeded+`PENDING` → mismatch; failed+`COMPLETED` → mismatch; failed+`FAILED`/`PENDING` → match; provider lookup failure → mismatch; provider throws → mismatch; counts-sum invariant.
  - `stubStatusProvider` (line 1076) registers a stub via `providerRegistry.set('stripe', …)`.
- Provider contract confirmed: Stripe/Paymob `getPaymentStatus` return `{ status, amount, currency }` (mock returns `{status:'succeeded', amount:0, currency}`).

## 9. P0-F — Costing Weighted-Average (CLOSED)

- **Bug found**: `costing.service.ts` fallback used `inventoryBatch.aggregate({ _sum: { quantity, unitCost } })` then `totalCost / totalQty`, i.e. it summed **per-unit costs**, not `quantity × unitCost`. For batches of 100@9.5 + 100@0.5 it produced `10/200 = 0.05` instead of `1000/200 = 5.00`.
- **Fix** (`costing.service.ts:162–180`): `findMany` + `Prisma.Decimal` reduce of `quantity × unitCost`, rounded `toDecimalPlaces(4, ROUND_HALF_UP)`.
- GRN path (`purchasing.service.ts:948–993`) already locks `FOR UPDATE` and maintains `averageCost` correctly — it remains primary; the fixed fallback is authoritative only when `averageCost` is unset. `averageCost` remains user-settable via inventory create/update (`inventory.service.ts:436,496`), keeping the fallback reachable.
- New `costing.service.spec.ts` — 8 tests: stored `averageCost` precedence; weighted formula; **not-sum-of-unit-costs regression** (100×9.5+100×0.5 → 5.00); fractional-quantity exact Decimal math; no active batches → `unitCost` fallback; FIFO oldest active batch cost; tenant isolation (`NotFound`); audit log + cache invalidation.
- `costing.processor.ts` has no parallel buggy aggregation path.

## 10. P0-H — Recipe Update Atomicity (CLOSED)

- **Bug found**: `updateRecipe` (`recipes.service.ts`) performed `recipe.update`, then `recipeItem.deleteMany`, then `recipeItem.createMany` outside any transaction — an item-write failure left the recipe header updated but items stale.
- **Fix** (`recipes.service.ts:222`): all three writes wrapped in `this.prisma.$transaction(async (tx) => …)`; `recalculateRecipeCost` / audit / cache invalidation remain outside (post-commit), as before.
- New `recipes/tests/recipes.service.update.spec.ts` — 6 tests: atomic commit via tx; **rollback on `createMany` rejection** (header not updated, no recalc/audit/cache); item replacement skipped when no items; cost recalculated after commit; tenant isolation; duplicate-name `ConflictException`.

## 11. P0-I — Dangling `PURCHASING` Role (CLOSED)

- `UserRole` enum (schema 14–23) has no `PURCHASING` member, so all six `@Roles(..., 'PURCHASING')` decorators were **behaviorally dead** — holders could never have used them, yet they implied intent.
- Removed `'PURCHASING'` from all 6 routes in `purchasing.controller.ts` (`createPO`, `updatePO`, `submitPO`, `orderPO`, `receivePO` → `OWNER, MANAGER`; `createGRN` → `OWNER, MANAGER, CASHIER`). Behavior-preserving; no schema/migration change.
- **Critical finding**: the existing RBAC tripwire `rbac-route-coverage.spec.ts` was **vacuous** — it scanned `(prototype, methodName)` and reported `controllers=0, routes=0` across all 74 controller files, because Nest `SetMetadata` stores handler metadata **on the handler function** (`descriptor.value`), not on the prototype.
- Probe with function-level metadata: **74 controllers / 593 routes / 0 ungated**. Rewrote the tripwire (`rbac-route-coverage.spec.ts`) to read `Reflect.getMetadata(ROLES_KEY|PERMISSIONS_KEY|AUTH_METADATA, proto[methodName])`. It now genuinely enforces deny-by-default and passes (66, line 66 describe).
- New `purchasing/tests/purchasing.roles.spec.ts` — 3 tests (roles attached, read via handler fn, GRN keeps CASHIER).
- `CHEF` in the recipes controller is the same class of dangling role but lies **outside** the five gates → left untouched, documented here.

## 12. P0-J — Client-Price Trust (PARTIAL)

- **Problem**: `CreateOrderDto` client fields `unitPrice` (≥0) and modifier `price` were fully trusted; `validateBusinessRules` verified product/variant existence but never priced from the catalog, so a client could forge an order total.
- **Implemented** (`orders.service.ts`):
  - `validateBusinessRules` (line 1400) now returns a `CatalogPrices` map (products `basePrice`, variants `price`, modifiers `price`) and additionally validates any provided `modifierId` (`NotFoundException` if unknown).
  - `resolveItemUnitPrice` (line 1477): **non-variant items use `Product.basePrice`; client `unitPrice` is ignored**.
  - `resolveModifierPrice` (line 1486): catalog `Modifier.price` when `modifierId` present (client `price` ignored); client `price` kept for **custom, id-less modifiers** (legitimate free-text extras).
  - `create()` (line 75) prices `subtotal`, item `total`, `unitPrice`, `priceSnapshot`, and modifier writes from the authoritative values; totals flow through existing `Decimal` money math.
  - Variant items keep client `unitPrice` (documented residual, below).
- New/updated tests in `orders/tests/orders.service.spec.ts` (76 total, all passing): forged `unitPrice` (0.01) on a non-variant item is ignored (stored 10.99, total 21.98); decimal-math test rewritten against catalog `basePrice`; catalog modifier price authoritative despite forged `price`; custom modifier keeps client price; unknown `modifierId` → `NotFoundException`; variant item keeps client price (documents the residual).

### 12.1 P0-J Residual Risk (why PARTIAL, not CLOSED)

- **Variant items**: when `variantId` is present, the order still accepts the client `unitPrice`. The data model does not define whether `ProductVariant.price` is a full or additive price, so switching to server-authoritative variant pricing could under/over-charge legitimate orders. Closing this requires a product decision (schema/price semantics), not a code fix.
- **Custom modifiers without `modifierId`** accept a client price by design (free-text line items).
- **Update path** (`update()` CAS, line ~299) still honors client `unitPrice` for order editing — treated as a legitimate manager price adjustment; totals are recomputed from stored prices and version-guarded.

---

## 13. Full Test Suite (Gate H)

- `jest --config jest.config.ts --no-coverage` (from `apps/api`): **90 suites / 1159 tests / 0 failures / 0 snapshots**.
- The RBAC tripwire test now executes real route scanning (~6s) instead of the previous vacuous instant pass.
- Re-run after eslint auto-format: still 90/1159 green.

## 14. Static Checks (Gate H)

- `tsc -p tsconfig.app.json --noEmit`: exit 0.
- `eslint . --ext .ts`: **0 problems** (20 prettier auto-fixable issues in new spec files were fixed with `eslint --fix`; re-lint clean).

## 15. Builds (Gate H)

- `nx build api`: success.
- `nx build api --configuration=production` (canonical bundle for deploy comparison): success.
- Docker image `docker-api:latest` built from `docker/Dockerfile` (webpack production build inside the builder stage): success.

## 16. Prisma Gates (Gate H)

- `prisma validate`: valid. `prisma migrate status`: up to date (24/24). `migrate diff --exit-code`: no difference.
- See §5 for the same checks run against the production database.

## 17. Live Health Probes (Gate H)

- `http://127.0.0.1:3000/api/v1/health` → 200
- `http://127.0.0.1:3000/api/v1/health/live` → 200
- `http://127.0.0.1:3000/api/v1/health/ready` → 200
- (Correct routes are under the global `api/v1` prefix; bare `/health/*` correctly 404s.)

---

## 18. Security Hygiene Audit (Phase G)

- **`.env` not committed**: `.env`, `.env.local`, `.env.*.local` are git-ignored; `git ls-files` confirms only `.env.example` is tracked and it contains placeholders (`USER:PASSWORD@localhost`, `your-minimum-32-character-secret-here`).
- **No real secrets in source**: all `sk_live_*` / `sk_test_*` occurrences are dummy literals inside test files only; no private keys, no `postgresql://user:pass@host` in code.
- **No credentials in reports**: scan of all `*.md` for `sk_*`, private keys, connection strings with passwords, and filled `JWT_SECRET`/`REDIS_PASSWORD` → zero matches.
- **Logger redaction** (`common/logger/logger.service.ts:152`): 24 sensitive keys (`password`, `token`, `authorization`, `secret`, `apiKey`, `jwt`, `bearer`, `clientSecret`, `hmac`, `signature`, …), recursive sanitize to depth 10, applied across all log levels; covered by `logger.service.spec.ts` (direct/nested/array/error metadata cases).
- **Webhook header sanitization**: `webhook-processor.ts:35` `sanitizeUserHeaders` strips auth/signature-like headers before persist/log.

## 19. Gateway Mode Separation (Phase G)

- `config/payments.config.ts` enforces: production **forbids** `PAYMENTS_MODE=mock` and `=test`; `live` requires `STRIPE_SECRET_KEY` or `PAYMOB_API_KEY` and **rejects `sk_test_*` keys**; `test` requires an `sk_test_*` key. Covered by `payments.config.spec.ts`.
- `payments.module.ts` wires provider mode from config; `StripeProvider` defaults to `mock` and throws if `live`/`test` without a key.
- Running production container: `PAYMENTS_MODE=live`, `NODE_ENV=production`; boot log `StripeProvider initialized (mode=live)`; `PaymobProvider initialized (mode=mock …)` (no Paymob key configured). Values of configured keys were not inspected and not exposed.

## 20. Redis AUTH (Phase G)

- Live probe: unauthenticated `redis-cli PING` → `NOAUTH Authentication required.`; authenticated PING → `PONG`.
- App connects via `buildRedisConnectionOptions` using `REDIS_PASSWORD` explicitly (`redis.config.ts:6`, `redis.service.ts:18`), not the password-less `REDIS_URL`.
- `env.validation.ts:236` requires `REDIS_PASSWORD` ≥16 chars in production; compose requires it for both `redis` and `api`.
- Boot log confirms `Redis connected successfully.`

---

## 21. Deployment — Scope Discipline

- Only the `api` service was recreated: `docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api` (from `docker/`, using `docker/.env`).
- `postgres` and `redis` containers were untouched (no recreation, no restart, no data change).

## 22. Deployment — Bundle Integrity

| Artifact                                        | md5                                | Bytes     |
| ----------------------------------------------- | ---------------------------------- | --------- |
| Previously deployed bundle                      | `882f250e063111137ab35e4a7c880a78` | 2,580,995 |
| Local `nx build api --configuration=production` | `7411d739ed7dda141ef4126ec185c277` | 2,583,229 |
| New image `docker-api:latest` `app/main.js`     | `7411d739ed7dda141ef4126ec185c277` | 2,583,229 |
| Running container `app/main.js`                 | `7411d739ed7dda141ef4126ec185c277` | 2,583,229 |

The deployed bundle is byte-identical to the locally built bundle produced from the audited source — the code that passed all gates is exactly the code now running.

## 23. Deployment — Runtime Verification

- Container: `STATUS=running RESTARTS=0`.
- Health: `/api/v1/health`, `/api/v1/health/live`, `/api/v1/health/ready` all 200.
- Boot logs: `No pending migrations to apply.` → `Nest application successfully started` → `Redis connected successfully`; Stripe `mode=live`; **no ERROR lines**.
- Bundle sentinels: `PURCHASING` count = 0 (P0-I strings gone); `basePrice` present (13, P0-J); `averageCost` present (27, P0-F); `Modifier`/`not found` literals present.
- DB unchanged by deploy: `_prisma_migrations` 24/24, 127 tables, 0 rows in key tables.

## 24. Deploy Classification

- **CLOSED**: build reproducible byte-for-byte, only `tablofy-api` recreated, health/startup clean, no migration side effects, gateway/Redis config preserved.

---

## 25. STOP-Condition Audit

No stop condition was triggered:

- Bookkeeping was possible and completed non-destructively (no reset/recreate/fabrication).
- No uncertain money math introduced: P0-F uses `Decimal` exact math; P0-J prices from catalog and totals via existing `Decimal` utilities.
- Concurrency: P0-H relies on a single Prisma transaction; order update path retains its version-CAS; GRN retains its `FOR UPDATE` lock.
- Tenant isolation: all new lookups filter `tenantId`; new tests assert it.
- No client-price manipulation left unchecked beyond the documented P0-J residuals (§12.1).
- No secrets committed or exposed; no credentials invented.

## 26. Residual Risks / Known Gaps

1. **P0-J variant pricing** (bounded): variant items still accept client `unitPrice`; needs product decision on `ProductVariant.price` semantics (schema-level change) to close.
2. **Reconcile amount/currency**: `reconcile()` matches on status/reference only; it does **not** compare provider `amount`/`currency` against local values (gap documented, intentionally not implemented — no agreed mutation contract).
3. **`CHEF` dangling role** in recipes controller: same dead-role class as P0-I but outside the five gates; recommend the same cleanup as a P0/P1 follow-up.
4. **Pre-existing uncommitted work**: the tree carries earlier uncommitted changes (see §28) not authored by this mission; they were present before this audit and pass every gate, but their provenance is the prior work packages, not this one.
5. **Custom (id-less) modifiers** and order **update** pricing remain client-influenced by design (free-text extras / manager price adjustments).

## 27. Files Changed by This Mission

- `apps/api/src/common/rbac/rbac-route-coverage.spec.ts` — tripwire rewritten (function-level metadata).
- `apps/api/src/modules/costing/costing.service.ts` — weighted-average fallback fix.
- `apps/api/src/modules/costing/costing.service.spec.ts` — NEW, 8 tests.
- `apps/api/src/modules/orders/orders.service.ts` — catalog-authoritative pricing.
- `apps/api/src/modules/orders/tests/orders.service.spec.ts` — 6 new/updated price tests.
- `apps/api/src/modules/payments/tests/payments.service.spec.ts` — reconcile suite (12 contract tests).
- `apps/api/src/modules/purchasing/purchasing.controller.ts` — 6 dead `PURCHASING` strings removed.
- `apps/api/src/modules/purchasing/tests/purchasing.roles.spec.ts` — NEW, 3 tests.
- `apps/api/src/modules/recipes/recipes.service.ts` — `updateRecipe` in `$transaction`.
- `apps/api/src/modules/recipes/tests/recipes.service.update.spec.ts` — NEW, 6 tests.
- `apps/api/src/test/factories/order.factory.ts` — test factory supports `modifiers`.
- `POST-CONDITIONAL-GO-FINAL-INDEPENDENT-AUDIT.md` — this report.

## 28. Pre-Existing Working-Tree Modifications (not authored by this mission)

Present before this audit and out of its scope: `app.module.ts`, `common/logger/logger.service.ts` + spec, `api-keys/guards/api-key.guard.ts` + spec, `auth/auth.controller.ts` + spec, `invitations/invitations.service.ts` + spec, `payments/dto/payment-response.dto.ts`, `payments/payments.controller.ts`, `payments/payments.service.ts`, `users/users.service.ts` + spec. All are covered by the full suite/typecheck/lint/build gates that pass.

## 29. Evidence Chain (how this report was verified)

Every conclusion above was re-derived in this session: `git diff` of each change; jest/tsc/eslint/build runs; `prisma validate/status/diff` against the live DB with the unquoted `DATABASE_URL`; direct `psql` queries; `docker inspect`/`docker exec` for env, image, bundle md5, logs, and sentinels; HTTP probes; live Redis AUTH probes; report-wide secret-pattern scan.

---

## 30. FINAL VERDICT

**CONDITIONAL GO FOR PHASE 3.**

- Four of five gates are **CLOSED** (P0-A, P0-F, P0-H, P0-I) with code fixes, test coverage, static gates green, and a byte-identical verified deploy.
- One gate is **PARTIAL** (P0-J): the dominant forgery vector (non-variant catalog items and catalog modifiers) is closed and tested; the residual (variant items) cannot be closed without a product decision on `ProductVariant.price` semantics and is explicitly documented, bounded, and out of reach of a safe code-only change.
- DB bookkeeping is **CLOSED** and non-destructive: 24/24 ledger, zero drift, 127 tables, 0 data rows, no migration side effects on redeploy.
- Condition: Phase 3 may proceed provided the P0-J variant-pricing residual and the P0-A amount/currency gap are carried as explicit Phase-3 backlog items with a product decision recorded before variant-item server pricing is implemented, and the pre-existing working-tree changes are committed/curated under their originating work packages.

**Sign-off basis**: full suite 90/1159 green, `tsc` clean, ESLint clean, production build reproducible, live health 200/200/200, no STOP condition triggered.
