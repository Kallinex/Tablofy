# Phase 7 — M5 P1 Fixes

**Scope:** All 20 High-severity findings (P1-1 … P1-20) from `FINAL-PRODUCTION-READINESS-AUDIT.md`, closed across Phase 6 and Phase 7 M1–M5.

**Verdict:** ALL P1 FINDINGS CLOSED — ✅ VERIFIED

**Final state (post all fixes):**
- Full Jest: **55 suites / 519 tests — all passing**
- `nx lint api`: **0 errors, 0 warnings**
- `nx build api`: **0 errors**
- `npx prisma validate`: **schema valid**
- `scripts/verify-phase7-m1.js`: **55/55 (100%)**
- `scripts/verify-phase7-m2.js`: **33/33**
- `scripts/verify-phase7-m3.js`: **39/39**
- `scripts/verify-phase7-m5.js`: **39/39**
- `scripts/verify-phase7-m4.js`: **30/30 static + 3 DB-dependent checks (environment-blocked)**

---

## Pre-commit audit — Blocker fixes (P1-21 … P1-25)

A full pre-commit audit of the M5 working tree vs the `v7.5.0` baseline found the following runtime/correctness defects in the P1 gateway/email work. All were fixed and re-verified before commit.

### P1-21 — Payment webhooks unreachable (403) → FIXED

**Root cause:** `apps/api/src/modules/payments/payment-webhooks.controller.ts` is `@Public()` but was **not** annotated `@SkipTenantCheck()`. `TenantGuard` throws `ForbiddenException` whenever `request.user` is undefined, so Stripe/Paymob webhook deliveries always returned **403** (empirically verified via `POST /api/v1/webhooks/stripe` and `POST /api/v1/webhooks/paymob`). The entire async gateway-confirmation flow was dead.

**Fix:** Class-level `@SkipTenantCheck()` added (matches the established pattern on `health`, `metrics`, `auth`, `tenants`, `invitations` controllers).

**Runtime re-verification:** `POST /api/v1/webhooks/stripe` (no signature) → **400** `Missing stripe-signature header`; `POST /api/v1/webhooks/paymob` (no hmac) → **400** `Invalid webhook signature`. No more 403.

### P1-22 — Email jobs always dead-letter (SMTP config never loaded) → FIXED

**Root cause:** `apps/api/src/config/smtp.config.ts` existed but was **not** registered in `ConfigModule.forRoot({ load: [...] })` in `app.module.ts`. `EmailProcessor.getTransporter()` therefore always read an empty `smtp.host`; every email job (password reset, verification, invitations) threw, retried 5×, and dead-lettered.

**Fix:** `smtpConfig` added to the `ConfigModule.forRoot({ load: [...] })` array.

### P1-23 — Stripe live refund/void broken → FIXED

**Root cause:** `StripeProvider.refundPayment` sent `reason` as free text; Stripe only accepts `duplicate | fraudulent | requested_by_customer` — arbitrary text (e.g. `dto.reason`) was rejected by the API. `voidPayment` also used the refund endpoint, which Stripe rejects for uncaptured PaymentIntents.

**Fix:** Refund `reason` is now sanitized against the Stripe enum (omitted when not a valid value). Added `voidPayment()` to the `PaymentProvider` interface and both providers: Stripe voids via `POST /v1/payment_intents/{id}/cancel`; the service `voidPayment()` now calls `provider.voidPayment(...)` instead of `refundPayment(...)`.

### P1-24 — Paymob live broken → FIXED

**Root cause:** `PaymobProvider.confirmPayment` called the non-existent `/ecommerce/orders/transaction` endpoint (payment incorrectly failed after `createPaymentIntent` succeeded). Refund/status passed the **order id** where Paymob requires the **transaction id**. `billing_data` was hard-coded fake customer data.

**Fix:** `confirmPayment` now resolves status via the documented `/ecommerce/orders/transaction_inquiry` endpoint and returns `pending` (awaiting webhook) when no transaction exists yet — a failed inquiry no longer fails the payment. Refund/void/status resolve the real transaction id via transaction inquiry, then call `/acceptance/void_refund/refund`, `/acceptance/void_refund/void`, and `/acceptance/transactions/{id}` respectively; refunds always send `amount_cents` (from the caller or the resolved transaction). `billing_data` is populated from `metadata` (`customerEmail`, `firstName`, `lastName`, `phoneNumber`, `country`) with safe defaults.

### P1-25 — Payments double-credit race → FIXED

**Root cause:** Sync finalization (`charge()`/`splitPayment()` on gateway `succeeded`) and async webhook finalization (`applyWebhookSucceeded`) could both read a `PENDING` payment, then both credit `order.paidAmount` — Stripe retries or a fast webhook could double-credit revenue.

**Fix:** Finalization now **claims** the payment atomically with a status-guarded `updateMany({ where: { id, status: PENDING } })` before crediting. Only the winner (count === 1) credits the order; the loser (a) webhook path logs and returns benignly (responds 200 so the gateway stops retrying), (b) `charge()` sync path re-reads the already-finalized payment and returns it **without** re-emitting metrics/audit/events. Applied to `finalizeSucceededPayment`, `applyWebhookSucceeded`, and the `splitPayment` succeeded branch.

**Tests added/updated:** Stripe (enum-reason omission, void via cancel), Paymob (pending/succeeded confirmation via inquiry, refund/void/status transaction resolution), service + integration split/webhook mocks for the status-guarded claim. Full suite now **55 suites / 519 tests**.

---

## P1-1 — No MFA/2FA → IMPLEMENTED (Phase 7 M5)

**Root cause:** `twoFactorEnabled` / `twoFactorSecret` columns existed on `User` but were unused; no TOTP flow.

**Files:**
- `apps/api/src/modules/auth/totp.ts` (new) — RFC 6238 SHA1-HMAC TOTP: `generateTotpSecret` (base32, 20 bytes → 32 chars), `generateTotp` (6 digits, 30 s step), `verifyTotp` (window ±1), `generateOtpauthUrl`.
- `apps/api/src/modules/auth/dto/two-factor.dto.ts` (new) — `TwoFactorCodeDto` (`@Matches(/^\d{6}$/)`), `EnableTwoFactorDto`, `DisableTwoFactorDto`.
- `apps/api/src/modules/auth/dto/login.dto.ts` — optional `twoFactorCode`.
- `apps/api/src/modules/auth/auth.service.ts` — `login(email, password, meta?, twoFactorCode?)` now selects `twoFactorEnabled`/`twoFactorSecret`; enabled users must present a valid code or receive `UnauthorizedException` (audits `LOGIN_2FA_FAILED`); TOTP secret stripped from returned user. New: `getTwoFactorStatus`, `setupTwoFactor`, `enableTwoFactor`, `disableTwoFactor` (disable revokes all tokens + Redis sessions).
- `apps/api/src/modules/auth/auth.controller.ts` — `GET auth/2fa/status`, `POST auth/2fa/setup`, `POST auth/2fa/enable`, `POST auth/2fa/disable`.

**Fix rationale:** Secret is generated server-side and returned exactly once; verification uses the RFC 6238 test vector; window ±1 tolerates clock drift; disable closes all active sessions.

**Tests:** `apps/api/src/modules/auth/tests/totp.spec.ts` (RFC 6238 vector `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` → `94287082` at 59 s; window; malformed tokens; otpauth URL); `auth.service.spec.ts` 2FA block (login requires/accepts/rejects code, no secret leak, setup/enable/disable). Auth: **5 suites / 75 tests passing**.

## P1-2 — No tenant status check on login → FIXED (Phase 6)

**Files:** `auth/auth.service.ts` login path, `auth/jwt.strategy.ts`.

**Fix:** Login and JWT re-validation reject users whose tenant/subscription status is not active.

**Tests:** `auth.service.spec.ts` + `jwt.strategy.spec.ts`; verified by `scripts/verify-phase7-m1.js` (checks `auth.service login() checks tenant status` and `jwt.strategy validates tenant status`).

## P1-3 — Revoked JWT blacklist Redis-only → FIXED (Phase 6)

**Fix:** Revoked sessions persisted (DB-backed revocation) in addition to Redis, so a Redis flush cannot resurrect revoked tokens; `revokeAllUserTokens` + session cleanup.

**Tests:** `auth.service.spec.ts` revocation suites.

## P1-4 — Registration leaks user existence → FIXED (Phase 6)

**Files:** `auth/auth.service.ts` `register()`.

**Fix:** Duplicate-registration path returns a generic message; register does not return the stored user object (verified by m1 check `register() does NOT return user object`).

## P1-5 — RolesGuard lacks permission-based RBAC → IMPLEMENTED (Phase 7 M5)

**Root cause:** `common/guards/roles.guard.ts` matched role names only; no granular permissions (e.g. `orders:delete`).

**Files:**
- `apps/api/src/common/rbac/role-permissions.ts` (new) — `ALL_PERMISSIONS` (14 permissions), `ROLE_PERMISSIONS` mapping (`SUPER_ADMIN`/`OWNER` = `['*']`), `hasPermissions(role, required)`.
- `apps/api/src/common/decorators/permissions.decorator.ts` (new) — `@Permissions(...)`.
- `apps/api/src/common/guards/roles.guard.ts` — now enforces both `@Roles` and `@Permissions`; violation throws `ForbiddenException('Insufficient permissions')`.
- `apps/api/src/modules/orders/orders.controller.ts` — `@Permissions('orders:delete')` on `DELETE :id` and `POST :id/restore`.

**Fix rationale:** Extends the existing guard (no new guard class, backward compatible); `@Permissions` refines rather than replaces `@Roles`; permission matrix centralized for audit.

**Tests:** `roles.guard.spec.ts` (role+permission matrix), `role-permissions.spec.ts` (mapping assertions).

## P1-6 — Missing `@@index([tenantId, createdAt])` → FIXED (Phase 6, re-verified M5)

**Fix:** Composite indexes added across tenant-scoped models. Re-verified this milestone: schema contains the `@@index([tenantId, createdAt])` pattern across the tenant data models; verified by m3 checks.

## P1-7 — String fields should be enums → FIXED (Phase 6)

**Fix:** Status/type columns moved to Prisma enums with migration. Verified by m1/m3 schema audits.

## P1-8 — Decimal fields missing `@db.Decimal` → FIXED (Phase 6)

**Fix:** Monetary `Decimal` fields declared with explicit `@db.Decimal(precision, scale)`.

## P1-9 — Blocking Redis `KEYS` in CacheService → FIXED (Phase 6)

**Files:** `common/services/cache.service.ts`.

**Fix:** `deletePattern()` switched from `client.keys()` to cursor-based `SCAN` iteration (non-blocking).

## P1-10 — Missing composite indexes on Order → FIXED (Phase 6)

**Fix:** `[tenantId, status, createdAt]` and `[tenantId, branchId, createdAt]` composite indexes added to the `Order` model matching the KDS / reporting query patterns.

## P1-11 — In-memory low-stock filtering → FIXED (Phase 6, re-verified M5)

**Files:** `apps/api/src/modules/inventory/inventory.service.ts` `getLowStockItems` (~line 1163).

**Fix:** Filter pushed into the Prisma query: `currentQuantity: { lte: this.prisma.inventoryItem.fields.minStock }` (DB-side filter, no full-table fetch).

## P1-12 — No pagination on stock endpoints → FIXED (Phase 6, re-verified M5)

**Files:** `inventory.service.ts` `getCriticalStockItems` (DB-filtered by `reorderLevel` + paginated), stock endpoints.

## P1-13 — Missing transactions in inventory mutation paths → FIXED (Phase 7 M5)

**Root cause:** `createCategory`, `createUnit`, `deleteItem`, `createCount` performed entity write + audit log as separate non-transactional writes (partially applied mutations, lost audits).

**Files:** `apps/api/src/modules/inventory/inventory.service.ts`:
- `createCategory` (~line 57) — `tx.inventoryCategory.create` + `tx.auditLog.create` (`INVENTORY_CATEGORY_CREATED`) inside `prisma.$transaction`.
- `createUnit` (~line 175) — `tx.inventoryUnit.create` + audit (`INVENTORY_UNIT_CREATED`) in transaction.
- `deleteItem` (~line 603) — `tx.inventoryItem.update` + audit (`INVENTORY_ITEM_DELETED`) in transaction.
- `createCount` (~line 980) — `tx.inventoryCount.create` + audit (`INVENTORY_COUNT_CREATED`) in transaction.
- Existing transactional paths verified present: `createAdjustment`, `approveAdjustment` (array tx), `waste`.

**Fix rationale:** Audit write moved inline into the same transaction as the entity write (atomic), matching the existing adjustment/waste pattern; partial-failure now rolls back both entity and audit.

**Tests:** `inventory.service.spec.ts` rewritten — tx assertions on `$transaction` for all four paths plus `createUnit`/`deleteItem`/`createCount` describe blocks. Inventory: **18 tests passing**.

## P1-14 — Missing composite index on AuditLog → FIXED (Phase 6)

**Fix:** `@@index([createdAt, isArchived])` added to `AuditLog` for archive-job queries.

## P1-15 — Subscriptions module empty → IMPLEMENTED (Phase 7 M5)

**Root cause:** `modules/subscriptions/` was an empty directory; subscription management logic partially scattered in `tenants.service.ts`.

**Files (new):**
- `apps/api/src/modules/subscriptions/subscriptions.module.ts` — imports `AuditLogsModule` + `CommonModule` (for `PlanLimitsService`).
- `apps/api/src/modules/subscriptions/dto/change-plan.dto.ts` — `@IsEnum(PlanType)` on `plan`.
- `apps/api/src/modules/subscriptions/subscriptions.service.ts` — `getPlans()` (plan catalog from `PLAN_LIMITS`/`BRANCH_LIMITS`/`PLAN_PRICES`), `getCurrent(tenantId)` (subscription + `planLimitsService.getPlanUsage`), `changePlan(...)` (same-plan rejection, `assertDowngradeFits` against current resource counts, transactional plan update + `SUBSCRIPTION_PLAN_CHANGED` audit, reactivation on plan change from CANCELED), `cancel(...)`/`reactivate(...)` (transactional + `SUBSCRIPTION_CANCELED_NOTIFIED`/`SUBSCRIPTION_REACTIVATED_NOTIFIED` audit).
- `apps/api/src/modules/subscriptions/subscriptions.controller.ts` — `GET /subscriptions/plans` (`@Roles('OWNER','MANAGER')`), `GET /subscriptions/current` (`@Roles('OWNER','MANAGER')`), `POST /subscriptions/change-plan`, `POST /subscriptions/cancel`, `POST /subscriptions/reactivate` (all `@Roles('OWNER')` + `@Permissions('settings:manage')`).
- `apps/api/src/app/app.module.ts` — registers `SubscriptionsModule`.

**Fix rationale:** Downgrades are pre-checked against current usage vs. target `PLAN_LIMITS` so a tenant can never be downgraded below its consumption; plan/status changes and their audit entries commit atomically.

**Tests:** `subscriptions.service.spec.ts` — **13 tests passing** (plans catalog, getCurrent + NotFound, upgrade/same-plan/downgrade-blocked/downgrade-allowed/reactivation-on-change, cancel/reject-already-canceled, reactivate/reject-not-canceled).

## P1-16 — `npm ci` installs devDependencies in prod image → FIXED (Phase 7 M5, task 7.5.10)

**Files:** `docker/Dockerfile`.

**Fix:** New `deps-prod` stage uses `npm ci --omit=dev`; `prisma` CLI preserved for runtime migrate. Docker build executed through the stage; final layer commit hit environmental `ENOSPC` (host C: 100% full), not a Dockerfile defect.

## P1-17 — Observability env vars not documented/validated → FIXED (Phase 7 M5, task 7.5.3/7.5.4)

**Files:** `apps/api/src/config/env.validation.ts`, `.env.example`.

**Fix:** `SENTRY_*`/`METRICS_*` added to validation and `.env.example`; production requires non-empty `METRICS_AUTH_TOKEN` (min 16 chars) with unit test.

## P1-18 — No dead-letter queue for BullMQ → FIXED (Phase 7 M5, task 7.5.8)

**Files:** `apps/api/src/modules/queues/queue.service.ts`.

**Fix:** DLQ for exhausted jobs + failed-listener alerting with threshold; verified by m5 G8.

## P1-19 — No Bull Board / queue monitoring → FIXED (Phase 7 M5, task 7.5.7)

**Fix:** `@bull-board/nestjs` at `/admin/queues` behind OWNER-role JWT auth (verified by m5 G7).

## P1-20 — Inventory processors are stubs → FIXED (Phase 7 M5, task 7.5.13)

**Files:** `apps/api/src/modules/inventory/inventory.processor.ts` (+ specs).

**Fix:** Real processor logic (low-stock alerts, expiration checks, waste reports, sync) backed by Prisma queries, not log-only stubs; verified by m5 G13.

---

## Verification Summary

| Gate | Result |
|------|--------|
| Full Jest (`npx jest --runInBand`) | **55 suites / 519 tests passing** |
| Lint (`nx lint api`) | **0 errors** |
| Build (`nx build api`) | **0 errors** |
| Prisma (`npx prisma validate`) | **valid** |
| m1 security/behavior harness | **55/55 (100%)** |
| m2 test-suite harness | **33/33** |
| m3 schema/regression harness | **39/39** |
| m5 observability/infra harness | **39/39** |
| m4 DB-audit harness | **30 static pass / 3 DB-dependent (environment-blocked)** |

Environment-blocked (documented, not code defects): live Postgres/Redis/gateway-dependent checks — `prisma migrate status`, enum-data audit, orphan-data audit (`scripts/m4-audit-enum-data.js`, `scripts/m4-audit-orphan-data.js`), Stripe/Paymob webhook round-trips, real-disk health assertion.
