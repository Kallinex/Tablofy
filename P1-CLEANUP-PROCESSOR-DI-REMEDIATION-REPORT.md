# P1 Remediation Report: CleanupProcessor -> ExportStorageService DI Bootstrap Failure

## 1. Report Title and ID

- **Title:** P1 - CleanupProcessor -> ExportStorageService NestJS DI Boot Fix
- **Report ID:** P1-CLEANUP-PROCESSOR-DI-REMEDIATION
- **Priority:** P1 (Production Blocking)
- **Backlog Reference:** B1 (BLOCKING) per `FINAL-COMPREHENSIVE-PROJECT-AUDIT.md`

## 2. Date and Author Context

- **Date:** 2026-08-28
- **Environment:** Windows 10/11 (win32), Worktree `D:\New folder (8)\tablofy-p4-01-clean`, detached HEAD `16d70e546d28252babf3e830d85015c55bcb6e00`

## 3. Summary

`CleanupProcessor` (in `QueueModule`) injects `ExportStorageService`, but `ExportEngineModule` never exported that provider. Nest therefore could not resolve the dependency at `index [3]` during application bootstrap, crashing `tablofy-api` startup. A minimal one-line exports change plus a regression test suite (testing the real Nest module graph with only connection-dependent infrastructure stubbed) restores normal application boot. All regression gates pass (full test suite, typecheck, lint, production build, Prisma schema validation, and a live runtime boot proof with healthy Postgres/Redis/BullMQ).

## 4. Root Cause Analysis

- **Faulting modules:** `apps/api/src/modules/queues/queue.module.ts` (imports `ExportEngineModule`) and `apps/api/src/modules/export-engine/export-engine.module.ts`.
- **Exact mechanism:** `CleanupProcessor`'s constructor declares `ExportStorageService` as its 4th dependency. `QueueModule` imports `ExportEngineModule`, which declared `ExportStorageService` in `providers` but omitted it from `exports`. Nest's module-scoped provider visibility rules make a non-exported provider invisible to any importing module, so Nest threw `Nest can't resolve dependencies of the CleanupProcessor (QueueService, PrismaService, ConfigService, ?). Please make sure that the argument ExportStorageService at index [3] is available in the QueueModule module.` This threw during DI graph instantiation, aborting `app.init()`.
- **Why this was not caught by CI:** No test suite boots `AppModule` (or the derived module graph); the failed-to-compile module graph was never exercised at test time. Nothing in CI compiled the real Nest graph that reproduces the dependency resolution.

## 5. Affected Components

- `apps/api/src/modules/export-engine/export-engine.module.ts` (the only production code changed)
- `CleanupProcessor` (`apps/api/src/modules/queues/cleanup.processor.ts`)
- `ExportStorageService` (`apps/api/src/modules/export-engine/export-storage.service.ts`)
- Application bootstrap (`apps/api/src/main.ts`; `NestFactory.create` / `app.init()`)

## 6. Authorized Scope

Strict scope (as governed by the mission):

- ALLOWED: fix `export-engine.module.ts`; minimum test file(s) exercising real Nest DI; test config only if strictly required.
- NOT ALLOWED: payment logic, Stripe/Paymob/SMTP, Redis internals, DB schema, migrations, `.env`, Docker config, unrelated tests, commit/push/deploy/PR.

## 7. Changes Applied (Exact Diff)

Single production change - added the existing provider to `exports` in `apps/api/src/modules/export-engine/export-engine.module.ts`:

```diff
-  exports: [ExportEngineService],
+  exports: [ExportEngineService, ExportStorageService],
```

(The `providers` entry for `ExportStorageService` was already present in the pre-existing uncommitted worktree; the missing piece was its export visibility.)

## 8. Regression Test Added

- **File:** `apps/api/src/modules/queues/tests/queue-module.di.spec.ts` (new, repo-owned)
- **Design:**
  - Compiles the REAL `QueueModule` + `ExportEngineModule` graph exactly as `AppModule` wires it (`QueueModule` is `@Global` and imports `ExportEngineModule`).
  - A `@Global()` test-only `InfraTestModule` stubs ONLY connection-dependent infrastructure tokens: `ConfigService`, `PrismaService`, `RedisService`, `MetricsService` (via `createMockMetrics()`), `EventEmitter2`.
  - The dependency under test (`CleanupProcessor` -> `ExportStorageService`) is 100% real and resolved by Nest through the module graph. If the export is removed again, `compile()` throws the exact P1 error and the suite fails.
- **Tests (2):**
  1. `resolves CleanupProcessor with the real ExportStorageService instance exported by ExportEngineModule` - verifies instance identity between `CleanupProcessor`'s injected `exportStorageService` and the module-provided `ExportStorageService`.
  2. `exposes ExportStorageService and QueueService through the real module graph` - verifies providers are resolvable (`QueueService`, `ExportEngineService`, `ExportStorageService`).
- **Verified behavior:** PASS (2/2) with the fix applied; FAILS without the fix with the exact P1 error. No coverage regression introduced.

## 9. Reproduction Evidence (Pre-Fix)

Reproduced before applying the fix using a temporary isolated harness (deleted after use) as well as the committed regression test pointing at the un-exported state. Failure message in all cases:

```
Nest can't resolve dependencies of the CleanupProcessor (QueueService, PrismaService, ConfigService, ?).
Please make sure that the argument ExportStorageService at index [3] is available in the QueueModule module.
```

## 10. Regression Gate: Full Test Suite

- Command: `npx jest --silent` (root) / `npx nx run-many -t test` (not required; full run used)
- Result: **PASS - 97 suites, 1229 tests** (baseline: 96 suites, 1227 tests -> +1 suite, +2 tests)
- Includes the new `queue-module.di.spec.ts` suite: **PASS (2/2)**

## 11. Regression Gate: TypeScript Compile

- Command: `npx tsc --noEmit -p apps/api/tsconfig.app.json`
- Result: **exit 0**, no errors.

## 12. Regression Gate: Lint (ESLint)

- New spec file initially raised 3 Prettier formatting findings; fixed via `npx eslint ... --fix` (formatting only).
- Full repo: `npx eslint . --ext .ts` -> **exit 0**, no findings.

## 13. Regression Gate: Production Build

- Command: `npx nx build api --skip-nx-cache`
- Result: **SUCCESS** (webpack compiled, ~17.4s). Note: a first build attempt was interrupted by a tool-runner kill; the retry completed successfully.

## 14. Regression Gate: Prisma Schema

- `npx prisma validate --schema prisma/schema.prisma`: **valid** (datasource "db", PostgreSQL).
- `npx prisma migrate status --schema prisma/schema.prisma` (against reachable dev DB): **up to date** - 24 migrations found; database schema up to date.
- `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` (read-only): **generates SQL successfully** (schema internally consistent).
- No schema or migration files were changed.

## 15. Runtime Boot Proof (Live)

- Set up a safe local environment: started Docker Desktop (pre-existing daemon/wsl distros offline) which brought back pre-existing **dev-only** containers: `tablofy-postgres` (127.0.0.1:5432, db `tablofy_prod`), `tablofy-redis` (127.0.0.1:6379), and a stale 13-day-old `tablofy-api` container still on :3000 (NOT touched).
- Booted the NEW production build (`dist/apps/api/main.js`) as a standalone process on **port 3100** with dev-tier settings: `NODE_ENV=development`, `PAYMENTS_MODE=mock` (no real gateway/SMTP credentials, no shipping of anything, no DB writes beyond normal app reads).
- **Boot logs (trimmed evidence):**
  - `CleanupProcessor ... Cleanup processor registered`
  - `ExportStorageService ... Export storage root ready`
  - `QueueService ... Worker registered for queue "cleanup"`
  - `RedisService ... Redis connected successfully`
  - `PrismaService ... Database connected successfully`
  - `Bootstrap ... Application is running on: http://localhost:3100/api/v1`
  - No dependency-resolution errors observed.
- HTTP checks against the running new build:
  - `GET /api/v1/health` -> **200** `{"status":"ok"}` with `database: up`, `redis: up`, `bullmq: up`, `memory_rss: up`, `disk: up`.
  - `GET /api/v1/health/live` -> **200** `{"status":"ok"}` (`database: up`, `redis: up`).
- Process then shut down cleanly.

## 16. Environment / Toolchain Notes

- `bullmq` and `uuid` are module-mapped in `apps/api/jest.config.ts` to repo mocks; real modules compile without a live Redis at compile time.
- `ts-jest` emits a benign, pre-existing `isolatedModules` deprecation warning.
- New app behavior discovered (pre-existing, unrelated to this fix): with `NODE_ENV=production`, the app forbids `PAYMENTS_MODE=mock` and requires real gateway credentials; a live boot proof therefore used development mode + mock (the safe, minimal configuration).

## 17. Provenance / Repository State

- HEAD: `16d70e546d28252babf3e830d85015c55bcb6e00` (detached).
- Files changed by this remediation: exactly 2.
  - Modified: `apps/api/src/modules/export-engine/export-engine.module.ts`
  - Added (new): `apps/api/src/modules/queues/tests/queue-module.di.spec.ts`
- The repository working tree also contains ~850 pre-existing uncommitted entries from prior Phase-4 work; **none of them were touched or modified by this remediation.**

## 18. No Unrelated Changes

- No changes to payment logic, Redis internals, database schema, migrations, `.env`, Docker configuration, or any application source outside `export-engine.module.ts`.
- No temporary harness files remain in the repository (harness existed in system temp only and was deleted).

## 19. Risks and Residual Concerns

- The stale `tablofy-api` dev container on :3000 still runs the 13-day-old pre-fix image. It is dev-only; redeploying/recreating containers was outside scope.
- Runtime boot proof used development-mode mock payments; a production `NODE_ENV=production` boot was not exercised (requires unreachable real gateway credentials) and is already covered by unit/integration gates plus the new DI-graph test.
- No live SMTP/Stripe/Paymob credentials available; out of scope. Any such flows remain covered by existing tests and mocks.

## 20. Conclusion / Closure

- **P1 CLOSED (fix + regression gates + runtime boot proof).** The DI resolution failure is fixed by a minimal, provable change; the failure mode cannot silently return (locked by a real-graph regression test that fails with the exact P1 error if the export is removed).
- **DB/migrations: VERIFIED** (24 migrations applied, schema up to date, validates, no drift) against the local dev database.
- **Caveat:** a same-day production-environment boot (real gateways, `NODE_ENV=production`) was not performed; it is the only remaining runtime environment not directly exercised, and it is outside the authorized safe test path.

## 21. Required Follow-Ups (No Action Taken)

- No commit, push, deploy, image rebuild, container recreation, or PR performed (explicitly outside scope).
- Recommend rebuilding/redeploying `tablofy-api` with this fix in the normal deploy pipeline.

## 22. Rollback Plan

- Remove `ExportStorageService` from `ExportEngineModule.exports` (revert the single line in `apps/api/src/modules/export-engine/export-engine.module.ts`) and delete `apps/api/src/modules/queues/tests/queue-module.di.spec.ts`; the P1 error will resurface (regression suite confirms this).
- Note: rollback would reintroduce the production-blocking boot crash.

## 23. Verification Commands (for reproducibility)

```powershell
# Full test suite
npx jest --silent

# Typecheck (API app)
npx tsc --noEmit -p apps/api/tsconfig.app.json

# Lint full repo
npx eslint . --ext .ts

# Production build
npx nx build api --skip-nx-cache

# Prisma (schema validation + migrations status + read-only diff)
$env:DATABASE_URL='postgresql://tablofy:tablofy_prod@127.0.0.1:5432/tablofy_prod?schema=public'
npx prisma validate --schema prisma/schema.prisma
npx prisma migrate status --schema prisma/schema.prisma
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

## 24. Decisions and Justifications

- **Exported the provider instead of restructuring modules:** minimal, single-source-of-truth fix matching AppModule's intended contract (`ExportEngineModule` owns `ExportStorageService`).
- **Real-graph regression test instead of booting full `AppModule`:** `ConfigModule.forRoot` validation requires many env vars absent from the jest global test setup, which would fail the suite for unrelated reasons. Stubbing only connection-dependent infra while keeping the dependency-under-test real is the minimal configuration that reproduces the failure and locks the fix.
- **Boot proof in development + mock payments:** the safe (non-production-credential) runtime path that could actually boot; uses only the local dev Postgres/Redis and makes no schema or data changes.

## 25. Attestation

- The remediation was performed strictly within the authorized scope (fix + minimum test file + verification); no un-scoped changes were made.
- All verification steps above were executed in this session and their outputs observed.
- Final status: **P1-RESOLVED** (fix, regression coverage, and verification complete; no deploy performed).
