# POST-P0-E — INDEPENDENT DECISION AUDIT

**Date:** 2026-08-12
**Repository:** `D:\New folder (8)\tablofy`, branch `feature/phase7-m5`, HEAD `5d6d0c392f5536f87d880a8cbf7336aaed407579`
**Auditor role:** Independent. All evidence re-derived from current source, live database, deployed container, and freshly re-run gates. No source, test, schema, migration, or `.env` file was modified during this audit. No P0-F work was started.
**Subject:** Independent verification that P0-E (invitation acceptance security remediation) is genuinely closed, re-classification of the remaining P0 backlog and P1 hardening against current code, and the decision gate before P0-F.

---

## 1. Executive Summary

- **P0-E is genuinely closed.** The current source, the live database, the deployed bundle, and freshly re-run gates all agree: `accept()` performs a hashed-token lookup scoped to `PENDING`, claims the invitation with a CAS `updateMany` inside an interactive transaction, rolls back the claim when the user creation fails, and the deployment is byte-identical to the locally built artifact.
- **One report discrepancy found:** the P0-E report claimed `prisma migrate status` = "24/24 up to date". That claim is **not reproducible** against the live database: `tablofy_prod` has **no `_prisma_migrations` table**, so `migrate status` reports all 24 migrations "not yet applied". The schema itself is provably in sync with the migration chain (`prisma migrate diff` against a shadow DB → "No difference detected"), so there is no schema drift — but the migration bookkeeping is missing. This is an environment/operations finding, not a P0-E correctness failure.
- **Old P0 backlog is NOT fully closed.** Independent re-audit: P0-C (throttling), P0-D (API-key auth), P0-E (invitations), P0-G (supplier-performance isolation), P0-B (clientSecret logging) are closed. **P0-A (reconciliation) PARTIAL, P0-F (costing weighted-average) OPEN, P0-H (recipe update atomicity) OPEN, P0-I (PURCHASING role references) OPEN, P0-J (client-price trust) OPEN.**
- **New finding (P0-I deepened):** the `PURCHASING` role is referenced by string in `purchasing.controller.ts` but does **not exist** in the `UserRole` enum (`schema.prisma` lines 14-23), the RBAC policy (`role-policy.ts`), or `TENANT_ASSIGNABLE_ROLES`. No user can ever hold that role; the guards effectively reduce to OWNER/MANAGER. Dead/broken role references.
- **Verdict: CONDITIONAL GO** (see §26). P0-F may proceed once the conditions in §26 are met.

## 2. Scope & Baseline (independently re-derived)

- Branch `feature/phase7-m5`; HEAD `5d6d0c392f5536f87d880a8cbf7336aaed407579`; working tree **dirty** (13 modified files + untracked reports/specs). Same set as the P0-E session; no new modifications introduced by this audit.
- Containers (docker): `tablofy-api` (Up ~9h, **healthy**, 0.0.0.0:3000), `tablofy-postgres` (Up ~9h, healthy), `tablofy-redis` (Up ~9h, healthy). Image `docker-api:latest` = `c0611a2cfab8`.
- Deployment identity: container `/app/app/main.js` md5 **882f250e063111137ab35e4a7c880a78** (2,580,995 bytes) == fresh local `dist/apps/api/main.js` md5 **882f250e063111137ab35e4a7c880a78** → deployment synchronized at audit time (re-verified after a fresh `nx build api`).

## 3. Mission Constraints Applied

- Read-only: no source changes, no DB data changes, no migrations, no `.env`/credential edits, no P0-F or other remediation. All checks were reads/probes; the only writes were throwaway artifacts (a temporary shadow database, created and dropped) and this report.
- Evidence hierarchy enforced: actual source + live DB + deployed runtime + fresh test runs **override** the claims in prior reports.

## 4. Git State & Working Tree

- `git status` (re-derived): 13 modified files (app.module, logger.service, api-key.guard, auth.controller + spec, invitations.service + spec, payment-response.dto, payments.controller/service/spec, users.service + spec) + untracked (4 prior P0 reports, PHASE-3 audit, POST-P0-WORK-PACKAGE-1 audit, new spec files, P0-E report, this report).
- `.env` and `docker/.env` are **gitignored and untracked** (`.gitignore:12`); `.env.example` contains only commented-out/placeholder values. No credentials are committed.

## 5. P0-E Source Re-Audit (independent, from current source)

| Claim                           | Source evidence (verified)                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token hashed before lookup      | `findByToken()` (invitations.service.ts:127-147): `createHash('sha256').update(token).digest('hex')`, WHERE `{ token: hashedToken, status: PENDING }`, expiry → status `EXPIRED` then NotFound. SHA-256 precedent in auth.service.ts lines 451/484/591/657.                          |
| Accept is atomic                | `accept()` (invitations.service.ts:149-210): `prisma.$transaction(async (tx) => …)` containing `tx.invitation.updateMany({ where: { id, status: PENDING }, data: { status: ACCEPTED, acceptedAt } })`; `claim.count !== 1` → `ConflictException('Invitation is no longer pending')`. |
| Inviter/role check              | Inviter fetched with `where: { id: invitedBy, tenantId, deletedAt: null }`; `canAssignRole` enforced before user creation.                                                                                                                                                           |
| Rollback on user-create failure | `usersService.create(…, tx)` inside the same transaction → any failure rolls back the ACCEPTED claim.                                                                                                                                                                                |
| Schema constraints              | Invitation model (schema.prisma:350-373): `token String @unique`, `@@unique([tenantId, email])`, `@@index([token])`, `@@map("invitations")`; InvitationStatus enum PENDING/ACCEPTED/REJECTED/EXPIRED (57-62); User `@@unique([tenantId, email])` (line 234).                         |

## 6. P0-E Invariants, Concurrency & Security

- **Race safety:** the CAS `updateMany` (status filter) means exactly one of N concurrent accepts can claim the invitation; tests prove this (see §7). DB-level backstop for duplicate email is `users_tenantId_email_key`.
- **Secrets:** no raw token is ever stored; only its SHA-256 is persisted and indexed. `AuditLogEntry` (audit-logs.service.ts) contains **no token fields**; audit writes are best-effort (never throw). Redis temp tokens use the `temp:` prefix → runtime key `temp:invitation:<sha256>`.
- **Observations (non-defects):** `temp:` prefix is present in redis.service.ts (157-175); the spec asserts the un-prefixed key because the mock ignores the prefix. Redirection of `temp:` keys is handled by the Redis service itself.

## 7. Test Evidence (freshly re-run)

- Focused P0-E suite (invitations.service.spec.ts, 428 lines): hash-before-lookup, expiry, expired-token rejection, duplicate-email Conflict propagation with **no post-transaction side effects** (claim not accepted / no audit / no redis delete), and a **barrier-synchronized double-accept** proving exactly one succeeds and one gets `ConflictException` (lines 312-339).
- Full regression (fresh run, no cache): **87 suites / 1126 tests PASS**, 0 failures, ~11s.
- The 1126 total exceeds the pre-P0-E baseline of 1115 by the P0-E-focused additions (11).

## 8. Regression Gates (freshly re-run, cache skipped)

| Gate                                                        | Result                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npx jest --config jest.config.ts --no-coverage`            | **87 suites / 1126 tests PASS**                                                 |
| `npx tsc -p tsconfig.app.json --noEmit`                     | **exit 0**                                                                      |
| `npx nx lint api`                                           | **exit 0**                                                                      |
| `npx nx build api`                                          | **exit 0** (production webpack)                                                 |
| `prisma validate`                                           | **schema valid**                                                                |
| `prisma migrate status`                                     | **exit 1 — all 24 "not yet applied"** (see §23 — no `_prisma_migrations` table) |
| `prisma migrate diff` (from migrations → schema, shadow DB) | **"No difference detected", exit 0**                                            |

## 9. Database Verification (live DB, read-only)

- Direct introspection via `PrismaClient` (explicit `datasources.url` override; see §25 for the env quirk):
  - `TOTAL_INVITATIONS = 0`, `BY_STATUS = []`, `ROWS_WITH_SHORT_TOKEN = 0`.
  - `invitations` columns: id, tenantId, email, role (enum), token (text), status (enum), invitedBy, expiresAt, acceptedAt, createdAt, updatedAt, deletedAt — all present.
  - Indexes: `invitations_pkey`, `invitations_status_idx`, `invitations_tenantId_createdAt_idx`, `invitations_tenantId_email_key` (UNIQUE), `invitations_tenantId_idx`, `invitations_token_idx`, `invitations_token_key` (UNIQUE).
  - `users_tenantId_email_key` **UNIQUE** index confirmed (duplicate-email backstop).
- No post-probe state change: the probe performed only `SELECT`/counts. Shadow DB for the diff was created and **dropped** afterwards.

## 10. Deployment & Bundle Identity

- Fresh `nx build api` then compare:
  - Local `dist/apps/api/main.js` md5 `882f250e063111137ab35e4a7c880a78`, 2,580,995 bytes.
  - Container `/app/app/main.js` md5 `882f250e063111137ab35e4a7c880a78` → **identical**. The deployed bundle is the audited source.
- Container `NODE_ENV=production`, image `c0611a2cfab8`, container healthy.

## 11. Runtime Verification (live probes, safe/read-only)

| Probe                                                       | Result                                  |
| ----------------------------------------------------------- | --------------------------------------- |
| `GET /api/v1/health`                                        | **200**                                 |
| `GET /health/live`                                          | **200**                                 |
| `GET /health/ready`                                         | **200**                                 |
| `GET /docs`                                                 | **200**                                 |
| `POST /api/v1/invitations/accept` (synthetic garbage token) | **404** "Invalid or expired invitation" |
| `GET /api/v1/invitations/token/<garbage>`                   | **404**                                 |
| `GET /api/v1/invitations` (no auth)                         | **401** (route is auth-gated)           |

Classification: the accept-path probes are safe-input probes (expected-reject behavior), classified **LIVE VERIFIED for the reject path**; the success path is **UNIT VERIFIED + STRUCTURALLY VERIFIED** (CAS + DB constraints), not live-verified with a real invitation because that would mutate data (prohibited).

## 12. Secrets & Credentials Audit

- **No committed secrets:** `.env` and `docker/.env` are gitignored/untracked; `.env.example` holds only placeholders. Source-tree grep for private-key / live-stripe / GitHub-token patterns → 0 hits outside tests and pattern strings.
- **Logger redaction:** `sensitiveKeys` (logger.service.ts:152-172) covers password, token, authorization, secret, apiKey, clientSecret, paymentKey, hmac, signature, jwt, bearer, etc.; `sanitize()` is recursive (depth 10), exact-key, → `[REDACTED]`.
- **Config guards:** `payments.config.ts:51-62` forbids `sk_test_*` in `PAYMENTS_MODE=live` and requires live gateway credentials; test keys only valid in `mode=test`.
- **Deployed bundle scan:** 0 private keys, 0 live/test Stripe keys (the single `sk_test_` hit is the error-message pattern string), redaction code present.
- Docker `.env` (untracked) holds the real deployment secrets (JWT 39 chars, Stripe live 44 chars, Redis password 64 chars) — verified present but **not** printed here and **not** committed.

## 13. P0 Backlog Re-classification (against current code)

| #    | Item                           | Status      | Evidence                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-A | Payments reconciliation        | **PARTIAL** | `reconcile()` (payments.service.ts:1167-1220): tenant-scoped, compares local vs provider status, returns counts; **report-only, no auto-correction**. Route binding verified (controller spec).                                                                                         |
| P0-B | clientSecret exposure          | **CLOSED**  | `toResponseDto` returns `clientSecret` only for `PENDING`; logger redacts it; no other module serializes `gatewayData`.                                                                                                                                                                 |
| P0-C | Auth throttling                | **CLOSED**  | `ThrottlerModule.forRootAsync` + global `ThrottlerGuard` + `PlanThrottleGuard` (app.module.ts:143, 244-261); auth.controller `@Throttle` limits (register 20, login 30, refresh 60, forgot/reset 3, verify-email 5, change 3).                                                          |
| P0-D | API-key auth                   | **CLOSED**  | `ApiKeyGuard` (guards/api-key.guard.ts) requires `apikey` scheme, validates + scopes + tenant binding; api-keys.config provides rate/prefix/length settings.                                                                                                                            |
| P0-E | Invitation acceptance          | **CLOSED**  | §5-6 of this report.                                                                                                                                                                                                                                                                    |
| P0-F | Costing weighted-average       | **OPEN**    | `calculateWeightedAverageCost` (costing.service.ts:150-175) returns stored `averageCost` when > 0; batch-weighted fallback only when 0. Correctness of the maintained `averageCost` is not independently verified; no row-lock integration tests. **Not started (mission constraint).** |
| P0-G | Supplier-performance isolation | **CLOSED**  | `getSupplierPerformanceSummary` (dashboard.service.ts:130-140) scopes by `tenantId`.                                                                                                                                                                                                    |
| P0-H | Recipe rollback / idempotency  | **OPEN**    | `updateRecipe` (recipes.service.ts:225-252): `update` (version++), then `deleteMany` + `createMany` of recipeItems **without a surrounding transaction** — partial state possible if createMany fails; not concurrency-safe.                                                            |
| P0-I | PURCHASING role references     | **OPEN**    | String `PURCHASING` in purchasing.controller.ts:40,68,87,105,112,141; **absent from `UserRole` enum** (schema 14-23), `role-policy.ts`, and `TENANT_ASSIGNABLE_ROLES`. No user can hold it; guards reduce to OWNER/MANAGER.                                                             |
| P0-J | Order client-price trust       | **OPEN**    | Order create uses client-supplied `unitPrice` for totals + `priceSnapshot` (orders.service.ts:87,122,137,141); no server-side recompute from catalog.                                                                                                                                   |

## 14. P1 Hardening Re-check (12 areas, structural)

| Area                             | Status      | Evidence                                                                                                                                             |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full-refund CAS                  | VERIFIED    | `$transaction` + `updateMany` status-guarded claims (payments.service.ts:125, 564-565, 664-665).                                                     |
| Split/merge order CAS            | VERIFIED    | `verResult = tx.order.updateMany` + transaction (293-294, 466, 553, 606, 742-894).                                                                   |
| KDS ticket idempotency           | VERIFIED    | order/orderItem/orderItemModifier `updateMany` guarded updates (373-385); ticket creation keyed to unique order-item constraint (migration present). |
| GRN receive-cap / attribution    | VERIFIED    | goods-receipts code + `add_grn_batch_attribution` migration present (24th migration).                                                                |
| GRN cancellation attribution     | VERIFIED    | CAS-style guarded updates in purchasing flow.                                                                                                        |
| Inventory mutation CAS           | VERIFIED    | `updateMany` guarded moves (inventory.service.ts:436 area) + optimistic checks.                                                                      |
| Loyalty atomic earnPoints        | VERIFIED    | transaction-wrapped point accrual with balance guards.                                                                                               |
| Redis auth                       | VERIFIED    | container `requirepass` + NOAUTH behavior (prior live check) + `REDIS_PASSWORD` (64 chars) in docker `.env`.                                         |
| Split-payment three-phase        | VERIFIED    | `splitPayment` (payments.service.ts:779+) uses `$transaction` (805) with per-split CAS claims.                                                       |
| averageCost row locking          | **PARTIAL** | CAS via guarded `updateMany`; no explicit `SELECT … FOR UPDATE` integration test on the cost row.                                                    |
| Logger payment-secret redaction  | VERIFIED    | §12.                                                                                                                                                 |
| Auth throttling / invitation CAS | VERIFIED    | §13 P0-C/P0-E.                                                                                                                                       |

## 15. Test Quality Audit

- **Real race semantics tested (mock-level):** invitation atomic claim via barrier-synchronized double-accept (invitations.service.spec.ts:312-339); webhook idempotency — firing the same payload twice calls `$transaction` exactly once (payments.service.spec.ts:1521-1524); rollback — tx failure rethrows and records no metrics (:1527+).
- **Also present:** concurrency tests in customers (233), gift-cards (104), inventory (294); rollback tests in purchasing (1529).
- **Gap:** all of the above are **mock-based unit tests** — they verify the code-path CAS semantics (count check → throw), not real PostgreSQL row-level isolation. There are no integration tests against the live/Postgres engine for the race paths. Classification: UNIT VERIFIED for race logic; DB-level isolation is STRUCTURALLY VERIFIED only.

## 16. Money Safety

- Payments: idempotency keys (`idempotencyKey` in create-payment.dto:37), CAS claims on `PENDING→COMPLETED` transitions, gateway webhook signature verification (payments.service.ts:1250), provider `verifyWebhookSignature` (interface:59; paymob:403).
- Orders: amounts use `mulMoney`/`roundMoney` consistently; service charges and taxes resolved server-side by id (1108, 1160).
- Open exposure (P0-J): client-supplied `unitPrice` drives order totals — a money-safety concern that remains OPEN.

## 17. Concurrency & Race Safety

- Invitation claim: **CAS `updateMany` + transaction** → single-winner semantics, tested. DB backstop unique `(tenantId, email)`.
- Payments: guarded `updateMany` transitions + idempotency keys + webhook idempotent handling (double-fire test).
- Orders: guarded `updateMany` on version/status in split/merge/move paths.
- **Open:** recipe update is not transaction-wrapped (P0-H).

## 18. Tenant Isolation

- Spot-audited scoping: dashboard summaries and supplier-performance (dashboard.service.ts), reconciliation (payments.service.ts:1174 `where: { tenantId … }`), valuation/costing (costing.service.ts:23 `tenantId`), invitations (findByToken/inviter both tenant-scoped). Consistent `where: { tenantId }` patterns.
- **Open (minor, OWNER-only):** `GET payments/providers/:tenantId/status` takes an arbitrary `tenantId` path param (previously unreachable shadowed route; now reachable) — returns only `{ status, latencyMs }`. OWNER-gated.

## 19. RBAC

- `role-policy.ts`: `canAssignRole`/`canManageUser` enforced in `users.service.ts:50-52`. OWNER assigns OWNER/MANAGER/STAFF/KITCHEN/CASHIER/WAITER/VIEWER; MANAGER assigns staff-tier; staff-tier assign nothing.
- **Open (P0-I):** `PURCHASING` referenced in purchasing.controller.ts but absent from enum/policy → cannot be assigned, cannot be managed, no policy entry. Dead role reference.

## 20. Redis

- Container `requirepass` configured; `temp:` key prefix for temporary tokens; `REDIS_PASSWORD` (64 chars) in untracked docker `.env`. `PING` unauthenticated → NOAUTH (prior live check). Plan throttle uses Redis-backed counting (plan-throttle.guard.ts).

## 21. KDS

- Kitchen tickets keyed to unique order-item (`20260811000000_add_kitchen_ticket_item_unique_order_item` migration); guarded updates prevent duplicate tickets.

## 22. Payments

- Route binding, state machine (`payment-state-machine.ts`), CAS transitions, webhook signature verification, idempotency, reconciliation (read-only), clientSecret only-in-PENDING. All gates green.

## 23. Database / Migration Health

- **Finding:** live `tablofy_prod` has 126 user tables but **no `_prisma_migrations` table** (checked via `pg_class` across all schemas; only schema `public` exists). `prisma migrate status` → all 24 migrations "not yet applied".
- **Not schema drift:** `prisma migrate diff` (migrations → schema, shadow DB) → **"No difference detected"**. The schema is exactly what the migration chain produces; only the bookkeeping table is absent.
- **Risk:** a future `prisma migrate deploy` would attempt to re-apply all 24 migrations against existing objects and would fail on `CREATE` conflicts — operational care required (e.g., baseline the bookkeeping table or regenerate it without touching schema).
- The P0-E report's "24/24 up to date" statement is **not reproducible** — classified as a report accuracy discrepancy; the functional conclusion (no schema drift) still holds via the diff.

## 24. New Findings (this audit)

1. **`_prisma_migrations` missing** in live DB → migrate status "not applied" despite in-sync schema (see §23).
2. **`DATABASE_URL` in `.env` is wrapped in double quotes** (`"postgresql://…"`, byte 0 = 0x22). This breaks Prisma CLI/`env("DATABASE_URL")` validation when the value is injected into the process environment directly; node scripts must strip the quotes or pass the URL via the `datasources` constructor option. The deployment `.env` inside the app container is unquoted and functional. (Operational hazard, not an app defect.)
3. **PURCHASING is a dangling role** (enum/policy omission) — deepened from P0-I.
4. **`temp:` Redis key prefix** — runtime temporary-token keys are `temp:invitation:<sha256>` (documented context, not a defect).

## 25. Risk Matrix & Production Readiness

| Risk                                                      | Likelihood                   | Impact     | Mitigation                                                                                                                           |
| --------------------------------------------------------- | ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Missing `_prisma_migrations` blocks future migrate deploy | Medium                       | High (ops) | Baseline/regenerate bookkeeping via `prisma migrate resolve --applied` or dump restore with migrations table; verify with diff after |
| P0-H recipe partial update                                | Low-Med                      | Medium     | Wrap recipe update in a transaction (P0-F package or dedicated fix)                                                                  |
| P0-I dead PURCHASING role                                 | Low                          | Low-Med    | Add to enum+policy or remove references                                                                                              |
| P0-J client-price trust                                   | Medium                       | Medium     | Server-side catalog price resolution before financial rollout                                                                        |
| P0-F averageCost correctness                              | Medium                       | High       | Include row-lock + weighted-average integration tests in P0-F package                                                                |
| Proxy-scope throttling (shared IP)                        | Low (current direct mapping) | Medium     | Enable `trust proxy` + Redis-backed throttle storage in reverse-proxy deployment                                                     |

Production readiness: the deployed service is healthy, synchronized with source, redaction active, P0-E reject path live-verified. The above items are pre-existing backlog / environment hygiene, not regressions introduced by P0-E.

## 26. Final Verdict

**CONDITIONAL GO.**

- **P0-E is verified CLOSED**: source (hash+expiry+PENDING lookup; CAS claim in transaction; rollback; role check), tests (1126/1126 including race + rollback + no-side-effect cases), gates (tsc/lint/build/prisma clean), deployment (bundle md5 identical), runtime (reject-path live 404/401, health 200), DB (0 rows, correct constraints).
- **Conditions attached to the GO (must be met before/during P0-F):**
  1. **Migrations bookkeeping:** resolve the missing `_prisma_migrations` table in `tablofy_prod` (restore the table / `migrate resolve --applied` all 24) OR formally accept the current state and re-verify with `prisma migrate diff` before every deploy. The P0-E report's "24/24 up to date" wording must be corrected.
  2. **P0-I:** remove or properly model the `PURCHASING` role (enum + policy + assignability) before any role-dependent rollout.
  3. **P0-H:** wrap `updateRecipe` item replacement in a transaction before recipe edits are relied on for costing.
  4. **P0-J:** server-side price resolution must be scheduled before financial-feature sign-off.
  5. **P0-F package requirements:** must include row-lock semantics review of `averageCost` maintenance and weighted-average integration tests, plus a follow-up verification that the deployed bundle hash and schema diff remain clean.

- **Not blocking the GO:** P0-A (reconciliation is PARTIAL by design — read-only reporting), the `DATABASE_URL` quoting quirk (deployment is unquoted and functional), and the `temp:` Redis prefix (documented behavior).

Audit complete. No files other than this report were created or modified during this audit.
