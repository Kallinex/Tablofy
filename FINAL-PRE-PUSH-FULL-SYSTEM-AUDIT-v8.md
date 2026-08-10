# FINAL PRE-PUSH FULL SYSTEM AUDIT — v8

**Repository:** `tablofy` monorepo — `D:\New folder (8)\tablofy`
**Branch:** `feature/phase7-m5` · HEAD `56aeb5e` · Tag `v7.5.0` = `a053516` · merge-base `a053516`
**Scope:** Uncommitted working tree (Phase7 M1–M5 + P0 + P1 Batch 1–3 + F1 fix)
**Date:** 2026-08-09
**Method:** Read-only. Every claim below was re-verified against source and/or a live runtime probe in this session (no prior-report trust). All DB probes ran inside `ROLLBACK` transactions; no persistent data was modified.
**Result:** **❌ BLOCK — DO NOT COMMIT / DO NOT PUSH.** Remediation required before commit.

---

## 1. EXECUTIVE SUMMARY

| Area | Status |
|---|---|
| Build / TypeScript | ✅ PASS (`tsc --noEmit`, `nx build api`) |
| Prisma schema + migrations | ✅ PASS (20/20 deploy, diff-clean; M4.4 drift cosmetic) |
| Tests | ✅ PASS (68 suites / 776 tests, exit 0, coverage thresholds met) |
| Runtime health / Docker | ✅ PASS (api healthy; postgres/redis up; 21 queues up) |
| Tenant isolation (HTTP) | ✅ PASS (JWT claim + TenantGuard chain) |
| Tenant isolation (WebSocket) | **❌ FAIL — P1, runtime-proven** |
| Payments webhook | **❌ FAIL — P1, runtime-proven (FK crash)** |
| SCA / dependency audit | **❌ FAIL — P1, CI-blocking (24 vulns)** |
| CI gates (lint) | **❌ FAIL — P1 (2704 errors + 2 warnings)** |
| Export engine PDF | **❌ FAIL — P1, runtime-proven** |
| SSRF / webhooks outbound | ✅ PASS (comprehensive) |
| Bull Board / Metrics auth | ✅ PASS (401 without token; SUPER_ADMIN-gated) |

**Findings tally (current working tree):** **P0 = 0 · P1 = 5 · P2 = 18 · P3 = 4 · PASS = 21 areas.**

**Verdict per the binding rule** (no commit/push if any P0/P1 security, tenant-isolation, data-integrity, payment, migration, production-boot, or concurrency issue remains):

> **❌ DO NOT COMMIT OR PUSH.** Four confirmed P1s are security/tenant-isolation/payment/CI-blocking and are in the uncommitted delivery. Fix the items in §10, re-run the gates in §9, then commit.

---

## 2. REPOSITORY & GIT INTEGRITY

- Branch `feature/phase7-m5`; HEAD `56aeb5e` (committed M5 P1 fixes); tag `v7.5.0` → `a053516`; merge-base `a053516`. Working tree is **uncommitted** on top of the last commit (consistent with prior batch delivery pattern).
- `git status --short`: modified files across auth/orders/payments/queues/recipes/webhooks/customer-analytics/health/bull-board/guards/interceptors/controllers/schema/config + 30 untracked files (SSRF module, webhook/recipe/queue/guard specs, `webhook-events.ts`, 2 new migrations, `prisma/seed.js`, audit/report md). All untracked files have legitimate reasons (new features/tests/migrations/tooling); none are secrets.
- **Secrets scan:** clean. Only benign hits (env refs, test fixtures, Bull Board `configService.get('jwt.secret')`). `.env` and `docker/.env` gitignored (`.gitignore:12`); `*.log` ignored; no `.pem`/`.key` tracked.
- Tracked legacy scripts (`clean-db.js`, `check-prisma.js`, `debug-m3.js`, `verify-*.js`) are pre-existing baseline, not batch changes.

---

## 3. BUILD, TYPE-CHECK, LINT

- `npx tsc --noEmit -p apps/api/tsconfig.json` → **exit 0**.
- `npx nx build api` → **exit 0**.
- `npx prisma validate` → **valid**.
- **Lint (`nx run api:lint` → `eslint . --ext .ts`): ❌ FAIL — 2706 problems (2704 errors, 2 warnings).** Full verified breakdown:

| File | Errors | Warnings | Rules |
|---|---|---|---|
| `modules/customers/customers.service.ts` | 1511 | 0 | prettier/prettier (CRLF) |
| `modules/customer-analytics/customer-analytics.service.ts` | 729 | 0 | prettier/prettier (CRLF) |
| `modules/crm-analytics/crm-analytics.service.ts` | 455 | 0 | prettier/prettier (CRLF) |
| `modules/payments/tests/integration/payment-flow.integration.spec.ts` | 9 | 1 | prettier (7) + 2 non-prettier |
| `common/rbac/rbac-route-coverage.spec.ts` | 2 | 2 | `@typescript-eslint/no-require-imports` + unused-disable |

  - **All 2704 are formatting/spec-style debt** (CRLF line endings + 2 require() in a spec). **Zero type/logic/security lint errors.** Pre-existing baseline (CRLF files predate the batch); `customer-analytics.service.ts` is also a batch-touched file, so the batch does not *introduce* these, but CI's `npx eslint --ext .ts apps/api/src` step is **red on push today**.
  - Note: an earlier session reported "1966 errors in 2 files" — this session re-ran the same command and measured the accurate current state above (5 files, 2704 errors). Trust this number.

---

## 4. TESTING & COVERAGE

- Full run: `npx jest --config jest.config.ts --coverage --runInBand --forceExit` → **68 suites / 776 tests passed, exit 0, no coverage-threshold failures**.
- Thresholds in `apps/api/jest.config.ts` (per-file, unchanged this batch) verified.
- New in this delivery: SSRF suite (guard + client, incl. IPv6/mapped-form, dotted-quad IPs, DNS-rebinding pinning, redirect re-validation + cap, protocol allowlist, embedded credentials, reserved hostnames, oversized URLs), webhook processor/events/emitter/service specs, recipe/queue specs.
- **Known coverage gap (P2):** the 5-parallel-payment concurrency behavior is protected by code (payments.service.ts:256–358 CAS guards) and covered by unit specs, but has **no DB-backed automated test** (only unit-level mocks).

---

## 5. DATABASE, PRISMA, MIGRATIONS

- `prisma migrate status` (prod URL): **up to date — 20 migrations**.
- **Scratch deploy test:** fresh DB → `prisma migrate deploy` → 20/20 OK, order clean → `migrate diff --from-url <scratch> --to-schema` → **"No difference detected" (exit 0)**. Scratch DB dropped. Prod diff also exit 0.
- **M4.4 drift FULLY characterized (cosmetic, non-blocking):** fresh-deploy checksum `ed81a8a2…` equals the working-tree file hash (`ED81A8A2…`); prod records `286c6529…`. `git diff` shows only `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` + `DROP DEFAULT` — **final schema identical**; cannot affect prod deploy.
- **Indexes verified present on prod** (`pg_indexes`): `orders_customerPhone_idx`, `customers_phone_idx`, `consumption_records_tenantId_inventoryItemId_date_idx`, `wallet_transactions_referenceType_referenceId_idx`.
- **Seed idempotency (run twice on scratch):** 1 tenant / 1 user / 1 restaurant / 1 branch / 1 subscription both times; identical tenant UUID `ade5f61d-…` across runs. ✅

---

## 6. MULTI-TENANT ISOLATION

- **HTTP/REST: ✅ PASS.** Global guard chain (app.module.ts): `JwtAuthGuard → RolesGuard → TenantGuard → PlanThrottleGuard`. Controllers derive tenant from `user.tenantId!` only; JWT claims `{sub,email,role,tenantId,jti,iss:'tablofy',aud:'tablofy-api'}`. Verified in code + 776 tests.
- **WebSocket: ❌ FAIL — P1 (runtime-proven).** **All 13 Socket.IO namespaces accept unauthenticated connections and join an arbitrary `tenant:<query.tenantId>` room.** Live probe (socket.io-client, no auth token, random tenantId) connected successfully and joined the requested tenant room on every namespace:

  `/warehouses`, `/live-analytics`, `/cycle-counts`, `/inventory`, `/crm`, `/customers`, `/kitchen`, `/transfers`, `/recipes`, `/purchasing`, `/forecasting`, `/barcodes`, `/campaigns` — **all CONNECTED with `socket.connected=true`** and joined `tenant:tenant-leak-probe-123`.

  Root cause: `handleConnection` in `warehouses.gateway.ts:25-31` (and identical pattern in the other gateways) does `client.join(\`tenant:${client.handshake.query.tenantId}\`)` with no `WsGuard`, no JWT check, no middleware; all gateways set `cors: { origin: '*', credentials: true }`. Since server broadcasts go to `tenant:<id>` rooms (e.g. `broadcastWarehouseUpdate`, warehouses.gateway.ts:37-51), **any anonymous client can subscribe to any tenant's live inventory/orders/KDS/analytics/campaign/customer data.** No `WsGuard`/`SocketIoAdapter` exists anywhere.

---

## 7. AUTHENTICATION & AUTHORIZATION (RBAC)

Verified source + runtime. **No P0. 13 findings:**

| # | Severity | Finding | Evidence |
|---|---|---|---|
| A1 | **P1** | WebSocket channels unauthenticated — arbitrary tenant room join (see §6) | all `*.gateway.ts` |
| A2 | P2 | Swagger `/docs` exposed in all environments | `main.ts:139-140` |
| A3 | P2 | `.env.example` placeholder JWT secrets pass prod validation (only `change-this` blocked) | `env.validation.ts:207-215` |
| A4 | P2 | Logout revokes refresh session + DB `revokedAt` but **does not revoke the access token**; `blacklistToken` (`redis/redis.service.ts:71`) is **never called** in prod code | `auth.service.ts` logout path |
| A5 | P2 | Refresh tokens persisted **unhashed** | `auth.service.ts:812-820` |
| A6 | P2 | `JWT_REFRESH_SECRET` never read at runtime (single config occurrence) | config scan |
| A7 | P2 | `Session` rows never created (model unused) | schema + grep |
| A8 | P2 | `ApiKeyGuard` is dead code | grep |
| A9 | P2 | 2FA/TOTP: `verifyTotp` window=1, **no single-use counter and no brute-force rate limit on the MFA verify endpoint** | `totp.ts:75-101`, `auth.service.ts:248-253,723,757` |
| A10 | P3 | Password lockout exists on login (5 attempts) but not mirrored on 2FA verify | `auth.service.ts:224` |
| A11 | P3 | No per-IP auth throttle on refresh endpoint (relies on short TTL) | config scan |
| A12 | P3 | No audited SSO/OAuth support (out of scope) | — |
| A13 | P3 | Role assignment self-service gaps beyond SUPER_ADMIN bootstrap (documented) | RBAC coverage spec |

**PASS:** JWT iss/aud, jti claims, `RolesGuard` route coverage spec exists (`rbac-route-coverage.spec.ts`), Bull Board access requires SUPER_ADMIN + ACTIVE + non-deleted + valid `iss`/`aud` + jti not blacklisted + DB re-check (`bull-board.module.ts:70-142`) — **runtime-verified 401 without token**.

---

## 8. DOMAIN AREAS (verified)

### 8.1 Payments
- **P1 — Webhook FK crash (runtime-proven).** `applyWebhookSucceeded` (payments.service.ts:1151-1239) writes `orderStatusHistory` with `changedByUserId: 'system'` (line 1215). FK `order_status_history_changedByUserId_fkey → users(id)` rejects it. Verified: **no user `id='system'` exists in prod (0 rows)**; direct SQL insert in a rolled-back tx returns:
  `ERROR: insert or update on table "order_status_history" violates foreign key constraint "order_status_history_changedByUserId_fkey" — Key (changedByUserId)=(system) is not present in table "users".`
  **Impact:** the entire tx (including the PENDING→COMPLETED payment claim) rolls back → when a real `payment.succeeded` webhook is the first finalizer, the payment can never complete, the order stays PENDING, and Stripe retries forever. Money is taken with no completion record. The sync path (`processPayment`) uses the real `userId` and is fine; only the webhook path is broken. No residual data left by the probe (tenant/order/history counts back to 0).
- **PASS — no double-charge via replay.** Webhook path early-returns when payment no longer `PENDING` (1159-1161) + CAS `updateMany(status=PENDING)` claim inside tx (1173-1179) with `PaymentAlreadyFinalizedError`. Concurrent split credits CAS-guarded (860-871). Earlier "double-charge P1" claim is **overstated — mitigated**; the real P1 here is the FK crash above.
- **PASS — sync over-payment guards** (payments.service.ts:256-358) block paying beyond remaining balance.
- **P2 — refund path:** `applyWebhookRefunded` (1260-1310) CAS-protects against replay, but there is **no cumulative refund-amount tracking** (relies on provider correctness; `paidAmount` can go negative on edge cases) and `refund.succeeded` without `refundedAmount` is treated as a **full refund** (line 1268).
- **P2 — `COMPLETED` written directly** in payments paths (payments.service.ts:1203, 924, 149-151, 317-319), bypassing `orders.service.ts` `validateTransition`; `REFUNDED` order status is **never set anywhere** (unreachable).
- **P2 — runtime config note:** running prod container has `PAYMENTS_MODE=live`; no test webhook target is configured in this env, so payment webhooks are not exercisable here. Confirm intent before go-live.

### 8.2 Inventory / F1 fix
- **PASS.** F1 deduction verified by unit tests; `consumption_records` composite index present; no regression found in this session.

### 8.3 Webhooks / SSRF
- **PASS (comprehensive).** Registration validates `https` protocol (`@IsUrl`), `assertUrlSafe` resolves every address; blocklist covers 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, 0/8, ::1, ::ffff, fc00::/7, fe80::/10, ff00::/8, link-local; `metadata.google.internal` blocked. **DNS-rebinding:** re-resolve at delivery + per redirect hop; socket lookup pinned to validated addresses (ssrf-client.service.ts:136). Redirects re-validated per hop; header-size caps; retry 5× exp backoff 3000ms; DTO caps. Tests cover private/loopback/link-local, dotted-quad, IPv6 mapped/compressed, redirect re-validation + cap, embedded credentials, reserved hostnames, oversized URLs. HMAC verification fail-closed (`verifyWebhookSignature` throws).

### 8.4 Queues / Redis / Observability
- **PASS.** Health endpoint: `status ok`, database up, redis up, memory up, bullmq up — **21/21 queues** reported. Bull Board auth verified (§7). Queue stats REST surface minimal (`GET /queues/:name/stats`, OWNER/MANAGER).
- **P2 — recovery/restore service is a stub** (`recovery.service.ts:55-78`): emits events + lists pending steps; performs no actual restore (only `menuCategories` upsert real).
- **P2 — Redis has no `requirepass`** (`docker-compose.prod.yml`, port 6379 exposed to host).

### 8.5 Export engine
- **P1 (functional, runtime-proven) — PDF exports always crash.** Redis failed-job data for `bull:export-engine:failed`: jobs 10 and 12 → `"PDFDocumentConstructor is not a constructor"`. Root cause: `import * as PDFDocument from 'pdfkit'` with `esModuleInterop` (tsconfig.base.json) yields a module namespace, not the constructor; the `as unknown as new(...)` cast (export-engine.service.ts:209-213) hides it from TS but it fails at runtime. Job 14 failed with `"Export not found"` (stale reference). XLSX/CSV exports succeed (7 completed). **Fix:** default import (`import PDFDocument from 'pdfkit'`).

### 8.6 Business invariants / Orders
- **P2 — order totals exclude modifiers until recalculation** (`orders.service.ts:72-85`; `recalculateOrder` 1411-1444 still excludes modifiers from subtotal). Payments cannot over-pay (guards 256-261), but reported totals can be inaccurate until recalc.
- **PASS — manual status transitions** validate against `validateTransition`.

### 8.7 Analytics / Performance
- **Raw-SQL safety: PASS.** Only static `SELECT 1` via `$queryRawUnsafe` (health indicator); all analysis uses `$queryRaw` + `Prisma.sql` tagged templates (customer-analytics L116/187/370/415/614, inventory-analytics L261/269/312/379, supplier-analytics L326/482/505). Tenant filters present throughout.
- **P2 — growthRate bug (F-08):** `customer-analytics.service.ts:49-55` — when `query.startDate` is provided, `previousPeriodStart` collapses to `periodStart` → previous-period count always 0 → growthRate always **100%** (or 0). Correct only for the default 30-day window.
- **P2 — money handled as JS `Number` (float) in several analytics paths; tenant + `deletedAt` scoping inconsistent in a few SQL blocks** (spot-checked; recommend a follow-up sweep).

---

## 9. SECURITY & COMPLIANCE GATES

- **`npm audit --audit-level=high` → ❌ FAIL (exit 1).** 24 vulnerabilities: **20 high, 4 moderate**. Key: **axios 1.16.1** (direct prod dependency, used by the outbound webhook SSRF client) — 10 high advisories (formDataToJSON DoS, prototype pollution, NO_PROXY bypass for 0.0.0.0, maxBodyLength bypass); fix requires `npm audit fix --force` (breaking). Also exceljs/sockjs→uuid, nx→brace-expansion, nanoid 3.3.16, fast-uri. **CI "Security audit (SCA)" step fails on push/main.**
- **Runtime probes:** `GET /api/v1/metrics` → **401** without token (METRICS_AUTH_TOKEN set). `GET /admin/queues` → **401** without token. ✅
- **Secrets:** clean (see §2).
- **CORS:** prod validation blocks wildcard `*` in production (`env.validation.ts:217-221`) — except the WS gateways, which hard-code `origin: '*'` (§6).

---

## 10. FINDINGS & REMEDIATION LIST (ordered)

**Must fix before commit/push (P1):**
1. **WS tenant leak** — add an authenticated `WsGuard`/SocketIO adapter; derive tenant from verified JWT, not handshake query; remove `origin:'*'`. (13 namespaces.)
2. **Webhook FK crash** — in `applyWebhookSucceeded`, replace `changedByUserId: 'system'` with the payment/order's real acting user (or make the column nullable + set null); add a webhook integration test.
3. **`npm audit`** — plan upgrade of axios (10 advisories) + remaining high CVEs before push (CI gate).
4. **Export engine PDF** — `import PDFDocument from 'pdfkit'`; add a PDF smoke test; requeue the 7 failed jobs.
5. **CI lint** — normalize CRLF (prettier --fix) in the 5 files (2695 prettier) + fix the 2 `no-require-imports`/unused-disable in `rbac-route-coverage.spec.ts`.

**Strongly recommended (P2)** — auth token revocation on logout, refresh-token hashing, Swagger gating by env, `.env.example` placeholder validation, 2FA single-use/rate-limit, refund cumulative-amount tracking, recovery service real implementation, Redis auth on exposed port, growthRate fix, order-total modifier inclusion, `REFUNDED` reachability, PAYMENTS_MODE confirmation.

---

## 11. FULL REGRESSION MATRIX

| ID | Item | Source | Status (this session) |
|---|---|---|---|
| P0-1..8 | Phase-7 P0 batch items | prior certification | ✅ re-confirmed (tests green, no re-open) |
| P1-B1-1..5 | Batch-1 P1 fixes | certification md | ✅ no regression |
| P1-B2-1..5 | Batch-2 P1 fixes | certification md | ✅ no regression |
| P1-B3-1..5 | Batch-3 P1 fixes (SSRF, webhook delivery, queue guards, gateways, F1) | certification md | ⚠️ SSRF/webhooks/queues ✅; **gateway auth incomplete → P1 WS leak (§6)** |
| D1–D13 | Data-integrity debt list | prior audit | ✅ no new regressions; see new items above |
| F2–F6 | Functional findings | prior audit | ✅ no regressions |
| M4 | M4.4 soft-delete/updatedAt | migration drift | ✅ cosmetic only (§5) |
| M5 | M5 P1 fixes | committed HEAD | ✅ committed, clean |
| F1 | Inventory deduction fix | F1-fix report | ✅ unit-tested |

---

## 12. FINAL VERDICT

**❌ BLOCK — DO NOT COMMIT OR PUSH.**

Basis (binding rule: any remaining P0/P1 in security, tenant isolation, data integrity, payment, migration, production boot, or concurrency ⇒ no approval):
- **P1 tenant-isolation:** all 13 WS namespaces accept anonymous connections and join arbitrary tenant rooms (runtime-proven).
- **P1 payment/data-integrity:** webhook payment completion crashes on an FK violation with a non-existent `'system'` user (runtime-proven), leaving payments stuck PENDING and orders uncompleted.
- **P1 security/CI:** `npm audit` fails (24 vulns, 20 high, axios direct dep); CI lint gate fails (2704 errors).
- **P1 functional:** PDF exports always crash.

Build, type-check, 776 tests, migrations, seed, health, SSRF, Bull Board, and metrics auth are all green — the delivery is close. **Fix §10 P1 items, re-run §9 gates, then commit.** No commit, push, or Batch-4 work was performed.
