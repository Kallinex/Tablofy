# P1-B CERTIFICATION REPORT — Webhook FK Fix & Full Regression

**Date:** 2026-08-10
**Repository:** `tablofy` monorepo — `D:\New folder (8)\tablofy`
**Branch:** `feature/phase7-m5` · HEAD `56aeb5e` (fix in uncommitted working tree)
**Scope:** P1-B — webhook foreign-key crash in `applyWebhookSucceeded` (`payments.service.ts`), plus full regression re-run of every CI gate.
**Method:** Runtime verification against the live Docker stack (`tablofy-api` / `tablofy-redis` / `tablofy-postgres`) plus the repo's own CI gate commands and `verify-*.js` E2E harnesses.

---

## 1. Executive Summary

| Area | Result |
|---|---|
| P1-B webhook FK fix (live runtime) | **PASS** |
| Unit / integration tests | **PASS — 808/808 (70 suites)**, incl. F1 concurrency specs |
| E2E verify harnesses (CI set) | **PASS** — phase2a, m4, m5, m6, m7, m8; **m9 54/55** (1 known deviation, §6) |
| TypeScript (`tsc --noEmit`) | **PASS** |
| Build (`nx build api`) | **PASS** (dist fresh) |
| Lint (`nx run api:lint`) | **PASS** (v8's 2704 pre-existing errors are resolved in this tree) |
| Prisma validate / migrate status | **PASS** — schema valid, 20 migrations up to date |
| HTTP health (container) | **PASS — 200** |
| Test-data hygiene | Restored to baseline: 0 tenants / 1 pre-existing user |

---

## 2. P1-B Webhook FK — Runtime Verification (live container)

**Fixture:** tenant + restaurant + branch + order (`CONFIRMED`, subtotal/total 100) + payment (`PENDING`, `gatewayRef=pi_runtime_verify_<ts>`, unique per run). Signed Stripe webhook (`payment_intent.succeeded`, HMAC with the container's `STRIPE_WEBHOOK_SECRET`) delivered to `POST /api/v1/webhooks/stripe`.

**Result (clean single-fixture run):**

```
webhook HTTP 200 {"received":true,"type":"payment.succeeded"}
order status: COMPLETED | paidAmount: 100 | completedAt set: true
payment status: COMPLETED
history row: {"fromStatus":"CONFIRMED","toStatus":"COMPLETED","changedBy":"system","changedByUserId":null,
             "reason":"Payment confirmed via gateway webhook"}
WEBHOOK FK RUNTIME VERIFY: PASS
```

- The former crash path — `OrderStatusHistory` insert with `changedByUserId=null` — now succeeds with no FK violation (the fix makes the nullable-user FK path valid).
- A mid-run observation confirmed exact-once semantics across runs that reused a `gatewayRef`: `findFirst` matched the first payment and completed its order; the newer fixture remained untouched.

---

## 3. Static Gates

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` (apps/api) | PASS (0 errors) |
| Build | `nx build api` | PASS (dist `main.js` contains the fix) |
| Lint | `npx nx run api:lint` | PASS (0 errors; v8's 2704 pre-existing errors gone) |
| Prisma | `npx prisma validate` / `prisma migrate status` | PASS — schema valid; 20/20 migrations applied |

---

## 4. Test Gates

| Gate | Result |
|---|---|
| Full jest suite (`nx test api --configuration=coverage`) | **PASS — 70 suites, 808 tests** |
| F1 concurrency (in suite) | PASS — `RecipesService.deductInventoryForOrder` concurrent/retry idempotency |
| Payments concurrency (in suite) | PASS — concurrent refund balance consumption, single-credit webhook delivery |

---

## 5. E2E Verify Harnesses (CI set)

Run against the current tree's own built server (`node dist/apps/api/main.js`, `NODE_ENV=testing`, scratch DB `tablofy_dev` created+migrated+then dropped). Port-3000 conflict with the container was avoided by stopping the container for these runs and restarting it after.

| Script | Result |
|---|---|
| `verify-phase2a.js` | **37/37** PASS |
| `verify-m4.js` | **132/132** PASS |
| `verify-m5.js` | **38/38** PASS |
| `verify-m6.js` | **32/32** PASS |
| `verify-m7.js` | **41/41** PASS |
| `verify-m8.js` | **38/38** PASS |
| `verify-m9.js` | **54/55** — see §6 |

---

## 6. Known Deviation (user-approved, no code change)

**`verify-m9.js` T41 — anti-enumeration contract conflict.**

- T41 expects duplicate registration to return `201` with **no tokens** (don't reveal that the account exists). The app returns `409 Conflict` (`auth.service.ts:69`).
- `verify-phase2a.js`'s own "no user enumeration" check **explicitly expects 409** and passes.
- The two verify scripts encode contradictory contracts; T41 is therefore unpassable by design against the current implementation. This is a pre-existing spec/test inconsistency, **not** a regression from the P1-B fix.
- **Decision (2026-08-10, approved):** document as a known deviation; no code change. App behavior (409) is unchanged and matches `verify-phase2a.js`.

---

## 7. Environment State

- `tablofy-api`, `tablofy-redis`, `tablofy-postgres` running; `GET /api/v1/health` → 200.
- Scratch DB `tablofy_dev` (used by the verify harnesses) created and then dropped.
- Runtime fixtures in `tablofy_prod` fully removed (FK-safe order): `leftover tenantId rows: NONE`, tenants 0, users 1 (pre-existing), no orphan orders.

---

## 8. Verdict

> **✅ P1-B (webhook FK fix) is certified.** The FK-crash path now succeeds at runtime, and every CI gate re-run on the current tree passes: 808/808 unit tests (incl. F1 concurrency), all six E2E harnesses green, m9 54/55 with a single documented deviation, tsc/build/lint/prisma clean, live container healthy. No P0/P1 security, data-integrity, payment, migration, boot, or concurrency regressions observed.
