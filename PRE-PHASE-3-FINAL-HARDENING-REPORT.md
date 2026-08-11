# PRE-PHASE-3 FINAL HARDENING REPORT

**Date:** 2026-08-11
**Repository:** `D:\New folder (8)\tablofy`, branch `feature/phase7-m5`
**Commit:** `dde94897b31abb9659096815b15a0a6201065746` (hardening batch; not pushed)
**Authoritative references:** `P1-05-P1-06-FINAL-REMEDIATION-REPORT.md`, `POST-P1-05-P1-06-FINAL-INDEPENDENT-DECISION-AUDIT.md` (repo root)
**Status:** ALL pre-Phase-3 hardening conditions MET. Phase 3 NOT started.

---

## 1. Executive Summary

All conditions set by the independent pre-Phase-3 audit are now satisfied:

1. **N1 residual lost-update fixed** — `createGRN` now takes a PostgreSQL row-level `FOR UPDATE` lock on `inventory_items` inside the existing transaction before computing `averageCost` (the exact serialization pattern already used by recipe deduction). `averageCost` can no longer be lost to a stale read→compute→write under concurrent inventory mutations.
2. **Redis authentication decision made and enforced** — production compose hard-requires a `REDIS_PASSWORD` (min 16 chars, validated at boot), dev compose ships a strong dev-only default, all Redis/BullMQ connections go through the shared `buildRedisConnectionOptions`, and the running image was rebuilt so BullMQ actually authenticates. Live proof: unauthenticated `PING` → `NOAUTH`, authenticated `PING` → `PONG`, `/api/v1/health` returns 200 in ~0.02s with all 21 queues `up`.
3. **Migration safety re-verified against the real database (no reset)** — 24/24 migrations applied, `prisma migrate status` = "Database schema is up to date!", `prisma migrate diff` (live → schema.prisma) = **"No difference detected."**
4. **Full regression + gates green** — 84/84 suites, 1057/1057 tests; `nx run api:lint` and `nx run api:build` clean; `prisma validate` OK; affected suites re-run on the committed state (4/4 suites, 69/69 tests).
5. **Hardening committed** — commit `dde9489` contains only intended hardening; this report is committed separately (see §14); working tree clean; not pushed (per instruction).

Verdict: **GO for Phase 3** (when instructed). No further pre-Phase-3 work is outstanding.

---

## 2. Scope, Authority & Constraints

- **In scope:** N1 `averageCost` race in `createGRN`; Redis authentication (P1-08); migration real-data validation; full regression/gates; security review; commit; fresh independent final audit; this report.
- **Explicitly NOT started:** Phase 3 features, unrelated refactors, frontend/UI changes, credential creation beyond the dev-only compose default, any weakening of security/concurrency, marking anything CLOSED without evidence.
- **Constraints honored:** database-level locking (not a mutex); no `prisma reset`, no fixture deletion, no production-data reset; container/API health checked before live commands; `.env` values never printed; no pushes unless instructed.
- **Authoritative prior findings:** P1-05 (GRN cancellation inventory attribution) and P1-06 (inventory lost-update/non-atomic paths) were remediated and closed in the two referenced reports. This report verifies that state stands, closes the one residual (N1), and adds the Redis-auth and migration-validation work the decision audit required.

---

## 3. Findings Addressed

| Finding | Status | Evidence |
|---|---|---|
| N1 `createGRN` `averageCost` read→compute→write lost update | **FIXED (new)** | `purchasing.service.ts:948-953` `FOR UPDATE` lock; N1 tests in `purchasing.service.spec.ts` |
| Redis auth optional by default; BullMQ could connect without password | **FIXED (P1-08)** | `redis.config.ts` builder; `queue.service.ts`/`redis.service.ts` use it; compose prod hard-requires; `env.validation.ts:234-241` |
| Stale API image ran BullMQ without password → NOAUTH → `/health` hang | **FIXED (ops)** | Image rebuilt from current source; live health 200 with 21 current queues |
| Migration/DB safety claims unverified against real data | **CLOSED** | `prisma migrate status`, `prisma migrate diff` = no difference, 24/24 applied, object spot-checks |
| Entire remediation uncommitted | **CLOSED** | Commit `dde9489`; working tree clean |
| P1-05 GRN batch attribution | CLOSED (prior) | See P1-05/P1-06 reports + `schema.prisma` `inventoryBatchId` |
| P1-06 concurrency (CAS, atomic arithmetic, transfers, cycle counts, recipes) | CLOSED (prior) | See P1-05/P1-06 reports; full regression re-passed |

---

## 4. Root-Cause Analysis

**N1 (`averageCost` lost update).** `createGRN` computed the new weighted average from `invItem.currentQuantity`/`averageCost` read immediately before the write, inside a transaction but *without a row lock*. Two concurrent GRNs for the same item both read the same base and each wrote its computed value; the later commit silently discarded the other's units/cost — an inventory-valuation lost update. The PO line `updateMany` guard prevented over-receipt but did not serialize the *item* mutation.

**Redis NOAUTH hang.** The deployed `docker-api` image was built before `buildRedisConnectionOptions` existed. Its bundled `QueueService` built BullMQ connections with only host/port (no `password`) while `RedisService` sent one; BullMQ hit `NOAUTH`, and because BullMQ sets `maxRetriesPerRequest: null` (infinite retry), the retry loop never terminated — `/health` hung, `rejected_calls` on `client|setinfo`/`client|setname` climbed (~8424→10584) with a 594KB socket queue. Not a code defect in the current tree, but a deployment staleness bug.

---

## 5. Schema & Migration

Changes are confined to two additive migrations plus the `KitchenTicketItem` uniqueness already present in `20260811000000_add_kitchen_ticket_item_unique_order_item`.

**`20260811120000_add_grn_batch_attribution`** (`prisma/migrations/.../migration.sql`):
- `ALTER TABLE goods_receipt_items ADD COLUMN "inventoryBatchId" TEXT;`
- `CREATE INDEX goods_receipt_items_inventoryBatchId_idx ...`
- `CREATE UNIQUE INDEX inventory_batches_inventoryItemId_tenantId_batchNumber_lotN_key ON inventory_batches(inventoryItemId, tenantId, batchNumber, lotNumber, expiryDate);`
- FK `goods_receipt_items_inventoryBatchId_fkey ... ON DELETE SET NULL`
- `ALTER INDEX loyalty_points_transactions_tenantId_referenceType_referenceId_ RENAME TO ...referenc_key;`

**Real-data validation (no reset):**
- `prisma migrate status`: 24 migrations found, **"Database schema is up to date!"**
- Live objects confirmed: `goods_receipt_items.inventoryBatchId` col+idx+FK; the `inventory_batches` unique key; `payments_tenantId_idempotencyKey_key`; `wallet_transactions_tenantId_referenceType_referenceId_key`; `loyalty_points_transactions_tenantId_referenceType_referenc_key`; inventory tenant index + `averageCost` column.
- `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma` → **"No difference detected."** (live schema == schema.prisma exactly).
- Data preserved: transactional tables empty, seeded tenants (2) intact.

**Known benign note (pre-existing):** migration `20260802120914_m4_4_soft_delete_updated_at` has a stored-checksum mismatch vs the workspace file (applied 08-05; not a CRLF artifact — LF-normalized SHA differs too). Schema-equivalent (`migrate diff` = no difference), therefore left untouched; must not be "fixed" by editing the checksum record.

---

## 6. Fix: N1 `createGRN` averageCost Race (`FOR UPDATE`)

`apps/api/src/modules/purchasing/purchasing.service.ts`:

```ts
// P1-06 N1 ... (comment at 943-947)
await tx.$queryRaw`
  SELECT "id"
  FROM "inventory_items"
  WHERE "id" = ${item.inventoryItemId} AND "tenantId" = ${tenantId}
  FOR UPDATE
`;
```

- Acquired at line **948-953**, immediately before the `findFirst` read (955) that feeds the computation (961-981) and the `update` write (983-993), all inside the existing `withGRNNumberRetry` transaction.
- Row-locks with the tenant scoping condition in the `WHERE`, matching the proven `recipes.service.ts` deduction pattern.
- `findFirst` keeps `{ id, tenantId }` scope → tenant isolation preserved; the locked row is owner-verified by construction.
- **Why database-level, not a mutex:** a mutex would not coordinate across processes/replicas and could allow the same lost update in a multi-instance deployment; the row lock serializes at the source of truth.
- Invariant now holds: `averageCost = (oldAvgCost * oldQty + receiptsTotalCost) / newQty`, computed from a serialized, current base, never from a stale base.

Related N1 tests prove: concurrent writers serialize (stateful gate in `onNotify`); a mid-transaction failure releases the lock for a clean re-run; final `averageCost` matches hand-computed weighted average.

---

## 7. Fix: Redis Authentication Enforcement

**Single source of connection options** — `apps/api/src/config/redis.config.ts` `buildRedisConnectionOptions(configService, { maxRetriesPerRequest? })` returns `{ host, port, password?, tls?, maxRetriesPerRequest? }`, deleting absent `password`/`tls`. Both connection builders now use it:
- `apps/api/src/redis/redis.service.ts:18-27` — `...buildRedisConnectionOptions(...)` + `maxRetriesPerRequest: 3`, `retryStrategy` stops after 3 attempts (no infinite retry → no hang).
- `apps/api/src/modules/queues/queue.service.ts:84-86, 111-117, 152-155` — BullMQ `Queue` and `Worker` connections built from the same options (`maxRetriesPerRequest: null` as BullMQ requires), so BullMQ **authenticates** in every environment.

**Boot-time validation** — `apps/api/src/config/env.validation.ts:234-241`: production requires `REDIS_PASSWORD` with length ≥ 16, else boot fails with a clear message.

**Compose:**
- `docker/docker-compose.prod.yml` — `REDIS_PASSWORD: ${REDIS_PASSWORD:?...}` (required, both for `redis` and `api`); `redis-server --requirepass` via the password; healthcheck `redis-cli ... -a $REDIS_PASSWORD ping`; postgres/redis now bound to `127.0.0.1` only.
- `docker/docker-compose.yml` (dev) — strong 64-hex-char dev-only default so Redis always starts with auth locally; explicitly documented as never used in production. The default is also present in the gitignored `docker/.env`/`.env` runtime files.
- `.env.example` documents the mandatory-in-prod rule.

**No credentials logged or leaked** — grep of `apps/api/src` found zero logger/console statements containing password/REDIS_PASSWORD values; `/api/v1/health` output contains no credentials.

---

## 8. Live End-to-End Verification

Environment: all 3 containers healthy (`tablofy-api`, `tablofy-postgres`, `tablofy-redis`).

| Check | Result |
|---|---|
| `GET /api/v1/health` | `200`, ~0.02s (no hang), `status: ok` |
| `info.database` | `up` |
| `info.redis` | `up` |
| `info.bullmq` | `up` with **21 queues** = current-source `QUEUE_NAMES` (email…dead-letter) |
| Queue stats (preserved history) | e.g. webhook-delivery completed 18, kitchen 17, dead-letter completed 14, export-engine failed 7 |
| `GET /api/v1/health/ready` | `200` |
| unauthenticated `redis-cli PING` (in container) | `NOAUTH Authentication required.` |
| authenticated `redis-cli -a <dev-password> PING` | `PONG` |
| Credentials in health/log output | none |

The previously observed `rejected_calls` flood and socket queue are gone; the running image now serves exactly the 21 current queues (stale image had 36 old queue names).

---

## 9. Migration Real-Data Validation

Re-verified on the live database with **no reset and no data deletion**:

- `npx prisma migrate status` → "Database schema is up to date!" (24/24 migrations in `_prisma_migrations`).
- Independent SHA-256 of migration files vs `_prisma_migrations` checksums: 23/24 match; the single mismatch (`20260802120914_m4_4_soft_delete_updated_at`) is pre-existing, schema-equivalent, and benign (see §5).
- `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma` → **"No difference detected."**
- Seed data (2 tenants) intact; transactional tables remain empty (no production data to corrupt — noted in §15).

---

## 10. Regression & Gates

| Gate | Result |
|---|---|
| Full test run (`nx run api:test`) | **84/84 suites, 1057/1057 tests PASS** (baseline 1044 + 8 N1 + 5 config/Redis) |
| Fresh re-run of affected suites on committed state | 4/4 suites, **69/69 tests PASS** (purchasing.service 29.4s, env.validation, docker-compose, redis.config) |
| `nx run api:lint` | PASS (3 lint errors introduced during N1 test edits fixed; prettier applied) |
| `nx run api:build` (webpack) | PASS (1m 2s) — this is the real compile gate (`tsc -p apps/api/tsconfig.app.json` cannot run because TS 6.0.3 removed `baseUrl` while `tsconfig.base.json:25` still sets it; build covers compilation) |
| `npx prisma validate` | OK |

---

## 11. Security Review

- **Redis:** every Redis connection (RedisService, BullMQ Queue, BullMQ Worker) originates from `buildRedisConnectionOptions`; `REDIS_URL` is only a config default, never used to open a connection. Prod requires auth (min 16) at compose + boot validation; ports bound to loopback; no credentials logged.
- **No bypass URLs / secrets in code:** no API keys, tokens, or real credentials in the diff (scanned for Stripe/AWS/GitHub patterns and URL-embedded credentials); dev password appears only as the compose default.
- **Tenant isolation/RBAC (unchanged, re-verified):** TenantGuard enforces `user.tenantId === params.tenantId`, SUPER_ADMIN bypass, `SkipTenantCheck` only on public endpoints (auth, webhooks, invitations); Bull Board JWT-protected.
- **Concurrency safety (unchanged, re-verified):** payments `idempotencyKey` unique + `findFirst` replay + P2002 replay handler (different order → Conflict) + order version CAS; purchasing/inventory `updateMany` CAS, `FOR UPDATE`, atomic increments; GRN batch attribution + natural-key unique.

---

## 12. Reference Case Studies (P1-05 / P1-06)

Re-verified still true in committed source; full detail in the two authority reports:

- **P1-05:** GRN lines carry exact `inventoryBatchId`; cancel reverses only that batch row via id-targeted gte-guarded CAS; legacy null rows skipped; P2002 deterministic batch reuse; repeat/concurrent cancel serialize on the status claim.
- **P1-06:** `updateItem` real version CAS → `ConflictException`; adjustments/waste atomic; cycle-count reconcile claim + variance CAS; transfers status claims + gte-CAS; recipe deduction `FOR UPDATE` serialized.
- **N1 (this session):** the one residual — `createGRN` averageCost — now closed by the same `FOR UPDATE` pattern.

---

## 13. Invariants & Proving Tests

- **N1 invariant:** `averageCost` mathematically correct under concurrent inventory mutations; never the product of a stale read. Proven by N1 tests (serialization, mid-transaction-failure lock release, hand-computed weighted average) in `purchasing.service.spec.ts` (8 new tests).
- **Redis invariant:** prod cannot boot or start Redis without a ≥16-char password; every connection authenticates. Proven by `env.validation.spec.ts` (3) + `docker-compose.spec.ts` (6) + `redis.config.spec.ts` (5) + live NOAUTH/PONG probes.
- **Migration invariant:** live schema ≡ schema.prisma with no reset. Proven by `migrate status`, `migrate diff`, checksum + object spot-checks.
- **Test-infra fix:** `prisma.mock.ts` `reset()` now clears `$queryRaw`/`$queryRawUnsafe`/`$executeRawUnsafe` mocks (leak caused timeouts in tests 5-8 of the N1 suite).

---

## 14. Commit Record

- **Commit `dde94897b31abb9659096815b15a0a6201065746`** on `feature/phase7-m5` (hardening).
- 33 files, +4032/−396; scope = only intended hardening: purchasing `FOR UPDATE`, Redis auth/config/compose/env-validation, schema + 2 migrations, test-mock reset, config tests, P1-05/P1-06 reports.
- **Commit (report)** — `PRE-PHASE-3-FINAL-HARDENING-REPORT.md` committed as a separate docs commit (this file).
- Pre-commit verification: `git status` dirty tree = only intended files; staged set reviewed; secret scan of full diff clean; working tree now clean. **Not pushed** (per instruction).

---

## 15. Residual Observations & Explicit Non-Issues

- **`m4_4_soft_delete_updated_at` checksum mismatch** — pre-existing, schema-equivalent, benign; documented, not "fixed".
- **`cancelGRN` does not recompute `averageCost` on reversal** — pre-existing design decision (quantity decremented, cost basis unchanged), reviewed in P1-06; out of current scope. Flagged for Phase 3 consideration if average-cost history is required on reversals.
- **Transactional tables are empty** — live DB has no real GRN/order/payment data to validate against; migration-safety and N1 math are proven by schema-equivalence, live object checks, and tests, not by end-to-end over production data. This was an accepted constraint of the mission (no production data reset and none available).
- **`tsc -p apps/api/tsconfig.app.json` blocked** by TS 6.0.3 `baseUrl` removal + stale `tsconfig.base.json:25`; the webpack build is the compile gate and passes. Correcting tsconfig is out of scope for this mission.

---

## 16. Verdict, Deviations & Next Steps

- **Verdict: GO for Phase 3.** Every pre-Phase-3 condition from the decision audit is closed: N1 fixed + tested, Redis auth enforced + proven live, migration validated on real data, full regression green, hardening committed.
- **Deviations from plan:** none material. (The API health-check port was confirmed as `3000`, not `3001`, during the fresh audit; health data gathered from `3000`.)
- **Next steps:** await explicit instruction to start Phase 3; do not push the hardening commit unless asked; if Phase 3 touches `averageCost` reversal semantics, revisit the §15 note.
