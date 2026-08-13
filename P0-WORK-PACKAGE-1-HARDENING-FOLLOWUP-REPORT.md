# P0-WORK-PACKAGE-1 — HARDENING FOLLOW-UP REPORT

**Scope:** Two explicitly approved hardening changes from the independent P0 audit.
**Status:** COMPLETE — both changes implemented, tested, and regression-verified.
**Date:** 2026-08-11

---

## 0. Change Summary

| Change | Area | Classification |
|---|---|---|
| CHANGE 1 | Extend logger sensitive-key redaction with 6 keys | **Hardening improvement** (defense-in-depth) |
| CHANGE 2 | Add `@Throttle` to `change-password` endpoint | **Hardening improvement** (policy gap closure) |

Neither change fixes a previously *confirmed* production vulnerability. The prior audit found no active call path that leaks these values; both changes reduce residual/future risk and align behavior with the existing security policy. The prior verification results (A1/A2/P0-B/P0-C) that were **previously PASS** remain **PASS** and are **re-verified** below.

---

## 1. Exact Files Changed

| # | File | Change |
|---|---|---|
| 1 | `apps/api/src/common/logger/logger.service.ts` | Added 6 keys to `sensitiveKeys` set |
| 2 | `apps/api/src/common/logger/logger.service.spec.ts` | **New file** — focused redaction unit tests |
| 3 | `apps/api/src/modules/auth/auth.controller.ts` | Added `@Throttle` to `change-password` |
| 4 | `apps/api/src/modules/auth/tests/auth.controller.spec.ts` | Added focused throttling tests |

No other files were modified. No schema files, migration files, `.env` files, or payment/provider files were touched.

---

## 2. Exact Lines Changed

### Change 1 — `apps/api/src/common/logger/logger.service.ts`

Inserted 6 entries into the existing `sensitiveKeys` Set (after `'bearer'`):

```
166:     'clientSecret',
167:     'client_secret',
168:     'paymentKey',
169:     'payment_key',
170:     'hmac',
171:     'signature',
172:   ]);
```

The Set now spans lines 152–172. The `sanitize()` method (lines 174–197) is **unchanged** — exact-key matching, recursive descent into nested objects and arrays, depth cap of 10, `'[REDACTED]'` replacement. All 13 pre-existing keys were preserved (lines 153–165).

### Change 2 — `apps/api/src/modules/auth/auth.controller.ts`

One line added to the `change-password` handler:

```
147:   @Post('change-password')
148:   @HttpCode(HttpStatus.OK)
149:   @Throttle({ default: { limit: 3, ttl: 60000 } })     <-- ADDED
150:   @ApiBearerAuth()
151:   @ApiOperation({ summary: 'Change password (requires current password)' })
```

The handler body, DTO, authentication metadata, and service call are unchanged.

### Test files

- `apps/api/src/common/logger/logger.service.spec.ts` — new (full file).
- `apps/api/src/modules/auth/tests/auth.controller.spec.ts` — added `describe('changePassword throttling', ...)` block, lines 284–304.

---

## 3. Previous Behavior

### Change 1
- The logger sanitizer redacted the pre-existing 13 keys (`password`, `token`, `authorization`, `secret`, `apiKey`, `api_key`, `api-key`, `twoFactorSecret`, `two_factor_secret`, `accessToken`, `refreshToken`, `jwt`, `bearer`).
- The 6 payment-related keys (`clientSecret`, `client_secret`, `paymentKey`, `payment_key`, `hmac`, `signature`) were **not** in the redaction set. If any future or present log call passed these names as metadata, the values would have been written to logs unredacted.
- The prior audit verified no current call path passes these values to the logger, so this was not an active leak.

### Change 2
- `change-password` carried no `@Throttle`. It was still rate-limited by the **global** throttler default (`THROTTLER_LIMIT=120`, ttl 60s) via the global `ThrottlerGuard`, so it was not unlimited — but it had no dedicated policy aligned with the other password endpoints.

---

## 4. New Behavior

### Change 1
- `clientSecret`, `client_secret`, `paymentKey`, `payment_key`, `hmac`, `signature` are now redacted to `'[REDACTED]'` by the existing sanitizer in:
  - direct metadata objects,
  - nested objects (any depth up to 10),
  - nested arrays (recursively),
  - error metadata (passed alongside `Error` objects),
  - every structured logger level (`log`, `warn`, `error`, `debug`, `verbose`, `fatal`).
- All pre-existing keys continue to redact. Non-sensitive keys are untouched.

### Change 2
- `POST /api/v1/auth/change-password` now enforces `@Throttle({ default: { limit: 3, ttl: 60000 } })` — **3 requests per 60 seconds**, identical to the existing `forgot-password` and `reset-password` policy.
- Behavior: authorized requests under the limit proceed normally; the 4th request within the window receives HTTP `429 Too Many Requests`.
- The endpoint remains authenticated (class-level `@Authenticated()` + `@ApiBearerAuth()` unchanged; no `@Public`, no `@SkipThrottle`).
- Global `ThrottlerGuard` configuration is unchanged.

---

## 5. Why Each Change Was Required

### Change 1
The independent P0 audit (A2) found the redaction mechanism was the single most important log-leak defense but its key set omitted the exact property names used by the payment layer and webhook validation (`clientSecret` / `paymentKey` are the actual return fields of the payment providers; `hmac` / `signature` are used in webhook validation). Exact-key matching means a miss is silent. Adding these six names closes the gap so that even if a future log statement forwards provider output or webhook payload fragments into logger metadata, the values are scrubbed before reaching the console/file transports.

### Change 2
The audit (P0-C) observed that every other credential/password endpoint has an explicit `@Throttle` (register 20, login 30, refresh 60, forgot-password 3, reset-password 3, verify-email 5 per 60s), but `change-password` relied only on the global default of 120/min. Because `change-password` verifies the user's **current** password (a credential that is brute-forceable), it should sit at the same policy tier as the other password-mutation endpoints. `3/60s` was chosen because it is an **existing** policy value (forgot-password and reset-password) applied to a password-mutation endpoint — no new arbitrary limit was invented.

---

## 6. Tests Added

### `apps/api/src/common/logger/logger.service.spec.ts` (new)
Mocked `winston` so no real transports/files are created. Proves, for **each** of the six new keys:
- redacted in direct metadata,
- redacted in nested objects,
- redacted in nested arrays (while non-sensitive siblings are preserved),
- redacted in error metadata (alongside an `Error` argument).

Plus:
- structured logger calls: redaction across `log`, `warn`, `error`, `debug`, `verbose`, `fatal`;
- **all 13 pre-existing sensitive keys remain redacted** (regression);
- non-sensitive metadata (`orderId`, `amount`, `nested.status`) is not redacted (guard against over-redaction).

### `apps/api/src/modules/auth/tests/auth.controller.spec.ts` (extended)
- Proves `changePassword` carries `@Throttle` metadata: `THROTTLER:LIMITdefault = 3`, `THROTTLER:TTLdefault = 60000`.
- Proves the applied limit is consistent with the existing policy: register 20, login 30, refresh 60, forgot-password 3, reset-password 3, verify-email 5, change-password 3.

No real credential values appear anywhere in the tests (sentinel values such as `'super-secret-value'` are used).

---

## 7. Test Results

### Focused tests
```
Test Suites: 2 passed, 2 total
Tests:       57 passed, 57 total
```
- `logger.service.spec.ts` — 41 tests (6 keys × 4 shapes + structured-levels + 13 existing keys + non-sensitive).
- `auth.controller.spec.ts` — 16 tests (14 original + 2 new throttling tests).

### Full Jest suite
```
Test Suites: 87 passed, 87 total
Tests:       1115 passed, 1115 total
Snapshots:   0 total
```

---

## 8. Full Regression Results

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Focused logger tests | `jest logger.service.spec.ts` | PASS (41/41) |
| 2 | Focused throttling tests | `jest auth.controller.spec.ts` | PASS (16/16) |
| 3 | Full Jest suite | `jest --config apps/api/jest.config.ts` | PASS (87 suites / 1115 tests) |
| 4 | TypeScript (app source) | `tsc --noEmit -p apps/api/tsconfig.app.json` | PASS (exit 0) |
| 5 | ESLint | `eslint apps/api --ext .ts` | PASS (exit 0) |
| 6 | Build | `nx build api` | PASS (webpack compiled successfully, 22.1s) |
| 7 | Prisma schema | `prisma validate` | PASS (`schema is valid`) |
| 8 | Migrations | `prisma migrate status` | PASS (`Database schema is up to date!`, 24 migrations, none pending) |
| 9 | Health endpoint | boot built bundle → `GET /api/v1/health` | PASS (HTTP 200; database up, redis up, memory up, bullmq up) |

**Notes on check 4 (transparency):** The dedicated spec typecheck (`tsc -p apps/api/tsconfig.spec.json`) reports **1030 pre-existing type errors in 38 unrelated test files** (Prisma mock typing mismatches in legacy specs). **Zero** of these are in the four files touched by this work package. These errors pre-date this change and are not exercised by the Jest runtime (`ts-jest` runs with `isolatedModules`, which transpiles without full typechecking). The application-source typecheck (`tsconfig.app.json`), the build, and ESLint are all clean. Fixing the legacy spec typing was outside the approved scope.

---

## 9. Security Verification

| Requirement | Result | Evidence |
|---|---|---|
| `clientSecret` cannot appear in logs | PASS | Redacted in direct/nested/array/error/structured tests |
| `client_secret` cannot appear in logs | PASS | same |
| `paymentKey` cannot appear in logs | PASS | same |
| `payment_key` cannot appear in logs | PASS | same |
| `hmac` cannot appear in logs | PASS | same |
| `signature` cannot appear in logs | PASS | same |
| Existing secret redaction still works | PASS | All 13 pre-existing keys tested and still `'[REDACTED]'` |
| Non-sensitive data unaffected | PASS | `orderId`/`amount`/`status` pass through unredacted |
| `change-password` remains authenticated | PASS | `@Authenticated()` (class) + `@ApiBearerAuth()` unchanged; no `@Public`, no `@SkipThrottle` |
| `change-password` is now rate limited | PASS | Metadata test: limit 3 / ttl 60000; global guard unchanged |

The prior P0 findings (A1/A2/P0-B/P0-C) remain **PASS**:
- Provider secrets remain confined to the providers / `toResponseDto` path (previously PASS, unchanged).
- No secret in audit logs / DB / HTTP logs (previously PASS, unchanged).
- IP/device metadata not logged (previously PASS, unchanged).
- Global throttling guard active on all auth endpoints (previously PASS, unchanged).

No real credential values were printed, logged, or committed during this work.

---

## 10. No Schema Changes

- `prisma/schema.prisma` untouched.
- `prisma validate` — valid.
- `prisma migrate status` — no pending migrations; schema up to date.
- No migration files created.

## 11. No Credential Changes

- No `.env` / `.env.example` / `docker/.env` files modified.
- No credentials injected, rotated, or written to disk.
- Test values are sentinel strings only.

## 12. No Payment Behavior Changes

- Payment logic, payment providers, transactions, refunds, webhooks, idempotency, CAS, and financial behavior are **untouched**.
- `payments.service.ts`, `stripe.provider.ts`, `paymob.provider.ts`, `payment-state-machine.ts`, webhook controllers/processors were not modified.
- `PaymentResponseDto`/`gatewayData` handling unchanged.

---

## 13. Remaining Risks

1. **Logger key matching is exact-key based.** If a future call ever logs a secret under a non-listed key name (e.g., a renamed field), it would not be redacted. This is inherent to the existing design and unchanged by this work package; current call paths were verified not to do so.
2. **Throttling storage is the global in-memory storage.** The `change-password` limit (like every other `@Throttle` in the app) is per-application-instance. With multiple horizontally scaled instances the effective per-IP limit is multiplied by instance count. This is consistent with existing auth throttling behavior and was not changed.
3. **Legacy spec typecheck debt.** `tsc -p apps/api/tsconfig.spec.json` reports 1030 pre-existing errors in 38 unrelated legacy test files. Non-blocking for build/test/runtime, but recommended for a future dedicated cleanup (out of scope here).
4. **Change-password brute-force floor.** The new 3/60s limit is a meaningful reduction from the global 120/60s default, but it is not a substitute for the account lockout/2FA controls already present in the auth layer; those were not modified.

---

## 14. Final Status

- **CHANGE 1 — LOGGER SECRET REDACTION: DONE.** All six approved keys added; existing redaction preserved; verified by 41 unit tests.
- **CHANGE 2 — CHANGE-PASSWORD THROTTLING: DONE.** `@Throttle({ default: { limit: 3, ttl: 60000 } })` applied using an existing policy value; verified by metadata tests.
- **REGRESSION: ALL PASS** (focused tests, full Jest 1115/1115, tsc app source, ESLint, nx build, prisma validate, prisma migrate status, health endpoint).
- Both changes are **hardening improvements**, not fixes for confirmed production vulnerabilities.
- Out-of-scope work (**P0-E, P1, Phase 3**) was **NOT** started.
