# FINAL-SYSTEM-INDEPENDENT-AUDIT.md

**Project:** Tablofy (NestJS + Prisma + BullMQ restaurant multi-tenant platform)
**Repository:** `D:\New folder (8)\tablofy-p4-01-clean`
**Audit type:** Complete, independent, end-to-end, read-only system audit (all phases).
**Audit date:** 2026-09-21 (session span 13:46–20:57 local)
**Auditor:** FINAL INDEPENDENT SYSTEM AUDITOR (greenfield, no prior-reports trusted; every claim re-derived from source, tests, schema, runtime, and git).
**Method:** Static source analysis (manual + 3 parallel deep-dive passes), full gate execution (jest/tsc/eslint/nx build/prisma), live runtime verification against the locally running dev server (port 3100, current source), Docker/Redis/PostgreSQL inspection, and VCS state reconciliation.

---

## 1. Executive Summary

- The **working tree** is self-consistent and **builds and runs green**: Jest `98/98` suites, `1262/1262` tests; `tsc --noEmit` exit 0; ESLint exit 0; `nx build api` success (webpack `a443098750f48174`); `prisma validate` OK; `prisma migrate status` **up-to-date (0 pending)**; DB↔schema diff **empty**; compose config valid.
- The **live dev server (current source)** is running on port 3100: `/api/v1/health` returns DB=up, Redis=up, disk=up, BullMQ=up; all business queues and crons are active (reconcile cron fires every 15 min; every-minute scheduled-report scan; cleanup jobs processing). **Redis is correctly authenticated** (NOAUTH without password, PONG with).
- AuthN/AuthZ and multi-tenancy are defense-in-depth sound: **no confirmed exploitable cross-tenant IDOR** was found. Deny-by-default RBAC tripwire spec passes; unauthenticated access to protected surfaces returns 401.
- The P1-02 / P1-03 / P1-04 / P1-01(creation) remediation items are **verified in current source and in the running dev server**.
- **Release/deployment reality check:** `git` is in a **detached HEAD** (`16d70e5`), **0 commits** have been added; **841 tracked files modified, 1 deleted, 20 untracked.** Three production-relevant source files (`export-storage.service.ts`, `scheduled-reports.cron.ts`) are **untracked** and `scheduled-reports.processor.ts` is **tracked-but-deleted**. **A clean checkout cannot rebuild the current system and loses the export/scheduled-report features.** The running Docker API container (`tablofy-api`, image `docker-api:latest` built **2026-08-28**) is **stale** and does not contain any P1-02/03/04, P4-03, or scheduled-reports work. **Implemented-in-source ≠ committed ≠ deployed.**
- **New findings this audit (not environmental):**
  - **P1 — Payment/order completion race:** `refund()/partialRefund()` decrement `order.paidAmount` **without** bumping `order.version`, while the COMPLETED gate (`orders.service.ts:488-496`) evaluates a **cached** `paidAmount` then relies on version CAS — a refund concurrent with completion can let an order complete underfunded.
  - **P1 — Consumption-record reversal is not implemented** (rollback restores stock but never touches `ConsumptionRecord`) — **BLOCKED_BUSINESS_DECISION**, owner must choose semantics.
  - **P2 — Webhook non-2xx deliveries stall in RETRYING forever** (retry enqueued only on exceptions, not on HTTP failures; `getPendingRetries()` is dead code).
  - **P2 — Webhook success path credits payload amount without a mismatch check** (reconcile path checks cents); over-credit → auto-complete risk.
  - **P2 — ~23 BullMQ workers registered with zero producers** (forecast-generation, warehouse-analytics, low-stock-alerts, CRM family, etc.) — phantom queues, wasted worker capacity, observability noise.
  - **P2/P3 — `cancelGRN` leaves `averageCost` stale; `cancelPO` allows cancelling RECEIVED POs.**
  - **P3 — `/metrics` is unauthenticated when `METRICS_AUTH_TOKEN` unset (confirmed live); Swagger `/docs` fully public; 2FA secret stored plaintext in DB; `TenantBodyGuard` exists but is never wired; webhook consumer is not tenant re-scoped; global unique user email cross-tenant oracle.**
- External dependencies (SMTP, Stripe/Paymob live) are **BLOCKED_EXTERNAL**; internal behavior around them is correct (fail-loudly email design, mock payments, SSRF-guarded webhooks).

**Overall verdict: CONDITIONAL GO for the source-level milestone; NO-GO for deployment** until conditions §32 are satisfied.

---

## 2. Current Repository State

### 2.1 Git / VCS

- Branch: **detached HEAD** (`* (no branch)`); branches present: `main`, `feature/orders`, `feature/phase3-order-execution-m2`, `feature/phase4-m2`, `feature/phase5-m1..m3`, `feature/phase6-m1..m4`, `feature/phase7-m1..m5`; remote `origin` present.
- HEAD: `16d70e546d28252babf3e830d85015c55bcb6e00` — `chore(backend): finalize pre-phase-3 hardening` (the last commit).
- `git status --porcelain` = **862 entries**: 841 modified (tracked), **1 deleted**, 20 untracked. **Nothing staged, nothing committed since HEAD.**

### 2.2 Untracked (20) — release-critical

| Path                                                                                                                                              | Impact                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/export-engine/export-storage.service.ts`                                                                                    | **Imported by TRACKED files** (`export-engine.module.ts:5`, `export-engine.service.ts:10-14`, `cleanup.processor.ts:5`). A clean checkout **fails to compile**; export download/delete would be gone. |
| `apps/api/src/modules/scheduled-reports/scheduled-reports.cron.ts`                                                                                | **Imported by TRACKED** `scheduled-reports.module.ts:4`. Literally the every-minute due-report cron. Fresh checkout loses scheduled reports.                                                          |
| `apps/api/src/modules/export-engine/tests/export-storage.service.spec.ts`                                                                         | Test (untracked)                                                                                                                                                                                      |
| `apps/api/src/modules/scheduled-reports/tests/`                                                                                                   | Tests (untracked)                                                                                                                                                                                     |
| `apps/api/src/modules/payments/tests/reconcile-pending.spec.ts`, `queues/tests/cleanup.processor.spec.ts`, `queues/tests/queue-module.di.spec.ts` | Tests (untracked)                                                                                                                                                                                     |
| 13 root `*.md` audit/report documents                                                                                                             | Untracked reports                                                                                                                                                                                     |

### 2.3 Tracked-but-deleted (1)

- `apps/api/src/modules/scheduled-reports/scheduled-reports.processor.ts` (` D`) — replaced by the cron+event design; working tree and HEAD diverge.

### 2.4 Config surface

- Monorepo (Nx). Apps: `apps/api` only. `libs/` present. `dist/apps/api` build output present.
- Config: `nx.json`, `tsconfig.base.json`, `eslint.config.js`, `prisma.config.ts`, `docker/docker-compose.yml`, `docker/Dockerfile`, `.env.example`, root `jest.config.ts`.
- `.env` at repo root **and** `apps/api/.env` (created this session for local dev run; both **gitignored**). `dist/`, `logs/`, `exports/`, `node_modules/` are untracked/present in tree.

OBSERVATIONS:

- **Q. What is committed?** Only the pre-Phase-3 hardening baseline (HEAD). None of the P1 remediation, P4-03 export engine, or scheduled reports.
- **E. Unrelated modifications:** 841 tracked files modified versus HEAD — the working tree is effectively the _entire_ subsequent development carried as uncommitted changes (credible for this workflow, but a release cannot be produced from VCS today).
- **F. Generated files committed?** `dist/`, `logs/`, `exports/` are NOT tracked (no false-committed build artifacts).
- **G/H. Stale/dead/duplicate modules:** see §26 (phantom queues, dead methods, orphan webhook cleanup).

---

## 3. Architecture Map

### 3.1 Stack

- NestJS 10/11 (Express platform) + Socket.IO adapter; @nestjs/config+validation (guarded env); @nestjs/terminus health; Swagger at `/docs`; BullMQ on Redis; Prisma 6.19.3 on PostgreSQL 16; Nx workspace; webpack production bundle (`main.js`).
- Global prefix `api`, URI versioning `v1` default → routes `POST /api/v1/...`.
- Global pipeline order (app.module.ts): `JwtAuthGuard → RolesGuard → TenantGuard → PlanThrottleGuard → ThrottlerGuard`; global `ValidationPipe` (whitelist, forbidNonWhitelisted, transform).

### 3.2 Modules (apps/api/src/modules)

auth, users, tenants, sessions, invitations, restaurants (+branches/floors/dining-areas/tables), menu (categories/products/variants/modifier-groups/modifiers/tags/allergens/nutrition), orders, payments, inventory, recipes, purchasing (suppliers/POs/GRNs/batches), warehouse (counts/transfers/waste), costing, forecasting (+dashboard), analytics (financial/inventory/usage/dashboard), export-engine, scheduled-reports, webhooks, api-keys, subscriptions, usage, notifications, campaigns/crm/customers, gift-cards, privacy, backup, audit-log, queues (workers), scheduler (crons), health, metrics, common (guards/logger/redis/redis-lock/ws/bull-board/2fa/ssrf).

### 3.3 Primary flow map (verified)

```
Tenant register → user(OWNER) → login(JWT+refresh hashed) → guards(Jwt/Roles/Tenant)
→ restaurant/branch/table → menu catalog (server prices)
→ order create (catalog-authoritative pricing, recipes)
→ payment charge (PENDING row → provider intent → CAS finalize → paidAmount credit → order version CAS)
→ order.status COMPLETED (payment proof gate + version CAS) → event order.completed
→ recipes.processor deduct → StockMovement CONSUMPTION + ConsumptionRecord create (same tx, FOR UPDATE, logical idempotency)
→ analytics/forecasting/valuation readers (Σ totalCost / Σ quantity, ignore deletedAt)
→ cancel/refund → order.cancelled/order.refunded → rollbackDeduction (stock ADJUSTMENT reversal; ConsumptionRecord NOT reversed — gap §8/§9)
→ webhook delivery (signature/HMAC, SSRF-guard, retry/DLQ)
→ cron: reconcile_pending_payments (*/15), scheduled-report scan (* * * * *), cleanup family → BullMQ workers
→ export-engine (atomic file write, tenant dir, downloads role+tenant scoped) → email (SMTP; BLOCKED_EXTERNAL)
```

---

## 4. Phase-by-Phase Assessment (re-derived, reports NOT trusted)

| Phase                                | Claimed objective                              | Verdict in CURRENT SOURCE         | Notes/evidence                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 1/2 (Auth, tenancy, RBAC base) | Identity + multi-tenancy + RBAC                | **PARTIAL**                       | Sound overall; `TenantBodyGuard` unwired (P2), 2FA secret plaintext (P2), per-request DB JWT validation (P4).                                                      |
| Phase 3 M1/M2 (order execution)      | Orders state machine + payments + KDS          | **PARTIAL**                       | Gate + CAS good; refund/version race (P1) and webhook amount trust (P2) remain.                                                                                    |
| Phase 4 M1/M2                        | Catering/reservations, payments depth          | **PARTIAL**                       | Same payment caveats.                                                                                                                                              |
| Phase 5 M1–M3                        | Inventory/recipes/GRN/costing                  | **PARTIAL**                       | Deduction+single writer + row locking PASS; `rollbackDeduction` w/o ConsumptionRecord reversal; `cancelGRN` w/o averageCost recompute; `cancelPO` allows RECEIVED. |
| Phase 6 M1–M4                        | Analytics/export/campaigns/CRM scaffolding     | **PARTIAL**                       | Export engine solid (atomic, tenant, traversal-safe) but **uncommitted**; ~23 phantom queue workers; SMTP BLOCKED_EXTERNAL.                                        |
| Phase 7 M1–M5                        | RBAC/permissions, 2FA, payments, subscriptions | **PARTIAL**                       | Permissions model + tripwire PASS; 2FA secret at-rest plaintext (P2); global email unique (P3).                                                                    |
| P1-02 (reconcile)                    | Orphan pending reconciliation                  | **PASS (verified)**               | Cron `*/15 * * * *` firing live; reconcile never auto-fails; cents mismatch check; CAS claims.                                                                     |
| P1-03 (payment-proof gate)           | COMPLETED requires payment proof               | **PARTIAL (P1 race)**             | Gate present (`orders.service.ts:488-496`) and tested; race via cached read + refund-without-version.                                                              |
| P1-04 (token hashing)                | Refresh/verify/reset tokens hashed             | **PASS (verified)**               | SHA-256 at rest; single hashed writer; rotations revoke; DB refreshToken count 0.                                                                                  |
| P1-01 (consumption record)           | Consumption writer + costing integration       | **PARTIAL**                       | Creation = single writer in deduction tx (PASS); reversal semantics missing (**BLOCKED_BUSINESS_DECISION**).                                                       |
| P4-03 (export storage)               | Real file storage + download                   | **PASS in tree / UNWIRED in VCS** | `export-storage.service.ts` untracked; atomic write + path containment + tenant isolation verified in source; not committed.                                       |

No phase was found to be **PHANTOM**; the unreliable areas are the P1/P2 seams above, the uncommitted release surface, and the stale deployed container.

---

## 5. Cross-Phase Integration Assessment

| Integration seam                   | Result                                        | Evidence                                                                                                                                         |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth ↔ Tenancy ↔ RBAC            | **PASS** (no IDOR)                            | Uniform tenant-scoped lookup pattern; 266-route coverage; 401/403 verified live.                                                                 |
| Orders ↔ Payments (completion)    | **P1 gap**                                    | COMPLETED gate reads cached paidAmount while refunds decrement without version bump (§7/§11).                                                    |
| Payment → inventory deduction      | **PASS**                                      | `order.completed`/`payments.completed` → deduped `deduct-{orderId}` job → in-tx consumption.                                                     |
| Cancel/Refund → inventory → COGS   | **P1 gap**                                    | Stock reversed; **ConsumptionRecord NOT** → COGS/forecast inflation (reaching dashboard, financial-analytics, inventory-analytics, forecasting). |
| Export → Scheduled reports → Email | **PASS internal / BLOCKED_EXTERNAL delivery** | AbsolutePath event → email attachment validated for existence/containment; SMTP unset → loud failure.                                            |
| Cron → Queue → Processor           | **PASS** wiring                               | All scheduler crons → cleanup queue jobs → registered processors; reconcile live-fired.                                                          |
| Producer ↔ Consumer payloads      | **PASS**                                      | auth/scheduled-reports→email, kds→kitchen, export, campaign-execution, webhook-delivery/retry all consume matching payloads.                     |
| Tenant context in workers          | **PARTIAL**                                   | export-engine re-scopes by `{id,tenantId}`; webhook consumer loads by id only (P3); recipes processor requires tenantId.                         |
| Redis locks duplicate exec         | **PASS**                                      | `runIfLocked` SET NX PX + Lua compare-delete; live "another instance holds it" warns (dual instance).                                            |
| DB tx vs event publication         | **PARTIAL**                                   | Outbox-free emit-after-commit; provider intent created AFTER commit → orphan-PENDING window (mitigated by reconcile cron).                       |

---

## 6. Multi-Tenancy Assessment — **PASS (no confirmed IDOR)**, PARTIAL hardening

- Tenant context: from JWT + `params.tenantId` via `TenantGuard`; services apply `findFirst({where:{id, tenantId}})`before writes, 404 on cross-tenant ids.
- No `findUnique(id)` read-only without tenant scoping was found in production modules.
- Nested `restaurants/:restaurantId/...` routes validated by TenantGuard + service-level tenant filter.
- **P2 — TenantBodyGuard never wired** (`common/guards/tenant-body.guard.ts`; referenced only in its own spec). Body/query-supplied tenant ids are not validated; currently safe because services ignore body tenantId, but it is a latent isolation break.
- **P2 — systemic write-by-bare-id TOCTOU**: `findFirst({id,tenantId})` then `update({where:{id}})` (e.g., `users.service.ts:167-203`). Cross-tenant id ⇒ 404 first; race window is narrow; recommend `updateMany({where:{id,tenantId}})`.
- **Weights/Redis/queues/events:** Redis keys are `tenant:<...>`-free but isolation derives from server-side tenant scoping; webhook/queue payloads carry tenantId (webhook consumer missing re-check — P3).
- Cross-tenant attack tests: attempted endpoints return 401/404; no reproducible cross-tenant read/write path exists.

---

## 7. Authentication / RBAC Assessment — **PASS**, with P2/P3 items

Verified live: wrong credentials → 401; no token → 401; forged token → 401; nested protected route → 401.

- Global order `JwtAuthGuard → RolesGuard → TenantGuard → PlanThrottleGuard → ThrottlerGuard`; deny-by-default (missing metadata ⇒ 403) — tripwire spec passes (`role-reference-coverage.spec.ts`, 12.8s).
- Refresh/verify/reset tokens SHA-256 at rest (`auth.service.ts:287-288, 451, 484-487, 591-594`); refresh rotation with reuse detection → revoke-all; Revoked tokens blacklisted in Redis.
- Lockout: 5 fails/15 min; login throttled 30/min/IP.
- Public surface (verified exhaustive): 6 auth routes, invitation token/accept, stripe/paymob webhooks, health(3), metrics(1).
- **P2 — 2FA secret stored plaintext** (`auth.service.ts:744-747`, schema `User.twoFactorSecret`); TOTP math is standard (SHA1/6/30s/±1).
- **P3 — refresh does not re-validate tenant/subscription state** (`auth.service.ts:305-341`).
- **P3 — global unique `User.email`**: cross-tenant email oracle + DoS-by-email-occupation; register 409 leaks existence.
- **P3 — metrics unauthenticated when token unset (confirmed live: `/api/v1/metrics` 200, no auth).** Production validation requires a token ≥16 chars, so prod-safe by config; dev/self-host risk.
- RBAC matrix: roles enum UserRole (SUPER_ADMIN, OWNER, MANAGER, STAFF, KITCHEN, CASHIER, WAITER, VIEWER). Route-level coverage complete; VIEWER is read-only subset. No invalid role names; `PURCHASING`/`CHEF` references absent (spec-verified).

---

## 8. Orders Assessment — **PARTIAL**

- State machine `order-state-machine.ts:24-35` enforces legal transitions; equal-status/illegal blocked; terminal states respected.
- Server-authoritative pricing on create AND update (`resolveItemUnitPrice`, `resolveModifierPrice`, `resolveAuthoritativeItemPrice`) — client prices are NOT trusted.
- `recalculateOrder` floors total at paidAmount (`orders.service.ts:1693-1696`).
- Status change route: **`POST restaurants/:restaurantId/orders/:id/status`** (`orders.controller.ts:38`, `@Post(':id/status')`).
- Completable-without-payment: gate `paidAmount < total ⇒ 400` (`orders.service.ts:488-496`) tested (spec `:841-916`). **BUT** gate reads a CACHED order and only `version` CAS protects the transition; **refunds decrement paidAmount without bumping version** → concurrent refund slots past the gate (P1, §11).
- Events: `order.completed/cancelled/refunded/confirmed` emitted async from changeStatus; cross-phase commands (deduction/rollback) subscribers verified.

---

## 9. Inventory / Recipes / Costing Assessment — **PARTIAL** (two P1-grade gaps)

- Inventory mutations are gte-guarded, version-CAS'd, and approveAdjustment INCREASE auto/DECREASE requires approval. PASS.
- Deduction: recipes.service `validateBusinessRules` → tenant-scoped → FOR UPDATE row locks (inventory items, order) → partial deduction w/ shortfall → CONSUMPTION StockMovement + **ConsumptionRecord create in the SAME transaction** (`recipes.service.ts:707-719`) — single writer repo-wide (grepped). Idempotency: pre-check + in-tx re-check under lock + deduped job `deduct-{orderId}`.
- **Gap A (P1/BLOCKED_BUSINESS_DECISION):** cancellation/refund reverts stock quantities (ADJUSTMENT/ROLLBACK movements, `recipes.service.ts:764-832`) but **does not reverse `ConsumptionRecord`**. Consumers summing totalCost/quantity (dashboard, financial/inventory-analytics, forecasting) remain permanently inflated for cancelled/refunded orders.
- **Gap B (P2):** manual `POST recipes/rollback-order/:orderId` (`recipes.controller.ts:114-119`) is repeatable and the idempotency marker is ineffective (`notes NOT contains 'ROLLED_BACK'` but rollback writes ADJUSTMENT movements) → double-reversal on repeat calls.
- No DB unique constraint enforces consumption idempotency (`schema.prisma:3575-3599`); it is logical-only.

---

## 10. Purchasing Assessment — **PARTIAL**

- PO update confined to DRAFT/PENDING_APPROVAL; over-receipt CAS (`receivedQuantity lte remainingAllowed`); GRN applies inventory row lock + correct weighted-average formula (`purchasing.service.ts:948-981`); batch creation uses natural-key reuse; CAS on item version.
- **P2 — `cancelGRN` does not recompute `averageCost`** (`purchasing.service.ts:1267-1401`), leaving valuation polluted.
- **P2 — `cancelPO` permits cancelling `RECEIVED` / `PARTIALLY_RECEIVED`** POs (`:645-647`), leaving stock + GRNs attached to a cancelled PO (data-consistency smell).
- Lost-update races: GRN status recompute lacks PO version CAS (low impact).

---

## 11. Payments Assessment — **PARTIAL** (core P1 + P2 findings)

- Charge: payable-status check, over-payment guard, idempotent replay, provider PENDING row → intent (after commit) → confirm → success/FAILED (mock in dev). Non-provider (CASH/GIFT_CARD) immediate COMPLETED credit with gift-card balance CAS.
- Finalization: payment `status=PENDING` CAS claim; order version CAS; credits paidAmount; auto-COMPLETE path for provider-completed orders (with P1-03 gate).
- Reconcile: `reconcilePendingPayments`/`resolvePendingPayment`/`resolveSucceededPayment` — rejects mismatch (cents-level), never auto-fails on transient gateway errors, CAS-protected; cron `*/15 * * * *` (**verified firing live**) → cleanup queue → CleanupProcessor → PaymentsService. 13 reconcile tests.
- Webhook: signature verified; CAS idempotent claim; **P2 — credits payload amount with no mismatch check** (`payments.service.ts:1591`, vs reconcile check at 1314-1334) → over-credit + auto-complete risk on gateway drift.
- Money: `Decimal(10,2)` columns fed by float arithmetic in places (`payments.service.ts:267,329,1592`) not using `money.util.ts` rounding — LOW currency/precision risk.
- **P1 — refund race (§8):** `refund()` full CAS `amountRefunded:0`; `partialRefund()` CAS lte-max; both decrement paidAmount/tip **without `order.version` increment**, while the COMPLETED gate trusts cached paidAmount + version CAS.
- Orphan-PENDING: mitigated by 15-min reconcile (verified). `$0` orders complete with zero payment (by design, tested).

---

## 12. Webhook Assessment — **PARTIAL**

- Encryption at rest: AES-256-GCM, scrypt key from `WEBHOOK_ENCRYPTION_KEY`, boot-refusal if missing/weak (verified file + env-validation); secret returned once; SSRF-guard comprehensive (protocol whitelist, DNS pinning, per-hop redirect re-validation) — request URL cannot hit internal networks.
- **P2 — HTTP-failure stall:** non-2xx → `markFailed` but NEVER enqueues retry; retry enqueue exists only in exception `catch` (`webhook-processor.ts:170-175` not `:143-152`); BullMQ sees success → delivery sits RETRYING forever; `getPendingRetries()` (`webhook-delivery.service.ts:155`) is dead code.
- **P2 — retry budget mismatch:** dead-letter at global `delivery.maxRetries` default 5, ignoring per-registration `retryCount` (schema `maxRetries @default(3)`).
- **P3 — consumer loads registration/delivery by id WITHOUT tenant re-check** (`webhook-processor.ts:87-101`) — forged jobs could target another tenant's endpoint.
- **P3 — legacy fallback:** `getWebhookSecret` falls back to `secretHash` → unverifiable signatures for legacy rows.
- Replay protection: no DB uniqueness on `[webhookId,eventId]`; no PENDING sweep; duplicate delivery possible (BullMQ at-least-once) — partial.

---

## 13. Queue / Worker Assessment — **PARTIAL**

**QUEUE MATRIX** (verified: producer → consumer → registration → retry/DLQ):
| Queue | Producer | Consumer (file) | Registered | Retry/DLQ | Tenant-scoped |
|---|---|---|---|---|---|
| email | auth `:711`, sched-reports `:263` | email.processor `:36` | Y | 5/exp/DLQ | log-only |
| notification | inventory.processor `:131,237` | notification.processor `:12` | Y | yes | producer builds per-tenant |
| cleanup | scheduler (11 crons) | cleanup.processor `:22` | Y | 2 | global-by-design |
| print | **none** | print.processor `:12` | Y | yes | n/a |
| kitchen | kds `:353,:487` | kitchen.processor `:12` | Y | yes | log-only |
| export-engine | export `:45`, sched-reports `:176` | export-engine.processor `:14` | Y | 2/300s | **re-scoped id+tenant** |
| webhook-delivery / retry | webhook-event-emitter `:55` | webhook-processor `:73,:74` | Y | 5/3 | **not re-checked (P3)** |
| dead-letter | queue.service `:186` | dead-letter.processor `:26` | Y | 1 | observability |
| inventory-deduction | recipes.processor `:24-53` | recipes.processor `:15` | Y | base | tenantId required |
| notification-jobs | crm `:260,:506` | customers.processor `:14` | Y | base | log-only |
| purchase-notifications | purchasing `:387,514,676` | purchasing.processor `:11` | Y | base | log-only |
| campaign-execution | campaigns `:244` | campaigns.processor `:13` | Y | 2/300s | log-only |

- **PHANTOM (worker registered, NO producer anywhere — grep `.addJob(`/`.add(`):** `forecast-generation`, `auto-reorder`, `warehouse-analytics`, `supplier-performance-calculation`, `daily-valuation`, `crm-jobs`, `scheduled-notifications`, `daily-reports`, `segment-recalculation`, `analytics-generation`, `membership-recalculation`, `reward-processing`, `point-expiration`, `membership-upgrade`, `marketing-jobs`, `purchase-analytics`, `transfer-notifications`, `cycle-count-reminders`, `inventory-sync`, `low-stock-alerts`, `expiration-checks`, `waste-reports`. These inflate worker/thread consumption and health monitoring, but are harmless to correctness.
- No producer-without-consumer found; no consumer-not-registered found in the live tree.

---

## 14. Cron Assessment — **PASS**

- 11 cleanup crons + `reconcile_pending_payments` (`*/15 * * * *`, scheduler.service.ts:121-129) + `process_due_scheduled_reports` (`* * * * *`, scheduled-reports.cron.ts:17-29).
- All wrapped in `RedisLockService.runIfLocked` (SET NX PX + Lua compare-delete); duplicate-execution protection verified by live "another instance holds it" log lines.
- Registration: `ScheduleModule.forRoot()` (app.module.ts:155), SchedulerModule (:199), ScheduledReportsModule (:230). **All imported.**
- Minor (P4): `getRegisteredJobs()` omits `cleanup_expired_tokens_2am`; scheduled-reports scan cron is **untracked** (VCS issue, not wiring).

---

## 15. Export / Reporting Assessment — **PASS in tree / UNWIRED in VCS**

- `ExportStorageService.writeExport`: atomic temp+rename, size re-verify, empty-buffer rejection, stale-temp cleanup (`export-storage.service.ts:68-88,156-164`).
- Traversal-proof: `assertIdentifier`, `assertSafeRelativePath`, `assertContained` (`:126-154`); per-tenant directory; cross-tenant read/delete blocked → NotFound.
- Download authorization: `findFirst({id,exportId,tenantId})` + class-level `@Permissions('reports:read')`.
- COMPLETED implies file existed (size-verified before status). Missing file later → NotFound on download (no phantom success).
- Scheduled-report → export → email: `report-export.completed` event carries absolutePath; email attachment validated (existence + EXPORT_DIR containment, `email.processor.ts:130-154`); missing/zero-byte → throw ⇒ can't silently attach a non-existent file.
- Retention cleanup: expired_data_exports + expired_report_exports delete rows AND files.
- **Files are UNTRACKED in git** (§2) — reproducibility break.

---

## 16. Database Assessment — **PASS (state), with noted gaps**

- `prisma validate` OK; `migrate status` = up-to-date (0 pending, 24 migrations); `migrate diff --from-url … --to-schema-datamodel` = **No difference detected** (zero drift).
- Live DB `tablofy_prod` (postgres:16-alpine container): databases present: postgres, tablofy_prod, templates — only prod schema in use.
- Indexes present on hot paths; ConsumptionRecord carries indexes on `[tenantId,inventoryItemId,date]` but **no unique idempotency key** (logical-only).
- Decimal(10,2) money columns fed partly by float arithmetic (§11). No negative-stock (gte guards + clamp-to-0).
- Soft-delete semantics used consistently (`deletedAt`) but ConsumptionRecord readers don't filter `deletedAt` (relevant to §9 reversal decision).
- **No `test` database exists** — integration specs mock Prisma (§25).

---

## 17. Redis Assessment — **PASS**

- Authentication enforced and **verified live**: `redis-cli PING` → `NOAUTH Authentication required`; `-a <pw>` → `PONG`. TLS on via REDIS_TLS; prod validation mandates password ≥16.
- Key namespaces: `blacklist:<jti>`, `session:<id>`, `user_sessions:<userId>`, `temp:<token>`, `lock:<key>`, `cron:<name>`, BullMQ internals. TTLs on blacklist/sessions/temp tokens/counters verified in code.
- Locks: token-released Lua compare-and-delete, 5-min/60-s TTLs by task.
- No credential logging found (searched); no unbounded key storm (P4: `user_sessions` SADD members not cleaned on session expiry; `setHash/getAllHash` are TEST_ONLY dead API).

---

## 18. Security Assessment — **PASS with P1/P2/P3 findings**

- Privileged checks: `ssrf-guard.ts` (DNS-pinned lookup, per-hop redirect revalidation, https-only default, private-IP/alias blocklists) + `ssrf-client.service.ts`. Webhook can't reach internal networks. PASS.
- No SQL injection surface (Prisma parameterized); ValidationPipe whitelist + forbidNonWhitelisted globally.
- No mass-assignment (DTOs explicit); no unsafe deserialization; no prototype pollution paths found; no `console.*` in src.
- **Secret exposure:** no secrets in committed code; `.env` gitignored; JWT/webhook keys min-length enforced; production rejects `change-this` secrets, wildcard CORS, weak metrics token. PASS (config-level).
- Findings: §7 (2FA plaintext, refresh w/o tenant check, global email oracle), §6 (TenantBodyGuard, TOCTOU), §8/§11 (refund race, payment integrity), §12 (webhook tenant re-check). Severity register in §29.

---

## 19. API Contract Assessment — **PASS**

- Global ValidationPipe consistent across all routes; forbidNonWhitelisted prevents unknown-field tampering; status codes standard (400/401/403/404/409/422 observed).
- Swagger at `/docs` (public — P4 info disclosure note); route↔DTO↔service↔Prisma consistency verified on key flows (create/charge/status/download).
- Pagination/filter/sort present on list endpoints (query DTOs); no response-shape mismatches found on audited flows.

---

## 20. Error Handling Assessment — **PARTIAL**

- tx rollback on throw; CAS conflicts → Conflict; fail-loud email (getTransporter throws); webhook non-2xx → **silent stall (P2)**; processor failures → retries → DLQ with alerts.
- Exceptions don't produce false-success on audited critical paths; `emitResult` increments `ordersCompleted` per completed payment (metric inflation when multi-payment, LOW).

---

## 21. Observability Assessment — **PASS/PARTIAL**

- Structured JSON logs w/ requestId/correlationId; `AppLoggerService` global; unhandledRejection/exception handlers + forced-shutdown watchdog; graceful shutdown hooks with deadline.
- Audit-log module + retention cron; health/readiness (db/redis/disk/bullmq); Prometheus `/metrics`.
- **P3 — `/metrics` unauthenticated when METRICS_AUTH_TOKEN unset (verified live, 200) / prod-gated.** P4 — health public by design.
- No credential/token/OTP leakage in logs (searched).

---

## 22. Test Quality Assessment — **PARTIAL**

- Count: **98 suites / 1262 tests** — all pass, 40.8s. Includes role-coverage tripwire (deny-by-default) and payment/recipe/deduction/refund/reconcile/cleanup/DI specs.
- Strong: payment CAS/idempotency D3/D4 (payments.service.spec), reconcile-pending (13), recipe deduction concurrency + single-record + per-tenant (deduction.spec 386-499), RBAC tripwire, queue DI wiring.
- **Gap — the 7 `*.integration.spec.ts` specs are NOT true DB integration:** they inject mock PrismaService (`{provide:PrismaService, useValue: mockPrisma}`) and the test env points at `postgresql://test:test@localhost:5432/test`, a database that **does not exist** here. They prove service behavior with mocked repositories, not runtime DB behavior. → classification **TEST_PRESENT_BUT_NON_PROVING** for persistence.
- Untested critical flows: refund↔completion race, webhook non-2xx retry stall, cancelGRN averageCost, cancelPO RECEIVED, webhook amount mismatch, tenant-recheck in webhook consumer, ConsumptionRecord reversal (blocked on decision).
- No e2e (HTTP-level, real DB) suite exists.

---

## 23. Docker / Runtime Assessment — **PARTIAL (source runs; deployment stale)**

- `docker compose config` valid (obsolete `version:` key warning only).
- Containers: `tablofy-postgres` / `tablofy-redis` healthy (up 7h); `tablofy-api` on **0.0.0.0:3000** healthy.
- Image `docker-api:latest` `dbcfdfa8cb1f`, **built 2026-08-28 01:15 EEST**. Source changes (P1-02/03/04, P4-03 export, scheduled-reports cron) all **post-date the image** → the running API container is **stale and does not contain the audited work**.
- Dockerfile: `COPY dist` (no source bind-mount), CMD `prisma migrate deploy && node app/main.js`. No P1/export markers in the running bundle (verified previously by `docker exec ... grep`).
- **Current-source runtime is the local dev server on :3100** — boots clean, DB/Redis connect, all queues+crons live, health 200. This is the only place the audited system is actually running.
- **Dual-instance note:** the stale container (:3000) and the dev server (:3100) share one Redis → both register workers and compete for cron locks (live "another instance holds it" warnings). In a controlled run this is safe (locking), but mixing a stale bundle with a current bundle on one Redis can produce spurious retries for job types the old worker doesn't know.

---

## 24. Business Scenario Results

| #   | Scenario                                       | Result (evidence)                                                                                                                                                    |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tenant register → login → refresh → logout     | **PASS (unit+integration)**; login/refresh/logout behavior covered by specs; runtime unauth/401 probes OK. Full DB-write flow not executed (avoids mutating dev DB). |
| 2   | Tenant → roles → staff → authz                 | **PASS** — RBAC tripwire spec (266 routes), role-policy specs, VIEWER read-only.                                                                                     |
| 3   | Catalog → product → variant → modifier → order | **PASS (unit)** — server-authoritative price resolution; order CRUD integration (mocked DB).                                                                         |
| 4   | Order → deduction → consumption record         | **PASS (unit, strong)** — single writer, in-tx, concurrency dedup; runtime wiring via recipes.processor verified.                                                    |
| 5   | Order → payment → completion                   | **PARTIAL** — gate + CAS tested; **refund race (P1)** and webhook over-credit path (P2) remain.                                                                      |
| 6   | Payment failure → retry → reconciliation       | **PASS** — reconcile cron verified firing live; CAS + cents mismatch; 13 tests.                                                                                      |
| 7   | Order cancel → inventory rollback              | **PARTIAL** — stock reversed (movement+quantity); ConsumptionRecord not reversed (BLOCKED_BUSINESS_DECISION).                                                        |
| 8   | Refund → financial/inventory consequences      | **PARTIAL** — refund CAS + paidAmount decrement; version race (P1); consumption gap (§9).                                                                            |
| 9   | Purchase → GRN → batch → inventory → costing   | **PARTIAL** — over-receipt CAS + weighted-avg PASS; cancelGRN averageCost (P2), cancelPO RECEIVED (P2).                                                              |
| 10  | Export → file storage → download → cleanup     | **PASS (source)** — atomic write, traversal-safe, tenant dirs; **uncommitted** (VCS).                                                                                |
| 11  | Scheduled report → export → email attachment   | **PARTIAL** — wiring PASS; delivery **BLOCKED_EXTERNAL (SMTP unset)**.                                                                                               |
| 12  | Two tenants simultaneous identical ops         | **PASS (unit)** — per-tenant records tested; runtime cross-tenant probes 401/404.                                                                                    |
| 13  | Two workers same job                           | **PASS** — BullMQ atomic job claims + RedisLockService; dual-instance coexistence observed safely.                                                                   |
| 14  | Duplicate payment/webhook event                | **PARTIAL** — payment CAS idempotency strong; webhook lack of `[webhookId,eventId]` uniqueness (P3).                                                                 |
| 15  | Concurrent order status transitions            | **PARTIAL** — version CAS + transition table; refund/version gap (P1).                                                                                               |

Full HTTP CRUD scenario execution was not performed to avoid mutating the local dev database (test DB absent); unit+integration suites and live probes provide the evidence above.

---

## 25. Regression Findings

- Full suite + tsc + eslint + build pass on the current tree — **no regression** introduced by P1 work.
- DID drift hazards: untracked `export-storage.service.ts` / `scheduled-reports.cron.ts` and deleted `scheduled-reports.processor.ts` mean the **committed vs working tree diverge structurally** for export/scheduled-report features.
- Environment: Prisma 6.19.3 with update notice to 8.0.0-rc — do not upgrade ahead of a planned, tested window (P4).
- Pre-existing (not from recent phases): 841 modified tracked files as the entire development delta; no checklist separates them.

---

## 26. Phantom / Unwired Features — **significant list**

- **~23 phantom queue workers** (§13) — registered, zero producers.
- **UNWIRED in VCS (release-critical):** `export-storage.service.ts`, `apps/api/src/modules/scheduled-reports/scheduled-reports.cron.ts` (untracked); `scheduled-reports.processor.ts` tracked-but-deleted.
- **Dead code:** `getPendingRetries()` + `cleanupOldDeliveries()` (`webhook-delivery.service.ts:155,177`); `setHash/getAllHash` (Redis, TEST_ONLY); cleanup's `status:'FAILED'` webhook arm never matches generated statuses (only RETRYING/DEAD_LETTER/DELIVERED written).
- Stub-nature comments: notification + print processors log-and-mark (`notification.processor.ts:38-39`, `print.processor.ts:29-30`).
- Health indicator covers phantom queues and misses live ones (`notification-jobs`, `purchase-notifications`, `inventory-deduction` not in QUEUE_JOB_OPTIONS) (P4).

---

## 27. External Blockers — BLOCKED_EXTERNAL

- **SMTP/email delivery** — no SMTP\_\* keys; email jobs fail/retry/dead-letter loudly by design (3 failed jobs observed in BullMQ). Internal attachments/containment logic verified.
- **Stripe/Paymob live** — not testable; dev runs `PAYMENTS_MODE=mock`. Webhook/SSRF/signature internals verified in source.
- **Test database** — `postgresql://test:test@localhost:5432/test` does not exist; true DB-backed e2e cannot run here.
- **Push notifications / object storage / third-party OAuth** — not present/verified.

---

## 28. Business Decisions Required — BLOCKED_BUSINESS_DECISION

1. **ConsumptionRecord reversal semantics** on order cancel/refund — evidence points to codebase precedent of offsetting-record reversal (stock uses ADJUSTMENT/ROLLED_BACK), and readers ignore `deletedAt`. Choose: compensating record (recommended given precedent), soft-delete, hard-delete, or leave-as-is (accepting COGS distortion). **Required before closure.**
2. **Global unique email policy** across tenants (oracle + tenant-onboarding conflict).
3. **`/metrics` and `/docs` exposure policy** in shared deployments.
4. **Per-webhook retry budget** semantics (registration retryCount vs global default).
5. **cancelPO policy** for RECEIVED/PARTIALLY_RECEIVED.

---

## 29. Complete Finding Register

| ID    | Sev     | Status                    | Subsystem              | File / Symbol                                                                                                             | Description                                                                                                                                                                                                           |
| ----- | ------- | ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-001 | P1      | CONFIRMED                 | Payments/Orders        | `payments.service.ts:582-589,684-690`; `orders.service.ts:483-523,488-496`                                                | Refund/partialRefund decrement `paidAmount` without `order.version` bump; COMPLETED gate reads cached paidAmount + version CAS → concurrent refund can complete an order underfunded, and inventory already deducted. |
| F-002 | P1      | BLOCKED_BUSINESS_DECISION | Consumption            | `recipes.service.ts:707 vs 764-832`; consumers `dashboard:105-110`, financial-analytics, inventory-analytics, forecasting | rollbackDeduction reverses stock but not ConsumptionRecord → cancelled/refunded COGS/forecast inflation.                                                                                                              |
| F-003 | P0(rel) | UNWIRED-in-VCS            | VCS/Export/Reports     | `export-storage.service.ts`, `scheduled-reports.cron.ts` untracked; `scheduled-reports.processor.ts` D                    | Clean checkout breaks build; export/scheduled-report features absent from any committed release.                                                                                                                      |
| F-004 | P2      | CONFIRMED                 | Webhook                | `webhook-processor.ts:143-152` vs `:170-175`; `webhook-delivery.service.ts:155`                                           | Non-2xx → no retry enqueue; stuck RETRYING forever; retry sweeper dead.                                                                                                                                               |
| F-005 | P2      | CONFIRMED                 | Payments/Webhook       | `payments.service.ts:1591` vs `:1314-1334`                                                                                | Webhook success credits payload amount w/o mismatch check (reconcile checks cents) → over-credit/auto-complete.                                                                                                       |
| F-006 | P2      | PHANTOM                   | Queues                 | ~23 workers (`forecasting.processor:14,18`, `warehouses.processor:10`, inventory `:40-43`, CRM family, etc.)              | Registered workers, zero producers — wasted workers/threads, health noise.                                                                                                                                            |
| F-007 | P2      | CONFIRMED                 | Purchasing             | `purchasing.service.ts:1267-1401`                                                                                         | cancelGRN does not recompute averageCost.                                                                                                                                                                             |
| F-008 | P2      | CONFIRMED                 | Purchasing             | `purchasing.service.ts:640-683,645-647`                                                                                   | cancelPO allows RECEIVED/PARTIALLY_RECEIVED.                                                                                                                                                                          |
| F-009 | P2      | CONFIRMED                 | Multi-tenancy guard    | `common/guards/tenant-body.guard.ts` (unwired)                                                                            | Body/query tenant-id validation exists but is never applied; latent isolation break.                                                                                                                                  |
| F-010 | P2      | CONFIRMED                 | Auth                   | `auth.service.ts:744-747`; schema `User.twoFactorSecret`                                                                  | TOTP 2FA secret stored plaintext at rest.                                                                                                                                                                             |
| F-011 | P2/P3   | CONFIRMED                 | Multi-tenancy          | `users.service.ts:167-203` (+ pattern in ~12 modules)                                                                     | write-by-bare-id TOCTOU after tenant-scoped findFirst.                                                                                                                                                                |
| F-012 | P3      | CONFIRMED                 | Webhook                | `webhook-processor.ts:87-101`                                                                                             | Consumer loads registration/delivery by id without tenant re-check.                                                                                                                                                   |
| F-013 | P3      | CONFIRMED                 | Webhook                | `webhook-delivery.service.ts:21,122` vs schema `:3835`                                                                    | Retry budget ignores per-registration retryCount; global default wins.                                                                                                                                                |
| F-014 | P3      | CONFIRMED                 | Auth                   | `auth.service.ts:305-341`                                                                                                 | refreshTokens doesn't re-validate tenant/subscription state.                                                                                                                                                          |
| F-015 | P3      | CONFIRMED                 | Tenancy                | schema unique `User.email`; `auth.service.ts:63-70`                                                                       | Global email uniqueness = cross-tenant oracle + occupancy DoS.                                                                                                                                                        |
| F-016 | P3      | CONFIRMED (live)          | Observability          | `metrics.controller.ts:8,20`; main.ts                                                                                     | `/metrics` + `/docs` unauthenticated when token unset (verified 200/3126B). Prod-gated but default-open.                                                                                                              |
| F-017 | P3      | CONFIRMED                 | Recipes                | `recipes.controller.ts:114-119`; `recipes.service.ts:768-814`                                                             | Manual rollback endpoint repeatable; idempotency marker ineffective (ADJUSTMENT vs CONSUMPTION notes) → double-reversal.                                                                                              |
| F-018 | P3      | PARTIAL                   | Webhook                | `webhook-delivery.service.ts:208-212`                                                                                     | Legacy fallback to secretHash → sign-by-hash, unverifiable.                                                                                                                                                           |
| F-019 | P3      | PARTIAL                   | Webhook                | schema `3826-3855`; `webhook-event-emitter.ts:46-64`                                                                      | No [webhookId,eventId] uniqueness; no PENDING sweep → duplicate delivery risk.                                                                                                                                        |
| F-020 | P3      | CONFIRMED                 | Webhooks cleanup       | `cleanup.processor.ts:76-84` vs statuses written                                                                          | Cleanup arm filters `FAILED`; service never writes FAILED → dead retention.                                                                                                                                           |
| F-021 | P3      | CONFIRMED                 | Release                | — (this report)                                                                                                           | Dual-instance Redis sharing: stale (:3000) + current (:3100) workers on same queues/crons.                                                                                                                            |
| F-022 | P4      | CONFIRMED                 | Payments               | `payments.service.ts:267,329,1592`                                                                                        | Float money arithmetic into Decimal(10,2) bypassing money.util rounding.                                                                                                                                              |
| F-023 | P4      | CONFIRMED                 | Payments               | `payments.service.ts:505-513`                                                                                             | emitResult counts ordersCompleted per completed payment (multi-payment inflation).                                                                                                                                    |
| F-024 | P4      | CONFIRMED                 | Redis                  | `redis.service.ts:141-151`                                                                                                | user_sessions SADD members leak on natural session expiry.                                                                                                                                                            |
| F-025 | P4      | CONFIRMED                 | Redundant queue health | `queue.service.ts:66`, `bull-health.indicator.ts:13`                                                                      | Health checks phantom queues, misses live ones.                                                                                                                                                                       |
| F-026 | P4      | CONFIRMED                 | Scheduler              | `scheduler.service.ts:51,131-159`                                                                                         | getRegisteredJobs omits `cleanup_expired_tokens_2am`.                                                                                                                                                                 |
| F-027 | P4      | CONFIRMED                 | Test infra             | jest global-test-setup → `test:test@localhost:5432/test` (no such DB)                                                     | Integration specs are Prisma-mocked, not DB-backed (TEST_PRESENT_BUT_NON_PROVING).                                                                                                                                    |
| F-028 | P4      | CONFIRMED                 | Providers              | `payments.service.ts:379-388`                                                                                             | Provider intent created after tx commit → orphan-PENDING window (mitigated by reconcile cron).                                                                                                                        |

---

## 30. Risk Matrix

| Severity         | Count | High-priority IDs                                      |
| ---------------- | ----- | ------------------------------------------------------ |
| P0 (release-GOV) | 1     | F-003                                                  |
| P1               | 2     | F-001, F-002                                           |
| P2               | 8     | F-004, F-005, F-006, F-007, F-008, F-009, F-010, F-011 |
| P3               | 9     | F-012…F-021                                            |
| P4               | 7     | F-022…F-028                                            |

---

## 31. Recommended Remediation Order

- **PHASE 0 — Immediate release blockers (VCS):** commit the working tree (add the 20 untracked files, remove `scheduled-reports.processor.ts`, resolve diff), on an explicit release branch; **then** rebuild the Docker API image from source; stop the dual-instance staleness; ensure migrations subset unchanged (0 pending) before release.
- **PHASE 1 — Critical integrity/security:** F-001 (refund bumps `order.version`; re-read order FOR UPDATE inside changeStatus before the paidAmount gate); F-002 (owner decision, then implement ConsumptionRecord reversal per chosen model + idempotent rollback F-017); F-005 (webhook amount mismatch check mirroring reconcile). F-003 belongs here too (VCS).
- **PHASE 2 — Core business correctness:** F-004 (enqueue retry on non-2xx; wire `getPendingRetries` sweeper), F-013 (per-registration retry budget), F-007/F-008 (averageCost recompute; cancelPO policy), F-009 (wire or delete TenantBodyGuard), F-010 (encrypt/rotate 2FA secret), F-011 (updateMany({id,tenantId})).
- **PHASE 3 — Reliability:** F-006 (wire or retire phantom workers), F-012 (tenant re-check in webhook consumer), F-019 (webhook uniqueness), F-021 (single-instance policy for dev+prod), F-018.
- **PHASE 4 — Observability:** F-016 (metrics/docs auth policy), F-020 (cleanup predicate), F-024, F-025, F-026.
- **PHASE 5 — Tech debt:** F-022, F-023, F-027 (real DB-backed integration DB), F-028.
- **PHASE 6 — Nice-to-have:** Prisma 8 staging upgrade plan.

Each item's acceptance: green jest suite + a germane new test (refund/completion race; webhook non-2xx retry; consumption reversal; cancelGRN recalculation); `tsc`, `eslint`, `nx build`; no new migrations unless sanctioned; re-run `prisma migrate diff` = empty.

---

## 32. Final Decision

**Overall: CONDITIONAL GO (source milestone) — NO-GO for deployment until conditions are met.**

Rationale (evidence-based, not optimistic): the running **working tree** is verified operational end-to-end (build/tests/lint + live server on :3100 with healthy DB/Redis/queues/crons, correct token hashing, payment proof gate, single-writer consumption, tenant isolation with no confirmed IDOR, authenticated Redis, SSRF-guarded webhooks). No unresolved P0 runtime defect exists in the current source.

The verdict is CONDITIONAL because the following **must** be settled before a production GO; each is explicitly listed:

1. **F-001 (payment/order completion race)** — refund must participate in the order CAS and the paidAmount gate must be evaluated inside the transaction / against a current read. P1, impacts payment integrity.
2. **F-002 (ConsumptionRecord reversal)** — owner decision required (BLOCKED_BUSINESS_DECISION) then implementation, because cancelled/refunded orders today permanently inflate COGS/analytics.
3. **F-003 (release/VCS)** — nothing is committed; three source files untracked and one deleted; **a clean checkout cannot be built and loses export/scheduled-report features**. The release must be committed from the working tree.
4. **Deployment coherence** — the running `tablofy-api` container (:3000) is a **stale 2026-08-28 bundle** with none of the audited work. Deployment = rebuild image from committed source + recreate container; otherwise deployment remains NO-GO.
5. **F-004/F-005 webhook reliability + amount check** — non-2xx retry stall and webhook over-credit path (P2) should be fixed before live webhook traffic.
6. **External blockers** — SMTP must be configured for the scheduled-report→email pipeline (internal logic verified); Stripe/Paymob live certification is **BLOCKED_EXTERNAL** and cannot be claimed.

With conditions 1–4 satisfied (and 5–6 scheduled), the project is a **GO**; until then it is **CONDITIONAL GO**, and **production deployment is NOT approved.**

---

_Report produced read-only; no source, tests, schema, migrations, database data, or Redis contents were modified. `.env` files were created locally to run the dev server (gitignored). Full gates executed fresh this session._
