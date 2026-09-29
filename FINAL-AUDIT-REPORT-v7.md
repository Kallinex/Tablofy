# FINAL AUDIT REPORT v7

**Project:** Tablofy — Enterprise Restaurant SaaS Platform
**Audit Date:** 2026-08-05
**Repository:** `tablofy` (NestJS monorepo — apps/api + prisma + libs)
**Scope:** Close-out audit of P0 blocker remediation (privilege escalation + payments) plus re-verification of the full Phase 1–7.5 surface
**Method:** Code inspection, targeted unit/integration test execution (Jest), ESLint, production build (webpack via Nx), Prisma validation, phase verification scripts (`scripts/verify-*.js`)
**Prior Status:** ❌ NOT PRODUCTION READY — 2 P0 blockers open
**Current Status:** Both P0 blockers **fixed and verified**; non-P0 findings tracked; live-environment verification outstanding

---

## EXECUTIVE SUMMARY

The two P0 blockers that previously forced a **❌ NOT PRODUCTION READY** verdict have been fully remediated and re-verified:

| #    | Blocker                                                                                                                                                                                          | Severity      | Status    | Verified By                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | Privilege escalation: non-SUPER_ADMIN roles could mint/assign SUPER_ADMIN and escalate their own role                                                                                            | P0 (Critical) | **FIXED** | `users.service.spec.ts` (18 tests), `role-policy.spec.ts`, lint, build                                                                   |
| P0-2 | Payments module used mock/fabricated provider data; gateway was never called; no idempotency; no webhook verification; COMPLETED marked on fabricated success; mock mode permitted in production | P0 (Critical) | **FIXED** | `payments.service.spec.ts`, `stripe.provider.spec.ts`, `paymob.provider.spec.ts`, integration split-flow, lint, build, `prisma validate` |

**Verification results (all green):**

| Check                                         | Result                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Full Jest suite (Nx)                          | **448 passed / 50 suites**                                                              |
| Payments-focused suites                       | **87 passed / 5 suites**                                                                |
| ESLint (`npx eslint . --ext .ts`)             | **0 errors**                                                                            |
| Production build (`npx nx build api`)         | **Successfully ran target build for project api**                                       |
| Prisma schema validation                      | **valid**                                                                               |
| Phase verification scripts (DB-free)          | m3/m4/m1/m3/m5 **ALL CHECKS PASSED**                                                    |
| Phase verification scripts (DB/DB-free mixed) | m2 (1 pre-existing gap), m2-stale (2 baseline mismatches), m4 (3 DB-dependent) — see §4 |

**Open findings after remediation:** 5× P1, 2× P3 carried forward + 2 new P3 (verification-script hygiene). No P0/P1 security blockers remain in the RBAC or payments domains.

---

## VERDICT

> ## ⚠️ APPROVED WITH FIXES
>
> **Both P0 blockers are fixed, tested, linted, built, and schema-validated.**
>
> **Conditions before production deployment:**
>
> 1. Run live-environment verification (real Postgres/Redis, `prisma migrate deploy`, real Stripe/Paymob credentials, live webhook delivery, API E2E against a running instance) — see §6. These are environment-blocked here and remain unproven in a real runtime.
> 2. Close or formally accept the 5 carried P1 findings (§3) before the next release cycle.
> 3. In production, `PAYMENTS_MODE` MUST be `live`; `mock` is hard-forbidden by both config load and the runtime guard.

---

## 1. P0-1 — PRIVILEGE ESCALATION (FIXED)

### Root cause

`users.controller.ts` / `users.service.ts` assigned roles using a `@IsIn(['SUPER_ADMIN','OWNER','MANAGER','STAFF'])` DTO list and an in-controller `hasRole` check that never enforced a role hierarchy. A `MANAGER` (or any authenticated tenant actor) could call `assignRole` to mint `SUPER_ADMIN`, `OWNER`, or `MANAGER`; a `MANAGER` could also escalate their own role via `updateUser`. The `invitations` flow accepted any role without re-validating the inviter's authority at accept time, and self-assignment during the invite-accept path was effectively unrestrained. This is a direct privilege-escalation / cross-tenant-trust violation.

### Fix (defense-in-depth, three layers)

1. **Central policy** — `apps/api/src/common/rbac/role-policy.ts`:
   - `TENANT_ASSIGNABLE_ROLES` (line 3): only `STAFF`/`MANAGER`/`OWNER` — `SUPER_ADMIN` is never assignable inside a tenant.
   - `canAssignRole(actorRole, targetRole)` (line 65): actor must outrank target; `SUPER_ADMIN` can assign anything; `OWNER` up to `MANAGER`; `MANAGER`/`STAFF` cannot escalate to `OWNER`/`MANAGER` or `SUPER_ADMIN`.
   - `canManageUser(actorRole, targetRole)` (line 69): self-escalation blocked (equal-or-higher rank required).
2. **Service enforcement** — `apps/api/src/modules/users/users.service.ts`:
   - `create` re-checks `canAssignRole(creatorRole, targetRole)` (line 50).
   - `update` checks `canManageUser(editorRole, existing.role)` (line 151) and `canAssignRole(editorRole, dto.role)` (line 157).
   - `softDelete` (line 210) and `restore` (line 250) check `canManageUser`.
   - All signatures now receive the authenticated actor's role (creator/editor/deleter/restorer).
3. **Invitation accept-time re-validation** — `apps/api/src/modules/invitations/invitations.service.ts`:
   - Invite creation validates `canAssignRole(inviterRole, targetRole)` (line 39).
   - Accept path re-validates the current inviter against the stored `invitation.role` (lines 168–171) and assigns that validated role (line 180).
   - DTOs `dto/create-user.dto.ts`, `dto/update-user.dto.ts`, `dto/create-invitation.dto.ts` restrict `@IsIn(TENANT_ASSIGNABLE_ROLES)`.

### Verification

- `users.service.spec.ts`: 18 tests — findAll/findOne/create/update/softDelete/restore incl. MANAGER→OWNER and MANAGER→MANAGER rejection, SUPER_ADMIN escalation rejection, self-escalation blocked.
- `role-policy.spec.ts`: SUPER_ADMIN never tenant-assignable; SUPER_ADMIN assigns any role; tenant roles cannot assign SUPER_ADMIN; OWNER→MANAGER-and-below; MANAGER restrictions.
- Full suite, lint, build all pass (no regressions).

---

## 2. P0-2 — PAYMENTS: FABRICATED MOCK DATA, NO IDEMPOTENCY, NO WEBHOOKS (FIXED)

### Root cause

`stripe.provider.ts` / `paymob.provider.ts` returned hard-coded fabricated IDs (`pi_mock_*`, `paymob_order_*`) and always "succeeded"; `payments.service.ts` marked payments and orders `COMPLETED` on that fabricated success — the real gateway was never contacted even in "live" mode. There was no idempotency (double-charge on retry), no payment-webhook verification, and no guard preventing `mock` mode from running in production. Refunds/voids were likewise simulated.

### Fix

1. **Explicit provider modes** — `apps/api/src/config/payments.config.ts` (`registerAs('payments')`):
   - `PAYMENTS_MODE` (`mock`|`live`, default `mock`; invalid value throws).
   - Production + `mock` throws at config load.
   - `live` requires `STRIPE_SECRET_KEY` or `PAYMOB_API_KEY`; live forbids `sk_test_*` test keys.
   - Exports `DEFAULT_STRIPE_API_BASE` / `DEFAULT_PAYMOB_API_BASE`.
   - Wired into `config/index.ts`, `app.module.ts`, `config/env.validation.ts` (PAYMENTS*MODE, STRIPE*\_, PAYMOB\_\_ incl. `PAYMOB_INTEGRATION_ID`), root `.env.example`.
2. **Real gateway integration** — `apps/api/src/modules/integrations/interfaces/payment-provider.interface.ts` expanded (`PaymentIntentData`, `RefundData`, `ConfirmedPayment`, `GatewayWebhookEvent`, `createPaymentIntent(data, idempotencyKey?)`, `confirmPayment`, `refundPayment`, `getPaymentStatus`, `verifyWebhookSignature`, `parseWebhookEvent`).
   - `stripe.provider.ts` (rewritten): live calls the Stripe API with `Idempotency-Key` header; mock mode simulates; `@Optional()` options constructor; init requirement is live-only.
   - `paymob.provider.ts` (rewritten): live flow auth token → `/ecommerce/orders` → `/acceptance/payment_keys`; mock simulates; HMAC signature verification (sha512 over documented field order).
3. **Idempotency** — Prisma `Payment.idempotencyKey String?` + `@@unique([tenantId, idempotencyKey])`; hand-written migration `prisma/migrations/20260805000000_payments_idempotency_key/migration.sql` (adds column + unique index `payments_tenantId_idempotencyKey_key`). `charge()` uses DTO key or `randomUUID()`, replays the existing payment on duplicate key/P2002; refunds use `refund_`/`partial_refund_`/`void_` idempotency keys.
4. **Webhook verification** — `apps/api/src/modules/payments/payment-webhooks.controller.ts` (`POST api/v1/webhooks/stripe`, `POST api/v1/webhooks/paymob`, both `@Public()` + `@SkipTenantCheck()` but signature-verified, `@HttpCode(200)`); `main.ts` enables `{ rawBody: true }`. Stripe `t=…v1=…` HMAC-SHA256 over `${timestamp}.${raw}`; Paymob sha512. Events applied only via status-guarded optimistic-lock transactions (P1-25); payment/order never reaches `COMPLETED` without a gateway `succeeded`.
5. **Production mock guard** — `payments.service.ts` `assertNotMockInProduction(provider)` (line 54) throws `BadRequestException` whenever `app.nodeEnv === 'production'` and provider mode is `mock`, enforced on every gateway entry point (lines 198, 420, 497, 577, 667) plus `onModuleInit` (line 48).
6. **Provider wiring** — `payments.module.ts` builds providers from `STRIPE_PROVIDER_OPTIONS` / `PAYMOB_PROVIDER_OPTIONS` via ConfigService factories.

### Verification

- `payments.service.spec.ts` new `charge (gateway methods)` + `handleGatewayWebhook` blocks: production-mock refusal, idempotency replay, pending/succeeded/failed branches, signature rejection, webhook completion/failure.
- `stripe.provider.spec.ts` / `paymob.provider.spec.ts` rewritten: mock mode, live mode with captured HTTP (asserts `Idempotency-Key` header), valid/invalid signatures, event mapping.
- `payment-flow.integration.spec.ts` split-mock updated (includes `payment.update`).
- Payments total: **87 tests / 5 suites**, all passing; full suite 448; lint 0; build success; `prisma validate` valid.

---

## 3. OPEN FINDINGS (CARRIED FORWARD / RE-CONFIRMED)

### P1 (High)

| #   | Finding                                                                                                         | Root cause                                                                                                                       | Location                                                                                                                               | Status   |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Cross-tenant `softDelete` on orders bypasses tenant scoping                                                     | `softDelete` builds its `where` without the caller's `tenantId` in the delete predicate                                          | `apps/api/src/modules/orders/orders.service.ts:1171-1196`; called from `apps/api/src/modules/orders/orders.controller.ts:376-391`      | **OPEN** |
| 2   | Gift-card redeem is not atomic                                                                                  | `redeem()` checks balance and decrements in separate queries without `$transaction`, allowing race-condition double-redeem       | `apps/api/src/modules/gift-cards/gift-cards.service.ts:117-157`                                                                        | **OPEN** |
| 3   | Unparameterized dynamic raw SQL                                                                                 | `$queryRawUnsafe` used with interpolated/validated identifiers and raw SELECTs (injection/parameterization risk if inputs widen) | `apps/api/src/modules/supplier-analytics/supplier-analytics.service.ts:312`, `:463`, `:482`                                            | **OPEN** |
| 4   | Analytics N+1 / repeated full scans                                                                             | Per-entity `findMany` inside loops and repeated aggregation over full tables in analytics modules                                | `apps/api/src/modules/inventory-analytics/inventory-analytics.service.ts:40-179` (esp. `findMany` at 118, 179), `:187`, `:452`, `:557` | **OPEN** |
| 5   | Broader security P1s from earlier catalog (MFA absent, SSO/SAML absent, live webhook delivery robustness, etc.) | See `FINAL-PRODUCTION-READINESS-AUDIT.md` for the full catalog                                                                   | repo-wide                                                                                                                              | **OPEN** |

### P3 (Low) — verification hygiene (new this session)

| #   | Finding                                                        | Root cause                                                                                          | Location                                                                                    | Status   |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| 6   | `DiskHealthIndicator` does not check memory despite phase spec | Health indicator only reports `statfs` disk; phase script expects `freemem`                         | `apps/api/src/health/disk-health.indicator.ts:1-36`; check in `scripts/verify-phase6-m2.js` | **OPEN** |
| 7   | `verify-phase7-m2.js` hardcodes stale baselines                | Script asserts exactly "36 passed" suites / "285 passed" tests; suite now has 50 suites / 448 tests | `scripts/verify-phase7-m2.js:184-194`                                                       | **OPEN** |

### Earlier-audit retractions (confirmed correct, no action)

- Cache tenant namespacing — `apps/api/src/common/cache/cache.service.ts:12-14` includes tenant key namespace. **Retracted.**
- Webhook / API-key secret storage — hashed-secret models exist. **Retracted.**
- Kafka — no Kafka anywhere; Redis/Bull only. **Retracted.**

---

## 4. PHASE VERIFICATION SCRIPTS

| Script                        | Result               | Notes                                                                                                                             |
| ----------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/verify-phase6-m2.js` | 69 passed / 1 failed | Only failure: "DiskHealthIndicator checks memory" (§3 finding 6) — pre-existing, not from this remediation                        |
| `scripts/verify-phase6-m3.js` | 68 / 0               | ALL CHECKS PASSED                                                                                                                 |
| `scripts/verify-phase6-m4.js` | 78 / 0               | ALL CHECKS PASSED                                                                                                                 |
| `scripts/verify-phase7-m1.js` | 55 / 0               | ALL CHECKS PASSED                                                                                                                 |
| `scripts/verify-phase7-m2.js` | 31 / 2               | Failures are stale hardcoded baselines (36 suites/285 tests) in the script itself (§3 finding 7); ESLint on new test files passes |
| `scripts/verify-phase7-m3.js` | 39 / 0               | ALL CHECKS PASSED                                                                                                                 |
| `scripts/verify-phase7-m4.js` | 30 / 3               | 3 DB-dependent checks (migrate status, enum audit, orphan-data audit) — blocked by no live Postgres (§6)                          |
| `scripts/verify-phase7-m5.js` | 39 / 0               | ALL CHECKS PASSED                                                                                                                 |

---

## 5. TEST / BUILD / LINT EVIDENCE

```
Jest (full, Nx):      Tests: 448 passed, 448 total | Test Suites: 50 passed, 50 total
Payments suites:      87 passed / 5 suites
ESLint:               0 errors (after --fix of 79 auto-fixable + manual: unused IsEnum import,
                       createHmac require() -> import in 3 spec files)
Build (nx build api): Successfully ran target build for project api
Prisma validate:      The schema at prisma\schema.prisma is valid
```

Build-type errors found and fixed during remediation: nullable `confirmResult.data` narrowing; typo `changedByuserId` → `changedByUserId: 'system'`; Paymob `obj.order?.id` typing; `user.role as UserRole` casts in users/invitations controllers (`CurrentUserData.role` is typed `string`).

---

## 6. ENVIRONMENT-BLOCKED ITEMS (MUST RUN BEFORE PRODUCTION)

Cannot be executed in this environment (no Docker daemon, no local Postgres/Redis, no live gateway credentials). These are verification gaps only — not known code defects:

1. `prisma migrate deploy` against a real database (schema incl. new `payments_tenantId_idempotencyKey_key` migration 20260805000000).
2. API E2E against a running instance (Postgres + Redis + Bull).
3. Real Stripe/Paymob charge, refund, void and webhook-delivery round-trips with `PAYMENTS_MODE=live`.
4. Redis-backed throttling/Bull-job behavior.
5. `scripts/verify-phase7-m4.js` DB audits (migrate status, enum data, orphan data).

Mock mode (the accepted standard for this session) exercises the full code path and the production-mock guard is verified; live-mode behavior is unit-tested against captured HTTP only.

---

## 7. RECOMMENDATION

- **Release decision:** Approved with fixes — proceed to live-environment verification, then close §6 items before the production release.
- **Next cycle:** resolve the 5 P1 findings (§3), especially orders cross-tenant softDelete and gift-card redeem atomicity.
- **Hygiene:** update `scripts/verify-phase7-m2.js` baselines and add `freemem` reporting to the disk health indicator.
