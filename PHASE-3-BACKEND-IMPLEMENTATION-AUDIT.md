# PHASE 3 BACKEND IMPLEMENTATION AUDIT

**Date:** 2026-08-11
**Repository:** `D:\New folder (8)\tablofy`, branch `feature/phase7-m5`
**Commit at audit start:** `5d6d0c3` (working tree clean — verified)
**Mode:** READ-ONLY. No source files, migrations, schema, env, or tests were modified.
**Method:** Direct inspection of the actual repository (Prisma schema, app wiring, controllers, services, DTOs, guards, queues, config, tests). Independent re-verification of all cross-cutting claims via grep. Prior reports (`PRE-PHASE-3-FINAL-HARDENING-REPORT.md`, `P1-05-P1-06-*`, `POST-P1-05-P1-06-*`) were used as orientation only; every classification below is grounded in current source.
**Baseline evidence:** `apps/` contains **only** the `api` app (no frontend exists anywhere in the repo). Global pipeline = JwtAuthGuard → RolesGuard → TenantGuard → PlanThrottleGuard (`app.module.ts:242-258`); interceptors AuditLog + PerformanceMonitor; HttpExceptionFilter; middlewares Correlation/I18n/HttpLogging/Prometheus/Tenant (`app.module.ts:275-285`). Prisma: 24/24 migrations applied, live schema ≡ schema.prisma (verified pre-session). Full regression reached 84 suites / **1057 tests** PASS (1057 = post-hardening; 1044 was the pre-hardening baseline).

---

## 1. Verified Baseline Reconciliation (reports vs source)

| Claimed in prior reports | Actual source state | Verdict |
|---|---|---|
| N1 `createGRN` averageCost `FOR UPDATE` | `purchasing.service.ts:948-953` lock before read/compute/write | **CONFIRMED** |
| P1-04 GRN over-receipt CAS + number retry | `purchasing.service.ts:927-941` remaining-qty `updateMany`; P2002 retry | **CONFIRMED** |
| P1-05 batch attribution + natural-key unique | `GoodsReceiptItem.inventoryBatchId` (schema), cancelGRN id-targeted gte-CAS reversal (`purchasing.service.ts:1337-1357`) | **CONFIRMED** |
| P1-06 inventory CAS/atomic + version CAS | `inventory.service.ts` updateItem version-CAS, adjustments/waste/cycle-count/transfers claimed+gte-guarded | **CONFIRMED** |
| P1-07 loyalty earnPoints atomic | `customers.service.ts:400-458` `$transaction` + unique(referenceType,referenceId) + P2002 | **CONFIRMED** (but unwired from orders — see §3) |
| P1-08/09 Redis auth | `buildRedisConnectionOptions` used by RedisService + QueueService; prod validation | **CONFIRMED** |
| P1-10 split payment (gateway outside tx + CAS finalize) | `payments.service.ts:942-1015` (gateway) + `:1028-1072` (CAS finalize) | **CONFIRMED** |
| P1-01 full-refund CAS | `payments.service.ts:565-580` `updateMany` + ConflictException | **CONFIRMED** |
| "21 queues observed running" | `QUEUE_NAMES` = 21 (`queue.service.ts:37-67`) | **CONFIRMED** |
| Health returns 200 fast | `/api/v1/health` 200, bullmq up with 21 queues | **CONFIRMED** (live, this-session pre-audit) |
| "Tenant isolation is complete" | Tenancy pattern is uniform, **but** isolated holes exist: `supplier-performance` connect without tenant check, `PURCHASING` nonexistent role string, decorative `restaurantId`/`tenantId` params in places, dead `TenantBodyGuard` | **PARTIALLY CONFIRMED — gaps below** |

**Conclusions from reconciliation:** the hardening/security claims of prior reports are accurate. What the prior reports did **not** surface (and this audit now documents) is the *operational-completeness* gap: many queues are stub/log-only, several features are schema-only or dead paths, payments cannot complete live card flows, and ~24 modules have zero tests.

---

## 2. Capability Map — Classification Key

Classifications used below (mission vocabulary):
- **COMPLETE** — real implementation, wired, tested (tests may still be thin).
- **PARTIAL** — real implementation but with material gaps.
- **MISSING** — no implementation at all (schema-only or absent).
- **STUB** — files exist, body is placeholder/log-only.
- **UNSAFE** — implemented but with a correctness/security/integrity defect.
- **BLOCKED_EXTERNAL** — implemented but requires external credentials to operate/verify.
- **DEFERRED** — exists but deliberately not in Phase 3 scope.
- **DEAD_UNWIRED** — code exists but is not wired into the running app (or has no producer/caller).

---

## 3. Functional Area A — Identity, Auth & Security (7 modules)

| Module | Status | Prisma | Routes | Isolation | TX/Concurrency | Tests | Key risks |
|---|---|---|---|---|---|---|---|
| auth | **COMPLETE w/ gaps** | User, RefreshToken, RevokedToken, VerificationToken, Tenant, Subscription | register, verify-email, login (2FA), refresh, logout, forgot/reset-password, 2fa setup, me | n/a (SkipTenantCheck) | register `$transaction`; refresh rotation + reuse-detection; Redis jti blacklist | 87 (5 files) | `@Throttle` inert (ThrottlerGuard **never registered** — grep: 0 hits) → register/forgot brute-force only 100/min/IP/URL; `emailVerified` **not enforced at login**; verify token in URL; refresh tokens stored **plaintext**; SMTP optional → emails undeliverable by default |
| users | COMPLETE w/ gaps | User | CRUD, softDelete, restore | tenantId-scoped | single-write; audit separate | 17 | no last-owner/self-demotion protection; email-uniqueness race (no global unique) |
| tenants | COMPLETE | Tenant, Subscription | CRUD, findBySlug | SUPER_ADMIN gated | `$transaction` slug+subscription | 12 | slug race (DB-unique backs it) |
| sessions | **PARTIAL** | Session (table **never written** — grep `session.create` = 0) | list, revoke, revoke-all | tenant-scoped (Redis) | n/a | 10 | sessions **Redis-only, non-durable**; DB model dead weight; pagination params unvalidated |
| invitations | **UNSAFE** | Invitation | create, verify, accept, revoke, revokeExpired | inviter role re-checked at accept | **accept() NOT transactional**; no status CAS | 12 | plaintext token in DB; double-accept race (P2002 unhandled); public accept only IP-throttled |
| api-keys | **DEAD_UNWIRED** | ApiKey (keyHash, scopes, expiresAt, rateLimitPerMin) | CRUD, rotate, validate | tenantId-scoped | hashed at rest | 10 | `ApiKeyGuard` wired nowhere (grep: only self/spec); issued keys unusable; Bearer branch passes any token; rateLimitPerMin never enforced |
| audit-logs | PARTIAL | AuditLog | list w/ filters | OWNER/MANAGER | write-only | 6 | skips tenantless entries; no PII-redaction policy; archival exists only via cleanup job |
| privacy | PARTIAL | ConsentRecord, CookiePreference, DataExportRequest | consent CRUD, cookie prefs, export request, anonymize | OWNER/MANAGER | find-then-create (non-atomic) | 5 (RBAC) | inline body types (no class-validator); `processDataExport` **never invoked** → exports stay PENDING forever |
| subscriptions | PARTIAL | Subscription | plans, current, changePlan, cancel, reactivate | OWNER + `settings:manage` | `$transaction` + in-tx audit | 13 | **no payment/entitlement gate** — free ENTERPRISE upgrade; `monthlyPrice` never updated on plan change |
| backup | **PARTIAL / BLOCKED_EXTERNAL** | BackupRecord | create, verify, restore, delete | OWNER/MANAGER | synchronous | 5 (RBAC) | plaintext PII on local disk (no encryption/object storage); restore covers only `menuCategories` |
| WS auth | COMPLETE | — | socket auth, tenant rooms | enforce tenant rooms | — | 36 | prod CORS not audited |
| guards (global) | COMPLETE | — | — | TenantGuard params cross-check; SUPER_ADMIN bypass | — | — | `TenantBodyGuard` DEAD_UNWIRED; `SkipPlanThrottle` noop (metadata never read) |

**A-area classification:** COMPLETE (auth/users/tenants/ws), PARTIAL (sessions/audit-logs/privacy/subscriptions/backup), **UNSAFE (invitations)**, **DEAD_UNWIRED (api-keys, TenantBodyGuard)**.

---

## 4. Functional Area B — F&B Operations / Menu / Orders / KDS

| Module | Status | Notes |
|---|---|---|
| restaurants, branches, floors, dining-areas, tables | COMPLETE (no tests) | Uniform OWNER/MANAGER-write + read roles; PlanLimitsService on branches/tables; Table `@@unique([branchId, number])`; QR via randomUUID; tenant-parent checks in every create |
| menu (categories, products, images, availability), variant-groups, product-variants, modifier-groups, modifiers, tags, allergens, nutrition | COMPLETE (no tests) | Uniform pattern; cache `menu:{restaurantId}:*`; product-availability conflict check lacks tenantId in predicate (low risk, productId is global UUID) |
| business-hours, business-exceptions, restaurant-settings, branch-settings, tax-rates, service-charges | COMPLETE (no tests) | tax/service-charge CRUD only; no computation tests |
| units | COMPLETE (no tests) | tenant-level prefix `/units`; `@@unique([tenantId,name,deletedAt])` |
| **orders** | **COMPLETE** | 1572-line service, 15 DTOs, state machine (DRAFT…REFUNDED), optimistic-lock version CAS on void/status, `@@unique([restaurantId, orderNumber])` retry, `splitOrder`/`mergeOrders` versioned `updateMany` + ConflictException, `recalculateOrder`, `addMoney/subMoney/sumMoney` Decimal helpers. **71 tests.** |
| kds | COMPLETE (thin tests) | 588-line service + `/kitchen` gateway; `KitchenTicketItem @@unique([orderItemId])`; queue `kitchen` stub processor. **11 tests** (P3). |
| kitchen/ (dir) | **DEAD_UNWIRED** | empty directory, not imported |

**Orders risk flagged (REQUIRES EVIDENCE):** `create()` computes subtotal from client-sent `unitPrice`×`quantity` (`orders.service.ts` create path); must confirm `recalculateOrder` re-derives prices from the catalog or at least that price trust boundaries are intentional. Snapshot fields exist on OrderItem. **Verify before Phase 3 ordering work.**

---

## 5. Functional Area C — Customers, CRM, Campaigns, Gift Cards, Loyalty

| Module | Status | Notes |
|---|---|---|
| customers | **COMPLETE (wiring gap)** | 709-line spec. Atomic `earnPoints` (P1-07), wallet CAS spend (`updateMany balance gte`), tier multiplier, analytics tenant-scoped. **BUT loyalty is NOT wired to orders/payments**: `earnPoints` called only from customers controller + referral completion (grep: no other module imports CustomersService); `PaymentMethod.WALLET` rejected at `payments.service.ts:241-245` with no spend flow caller. `FeatureFlagService` defaults `loyalty.program:false`/`campaign.management:false` but **no code checks the flags**. |
| crm | **PARTIAL** | timeline/templates/communications CRUD; **`processEvent` has zero callers** (event rules dead); enqueues `notification-jobs` → stub worker → communications never delivered |
| campaigns | **PARTIAL** | approval upsert exists but **does not guard status transitions / self-approve possible**; `executeCampaign` sets ACTIVE with no approval gate; all queue workers log-only stubs; **zero tests** |
| gift-cards | COMPLETE w/ gaps | redeem CAS `currentBalance gte`; recharge increment; ISSUE/REDEEM/RECHARGE rows. **Gap:** no unique on `referenceId` → replay protection absent (unlike loyalty/wallet); money via `@IsNumber()` float DTOs |
| customer-analytics | COMPLETE | 11 read endpoints; cache; parameterized SQL tested |
| crm-analytics | COMPLETE (no tests) | 8 endpoints |
| usage | COMPLETE | Redis counters on `order.created` only; SCAN-based reads tested |
| notifications/ (dir) | **MISSING / DEAD_UNWIRED** | 0 files; not in app.module. Real channel = log-only `notification` worker + `prisma.notification.createMany` from inventory processor |

**Loyalty/wallet/membership/rewards classification: PARTIAL.** Full schema (LoyaltyProgram/Tier/PointsTransaction/Membership/Reward/Wallet/WalletTransaction/Referral/Segment) + atomic earn/spend primitives exist, but end-to-end lifecycle is unwired. Wiring earn-to-order-completion is a **Phase 3 candidate requiring product confirmation of the business rule (no-guess rule)**.

---

## 6. Functional Area D — Inventory, Purchasing, Recipes, Transfers, Warehousing, Forecasting

| Module | Status | Notes |
|---|---|---|
| inventory | **COMPLETE** | 1356-line service; updateItem version-CAS + ConflictException; adjustments/waste atomic; low-stock/critical/out-of-stock SQL thresholds; 810-line spec covering P1-06 races. **Gap:** `InventoryCount` created but **never applies variance** (createCount = record only); `ConsumptionRecord` has **zero writers** (schema-only) |
| purchasing | **COMPLETE w/ defects** | N1/P1-04/05 confirmed. **Defects:** `@Roles('OWNER','MANAGER','PURCHASING','CASHIER')` uses **nonexistent role `PURCHASING`** (UserRole enum: SUPER_ADMIN/OWNER/MANAGER/STAFF/KITCHEN/CASHIER/WAITER/VIEWER — grep 6 usages) → string is dead; `updateGRN` PENDING-only gate is unreachable (createGRN writes COMPLETED). 1579-line spec |
| transfers | COMPLETE | status claims + gte-CAS; 520-line spec |
| recipes | **COMPLETE w/ defect** | deductInventoryForOrder idempotent (in-tx dedupe, deterministic jobId). **Defect:** `rollbackDeduction` NOT idempotent — dedupe filter checks `notes contains 'ROLLED_BACK'` but reversal writes `'Rolled back deduction…'` and never updates original notes → **double-rollback risk**; manual `POST deduct-order/:id` and `rollback-order/:id` endpoints exposed |
| ingredients, product-ingredients, units, suppliers | COMPLETE (thin tests) | supplier-performance create connects supplier **without tenant check** (`supplier-performance.service.ts:40-45`) — cross-tenant connect risk |
| supplier-performance | **UNSAFE** (tenant check) | create path; rest CRUD |
| warehouses | COMPLETE (no tests) | 17 routes; **no version CAS on updates** |
| barcodes | COMPLETE | 211-line service; 300s cache; 196-line spec |
| forecasting | **PARTIAL** | generateForecast/reorderSuggestions real, but `forecast-generation`/`auto-reorder` workers have **no producer** and `ConsumptionRecord` never written → forecast inputs empty |
| cycle-counts | COMPLETE w/ gaps | reconcile claim + variance CAS (P1-06); `cycle-count-reminders` worker stub, no producer; **no tests** |
| costing | **UNSAFE** | weighted-average **sums `unitCost` instead of `unitCost×quantity`** (`costing.service.ts:162-171`); `daily-valuation` worker stub |
| inventory-analytics | COMPLETE | 646-line service; parameterized SQL; 177-line spec |

---

## 7. Functional Area E — Payments & Financial

| Module | Status | Notes |
|---|---|---|
| payments | **COMPLETE w/ P0 bugs + BLOCKED_EXTERNAL for live** | Provider abstraction (Stripe/Paymob), per-tenant idempotency `@@unique([tenantId,idempotencyKey])`, P1-01 refund CAS, P1-10 split flow. **P0 bugs:** (1) `@Get('reconcile')` is shadowed by `@Get(':id')` (`payments.controller.ts:42` before `:104`) → reconcile report **always 404s**; (2) `clientSecret`/payment-key token **never returned** in `toResponseDto` (`payments.service.ts:1487-1508`) → **live card payments uncompletable through this API** (mock mode masks it). **Defects/limits:** hardcoded `currency:'usd'` for intents, `Payment` has no `currency` column; single shared gateway account + global webhook secret (webhook tenant resolved by gatewayRef, un-scoped); `metricsService.addRevenue` **omitted** on split path (`:923-928`); subscriptions have no billing linkage; `amountRefunded` cap is code-only (no version column on Payment). **54+ tests, all mocked** — live verification **BLOCKED_EXTERNAL** (no STRIPE/PAYMOB credentials present; `PAYMENTS_MODE` defaults `mock`). |
| payment webhooks | COMPLETE | Stripe HMAC-SHA256 + Paymob HMAC-SHA512, `timingSafeEqual`, `@Public()`+`SkipTenantCheck`; PENDING→COMPLETED CAS; refund delta logic handles cumulative vs additive correctly; **no timestamp skew tolerance**; webhook routes subject to PlanThrottleGuard (IP bucket). Tests use `sk_live_123` mock values (not live). |
| financial-analytics | COMPLETE (no tests) | revenue/COGS/profitability from Order aggregates; **does not reconcile refunds/Payments**; `period` query unvalidated |
| wallet / gift-card money | PARTIAL (float risk) | DTOs `@IsNumber()`; `roundMoney` 2dp HALF_UP mitigates; **not pure Decimal end-to-end** (mission financial-safety rule) |

**Financial integrity verdict:** core CAS/idempotency invariants are proven and tested; but two P0 payment defects must be closed before Phase 3 financial work, and live-gateway certification is impossible without credentials (BLOCKED_EXTERNAL, not a code failure).

---

## 8. Functional Area F — Analytics, Reports, Export, Scheduling, Queues, Integrations

| Area | Status | Notes |
|---|---|---|
| **Queues (infra)** | COMPLETE | `QUEUE_NAMES` = 21 (`queue.service.ts:37-67`); 36 workers registered; DLQ auto-enqueue on exhausted attempts; per-queue options; `/queues/:name/stats`. **Gap:** 15 worker queues sit outside `QUEUE_NAMES` → **invisible to `/health`** (`bull-health.indicator.ts:13` iterates QUEUE_NAMES only) |
| Queue workers (real) | — | email (nodemailer, fails→retry→DLQ if SMTP unset), cleanup (8 types), dead-letter, webhook-delivery + webhook-retry (full crypto/retry/DLQ), inventory quartet (inventory-sync/low-stock-alerts/expiration-checks/waste-reports — real, writes notifications/reports), export-engine, forecast-generation + auto-reorder (real, no producer), scheduled-reports (real handler, **no producer → dead**), inventory-deduction + rollback (real) |
| Queue workers (**STUB / log-only**) | STUB | notification, kitchen, print, purchase-notifications, purchase-analytics, warehouse-analytics, transfer-notifications, supplier-performance-calculation, daily-valuation, crm-jobs, scheduled-notifications, daily-reports, campaign-execution, segment-recalculation, analytics-generation, membership-recalculation, reward-processing, point-expiration, membership-upgrade, marketing-jobs, **notification-jobs (has real producers!)** — **22 of 36 have no producer** |
| scheduler | COMPLETE | 9 `@Cron` all → `cleanup` jobs, all under Redis `runIfLocked`. **Gap:** `getRegisteredJobs()` omits `cleanup_expired_tokens_2am`; **no cron drives** scheduled-reports/forecasting/low-stock/expiration/analytics |
| webhooks (outbound) | **COMPLETE** (most complete subsystem) | SSRF-pre-checked HTTPS-only; AES-256-GCM secret storage; HMAC signatures + header-poisoning guards; exponential backoff; per-registration DEAD_LETTER; 76 canonical events + aliases; rotate-secret |
| export-engine | COMPLETE | CSV/EXCEL/PDF, queued, tenant-scoped paths, no path traversal (no file streaming in API) |
| scheduled-reports | **PARTIAL (dead core)** | CRUD + manual `trigger` works (enqueues export-engine); **auto-scheduling is dead** — `processScheduledReport` has no producer, `schedule` string never parsed, no cron |
| analytics (all 9 dashboards) | COMPLETE w/ perf risk | synchronous inline queries + Redis cache (JSON.stringify(query) keys); **no precompute pipeline**; live-analytics `triggerKpiUpdate` **has no callers** (realtime push unwired) |
| integrations | **MISSING (empty registry)** | `IntegrationsService` in-memory registry; **no provider registered**; also `modules/settings` (0 files), `modules/reports` (0 files), `modules/notifications` (0 files) |
| health/metrics | COMPLETE w/ gaps | 3 health routes public; BullHealth iterates 21 QUEUE_NAMES only; `/metrics` public w/ **optional** bearer gate (prod env validation requires token); Bull Board SUPER_ADMIN + JWT + blacklist locked |

---

## 9. Cross-Cutting Verification Results (mission A–N)

**A. Implemented (genuine):** auth/RBAC/tenancy, menu/orders/KDS, customers/CRM CRUD, inventory/purchasing/transfers/recipes, payments (mock), analytics, export, outbound webhooks, cleanup/scheduler, Redis-locked ops, outbound email worker.
**B. Partially implemented:** loyalty/wallet lifecycle, sessions durability, subscriptions billing, scheduled-reports automation, live-analytics push, forecasting pipeline (no consumption data), warehouse CAS.
**C. Stubbed:** 21 log-only queue workers (see §8), notification delivery, print, kitchen queue, integration providers (empty registry).
**D. Dead/unwired:** `ApiKeyGuard`, `TenantBodyGuard`, `SkipPlanThrottle`, `Session` table writes, `processDataExport` (privacy), `triggerKpiUpdate` (live-analytics), `processEvent` (crm), `ConsumptionRecord` writers, `scheduled-reports` producer, empty dirs `notifications/ settings/ reports/ kitchen/`, dead `JWT_REFRESH_SECRET` config, `PURCHASING` role string.
**E. Unsafe (needs Phase 3 P0):** invitations accept race/plaintext token; costing weighted-average bug; supplier-performance tenant check; recipes rollback idempotency; payments reconcile 404 + missing clientSecret; orders client-price trust (verify); promotions `usedCount` non-atomic.
**F. Lacks tests:** 24+ modules zero tests (restaurants→units, forecasting, cycle-counts, costing, warehouses, campaigns, crm-analytics, financial-analytics, live-analytics, dashboard, export-engine part, scheduled-reports, integrations…).
**G. Tenant-isolation gaps:** supplier-performance connect (no tenant check); decorative `tenantId`/`restaurantId` path params on several controllers (guarded only by JWT tenantId, not the param — no leak, but param unvalidated); product-availability conflict predicate missing tenantId; webhook tenant resolution by gatewayRef un-scoped (safe by UUID uniqueness).
**H. Authorization gaps:** `@Roles('PURCHASING')` dead string; `@Throttle` inert; `emailVerified` not enforced; last-owner protection missing; campaign self-approval; `SkipPlanThrottle` noop.
**I. Concurrency risks:** promotions `usedCount`; campaigns status transitions; gift-card replay (no unique referenceId); privacy cookie-preference upsert; double-rollback in recipes; sessions TTL races (Redis-only).
**J. Transactional-integrity risks:** invitations accept; audit logs outside transaction (accepted pattern); subscriptions changePlan without billing; backup restore partial.
**K. Queue/processor risks:** stub workers that return `{processed:true}` without side effects (false delivery signals); `notification-jobs` produced by CRM but stub-consumed; 22 queues orphaned; health blind to 15 queues.
**L. External-provider dependencies:** Stripe/Paymob (BLOCKED_EXTERNAL — no creds, mock mode), SMTP/nodemailer (BLOCKED_EXTERNAL unless SMTP_HOST set), notification push/FCM (MISSING), no SMS/WhatsApp provider code at all (campaign delivery is log-only).
**M. Appropriate for Phase 3:** the P0/P1 backlog in §11 (no new external providers, no new permission names, no invented contracts).
**N. NOT for Phase 3 yet:** new payment providers, multi-currency expansion, frontend work (no frontend exists), SSO/OAuth, new analytics metrics, in-app chat, order auto-fulfillment AI — all would invent contracts/capabilities.

---

## 10. Test Coverage Matrix (84 suites / 1057 tests, from full regression)

| Coverage tier | Modules |
|---|---|
| Strong (concurrency/idempotency proven) | purchasing (N1, P1-04/05), inventory (P1-06), transfers, recipes deduction (F1), payments service/state-machine/providers, auth, customers (loyalty/wallet), ws-auth |
| Adequate | invitations, users, sessions, subscriptions, gift-cards, tenants, audit-logs, queue.service, scheduler, webhooks, export-engine, supplier-analytics, inventory-analytics, customer-analytics, barcodes, usage |
| **Zero tests** | restaurants, branches, floors, dining-areas, tables, menu stack, variant-groups, product-variants, modifier-groups, modifiers, tags, allergens, nutrition, business-hours, business-exceptions, restaurant/branch-settings, tax-rates, service-charges, units, **forecasting, cycle-counts, costing, warehouses**, **campaigns**, **crm-analytics**, **financial-analytics**, live-analytics, dashboard, executive-dashboard, kitchen-analytics, forecasting-dashboard, scheduled-reports, integrations |
| Integration specs are mocked | `payment-flow.integration.spec.ts` uses mocked Prisma — **not** a live-DB integration (misleading name; no real provider certification) |

---

## 11. Ranked Phase 3 Implementation Backlog

### P0 — Production correctness / security / data integrity (must close first)
1. **Payments: reconcile route 404** — declare `reconcile` before `:id` (or use path strategy); add e2e route test.
2. **Payments: uncompletable live card flow** — surface `clientSecret`/payment-key in response DTO or implement server-side confirm; add tests for non-mock modes (without credentials: test the contract, mark live **BLOCKED_EXTERNAL**).
3. **Rate limiting actually enforced** — register `ThrottlerGuard` globally (or per-route) so register/forgot-password/accept/invite brute-force protection is real; keep PlanThrottleGuard.
4. **Invitations accept() hardening** — wrap accept in `$transaction`, add atomic status CAS (`updateMany where status=PENDING`), handle P2002 on duplicate email as Conflict; hash tokens at rest (align with verification-token pattern).
5. **API-key decision** — wire `ApiKeyGuard` to intended endpoints (fix Bearer pass-through) **or** disable key issuance; enforce per-key `rateLimitPerMin`.
6. **Costing weighted-average bug** — multiply `unitCost×quantity` before summing (`costing.service.ts:162-171`).
7. **Supplier-performance tenant check** — scope supplier connect by tenantId.
8. **Recipes rollback idempotency** — make `rollbackDeduction` idempotent (dedupe by movement + marked status, not brittle note string); remove/guard manual rollback endpoints.
9. **`@Roles('PURCHASING')`** — remove nonexistent role from `purchasing.controller.ts` (6 usages) or add the role deliberately (do not invent — decide with product).
10. **Orders client-price trust** — confirm `recalculateOrder` re-derives from catalog or enforce server-side pricing; add tests (currently REQUIRES EVIDENCE).

### P1 — Operational completeness
11. **Sessions durability** — write `Session` rows (or define the intended durability) + TTL fallback when Redis unavailable.
12. **Notification delivery** — replace log-only `notification`/`notification-jobs` workers with real channel (email exists; push/SMS = MISSING → keep as documented BLOCKED_EXTERNAL/MISSING rather than fake delivery).
13. **Scheduled-reports driver** — add producer + cron that parses `schedule` and enqueues `scheduled-reports`.
14. **Privacy data export** — invoke `processDataExport` via `export-engine` queue; add DTOs + validation.
15. **Subscriptions entitlement** — tie `changePlan` to a payment/entitlement gate; sync `monthlyPrice`.
16. **Health coverage** — include the 15 extra worker queues in BullHealth (or normalize all workers into `QUEUE_NAMES`).
17. **Live-analytics push** — wire `triggerKpiUpdate` to order/payment events.
18. **Email verification enforcement** — enforce `emailVerified` at login (or define the intended gate).
19. **Backup hardening** — encrypt-at-rest or object storage; complete the restore contract.
20. **Forecasting inputs** — write `ConsumptionRecord` from deductions/orders so forecast has data (needs business-rule confirmation).

### P2 — Safe-to-defer important items
21. Promotions `usedCount` CAS; 22. campaign approval status transitions; 23. gift-card `referenceId` uniqueness; 24. warehouse version CAS; 25. last-owner/self-demotion guard; 26. audit-log PII policy + tenantless policy; 27. loyalty earn wiring (business-rule confirm); 28. analytics precompute pipeline; 29. product-availability tenant predicate; 30. getRegisteredJobs fix; 31. `monthlyPrice`/currency on Payment model.

### P3 — Polish / tests / housekeeping
32. Tests for the 24 zero-test modules (at minimum: forecasting, cycle-counts, costing, warehouses, campaigns, financial-analytics, crm-analytics, live-analytics, scheduled-reports); 33. KDS test depth; 34. remove empty dirs (`notifications/ settings/ reports/ kitchen/`) + dead config (`JWT_REFRESH_SECRET`); 35. Stripe signature timestamp tolerance; 36. exclude gateway webhooks from PlanThrottle; 37. prod CORS audit; 38. `SkipPlanThrottle` either implemented or removed.

---

## 12. Recommendations & Guardrails for Phase 3 Work Packages

1. Work packages must be **bounded and sequential** — one at a time, with tests + full regression + report + STOP (per mission).
2. Do **not** invent: permission names, roles, payment methods, statuses, plans, notification types, analytics metrics, queue names, or external-provider semantics. Anything uncertain → REQUIRES EVIDENCE.
3. Financial work: no float for money (move wallet/gift-card/order pricing to Decimal end-to-end), preserve CAS, keep provider calls outside rollbackable transactions.
4. Tenancy: every new mutation must tenant-scope referenced entities before mutation (close the supplier-performance pattern everywhere).
5. External credentials absent → classify BLOCKED_EXTERNAL, never fake "live verified".
6. Database changes only via additive migrations + real-data checks (24/24 baseline must stay green; `migrate diff` must stay "No difference detected").
7. Do not bypass Redis auth; do not weaken production config to pass tests.

---

## 13. Verdict

- The backend is **architecturally sound and hardened** where security/concurrency/financial invariants were previously audited; prior report claims are **reconciled against source and confirmed**.
- The dominant Phase 3 gap is **operational completeness**: two P0 payment defects, inert rate limiting, unsafe invitation accept, dead API-key auth, a nonexistent role string, three math/tenancy/idempotency defects, 22 orphaned or stub queues, and zero tests across ~24 modules.
- **P0 backlog must be closed before P1; P2/P3 must not start while P0/P1 remain.**

**Next step:** awaiting audit decision on the Phase 3 scope and first work package. No source code was modified, no migrations were created, and no Phase 3 features were started.
