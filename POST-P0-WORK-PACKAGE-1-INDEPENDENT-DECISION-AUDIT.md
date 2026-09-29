# POST-P0-WORK-PACKAGE-1 — INDEPENDENT DECISION AUDIT

**Date:** 2026-08-11
**Repository:** `D:\New folder (8)\tablofy`, branch `feature/phase7-m5`, HEAD `5d6d0c392f5536f87d880a8cbf7336aaed407579`
**Auditor role:** Independent. All evidence re-derived from source, git, tests, build, and live probes. No source/test/schema/`.env` file was modified during this audit.
**Subject:** P0-WORK-PACKAGE-1 (payment & security remediation P0-A/B/C/D) + HARDENING-FOLLOWUP (logger redaction, change-password throttle).

---

## 1. VERDICT

**APPROVE the implemented work** — all six changes are correctly implemented, tested, and regression-clean.

**REQUIRED before the work has any operational effect:** rebuild + redeploy the `tablofy-api` container. The running container predates the work and does **not** contain P0-A/B/C/D or the change-password throttle (evidence in §7). This is the single most important gap and was disclosed in the payment report (§18) but is not addressed anywhere else.

**RECOMMENDED (non-blocking):** three minor report-accuracy corrections (§8) — none of which changes the substance of the work.

---

## 2. Scope & Baseline (independently re-derived)

- Working tree contains exactly 9 modified files + 6 untracked files (reports + 3 new spec files). No schema, migration, or `.env` file is modified (git status + `git diff --stat`).
- All P0-A/B/C/D + followup changes are **uncommitted** working-tree changes on top of HEAD `5d6d0c3` (the last commit is `docs: record report commit hash in hardening report`). There are **no P0 hardening commits** — the work exists only as uncommitted changes. This matches the payment report's baseline statement.

## 3. Source Verification (each change inspected in full current file + `git diff`)

| ID   | Claim                               | Source evidence (verified)                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-A | `reconcile` 404 → shadowed by `:id` | Original order had `@Get(':id')` (old line 42) before `@Get('reconcile')` (old line 104). Fixed: `payments.controller.ts` now declares `@Get('reconcile')` (line 42) and `@Get('providers/:tenantId/status')` (line 55) **above** `@Get(':id')` (line 69). Pure reorder; handler logic unchanged.                                                                                  |
| P0-B | `clientSecret` never returned       | `toResponseDto` (payments.service.ts:1487) now extracts `clientSecret` **only when `status === PENDING`** via new `extractClientSecret` (1516) and `PaymentResponseDto` gained `clientSecret?: string`. `findAll`/`findOne`/charge/refund/void/split all route through `toResponseDto` (10 call sites). No other module serializes `gatewayData` (grep: only payments.service.ts). |
| P0-C | `@Throttle` inert                   | `ThrottlerGuard` was never registered; `ThrottlerModule.forRootAsync` was configured but no `APP_GUARD`. Fixed: `ThrottlerGuard` added as global `APP_GUARD` (app.module.ts:259-262) after `PlanThrottleGuard`. Config default ttl 60s; limit = `THROTTLE_LIMIT` (120 in container env / 60 in local `.env`).                                                                      |
| P0-D | ApiKeyGuard Bearer pass-through     | `bearer` branch (returned `true` for any token) removed; scheme now must be `apikey`. Scope check changed from `effectiveScopes.length > 0 && result.scopes` to `effectiveScopes.length > 0` (fails closed for scope-less keys). Guard remains **unwired** (grep: no `@UseGuards(ApiKeyGuard)` anywhere; confirmed by design per report).                                          |
| B1   | Logger redaction +6 keys            | `sensitiveKeys` (logger.service.ts:152-172) now includes `clientSecret, client_secret, paymentKey, payment_key, hmac, signature`. `sanitize()` unchanged (exact-key, recursive, depth 10).                                                                                                                                                                                         |
| B2   | change-password throttle            | `@Throttle({ default: { limit: 3, ttl: 60000 } })` on `changePassword` (auth.controller.ts:149). Matches existing forgot/reset policy (3/60s).                                                                                                                                                                                                                                     |

## 4. Test Verification (independently re-run)

- **Full Jest suite:** `npx jest --config jest.config.ts` → **87 suites passed / 1115 tests passed, 0 failures** (matches the final reported total exactly).
- **P0-A route binding** (`payments.controller.spec.ts`, new, 4 tests): `GET reconcile` → `service.reconcile` and **not** `findOne`; `GET :id` → `findOne`; `GET providers/:tenantId/status` → `providerStatus`; `POST` → `charge`. PASS.
- **P0-B exposure** (`payments.service.spec.ts`, +5): PENDING+secret → returned; COMPLETED/FAILED → omitted; PENDING without secret / null `gatewayData` → omitted. PASS.
- **P0-D guard** (`api-key.guard.spec.ts`, new, 8): missing header, malformed header, **Bearer rejected (no key lookup)**, invalid key, valid key + default scope, insufficient scope, no-scope key rejected, explicit `@Scopes` honored. PASS.
- **B1 redaction** (`logger.service.spec.ts`, new, **39** tests): each of the 6 keys redacted in direct/nested-object/nested-array/error metadata; all 13 pre-existing keys still redacted; non-sensitive values untouched; all log levels covered. PASS.
- **B2 throttle** (`auth.controller.spec.ts`, now **18** tests): `changePassword` metadata limit=3/ttl=60000; policy-consistency assertions across register 20 / login 30 / refresh 60 / forgot 3 / reset 3 / verify-email 5 / change 3. PASS. Metadata key names verified against installed `@nestjs/throttler` v6.5.0 constants (`THROTTLER:LIMIT` + name = `THROTTLER:LIMITdefault`).

## 5. Regression Gates (independently re-run)

| Gate                                                                         | Result                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `tsc --noEmit -p tsconfig.app.json`                                          | **exit 0**                                                                 |
| ESLint `eslint . --ext .ts`                                                  | **exit 0**                                                                 |
| `nx build api` (webpack production)                                          | **compiled successfully**                                                  |
| `prisma validate`                                                            | schema valid                                                               |
| `prisma migrate status`                                                      | **24/24 migrations applied, up to date** (`tablofy_prod` @ localhost:5432) |
| `prisma migrate diff --from-url <live DB> --to-schema-datamodel --exit-code` | **"No difference detected", exit 0** (no drift; no accidental migration)   |
| Full Jest                                                                    | **87/1115 PASS**                                                           |

## 6. Live / Runtime Verification (independent boot of the current build)

Booted the freshly-built bundle (`dist/apps/api/main.js`, `nx build api`) on port 3001 with merged container+local env (DATABASE_URL → localhost:5432, REDIS → localhost). Read-only checks; instance shut down afterward.

- `GET /api/v1/health` → **200** (database up, redis up, memory up, bullmq up, disk up). `/health/live` 200, `/health/ready` 200.
- `POST /api/v1/auth/login` (dummy creds) → **401 "Invalid email or password"** — route live and functional (the earlier 400s were PowerShell quote-mangling of the JSON body, not app behavior).
- `POST /api/v1/auth/change-password` (no token) → **401 "Invalid or expired token"** — endpoint still authenticated as claimed.
- `GET …/payments/reconcile` (no auth) → **401** (registered, JWT-protected) — not 404.
- **ThrottlerGuard proven active:** burst of 65 `GET /health` → 58×200 then **7×429** (limit reached at 60/60s per IP per the local `THROTTLE_LIMIT=60`). This is direct runtime proof that P0-C is functional in the current build.
- Fresh-build bundle inspection confirms P0-A order: `reconcile` and `providerStatus` methods precede `findOne` in the compiled `PaymentsController`.
- Redis AUTH (live infra): `PING` → **NOAUTH**; `PING -a <pwd>` → **PONG**. Matches report claim.

## 7. Deployment Status — THE OPERATIVE GAP

The running `tablofy-api` container (`docker-api`, healthy, 0.0.0.0:3000) was inspected via its compiled bundle:

| Marker in container bundle                        | Result                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientSecret` extraction (`extractClientSecret`) | **0 hits** → P0-B **not deployed**                                                                                                         |
| `ThrottlerGuard`                                  | **0 hits** → P0-C **not deployed**                                                                                                         |
| Payments route order                              | `@Get(':id')` **before** `@Get('reconcile')`/`@Get('providers/:tenantId/status')` → P0-A **not deployed** (reconcile still shadowed → 404) |
| ApiKeyGuard                                       | **absent from bundle** (tree-shaken; consistent with it being unwired) → P0-D N/A                                                          |
| Logger keys                                       | all 6 present (`clientSecret` 4, `client_secret` 1, `paymentKey` 2, `payment_key` 1, `hmac` 8, `signature` 17) → B1 **deployed**           |
| change-password throttle                          | `@Throttle`/`ThrottlerGuard` absent → B2 **not enforced**                                                                                  |

**Conclusion:** the container predates P0-A/B/C/D and B2. The payment report disclosed this (§18: "container image predates this work package … not redeployed"). The followup report does not address deployment. **Until the container is rebuilt and redeployed, none of the P0 fixes or the change-password throttle are active in the running environment** (the deployed build still 404s `reconcile`, still drops `clientSecret`, and still has inert throttling).

## 8. Report Reconciliation — discrepancies found (minor, non-substantive)

1. **Followup report §7 focused-test split is wrong (total coincidentally right):** reported "41 (logger) + 16 (auth) = 57". Actual independent counts: logger.service.spec = **39**, auth.controller.spec = **18**; total 57 is correct.
2. **"1030 pre-existing errors" is inflated by 5.** `tsc -p tsconfig.spec.json` → 1030 errors across 38 files (matches the claimed total), **but exactly 5 of them are newly introduced** by the P0-B test block in `payments.service.spec.ts` (lines 1733–1781: `Property 'findFirst' does not exist on type 'Mock<...>'`). Pre-P0 baseline is reconstructed as **1025**. They are the same legacy Prisma-mock typing pattern and have zero runtime impact (Jest uses transpile-only), so this is a transparency nit, not a correctness failure. The followup report's narrower claim ("zero in the four files touched by _this_ work package") is literally true for its own 4 files.
3. **Payment report §9 says the throttler default is "120/IP"** — accurate for the container env (`THROTTLE_LIMIT=120`); local `.env` sets 60. The live burst used the local value (60). Not a discrepancy in behavior; noted for clarity.

All other quantitative claims reconcile exactly: payment package baseline 84/1057 → 86/1074 (+2 suites, +17 tests) is arithmetically consistent with the final 87/1115 (+1 suite +41 = 39 logger + 2 auth-throttle).

## 9. Observations / side-effects introduced by the work (not blockers)

- **Global ThrottlerGuard now throttles every route**, including `@Public()` gateway webhook receivers (`POST /webhooks/stripe`, `POST /webhooks/paymob`) and health, at the per-IP default (60–120/min). For Stripe retries or high webhook volume this is a real operational consideration; it is documented in the payment report §10. **Worse-case caution:** in a future reverse-proxy deployment without Express `trust proxy`, all clients would share the proxy IP → a de-facto global 60/min cap across the entire API. The current direct port-mapped deployment is unaffected.
- **P0-A made `GET providers/:tenantId/status` reachable** for the first time (previously shadowed → 404). It takes an arbitrary `tenantId` path param (not the caller's tenant) and is `@Roles('OWNER')`. Verified it returns only `{ status, latencyMs }` (no secrets) — minor cross-tenant info disclosure, OWNER-only.
- **Throttling storage is per-instance in-memory** (documented in followup §13): limits multiply under horizontal scaling.

## 10. Part A — P0 Remediation (final)

| Item                        | Verdict                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| P0-A reconcile route        | **CORRECT + TESTED + BUILT** (not deployed)                            |
| P0-B clientSecret exposure  | **CORRECT + TESTED + BUILT** (not deployed)                            |
| P0-C throttling enforcement | **CORRECT + TESTED + BUILT + LIVE-VERIFIED** (429 burst; not deployed) |
| P0-D ApiKeyGuard hardening  | **CORRECT + TESTED** (guard intentionally unwired; no route contract)  |

## 11. Part B — Hardening Followup (final)

| Change                            | Verdict                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| B1 logger redaction (+6 keys)     | **CORRECT + TESTED + DEPLOYED** (container bundle contains all 6 keys)   |
| B2 change-password throttle 3/60s | **CORRECT + TESTED + BUILT** (not deployed; guard absent from container) |

## 12. Decision

- **APPROVE** the work as implemented. Source is correct, all six changes are tested, and every regression gate is green (87/1115 tests, tsc-app 0, ESLint 0, build OK, Prisma valid + up-to-date + no drift, live health 200, throttler proven live on the current build).
- **BLOCKING ACTION:** redeploy `tablofy-api` so the running environment actually contains P0-A/B/C/D and B2. Until then, the deployed service still exhibits all four P0 defects (reconcile 404, dropped clientSecret, inert throttling) plus unthrottled change-password.
- **Recommended cleanups (non-blocking):** correct the followup report's §7 per-file test split (39/18), and correct the "1030 pre-existing" note to reflect that 5 of the 1030 are newly introduced by the P0-B tests (baseline 1025).
- **Next-package gate (unchanged from mission):** do not start P0-E/P1/Phase 3 product features until this decision is recorded and the next work package is approved.

Audit complete. No files other than this report were created or modified.
