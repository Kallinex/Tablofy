# POST-P1-REMEDIATION INDEPENDENT DECISION AUDIT

## 1. Executive verdict

**CONDITIONAL GO (source level).**

Every conclusion below was derived by re-reading source code, tests, Prisma schema, git state,
and runtime bundle — not from P1-REMEDIATION-IMPLEMENTATION-REPORT.md (which was used only as a
claim list to challenge).

- **P1-03 COMPLETED-payment-proof invariant → CLOSED** (independently verified)
- **P1-04 refresh-token hashing → CLOSED** (independently verified)
- **P1-02 stranded-PENDING reconciliation → CLOSED** (independently verified)
- **P1-01 ConsumptionRecord creation → CLOSED** (independently verified)
- **P1-01 refund-reversal → BLOCKED_BUSINESS_DECISION** (independently verified to be the sole
  open item)

The CONDITIONAL-GO qualifier is narrow and statutory: only the P1-01 refund-reversal semantics
remain unresolved; the other three are fully verified; and the unresolved behavior is isolated to
the **consumption/COGS analytics** side of the refund path and does not affect any of the
already-safe implemented paths.

**Critical deployment fact:** the currently running `tablofy-api` container runs a bundle built at
`2026-08-28 01:15:30` that contains **none** of the P1 changes (marker grep = 0). The live source
build (compiled this audit) contains all of them. **IMPLEMENTED IN SOURCE ≠ DEPLOYED.** Deploying
is out of scope for this audit; no container was changed.

## 2. Scope

Audited exactly the four P1 items:

- P1-03 — order COMPLETED requires sufficient paidAmount (payment-proof invariant)
- P1-04 — refresh tokens stored/looked-up as SHA-256 digests only
- P1-02 — scheduled reconciliation of stranded gateway PENDING payments
- P1-01 — ConsumptionRecord creation from order deductions, plus the refund-reversal decision

Read-only audit. No source, test, schema, migration, DB, Redis, or container change was made.
No commit/push/deploy. A temporary, self-deleting count script was run at repo root and removed.

## 3. Evidence policy

- Source re-read at current working-tree content (git baseline is dirty — see sections 4–6).
- Claims accepted only when independently reproduced from source and/or a fresh gate run.
- The implementation report is treated as an unverified claim set; discrepancies are reported
  (sections 7 and 25).
- Test counts were independently enumerated from the spec files, not from the report.

## 4. Baseline

- Working dir: `D:\New folder (8)\tablofy-p4-01-clean`
- HEAD: `16d70e546d28252babf3e830d85015c55bcb6e00` (unchanged through the audit).
- Snapshot of pre-implementation state recorded at
  `C:\Users\ELNOUR~1\AppData\Local\Temp\opencode\deploy-audit\baseline-pre-impl.txt` (842 tracked
  modifications + 17 untracked at capture time).

## 5. Git state

Captured live:

- branch: unnamed/decapitated at `16d70e5` (`git branch --show-current` empty → detached state).
- `git status --porcelain` (autocrlf=false): **842 tracked modifications, 19 untracked**.
- HEAD `16d70e546d28252babf3e830d85015cbcb6e00`; last three commits: `16d70e5` (finalize
  pre-phase-3 hardening), `5d6d0c3` (report hash), `b5e89a4` (final hardening report).
- No resets, cleans, checkouts, commits, or stash operations occurred during the audit.

## 6. Changed-file reconciliation

Comparison of baseline snapshot vs. live state:

- Tracked-modified count: baseline 842 → live 842 (**unchanged**; the P1 edits landed inside files
  already in the pre-existing modified set).
- Untracked count: baseline 17 → live 19. The **only two additions** are:
  `P1-REMEDIATION-IMPLEMENTATION-REPORT.md` and
  `apps/api/src/modules/payments/tests/reconcile-pending.spec.ts`.
- The implementation report's claimed delta (12 modified files + 1 new spec + report) is
  consistent with the live state. **Because no checkpoint commit separates pre-existing edits from
  P1 edits, git cannot isolate the P1 delta line-by-line**; the audit therefore verified each
  claimed change by re-reading the current source (sections 7–25). All 15 listed files carry
  non-zero diffs (`diff --stat`), e.g. orders.service.ts +21, auth.service.ts +16, payments.service.ts
  +263, scheduler.service.ts +28, cleanup.processor.ts +65, queue.module.ts +3, recipes.service.ts
  +20, and corresponding spec deltas.
- Pre-existing unrelated edits (e.g., `email.processor.ts`/`email.processor.spec.ts`/`queue.service.ts`
  diffs present in the baseline file) were **not** touched by this work and remain unchanged apart
  from their pre-existing content.
- No files were deleted by the P1 work.

## 7. P1-03 source audit

- `orders.service.changeStatus` gate: `apps/api/src/modules/orders/orders.service.ts:488-496` —
  after `validateTransition`, if `dto.status === COMPLETED`, computes `totalPaid = Number(existing.paidAmount ?? 0)`,
  `orderTotal = Number(existing.total ?? 0)`, throws `BadRequestException` when `totalPaid < orderTotal`.
  Runs **before** the `$transaction` (line 498) and before any status-history/metric write. Re-verified
  by re-read at lines 476-573.
- **All five automatic COMPLETED writers are payment-gated** (re-verified at each site):
  1. `finalizeSucceededPayment` (payments.service.ts:155-177): completion only when
     `totalPaid >= orderTotal` (lines 160-162, 166-177).
  2. non-provider (cash/legacy) charge (payments.service.ts:326-348): completion only when
     `totalPaid >= orderTotal` (lines 331-347).
  3. split non-provider legs (payments.service.ts:872-893): only when
     `newTotalPaid >= Number(freshOrder.total)` (lines 876-892).
  4. split provider finalization (payments.service.ts:1075-1096): same guard (lines 1079-1095).
  5. webhook succeeded (payments.service.ts:1595-1618): same guard (lines 1600-1617).
- Bytes that write COMPLETED but are unrelated entities were excluded (backup, export-engine, cycle
  counts, campaigns, forecasting suggestions, scheduled reports — different models).
- **No other order-status writers exist**: the only `prisma.order.update/updateMany` sites outside
  changeStatus are moveTable (tableId only), softDelete (deletedAt), restore (deletedAt) —
  orders.service.ts:1020, 1310, 1415. Order `create` never sets COMPLETED (initial DRAFT/CONFIRMED).
- `changeStatus` callers: only `orders.controller.ts` `@Post(':id/status')` (line 97-112). Note: the
  implementation report section 6 calls this `PATCH orders/:id/status`; the controller annotation is
  **`@Post(':id/status')`** — a documentation-only discrepancy, no functional impact.

## 8. P1-03 bypass search

Repo-wide searches executed: `status: 'COMPLETED'` / `OrderStatus.COMPLETED`, `prisma.order.update*`,
`changeStatus(`, `order.create`. Results:

- No REST route lets a caller set an order status directly other than `changeStatus` via the DTO.
- No query-builder/raw-SQL path writes order status to COMPLETED.
- No seed/script writes order statuses.
- No webhook/event handler updates an order's status to COMPLETED other than the five gated payment
  flows; the reconcile path reuses `finalizeSucceededPayment` (the gated path), so it cannot bypass.
- Conclusion: **no bypass exists**; the invariant is satisfied by construction plus the new gate.

## 9. P1-03 payment semantics

- **PENDING cannot satisfy**: PENDING never increments `paidAmount`; only three credit sinks exist —
  `finalizeSucceededPayment` (line 158), non-provider charge (line 329), split legs (lines 875/1078),
  webhook (line 1598) — all also gated on the same invariant. Verified no other `paidAmount` writers
  in the codebase (grep of `paidAmount` assignments).
- **FAILED cannot satisfy**: FAILED payments never credit (`payment-state-machine.ts` PENDING→COMPLETED
  only; FAILED transitions exist for the reconcile/applyFail paths and never add to `paidAmount`).
- **Voided payments**: no payment VOIDED status exists in this codebase (payment lifecycle is
  PENDING/COMPLETED/PARTIALLY*REFUNDED/REFUNDED/FAILED). Voiding is an order-\_item* operation that
  reduces `total` via `recalculateOrder`; a reduced total makes the gate _more_ achievable, which is
  consistent with the invariant (the customer no longer owes the voided item).
- **CASH still works**: non-provider charge path (payments.service.ts:302-350) credits `paidAmount`
  and completes when covered — CASH is a non-provider method and behaves correctly.
- **Split payments work**: split legs accumulate `completedAmount` and complete only when the sum
  covers the total (lines 862-893, 1061-1096).
- **Partial payment rejected**: `paidAmount(60) < total(100)` and `paidAmount(0)` are covered by the
  `it.each` rejection tests.
- **Refund semantics respected**: full/partial refunds decrement `paidAmount`
  (payments.service.ts:585, 687, 1715) and the codebase supports COMPLETED→REFUNDED order transitions
  (order-state-machine.ts:31) and payment COMPLETED→REFUNDED (payment-state-machine.ts:6). The gate
  only constrains the _entry_ into COMPLETED, never the refund exit.

## 10. P1-03 concurrency

- The gate reads `paidAmount`/`total` from `findOne` immediately before the CAS transition; the
  transition still requires `order.updateMany({ where: { id, version: existing.version } })` to match
  (orders.service.ts:512-523), so a concurrent credit that bumps `version` aborts the transition with
  `ConflictException` — the gate cannot be raced into a wrong COMPLETED with a stale read.
- Every automatic writer uses the same version-CAS (payments.service.ts:144-150, 294-299, 863-869,
  1066-1072, 1584-1590) and payment-level claim (`status: PENDING`) — they remain race-safe against
  each other and against `changeStatus`.
- Tenant isolation intact: `changeStatus` uses tenant-scoped `findOne`; cross-tenant access raises
  `NotFoundException` (test at orders.service.spec.ts:974-979).

## 11. P1-03 tests

Independently enumerated (orders.service.spec.ts:816-979) and verified passing in the full run:

1. metric increment on COMPLETED (pre-existing)
2. fully-paid allowed (841)
3. zero-total free order allowed (872)
4. `it.each` rejects x3 — PENDING(0)/FAILED(0)/insufficient(60), asserting **no `$transaction` and no
   metric** (897-916)
5. split payments summing to total allowed (918)
6. concurrent version-CAS conflict → `ConflictException` (948)
7. cross-tenant → `NotFoundException` (974)

= 8 new P1-03 tests, matching the report. Orders suites green (incl. `order-crud.integration.spec`
with the unpaid-rejection assertion at line 236 region).

## 12. P1-04 source audit

- `hashToken(token) = sha256(token).hex` (auth.service.ts:909-911).
- Creation: `randomBytes(40).toString('hex')` (line 855); persisted field is `token: this.hashToken(...)`
  (lines 857-865); **raw value returned only in the in-memory response object** (lines 881-884).
- Lookup: `refreshToken.findUnique({ where: { token: this.hashToken(refreshTokenValue) } })`
  (lines 287-288). No plaintext lookup path exists.
- Rotation: revoke old by `id` (lines 343-346); new pair from `generateTokenPair`. Replay of a
  rotated token hits `revokedAt` → `TOKEN_REUSE_DETECTED` + `revokeAllUserTokens` + `UnauthorizedException`
  (lines 309-321).
- Logout: `updateMany({ where: { token: hash, userId, revokedAt: null } })` (lines 358-361) — ownership
  tied to the authenticated userId.
- Revoke-all-by-user (lines 887-892) and verification-token revocations (518-520, 571-573) are
  user-keyed, not token-value-keyed — correct.
- Expiry (`expiresAt`) and account-ACTIVE checks (lines 323-329) unchanged and still present.

## 13. P1-04 token lifecycle

Complete trace: generation → persisted digest → presented-token hashed-before-lookup → refresh →
rotation → revocation → logout → expiry → replay prevention — all hash-keyed or id/user-keyed. The
only string that equals the raw token anywhere in the system is the client response. There is no
second writer, reader, upsert, delete, or raw-SQL path touching `refresh_tokens` outside auth.service
(grep of `.refreshToken.(create|update|upsert|find...)` shows only auth.service.ts production hits).

## 14. P1-04 plaintext search

- Repo-wide `logger.*refresh`, token-in-log, and raw-token persistence searches: **0 matches**.
- `refreshToken.create`: single production site (auth.service.ts:857) — stored value is a 64-hex SHA-256
  digest; raw is a 160-bit (40-byte) hex value never reflected to Prisma.
- No plaintext fallback path, no legacy legacy `where: { token: raw }` remains.
- No migration was created (see section 26); the existing `refreshTokens` column holds hashes.

## 15. P1-04 security

- DB-at-rest confidentiality: a leak of `refresh_tokens` yields unusable digests; offline reversal is
  infeasible (SHA-256, 160-bit entropy source).
- Replay: rotated-token replay is actively detected and escalates to full-session revocation
  (TOKEN_REUSE_DETECTED).
- Ownership: logout keyed by (hash, userId); revocation by userId; JWT sub/tenantId unchanged.
- No new secrets; no credential logging; JWT/error paths use generic messages. Residual (accepted,
  protocol-inherent): the raw token exists in memory and in the client response.

## 16. P1-04 tests

Independently enumerated and verified present/passing:

- auth.service.spec.ts: lookup-by-hash assertion (310-327), expired rejection (338-346), P1-04
  persists-only-digest + no-raw-in-any-call (367-393), logout hash-keyed query (401-421).
- auth-flow.integration.spec.ts: logout assertion now expects
  `token: createHash('sha256').update('refresh-token').digest('hex')` (218-236); replay/TOKEN_REUSE
  test intact (195-216).
  = 4 new unit tests + 1 updated integration assertion, matching the report. Auth suites pass.

## 17. P1-02 source audit

- `reconcilePendingPayments({ max?, staleAfterMs? })` (payments.service.ts:1239-1280): scans
  `status: PENDING`, `createdAt <= cutoff`, `gatewayRef != null`, oldest-first, `take: max`.
- Resolution engine `resolvePendingPayment` (1282-1369):
  - no provider / provider mode `mock` → kept (1286-1288)
  - gateway status-lookup wrapped in try/catch **outside any DB transaction** (1290-1301)
  - `!success || !data` → errored/kept + attempt (1303-1309)
  - `succeeded` + amount match → `resolveSucceededPayment` (1313-1335)
  - `succeeded` + amount mismatch → **no credit**, `PAYMENT_RECONCILE_MISMATCH` audit, attempt (1316-1333)
  - `failed` → CAS `updateMany({status: PENDING} → FAILED)`, audit/metrics/emitter (1338-1365)
  - anything else (pending/processing/unknown) → kept + attempt (1367-1368)
- `resolveSucceededPayment` (1371-1438): order must exist (tenant-scoped, 1374-1383) else errored;
  credits through the **existing safe finalizer** `finalizeSucceededPayment` inside a `$transaction`
  (1386-1399). `PaymentAlreadyFinalizedError`→kept, `Conflict/NotFound`→kept, else rethrow (1400-1417).

## 18. P1-02 gateway behavior

- Provider conventions verified in-provider: Stripe `getPaymentStatus` returns `amount: intent.amount`
  (cents); Paymob returns `(tx.amount_cents ?? 0)/100` (major units) (stripe.provider.ts:301-332,
  paymob.provider.ts:361-397). `gatewayAmountCents` (1445-1450) normalizes accordingly — Stripe=cents,
  Paymob×100 — and `expectedCents = round(payment.amount*100)` matches the codebase's major-unit storage.
- amount mismatch can **never** credit (guard before finalize); network/timeout/unknown can **never**
  auto-FAIL (only explicit `failed` status does); failures follow existing failure semantics
  (updateMany PENDING→FAILED, metrics, `payments.failed` event) matching `applyWebhookFailed`.
- Verified by the ordering test: provider status is fetched before the finalizer transaction.

## 19. P1-02 concurrency / idempotency

- Claim safety: credit uses `finalizeSucceededPayment`'s `updateMany({ id, status: PENDING })` claim +
  order version-CAS inside one transaction; the second racer (webhook or reconcile) sees count 0 →
  `PaymentAlreadyFinalizedError` → reconcile returns `kept` without double-credit or double-order-bump.
- Webhook + reconcile race: both funnel through the same claim; harmless.
- Already-finalized candidates: re-discovery only picks PENDING rows; a COMPLETED row is never re-touched.
- Tenant isolation: candidates carry their own tenantId; order lookup is `{ id, tenantId }`-scoped; the
  finalizer re-scopes on tenantId. Between-candidates isolation test present.
- Idempotent no-op: `recordReconcileAttempt` merges into gatewayData (conflict-free read-merge).

## 20. P1-02 scheduler reachability (not dead code)

- `SchedulerModule` imported in `app.module.ts:199`; `QueueModule` at :198 — production bootstrap wires
  both.
- Cron: `@Cron('*/15 * * * *', { name: 'reconcile_pending_payments' })`
  (scheduler.service.ts:121-129) → `runLocked('reconcile_pending_payments')` →
  `queueService.addJob('cleanup', 'cleanup', { payload: { type: 'reconcile_pending_payments' } })`; entry
  added to `getRegisteredJobs` (:154-157).
- Worker: `CleanupProcessor.onModuleInit` registers the `cleanup` worker (cleanup.processor.ts:21-23);
  case `reconcile_pending_payments` (168-190) calls `paymentsService.reconcilePendingPayments` with
  `PAYMENT_RECONCILE_MAX` (50) / `PAYMENT_RECONCILE_STALE_AFTER_MS` (15 min) config overrides.
- DI: `CleanupProcessor` injects `PaymentsService` (cleanup.processor.ts:18); `QueueModule` imports
  `PaymentsModule` (queue.module.ts:11,15); `PaymentsModule` imports only AuditLogsModule + CommonModule
  (leaves) — **no module cycle**; `queue-module.di.spec.ts` compiles the real graph in tests.

## 21. P1-02 tests

- `reconcile-pending.spec.ts`: 13 tests — discovery bounds, providerless untouched, mock-mode untouched,
  success credit, gateway-before-transaction ordering, mismatch (no-credit + audit + attempt), paymob
  major-unit normalization, already-finalized no-double-credit, missing order, gateway-failed→FAILED,
  processing→kept, network/timeout→kept (never auto-fail), thrown-provider→kept. **13 calls to
  reconcilePendingPayments enumerated** — matches report.
- `cleanup.processor.spec.ts`: +2 reconcile tests (delegation with defaults; configured bounds).
- Full module run (`scheduler|payments|queues`) green; full suite green (section 28).

## 22. P1-01 source audit

- `deductInventoryForOrder` (recipes.service.ts:528): tenant-scoped order fetch; blocks DRAFT/CANCELLED/
  REFUNDED/VOIDED; in-transaction `FOR UPDATE` row lock on the order (631-636) + in-tx idempotency check
  (638-650); per-item ingredient row-lock (656-661); `actualDeduction` (partial-aware) computed at 671-673.
- ConsumptionRecord created immediately after the mirroring stock movement, inside the same
  `$transaction` (707-719): `inventoryItemId`, `tenantId`, `date: new Date()`, `quantity: actualDeduction`,
  `unitCost`, `totalCost`, `period: DAILY`, `source: 'ORDER'`, `referenceId: orderId`.
- **Single production writer** — repo-wide grep of `consumptionRecord.(create|createMany|update|updateMany|
delete|deleteMany|upsert)` returns only `recipes.service.ts:707`. All other references are readers/tests.
- Quantity correctness: partial shortfall records `actualDeduction` (1, not 2) — matches movement quantity
  magnitude (movement uses `-actualDeduction`; record uses `actualDeduction` — sign convention verified
  consistent with readers, section 24).
- Tenant isolation: `tenantId` flows from the tenant-scoped order; locks and lookup are tenant-scoped;
  test asserts per-tenant separation for the same order id.

## 23. P1-01 transaction / rollback

- Atomicity: record lives inside the deduction `$transaction`; any failure rolls back the movement, the
  record, and the inventory decrement together. No out-of-transaction record write exists.
- Idempotency: pre-tx and in-tx idempotency checks mean a re-entrant/duplicate `deductInventoryForOrder`
  never writes a second record; `deductInventoryForOrder` also returns the idempotent report without any
  transaction on the no-op path (test at 495-501).
- Cancel/refund behavior (verified against existing semantics): `RollbackDeduction` is the pre-existing
  reversal (section 25); it currently reverses the inventory movement but has **no consumption-record
  counterpart** — the object of the P1-01 blocker.

## 24. P1-01 reader compatibility

- Readers sum positive `totalCost` (COGS) and group/count by quantity/date/period: inventory-analytics
  `aggregate _sum totalCost` (:76-79) and `groupBy` (:191, :387, :476); financial-analytics COGS (:60, :247);
  dashboard (:105-110); forecasting (:42-49).
- The created record's positive `quantity`/`totalCost`, `date` (now), `createdAt` (default now), and
  `period: DAILY` satisfy these queries. No reader requires a branchId (unavailable on the model — comment
  at inventory-analytics.service.ts:74 documents it).
- **None of the readers filter `deletedAt`** (verified in getTurnover and forecasting) — material to the
  reversal decision (section 25).
- Other flows that plausibly consume inventory (waste entries, adjustments, transfers, manual decrements)
  do not create ConsumptionRecords — consistent with the explicit P1 scope ("sourced from actual
  fulfilling orders"); noted as a design scope, not a defect.

## 25. Refund-reversal business decision

**Critical verification (the report under-described this):** `recipesService.rollbackDeduction`
**exists and is pre-existing** (recipes.service.ts:764-832) and is **wired** to the `order.cancelled`
and `order.refunded` events (recipes.processor.ts:56-66, 68-78), which fire from `changeStatus`
transitions to REFUNDED/CANCELLED (orders.service.ts emits `order.${status}`).

`rollbackDeduction` behavior:

- finds the order's CONSUMPTION movements excluding ones already marked `ROLLED_BACK` (768-777);
- increments inventory back (788-794);
- **creates an offsetting ADJUSTMENT stock movement** with `referenceType: 'ROLLBACK'`,
  referenceId=orderId, positive quantity, notes referencing the original movement id and `ROLLED_BACK`
  (796-810) — i.e., **model C (offset/reversal record) is the codebase's established reversal pattern**;
- audit-logs `DEDUCTION_ROLLED_BACK` (816-823).

Gap confirmed: **no ConsumptionRecord reversal exists anywhere.** After a refund/cancel, the P1-01
record persists and COGS/forecast readers (which do not filter `deletedAt`) overstate consumption.

Decision determination per mandate:

- A. hard-delete — no code or doc establishes it for consumption records. Contradicts the audit-preserving
  offset pattern used for stock.
- B. soft-delete — schema has `deletedAt` (added pre-P1) but **every reader ignores it**; a soft-delete
  without touching readers would silently retain overstated COGS — not an established rule.
- C. offset/reversal record — **the only precedent explicitly established by existing source**: the
  ROLLBACK ADJUSTMENT movement pattern. Extending it to ConsumptionRecord (a reversal record referencing
  referenceId/order + ROLLED_BACK-style marker) is the evidence-consistent option, but is an inference,
  not an explicit rule.
- D. other — none found.

**Classified: BLOCKED_BUSINESS_DECISION.** "Refund-reversal semantics are not authorized by existing
evidence; implementation must stop until an owner decision is supplied." The recommendation implicit in
existing code is C (offset/reversal record), mirroring `rollbackDeduction` — the owner must confirm
before any change. P1-01 creation itself is unaffected by this decision.

## 26. Database / migration verification (independent, read-only)

- Schema: `RefreshToken` (schema.prisma:287-305) and `ConsumptionRecord` (3575-3599) models present,
  including `deletedAt`, indexes, `@@map` names. No P1-era schema edits.
- Migrations: directory contains **24 migrations, none newer than `20260811120000_add_grn_batch_attribution`**;
  `consumption_records` table created in `20260729181244_phase5_m2_warehouse` (pre-existing, migration.sql:182).
  **No migration was created by the P1 work.**
- `prisma validate`: schema valid. `prisma migrate status`: "Database schema is up to date!" (24 migrations).
- `prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma`:
  **No difference detected** — prisma's required global URL env was set transiently for these reads.
- Read-only row counts (Prisma Client, `where`-unconstrained `count()`): `refreshToken 0, order 0, payment 0,
consumptionRecord 0`. **No refresh-token backfill is needed** (table empty) and no consumption backfill.
- No destructive operations executed (no reset/truncate/delete/recreate).

## 27. Security verification

- Tenant isolation: all P1 paths are tenant-scoped by construction (orders gate, payment finalizers,
  reconcile order lookup, consumption record, refresh-token logout ownership). Cross-tenant tests exist
  for orders (974) and per-tenant consumption (467-493).
- Authorization: no new endpoints; existing Roles metadata intact (RBAC coverage tripwire test passes).
- Payment integrity: single credit path; mismatch never credits; reconcile meets the 'succeeded-with-proof'
  rule.
- Token confidentiality: digest at rest (section 15).
- Idempotency/CAS: payment claim + order version-CAS on every credit site and on changeStatus; deduction
  idempotency.
- Transaction boundaries: gateway calls outside DB transactions; DB writes inside serializable-CAS
  transactions.
- Retry safety: reconcile attempts tracked in gatewayData; race losers are harmless `kept`s.
- Replay safety: rotated-token reuse detected + all-sessions revocation.
- Secret hygiene: no new secrets; no key material in code; provider secrets remain env/config-injected
  (Paymob/Stripe values never logged).
- Logger redaction: no raw token or full gateway payload logged; reconcile logs only ids + normalized
  messages.

## 28. Regression verification (fresh runs during this audit)

| Gate                                             | Result                                                        |
| ------------------------------------------------ | ------------------------------------------------------------- |
| Full Jest (`npx jest --config jest.config.ts`)   | **98 suites / 1262 tests passed, 0 failures** (20.0 s)        |
| `npx tsc --noEmit -p apps/api/tsconfig.app.json` | clean (exit 0)                                                |
| `npx eslint . --ext .ts`                         | clean (exit 0)                                                |
| `npx nx build api`                               | webpack compiled successfully (hash a443098750f48174, exit 0) |
| `prisma validate`                                | valid                                                         |
| `prisma migrate status`                          | up to date (24)                                               |
| schema↔DB diff                                  | no difference                                                 |

- Baseline test count vs now: current suite = 98/1262. The P1-04/P1-03/P1-02/P1-01 added tests total
  ~32 new test cases (8 P1-03 it.each-expanded, 4 P1-04, 13 reconcile, 2 cleanup.processor, 5 P1-01);
  several P1-02/03 tests also slim prior coverage. Report claim matches.
- Failures: none observed in this run or the prior full run; no pre-existing failures or flaky tests
  observed (two sequential full-suite passes).

## 29. Runtime / deployment verification (read-only, no change)

- Running: `tablofy-api` (image `docker-api:latest`, ID `dbcfdfa8cb1f`, built **2026-08-28 01:15:30
  +0300**, up ~1 h, healthy), `tablofy-postgres` (postgres:16-alpine, 127.0.0.1:5432),
  `tablofy-redis` (redis:7-alpine, 127.0.0.1:6379).
- Image mechanics: Dockerfile multi-stage builds a self-contained bundle (`COPY --from=builder
/app/dist/apps/api ./app`; no source bind-mount); `CMD` = `prisma migrate deploy && node app/main.js`
  (docker/Dockerfile:46-75).
- Source edit times: orders.service.ts 01:59:59, auth.service.ts 02:04:30, cleanup.processor.ts 02:15:11,
  recipes.service.ts 02:20:26, scheduler.service.ts 02:23:08, payments.service.ts 02:23:34,
  reconcile-pending.spec.ts 02:23:34 — **all after the image build (01:15:30)**.
- Running-bundle grep (`docker exec tablofy-api grep`): `reconcile_pending_payments`=0,
  `cannot be completed until fully paid`=0, `reconcilePendingPayments`=0 → **running bundle contains
  NONE of P1-01/P1-02/P1-03/P1-04.**
- Local build (this audit, dist/apps/api/main.js): `reconcile_pending_payments` present,
  `reconcilePendingPayments` present, `cannot be completed until fully paid` present → local source
  bundle **contains all P1 changes**.
- **IMPLEMENTED IN SOURCE ≠ DEPLOYED.** The container was not modified.

## 30. Master status matrix

| Item                  | Status                        | Independently Verified               | Tested                            | Runtime Verified           | Deployed |
| --------------------- | ----------------------------- | ------------------------------------ | --------------------------------- | -------------------------- | -------- |
| P1-03                 | **CLOSED**                    | YES (source + bypass search)         | YES (8 new tests + full suite)    | Source-level only          | **NO**   |
| P1-04                 | **CLOSED**                    | YES (lifecycle + plaintext search)   | YES (4 new + updated integration) | DB=0 rows; bundle predates | **NO**   |
| P1-02                 | **CLOSED**                    | YES (engine + wiring reachability)   | YES (13 + 2 tests)                | Bundle predates            | **NO**   |
| P1-01 creation        | **CLOSED**                    | YES (single writer + tx + readers)   | YES (5 new tests)                 | DB=0 rows; bundle predates | **NO**   |
| P1-01 refund reversal | **BLOCKED_BUSINESS_DECISION** | YES (gap found; precedent = model C) | NO (no tests exist)               | Bundle predates            | **NO**   |

## 31. Remaining blockers

1. **P1-01 refund-reversal semantics** — owner decision required. Existing code establishes the
   offset/reversal model (C) for stock (`rollbackDeduction`, ADJUSTMENT + ROLLBACK reference +
   ROLLED_BACK marker); consumption records would need the analogous reversal record (or an equally
   justified alternative) plus a decision on whether readers remain `deletedAt`-ignorant. Until decided,
   refunds/cancels leave ConsumptionRecords that overstate COGS/forecasts.
2. **Deployment** — the running container is on a pre-P1 bundle. Deploy is outside this audit.
3. Documentation nit (non-blocking): implementation report section 6 says `PATCH orders/:id/status`;
   the controller uses `@Post(':id/status')`.

## 32. Final decision

**CONDITIONAL GO** (source level; deploy separately gated).

- The three required independent verifications hold: P1-03, P1-04, P1-02 CLOSED from raw source/tests.
- P1-01 creation is CLOSED and safe; only **P1-01 refund-reversal** remains unresolved, and it is
  explicitly isolated: it affects consumption/COGS analytics on the refund/cancellation path only and
  does not touch the deduction-creation transaction, payments, or tokens.
- Conditions attached to the GO:
  1. An owner decides P1-01 refund-reversal model (evidence points to C = offset/reversal record,
     mirroring `rollbackDeduction`) and authorizes its implementation + tests.
  2. The report documentation nits (route verb, rollbackDeduction existence) are corrected.
  3. **No GO applies to production yet**: the running `tablofy-api` bundle contains none of the P1
     changes. Any deployment decision must be made separately after the source remediation is accepted.

Do not implement, commit, push, or deploy on the strength of this audit alone. Await explicit authorization.
