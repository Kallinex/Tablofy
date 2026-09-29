# P0-E REMEDIATION AND DEPLOYMENT REPORT

**Date:** 2026-08-12
**Repository:** `D:\New folder (8)\tablofy`, branch `feature/phase7-m5`
**Scope:** P0-E only — audit §11 item 4: "Invitations `accept()` hardening — wrap accept in `$transaction`, add atomic status CAS (`updateMany where status=PENDING`), handle P2002 on duplicate email as Conflict; hash tokens at rest (align with verification-token pattern)."
**Method:** Re-verification → live-DB inspection → reproduction spec (deleted after use) → minimal source fix → rewritten proving specs → full regression → lint/build/tsc/Prisma gates → live probes → image rebuild + `tablofy-api` redeploy → post-deploy bundle + probe verification → report. No schema/migration/env changes. No secrets logged or persisted.

---

## 1. Executive Summary

The P0-E finding was confirmed against current source and fixed with the smallest correct change, proven by tests, and **deployed to the running environment**:

- **Transactional, atomic `accept()`:** user creation now happens inside a `$transaction`; the invitation is claimed with an atomic status CAS (`updateMany where { id, status: PENDING }`). A failed claim (`count !== 1`) throws `ConflictException` before any user is created — duplicate/concurrent accepts can no longer create a second user or leave a torn state.
- **P2002 → Conflict:** `UsersService.create()` now converts the duplicate-email `P2002` (target = `email`/`tenantId`/empty) into `ConflictException`, inside or outside a transaction. Unrelated `P2002`s are rethrown unchanged.
- **Tokens hashed at rest:** invitations store `SHA-256(token)` in the DB `token` column and the Redis key `invitation:<hash>` (aligned with the auth `VerificationToken` pattern). The raw token is returned only to the inviter at `create()`. Verified safe: the live DB holds **zero invitation rows**, so no data migration or backward-compat concern exists.

**Gates:** full regression **87 suites / 1126 tests PASS** (baseline 87/1115 → +11 tests), ESLint clean, production webpack build clean, `tsc -p tsconfig.app.json` clean, Prisma valid / 24-24 migrations / `migrate diff` = "No difference detected", live `/api/v1/health` 200, safe accept/findByToken probes return 404 with **no DB mutation**, deployed bundle md5 **byte-identical** to the locally built bundle and contains all fix markers.

**Deployment:** image rebuilt; **only `tablofy-api` recreated** (`tablofy-postgres`/`tablofy-redis` untouched); container healthy; post-deploy probes pass.

## 2. Work Package Scope

| ID   | Finding (audit §11 item 4)                                                    | Class                           |
| ---- | ----------------------------------------------------------------------------- | ------------------------------- |
| P0-E | `accept()` not transactional; invitation update unconditional (no status CAS) | IMPLEMENTED + TESTED + DEPLOYED |
| P0-E | raw P2002 from duplicate user creation escapes as-is (not Conflict)           | IMPLEMENTED + TESTED + DEPLOYED |
| P0-E | raw invitation tokens persisted at rest (DB + Redis)                          | IMPLEMENTED + TESTED + DEPLOYED |

Explicitly **out of scope** (documented, not started): all other audit backlog items (P0-F+, P1, Phase 3 product features), frontend, payments/Stripe/Paymob, credentials, `.env` edits, unrelated refactors, destructive Prisma commands, `prisma reset`, and any production-data mutation.

## 3. Mission Constraints Applied

- No invented API contracts, fields, routes, roles, scopes, or rate limits.
- Fix mirrors the existing verification-token hashing precedent (`auth.service.ts` `createHash('sha256').update(token).digest('hex')`).
- No schema or migration changes (verified live: zero invitation rows; `migrate diff` = no difference).
- No secrets printed or persisted; raw tokens never logged, never stored at rest, and only the inviter sees the raw token returned by `create()`.
- Tenant isolation untouched on every affected query (all queries remain tenant-scoped).
- Redis cleanup is deliberately best-effort and non-fatal (DB commit is the source of truth); no error masking.

## 4. Baseline Evidence

- Audit source: `PHASE-3-BACKEND-IMPLEMENTATION-AUDIT.md` §11 item 4 (exact wording in Scope above).
- Prior hardening commits (`5d6d0c3` etc.) unchanged; working tree dirty with this package plus the earlier uncommitted P0-A/B/C/D work.
- Full regression before this work package: 87 suites / 1115 tests.
- Live DB (`tablofy_prod`) at start: `TOTAL_INVITATIONS=0`, `BY_STATUS=[]`, token-length aggregate all null/0 → **no data migration required for the hashed-token switch** (explicitly verified, not assumed).

## 5. P0-E — Root Cause

`invitations.service.ts` `accept()` (pre-fix):

1. **No transaction.** `usersService.create(...)` and the invitation claim were separate `await` calls — a user-creation failure left the invitation untouched and a second attempt could re-create the user (P2002 escape).
2. **Unconditional status update.** The claim used `this.prisma.invitation.update({ where: { id }, data: { status: ACCEPTED, acceptedAt } })` with **no `status: PENDING` predicate** — no atomic claim, no conflict detection, concurrent duplicate accepts both "succeeded".
3. **Raw P2002.** `UsersService.create()` had no `P2002` handling, so a duplicate-email race surfaced as a raw Prisma `P2002` (500) instead of a `409 Conflict`.
4. **Raw tokens at rest.** `create()` stored the raw 64-hex token in the DB `token` column and the Redis key `invitation:<rawToken>`; `findByToken`/Redis cleanup used raw tokens end-to-end.

**Reproduction** (temporary `repro.p0e.spec.ts`, 6/6 PASS against pre-fix code, deleted after use): (1) `accept()` never opens `$transaction`; (2) invitation update unconditional; (3) user-create and claim are separate awaits (non-atomic); (4) raw P2002 escapes (not Conflict); (5) raw token persisted at rest in DB + Redis key; (6) concurrent duplicate accept → `['P2002', 'FULFILLED']`.

## 6. P0-E — Fix Applied

**`invitations.service.ts`**

- `create()` (`:64`, `:70`, `:79`): generates `token = randomBytes(32).hex`; stores `hashedToken = sha256(token)` in the DB `token` column and in the Redis key `invitation:<hashedToken>`; returns `{ ...invitation, token }` — the **raw token goes only to the inviter** (`:94`).
- `findByToken()` (`:128`, `:131`): hashes the incoming raw token before the Prisma lookup (never queries by raw token).
- `accept()` (`:173-197`): entire claim+create flow inside `this.prisma.$transaction(async (tx) => { ... })`:
  - Atomic CAS: `tx.invitation.updateMany({ where: { id, status: PENDING }, data: { status: ACCEPTED, acceptedAt: new Date() } })`.
  - `claim.count !== 1` → `ConflictException('Invitation is no longer pending')` — thrown **before** any user creation.
  - `usersService.create(..., tx)` passes the transaction client as the 6th argument so reads+writes share the transaction.
- Redis cleanup (`:199-205`): best-effort `deleteTemporaryToken('invitation:<hashedToken>')` in try/catch (warn-only, never fatal after commit).
- `reject()` (`:230`) / `revoke()` (`:265`): delete `invitation:<hashedToken>` (hashed stored token, never raw input).

**`users.service.ts`**

- `create()` (`:48`): optional `tx?: Prisma.TransactionClient` 6th parameter; `const db = tx ?? this.prisma` (`:55`) used for `findFirst` + `create`.
- `P2002` conversion (`:92-105`): `PrismaClientKnownRequestError` with code `P2002` whose target is empty or contains `email`/`tenantId` → `ConflictException('A user with this email already exists')`; any unrelated P2002 is rethrown unchanged (no global swallow).

## 7. P0-E — Design Invariants Preserved

- The transaction order is claim-first: an invitation can never be marked ACCEPTED without a user, and a user is never created when the claim fails.
- The CAS predicate `status: PENDING` is the single source of truth for "claim"; the earlier pre-transaction status check was removed as redundant (that branch was unreachable — `findByToken` already returns only PENDING).
- Duplicate-email detection stays correct inside the transaction: the pre-check catches the common case, the P2002 conversion catches the race (DB `@@unique([tenantId, email])` is the backstop).
- Redis is a cache only; its failure never reports a failed accept after the DB commit, and a successful DB commit never depends on Redis.
- No new permissions, roles, DTO fields, or routes introduced.

## 8. P0-E — Concurrency Analysis

Under two concurrent accepts of the same invitation, both `findByToken` calls return PENDING, both enter the transaction, and the first `updateMany(status=PENDING)` commits the ACCEPTED claim (count 1); the second `updateMany` matches zero rows (count 0) and throws `ConflictException`. Exactly one user is created (transaction-client reads/writes serialize within each transaction). Proven by the rewritten spec's concurrency-barrier test (one `FULFILLED`, one `Conflict`, `usersService.create` invoked once) and by the P2002 race test.

## 9. P0-E — Security Considerations (secrets & credentials)

- Raw invitation tokens exist only transiently: generated at `create()`, returned once to the inviter, never logged, never stored (DB holds SHA-256; Redis holds SHA-256 keys).
- No passwords, provider keys, or DB credentials printed or persisted during verification; all probe payloads were synthetic.
- The `AuditLogsService` events (`INVITATION_CREATED`, `INVITATION_ACCEPTED`) carry email/role/id only — a spec asserts the token never appears in the acceptance audit payload.

## 10. P0-E — Test Evidence

**Rewritten `invitations.service.spec.ts` (20 tests, all PASS)**

- create: role-escalation rejection, duplicate-pending rejection, existing-user rejection, hashed-at-rest + raw-returned, no raw token in row/Redis key.
- findByToken: unknown → NotFound, expired → EXPIRED + NotFound, valid pending returned, hashed lookup (never raw).
- accept: inviter-role Forbidden, full happy path (transaction + CAS `updateMany` + `tx` passed to `usersService.create` + hashed-key Redis delete + audit), CAS count 0 → Conflict, P2002-Conflict propagation with no post-transaction side effects, **concurrent claim (one FULFILLED / one Conflict / create called once)**, best-effort Redis failure non-fatal, audit event excludes token.
- reject: marks REJECTED + removes hashed Redis key (never raw). revoke/revokeExpired: non-pending → BadRequest, EXPIRED + hashed-key delete, bulk-expire count.

**Extended `users.service.spec.ts` (20 tests, all PASS)**

- Added: duplicate-email P2002 → `ConflictException` (no audit write), unrelated P2002 rethrown as the original error, provided transaction client used for reads/writes (prisma client untouched).

**Focused run:** 2 suites / **40 tests PASS**. **Full regression:** **87 suites / 1126 tests PASS, 0 failures** (baseline 87/1115 → +11: invitations +8, users +3).

## 11. P0-E — Database Verification (no migration)

- `prisma validate`: schema **valid**.
- `prisma migrate status`: **24/24 migrations applied**, DB up to date (`tablofy_prod`).
- `prisma migrate diff --from-migrations → --to-schema-datamodel` (against a throwaway shadow DB, created and dropped): **"No difference detected."**
- Live DB row inspection (via Prisma client, `DATABASE_URL` from `.env`, never printed): `invitations` table still **0 rows** before and after all probes; `Invitation.token` is already `String @unique` with `@@index([token])` → the hashed-token switch needs **no column change and no data migration** (verified: zero rows).

## 12. P0-E — Build & Static Gates

- `tsc -p tsconfig.app.json --noEmit`: **clean**.
- ESLint (`npx nx lint api`): **clean** (4 prettier formatting nits in the two touched spec files fixed; re-run green).
- Production webpack build (`npx nx build api --configuration=production`): **compiled successfully**.
- `tsc -p tsconfig.spec.json --noEmit`: **pre-existing dirty repo-wide** (1060 errors) — the systemic `createMockPrisma` typing class affects ~30 spec files including untouched ones; my files contribute only the same class; tests run via ts-jest `isolatedModules`, so this is not a passing gate in this repo and was left untouched (out of scope).

## 13. P0-E — Live Verification (pre- and post-deploy, safe probes only)

| Probe                                                                        | Result                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/v1/health`                                                         | **200** (db/redis/bullmq/disk up)                                      |
| `POST /api/v1/invitations/accept` (synthetic garbage token, valid DTO shape) | **404** `Invalid or expired invitation`, no DB mutation                |
| `GET /api/v1/invitations/token/<garbage>`                                    | **404** `Invalid or expired invitation`, no DB mutation                |
| `SELECT` on `invitations` before/after probes                                | **0 rows, unchanged**                                                  |
| Container logs                                                               | No errors; no raw token in any log line; probe failures logged cleanly |

A **real successful acceptance** (creating a live user) was **NOT attempted and NOT fabricated** — it requires a genuine invitation + email flow and would mutate production data. This item is classified **NOT LIVE-VERIFIED (external)** below; the remediation is proven instead by 40 unit tests, bundle inspection, and the safe probes.

## 14. P0-E — Deployment (only `tablofy-api`)

- Built: `docker compose -f docker/docker-compose.prod.yml up -d --build api` (context `docker/`, entry `node app/main.js`).
- Recreated: **`tablofy-api` only**; `tablofy-postgres` and `tablofy-redis` remained Running/Healthy and were not recreated.
- Startup: `prisma migrate deploy` (24/24, no-op) → Nest started cleanly ("Application is running on http://localhost:3000/api/v1"); container **Up (healthy)**.
- **Bundle sync:** container `/app/app/main.js` md5 `882f250e063111137ab35e4a7c880a78` == local `dist/apps/api/main.js` md5 (`882f250e063111137ab35e4a7c880a78`), size 2,580,995 bytes both. Pre-deploy container hash was `f7b375625a8cdf5635b859e65d56d065` (old build) — now replaced.
- **Fix markers present in deployed bundle:** `Invitation is no longer pending` ×1, `updateMany` ×77, `createHash` ×10, `A user with this email already exists` ×3, `invitation:` (Redis key prefix) ×4.
- Post-deploy probes: health 200; accept/findByToken garbage → 404; DB still 0 invitations.

## 15. P0-E — Git Diff Review

`git status --short` (this package's files): modified `apps/api/src/modules/invitations/invitations.service.ts`, `apps/api/src/modules/invitations/tests/invitations.service.spec.ts`, `apps/api/src/modules/users/users.service.ts`, `apps/api/src/modules/users/tests/users.service.spec.ts`; plus this report (new). Diff inspected line-by-line: hashing, transaction + CAS, P2002 conversion, and spec additions only — no unrelated files, no secrets. (Other listed dirty files belong to the earlier, separately reported P0-A/B/C/D work; not touched here.)

## 16. P0-E — Classifications Summary

| Item                                                                       | Classification                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `accept()` wrapped in `$transaction` (atomic claim + user creation)        | **IMPLEMENTED + TESTED + DEPLOYED**                                                                 |
| Atomic status CAS (`updateMany where status=PENDING`, count!=1 → Conflict) | **IMPLEMENTED + TESTED + DEPLOYED**                                                                 |
| Duplicate-email P2002 → `ConflictException` (target-discriminated)         | **IMPLEMENTED + TESTED + DEPLOYED**                                                                 |
| Tokens hashed at rest (SHA-256, DB + Redis), raw token to inviter only     | **IMPLEMENTED + TESTED + DEPLOYED**                                                                 |
| Concurrency: exactly one accept wins                                       | **PROVEN** (barrier test; no live race exercised — no invitation data exists)                       |
| Real successful live acceptance path                                       | **NOT LIVE-VERIFIED (external)** — requires a genuine invitation flow; not fabricated               |
| Schema/migration change                                                    | **NONE** (verified: zero rows, diff = no difference)                                                |
| Spec-typecheck (`tsconfig.spec.json`)                                      | **PRE-EXISTING DIRTY** (1060 errors repo-wide, systemic mock typing; not a gate here; out of scope) |

## 17. Out-of-Scope / Deferred (documented, not acted on)

- Live end-to-end acceptance (real invite → accept → login) — needs a human/tenant-owner-driven invitation flow; recommended staged verification.
- All other P0/P1/Phase 3 backlog items (costing, supplier-performance, recipes rollback, `PURCHASING` role, orders client-price trust, sessions, notifications, privacy export, subscriptions, analytics, forecasting, backups, etc.).
- Pre-existing spec-typecheck debt (see §12).

## 18. Next Steps & STOP

- P0-E is remediated, tested, gated, and **deployed**. **STOPPING here per mission.**
- Do **not** start P0-F/P1/Phase 3 work until an independent decision audit approves the next work package.
- Recommended follow-ups for that decision: (1) human-driven live accept verification with a real invitation; (2) wire any remaining P0 backlog items as separate work packages.

---

## FINAL VERDICT

**P0-E CLOSED** — SOURCE PASS (minimal, correct fix; reproduction proven then covered by 40 unit tests), BUILD PASS (tsc app, ESLint, production build), TESTS PASS (87 suites / 1126 tests, 0 failures; baseline 87/1115), DATABASE PASS (`prisma validate`, 24/24 `migrate status`, `migrate diff` = "No difference detected", zero rows → no migration needed), RUNTIME PASS (health 200, safe probes 404, container healthy, logs clean), DEPLOYMENT SYNCHRONIZED (image rebuilt, only `tablofy-api` recreated, deployed bundle byte-identical to local dist with all fix markers present). Sole documented caveat: the real successful-acceptance path remains **NOT LIVE-VERIFIED (external)** by design, as it requires a genuine invitation flow that would mutate production data.
