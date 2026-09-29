# P0 WORK PACKAGE 1 — PAYMENT & SECURITY REMEDIATION REPORT

**Date:** 2026-08-11
**Repository:** `D:\New folder (8)\tablofy`, branch `feature/phase7-m5`
**Scope:** P0-A, P0-B, P0-C, P0-D only (from `PHASE-3-BACKEND-IMPLEMENTATION-AUDIT.md` §11 backlog).
**Method:** Read-only reconciliation → minimal source fixes → new tests → full regression → lint/build/Prisma gates → live health + Redis auth → git diff review. No schema/migration/env changes. No secrets logged or persisted.

---

## 1. Executive Summary

All four P0 findings in this work package were confirmed against source and remediated with the smallest correct change:

- **P0-A (reconcile 404):** `@Get(':id')` was declared before `@Get('reconcile')`, so `GET …/payments/reconcile` bound to `findOne('reconcile', …)` → 404. Static routes were moved above `:id`; a supertest route-binding spec proves `reconcile` is reachable and `:id` still works.
- **P0-B (clientSecret never returned):** `toResponseDto` dropped the provider-generated `clientSecret`/payment-key, making live card completion impossible through this API. `clientSecret` is now exposed on `PaymentResponseDto` **only while `status = PENDING`** (read from the already-persisted `gatewayData`, never logged, never persisted beyond existing fields).
- **P0-C (ThrottlerGuard not registered):** `ThrottlerModule.forRootAsync` was configured but the guard was never registered, so all six `@Throttle` decorators on auth routes were inert. `ThrottlerGuard` is now registered as a global `APP_GUARD` (validated `@Global()` DI in `@nestjs/throttler` v6.5.0).
- **P0-D (ApiKeyGuard not wired):** No route is intended for API-key auth today. Per mission guardrail, the guard was made implementation-ready: the **Bearer pass-through (accepts any token) was removed**, and the scope check no longer bypasses when a key has no scopes. No route was arbitrarily wired; the missing route contract is documented.

**Gates:** 86 suites / **1074 tests PASS** (baseline 84/1057 → +2 suites, +17 tests), ESLint clean, webpack build clean, Prisma valid / 24-24 migrations / `migrate diff` = "No difference detected", live `/api/v1/health` 200 (db/redis/bullmq up), Redis AUTH verified (PONG with password; NOAUTH without).

---

## 2. Work Package Scope

| ID   | Finding (audit)                                                       | Class                                                                            |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P0-A | Payments reconcile route always 404s (shadowed by `:id`)              | IMPLEMENTED + TESTED                                                             |
| P0-B | Provider `clientSecret` never returned → live card flow uncompletable | IMPLEMENTED + TESTED                                                             |
| P0-C | `@Throttle` inert; `ThrottlerGuard` never registered                  | IMPLEMENTED + TESTED                                                             |
| P0-D | `ApiKeyGuard` wired nowhere; Bearer branch passes any token           | IMPLEMENTED + TESTED (guard implementation-ready; not wired — no route contract) |

Explicitly **out of scope** (not started): invitations, costing, supplier-performance, recipes rollback, `PURCHASING` role, orders client-price trust, sessions, notifications, privacy export, subscriptions, analytics, forecasting, backups, and all P0-E+ findings.

---

## 3. Mission Constraints Applied

- No invented API contracts, fields, scopes, roles, permissions, rate limits, or routes.
- Provider/interface contracts preserved; changes only wire existing contracts.
- `clientSecret` never logged or persisted beyond the existing `gatewayData` transient field; no credentials in tests (placeholders only).
- No schema changes (verified: `migrate diff` = no difference).
- Tenant isolation untouched on every affected query (all service queries already tenant-scoped; no new queries added).
- Money/Decimal handling, idempotency, refund CAS, version CAS, webhook replay protection, and "provider calls outside rollbackable transactions" all preserved — no financial logic changed.

---

## 4. Baseline Evidence

- Branch `feature/phase7-m5`, working tree dirty only with this work package's files (verified via `git status --short`); prior hardening commits `dde9489`/`b5e89a4`/`5d6d0c3` unchanged.
- Audit source: `PHASE-3-BACKEND-IMPLEMENTATION-AUDIT.md` §11 items 1–5 (P0-A/B/C/D).
- Full regression before this work package: 84 suites / 1057 tests.

---

## 5. P0-A — Root Cause

`payments.controller.ts` (before fix): `@Get()` findAll (line 31) → `@Get(':id')` findOne (**line 42**) → `@Get('reconcile')` (**line 104**). Express route resolution is declaration-order, so `GET /restaurants/:restaurantId/payments/reconcile` matched `:id` with `id='reconcile'` → `findOne('reconcile', tenantId)` → `NotFoundException` → **404**. The endpoint was _unwired_ (shadowed), not intentionally disabled. `GET providers/:tenantId/status` (3 segments) was not shadowed by `:id` (1 segment) but is likewise a static route.

## 6. P0-A — Fix Applied

`payments.controller.ts`: moved `@Get('reconcile')` and `@Get('providers/:tenantId/status')` **above** `@Get(':id')`. Pure declaration reorder — zero handler/logic change. Route order is now: `@Post()` → `@Get()` → `@Get('reconcile')` → `@Get('providers/:tenantId/status')` → `@Get(':id')` → `@Post(':paymentId/…')` → `@Post('split')`. (`POST split` cannot be shadowed: there is no `@Post(':id')`.)

## 7. P0-B — Root Cause

`toResponseDto` (`payments.service.ts:1487`, pre-fix) returned 14 fields and **dropped `clientSecret`** even though every provider contract already returns it (`IntegrationResult<{ id; clientSecret?; status }>`; Stripe `intent.client_secret`, Paymob payment-key `token`, mock `secret_mock_*`), and it is already persisted transiently in `payment.gatewayData` for the PENDING path (`payments.service.ts:481`). `PaymentResponseDto` had no field for it → clients could never complete a Stripe/Paymob card flow (mock mode masks the defect because mock confirm succeeds instantly).

## 8. P0-B — Fix Applied

- `payment-response.dto.ts`: added optional `clientSecret?: string`.
- `payments.service.ts` `toResponseDto`: `clientSecret` is surfaced **only when `payment.status === PaymentStatus.PENDING`** (the only state where client action is required), extracted from the existing `gatewayData` via a new private helper `extractClientSecret` (type-safe: rejects non-object/array/empty). COMPLETED/FAILED/VOIDED/REFUNDED responses omit it, preventing stale-secret exposure.
- Works across every return path automatically: charge PENDING (`emitResult`→`toResponseDto`), idempotent replay of a PENDING payment (`toResponseDto(existing)`), `findOne`, `findAll`, `void`, `split` provider legs.
- No new persistence, no logging, no schema change.

## 9. P0-C — Root Cause

`app.module.ts` configured `ThrottlerModule.forRootAsync` (ttl 60 s, limit 120/IP default) but **never registered `ThrottlerGuard` as `APP_GUARD`**. Result (audit-verified): all six `@Throttle` decorators on `auth.controller.ts` (register 20/min, login 30/min, refresh 60/min, forgot-password 3/min, reset-password 3/min, 2FA-verify 5/min) were inert; the only active limiter was `PlanThrottleGuard` (100/min/IP/URL unauthenticated).

## 10. P0-C — Fix Applied

`app.module.ts`: imported `ThrottlerGuard` and registered it as a global `APP_GUARD` alongside `JwtAuthGuard`/`RolesGuard`/`TenantGuard`/`PlanThrottleGuard`. Verified `@nestjs/throttler` v6.5.0: `ThrottlerModule` is `@Global()` and exports its providers, so `APP_GUARD` DI resolves. All existing `@Throttle` overrides become operational; the config default (120 req/60 s/IP) applies to the rest of the API. No `@SkipThrottle` was added (none exists in code; adding exclusions would invent policy). Known behaviour documented: webhook/health routes are now subject to the per-IP default (generous; the audit's separate P3 "exclude gateway webhooks from PlanThrottle" finding is unchanged and out of scope).

## 11. P0-D — Root Cause

`ApiKeyGuard` (`api-keys/guards/api-key.guard.ts`) is referenced nowhere except its own file (grep: 1 hit) and has no spec. Its **`bearer` branch returned `true` for any token** — a security defect if ever wired — and the scope check `if (effectiveScopes.length > 0 && result.scopes)` silently skipped enforcement when a key carried no scopes. `rateLimitPerMin` (set on every key, default 60) is never enforced. `ApiKeysController` is user/JWT-role-managed (OWNER/MANAGER) and is not an API-key surface. No intended API-key-protected route exists in the codebase.

## 12. P0-D — Fix Applied (implementation-ready; not wired)

Per the mission guardrail — _"if no intended API-key-protected route exists, do NOT invent one; make the guard implementation-ready and document the missing route contract"_:

1. **Removed the Bearer pass-through.** The guard now accepts only the `apikey` scheme; `bearer` → `UnauthorizedException('Invalid authorization scheme')`. A future route needing JWT-_or_-API-key auth must use a dedicated guard (documented, not invented here).
2. **Strict scope enforcement.** Changed to `if (effectiveScopes.length > 0)` (removed the `&& result.scopes` bypass). A valid key with no/insufficient scopes now gets `ForbiddenException` as intended.
3. **Kept unwired.** No controller was changed to use `ApiKeyGuard`. **Missing route contract (documented):** no route in the app is defined as API-key-authenticated; until product defines one, issuing keys remains DEAD_UNWIRED by design.
4. **`rateLimitPerMin` enforcement: DEFERRED** (documented in §20). It requires a counter store (Redis or in-memory); with no protected route, adding enforcement infra would be invented scope. `validateApiKey` hash-lookup, expiry, active/deleted checks, and `lastUsedAt` update are unchanged and remain correct.

## 13. Security Considerations (secrets & credentials)

- `clientSecret`/payment-key tokens are transient, read from existing `gatewayData`, surfaced only for PENDING, never logged, never stored in new fields.
- No API keys, passwords, or provider secrets were printed or persisted during verification (Redis auth check used env values in-process; placeholders only in test fixtures).
- No Redis/DB/SMTP/Stripe/Paymob secrets appear anywhere in this work package's diffs.

## 14. Test Evidence — Affected Suites (161 tests)

| Suite                               | Coverage added                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payments.controller.spec.ts` (NEW) | Route binding: `GET reconcile` → `service.reconcile` and **not** `findOne`; `GET :id` still → `findOne`; `GET providers/:tenantId/status` → `providerStatus`; `POST` → `charge`.   |
| `payments.service.spec.ts` (+5)     | PENDING + `gatewayData.clientSecret` → returned; COMPLETED/FAILED → omitted; PENDING without secret / null gatewayData → omitted.                                                  |
| `api-key.guard.spec.ts` (NEW, 8)    | missing header, malformed header, **bearer rejected (no key lookup)**, invalid key, valid key + default read scope, insufficient scope, no-scopes key, explicit `@Scopes` honored. |
| Existing payments/api-keys suites   | Full re-run, no regressions (state machine, providers, integration, service).                                                                                                      |

## 15. Full Regression Results

`npx jest --config jest.config.ts --runInBand` → **86 suites passed, 1074 tests passed, 0 failures** (baseline 84/1057; +2 suites, +17 tests from this work package).

## 16. Build & Static Gates

- ESLint (`npx nx run api:lint`): **clean** (2 prettier nits fixed from initial run).
- Webpack build (`npx nx run api:build`, production): **compiled successfully** (compile/DI gate for the new guard/helper code).

## 17. Prisma & Schema Gates

- `prisma validate`: schema **valid**.
- `prisma migrate status`: **24/24 migrations applied**, DB up to date (`tablofy_prod`).
- `prisma migrate diff --from-url <live DB> --to-schema-datamodel`: **"No difference detected"** (exit 0). No schema/migration changes made.

## 18. Live Verification

- Containers (compose): `tablofy-api` (healthy, 0.0.0.0:3000), `tablofy-postgres` (healthy, :5432), `tablofy-redis` (healthy, :6379).
- Health: `GET /api/v1/health` = **200** (database/redis/memory/bullmq/disk up); `/health/live` = 200; `/health/ready` = 200. **LIVE VERIFIED.**
- Redis auth: `redis-cli PING` → **NOAUTH** (auth enforced); `redis-cli -a <password> PING` → **PONG**. **LIVE VERIFIED.**
- Note: the running `tablofy-api` container image predates this work package (built ~14 h before the changes); it is not a deployment gate for this package and was not redeployed (out of scope). The health/Redis gates verify the live environment, not the new code paths.

## 19. Git Diff Review

`git status --short`: 5 modified source files + 1 modified spec + 2 new specs (+ audit report). Diff stat: **128 insertions, 33 deletions** across 6 tracked files; all changes minimal, no unrelated files touched, no secrets. Full diff inspected: route reorder (no logic change), DTO +1 optional field, service +16 lines, guard −4/+1 net change, app.module +4 lines.

## 20. Classifications Summary

| Item                                  | Classification                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| P0-A reconcile route                  | **IMPLEMENTED + TESTED** (unit route-binding spec)                                                                                        |
| P0-B clientSecret exposure            | **IMPLEMENTED + TESTED** (service spec, 5 cases)                                                                                          |
| P0-C ThrottlerGuard registration      | **IMPLEMENTED + TESTED** (guard wired; DI validated against package source; no live request exercise since running image predates change) |
| P0-D ApiKeyGuard hardening            | **IMPLEMENTED + TESTED** (guard spec, 8 cases); wiring intentionally **not done** — no route contract                                     |
| Live Stripe/Paymob card completion    | **BLOCKED_EXTERNAL** — no provider credentials; `PAYMENTS_MODE` defaults mock; never mislabeled as LIVE VERIFIED                          |
| Live health + Redis auth              | **LIVE VERIFIED** (this session)                                                                                                          |
| `rateLimitPerMin` per-key enforcement | **DEFERRED** — no storage mechanism and no protected route; decision required                                                             |

## 21. Out-of-Scope / Deferred (documented, not acted on)

- Wiring `ApiKeyGuard` to a route / enabling key issuance (needs product decision on the API-key route contract).
- Per-key `rateLimitPerMin` enforcement (needs storage decision; see §20).
- Stripe/Paymob live certification, webhook throttle exclusion (P3), currency on `Payment` (P2), Stripe signature timestamp tolerance (P3).
- All other P0 backlog items (invitations, costing, supplier-performance, recipes, `PURCHASING` role, orders price trust) — separate work packages.

## 22. Next Steps & STOP

- All four P0 findings are remediated, tested, and gated. **STOPPING here per mission.**
- Do **not** start P0-E/P1/Phase 3 product features until an independent decision audit approves the next work package.
- Recommended follow-ups for that decision: (1) define the API-key-protected route contract or disable key issuance; (2) decide the per-key rate-limit store; (3) certify live Stripe/Paymob with real credentials; (4) redeploy the `tablofy-api` container to activate the new guard wiring in the running environment.
