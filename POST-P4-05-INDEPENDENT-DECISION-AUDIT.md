# POST-P4-05 INDEPENDENT DECISION AUDIT

Independent, read-only audit of the P4-05 Scheduled Reports work package.
Audited against the authoritative scope doc `P4-05-SCOPE-AND-IMPLEMENTATION-PREFLIGHT-AUDIT.md`
(sibling repo `D:\New folder (8)\tablofy`) and the current working tree.
No source, tests, Prisma schema/migrations, `.env`, or credentials were modified.
No deploy, rebuild, restart, commit, push, or DB mutation performed.

---

## 0. EXECUTIVE VERDICT

**NO-GO — BLOCKED by a confirmed runtime DI bootstrap defect (P1), plus NOT DEPLOYED visibility.**

- The P4-05 feature is substantially implemented, unit-tested, and lint/type/build-clean.
- However, the working tree introduces a **guaranteed application bootstrap failure**:
  `CleanupProcessor` now injects `ExportStorageService`, but that provider is **not exported**
  from `ExportEngineModule` and is not global. Nest throws
  `Nest can't resolve dependencies of the CleanupProcessor (... ExportStorageService at index [3])`.
  This was **empirically reproduced** with a read-only Jest/Nest harness compiling the real
  module graph (3/3 tests fail, including an exact-wiring reproduction of `AppModule`).
- Because no test bootstraps `AppModule`, the entire 1227-test green suite cannot detect this.
- P4-05 is **NOT deployed**: HEAD is pre-Phase-3 and all P4-05 files are uncommitted/modified in
  the working tree; Docker daemon is down, no running containers found, so no runtime proof exists.
- Email delivery (SMTP) has no credentials/live environment → **BLOCKED_EXTERNAL, code only**.

---

## 1. BASELINE

- Working tree: `D:\New folder (8)\tablofy-p4-01-clean` (git repo, detached HEAD).
- Sibling/original repo (authoritative docs, `.env`, prior reports): `D:\New folder (8)\tablofy`.
- Model: monorepo (Nx), `apps/api`, root `prisma/`, `docker/`.

## 2. GIT STATE

- HEAD: `16d70e546d28252babf3e830d85015c55bcb6e00` — "chore(backend): finalize pre-phase-3 hardening".
- Working tree has ~849 modified/untracked entries. ALL Phase-4 work (P4-01/P4-03/P4-05) is
  **UNCOMMITTED**. Last commit predates Phase-4.
- P4-05 files: `scheduled-reports.*` modified, `scheduled-reports.cron.ts` untracked (new),
  `scheduled-reports.processor.ts` deleted (phantom worker removed), `tests/` untracked.
- `docker/Dockerfile`, `docker/docker-compose.prod.yml`, `.env.example`, `package.json`,
  `apps/api/src/config/env.validation.ts` all modified (P4-05-related).
- Deployment provenance against the deployed P4-03 bundle (`85B84609...`, 2,594,086 B) is a
  **different, earlier artifact** — the working tree bundle is now 2,603,032 B
  (SHA-256 `4CD580DC...`, built 2026-08-13 23:04 UTC). The deployed report hash does NOT match
  the current working tree (expected, because P4-05 changes are uncommitted). NOT a drift of the
  deployed bundle; it means P4-05 is simply absent from the deployed artifact.

## 3. AUTHORITY SOURCE

- `D:\New folder (8)\tablofy\P4-05-SCOPE-AND-IMPLEMENTATION-PREFLIGHT-AUDIT.md` (exists in sibling; NOT in worktree).
- `P4-05-SCHEDULED-REPORTS-IMPLEMENTATION-AND-DEPLOYMENT-REPORT.md` — **NOT FOUND anywhere**;
  implementation claims therefore audited from source only.
- References: `PHASE-4-SCOPE-AND-IMPLEMENTATION-PREFLIGHT-AUDIT.md` §24 (P4-05), §25 (deps),
  §26 (order), §28/§19 (resolved decisions).
- Scope preconditions per doc:
  - Explicit operator authorization to begin P4-05 — **NO authorization record found** (OPEN).
  - Durability decision for `/app/exports` — addressed: `exports_data` named volume
    (`docker-compose.prod.yml:127` declared `:147`); P4-05 preflight had noted
    "durability NOT decided" — now decided via volume. CLOSED.
  - Timezone semantics — **NOT addressed**. `isDue()` evaluates `CronTime.getNextDateFrom(...)` in
    server-local time (`scheduled-reports.service.ts:291`). No timezone field on the model, no
    `timeZone` option anywhere. Only the local-timezone serialization in the audit JSON is
    automatic. Record as **micro-decision gap** (operator should confirm intended TZ semantics).

## 4. REQUIREMENT-BY-REQUIREMENT CLASSIFICATION

Contract targets from the scope doc §24 (reconciled to source):

| Requirement                                      | Status                                  | Evidence                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron-driven scheduled report trigger             | CLOSED                                  | `scheduled-reports.cron.ts:17` `@Cron('* * * * *', { name: 'process_due_scheduled_reports' })`; lock `cron:process_due_scheduled_reports` TTL 60s (`:19-21`).                                                                                                                   |
| Scan all due reports globally                    | CLOSED                                  | `runDueReports()` `findMany({ where: { isActive: true, deletedAt: null } })` (`scheduled-reports.service.ts:200-203`); per-report `isDue()` uses `CronTime.getNextDateFrom(lastRunAt ?? epoch)` (`:289-297`).                                                                   |
| Sequential, isolated triggers                    | CLOSED                                  | `for...of` sequential loop; per-report try/catch prevents one failing report blocking others (`:209-224`).                                                                                                                                                                      |
| Create a PENDING ReportExport per trigger        | CLOSED                                  | `trigger()` creates `reportExport` with `status: 'PENDING'` (`:166-174`).                                                                                                                                                                                                       |
| Enqueue export job                               | CLOSED                                  | `queueService.addJob('export-engine', 'generate-export', { ..., payload: { exportId, scheduledReportId } })` (`:176-180`).                                                                                                                                                      |
| Reuse existing export pipeline (no new worker)   | CLOSED                                  | Job consumed by existing `ExportEngineProcessor` (`export-engine.processor.ts:14`), `processExport()` (`export-engine.service.ts:63-137`).                                                                                                                                      |
| COMPLETED only after real file write             | CLOSED                                  | `writeExport` then `status: 'COMPLETED'` + `filePath/fileSize/completedAt` (`:104-114`).                                                                                                                                                                                        |
| Emit completion event only for scheduled exports | CLOSED                                  | `eventEmitter.emit('report-export.completed', {...})` guarded by `if (scheduledReportId)` (`:116-127`).                                                                                                                                                                         |
| Email delivery with attachment                   | CLOSED (code) / BLOCKED_EXTERNAL (live) | `handleReportExportCompleted` `@OnEvent('report-export.completed')` (`:232-287`); validates report exists+active+tenant, builds attachment from `EXPORT_EXTENSIONS`/`EXPORT_MIME_TYPES`, queues `email` job with `path: event.absolutePath`. Live SMTP unproven (no creds/env). |
| Deliver / downloadable file                      | CLOSED                                  | Files at `EXPORT_DIR` (`/app/exports` in container), download endpoint `export-engine/.../download` (`export-engine.controller.ts:31-34`) with tenant-scoped lookup + traversal validation (`export-storage.service.ts`).                                                       |
| Update lastRunAt                                 | CLOSED                                  | `trigger()` sets `lastRunAt: new Date()` after enqueue (`:182-185`).                                                                                                                                                                                                            |
| Zero schema/migration                            | CLOSED                                  | No Prisma migration added; `report_export`/`scheduled_report` models pre-exist; `prisma validate` passes; 24 migrations unchanged.                                                                                                                                              |
| Retention / cleanup of old report exports        | CLOSED                                  | `expired_report_exports` case in `cleanup.processor.ts:100-137`; retention default 30 (`REPORT_EXPORT_RETENTION_DAYS`, `env.validation.ts:82`; compose default `:78`); file deleted FIRST then row; ENOENT tolerated; failure keeps row (convergent/idempotent).                |
| No phantom worker                                | CLOSED                                  | `scheduled-reports.processor.ts` deleted; no module reference; no `scheduled-reports` in `QUEUE_JOB_OPTIONS`; bull-health spec asserts 20 queues and `not.toContain('scheduled-reports')`.                                                                                      |
| Cron validation in DTO                           | CLOSED                                  | `IsCronExpression` custom validator via `CronTime.validateCronExpression` (`create-scheduled-report.dto.ts:15-33, 59-61`).                                                                                                                                                      |
| Email validation in DTO                          | CLOSED                                  | `@IsArray @ArrayNotEmpty @IsEmail({}, { each: true })` (`:63-66`). Update DTO inherits via `PartialType` (`update-scheduled-report.dto.ts:1`).                                                                                                                                  |
| Audit logging                                    | CLOSED (minor defect, see §10)          | create/update/remove/trigger/email-queued actions logged.                                                                                                                                                                                                                       |
| ScheduledReportsModule wiring                    | CLOSED                                  | `scheduled-reports.module.ts:8-13` imports AuditLogsModule + CommonModule; exposes service. `AppModule` imports the module (`app.module.ts:72`).                                                                                                                                |
| /app/exports durability in compose               | CLOSED                                  | `exports_data:/app/exports` volume; `EXPORT_DIR` default `/app/exports` (`docker-compose.prod.yml:77,127,147`). Dockerfile ensures mkdir+owner (`Dockerfile:62-63`), non-root `USER nestjs` (`:65`).                                                                            |
| Dependency pinned                                | CLOSED                                  | `package.json:81` `"cron": "4.4.0"` added as direct dep; used by DTO validator + service `CronTime`.                                                                                                                                                                            |

## 5. FILE INVENTORY (P4-05, by content inspection)

- `apps/api/src/modules/scheduled-reports/{scheduled-reports.module.ts, controller.ts, service.ts, cron.ts}` (cron new/untracked).
- `apps/api/src/modules/scheduled-reports/dto/{create,update,scheduled-report-query}.dto.ts` (modified).
- `apps/api/src/modules/scheduled-reports/tests/` (new).
- Deleted: `apps/api/src/modules/scheduled-reports/scheduled-reports.processor.ts`.
- Modified (P4-05-related): `export-engine/{export-engine.module.ts, export-engine.service.ts, export-storage.service.ts}`, `queues/{queue.module.ts, cleanup.processor.ts}`, `scheduler/scheduler.service.ts`, `config/env.validation.ts`, `docker/Dockerfile`, `docker/docker-compose.prod.yml`, `.env.example`, `package.json`.

## 6. SOURCE VERIFICATION (file:line)

All checks done directly against files; line numbers above. Highlights:

- Phantom worker fully removed; queue count in bull-health spec = 20; no `scheduled-reports` queue.
- `isDue()` uses `CronTime` from `cron@4.4.0` (`scheduled-reports.service.ts:8` import; `:291` usage).
- Event handler re-validates tenant + active on the event path (`:238-243`) — tenant isolation holds for email/audit.
- Email attachments reference `event.absolutePath`; `email.processor.ts` `readAttachment` enforces containment/resolve and non-empty file — safe.
- Retention cleanup: file-first, row-second, ENOENT-as-success, per-record continue on file error → no dangling COMPLETED rows while files remain. Convergent under retries.

## 7. CRITICAL FINDING — CONFIRMED RUNTIME DI BOOTSTRAP FAILURE (P1)

**Observation (git diff):** this working tree added

- `CleanupProcessor` constructor param `private readonly exportStorageService: ExportStorageService`
  (`queues/cleanup.processor.ts:16`), and
- `QueueModule` `imports: [ExportEngineModule]` (`queues/queue.module.ts:14`).

**Module graph:** `ExportEngineModule` declares `ExportStorageService` as a provider
(`export-engine.module.ts:12`) but **exports only `[ExportEngineService]`** (`:13`). It is not
`@Global`. Nothing else provides or re-exports `ExportStorageService`
(grep across all `*.module.ts` → single occurrence within `export-engine.module.ts`).

**Consequence:** Nest cannot resolve `ExportStorageService` for `CleanupProcessor` inside
`QueueModule`’s scope → bootstrap throws
`Nest can't resolve dependencies of the CleanupProcessor (QueueService, PrismaService, ConfigService, ?)… ExportStorageService at index [3]`.

**Empirical proof (read-only harness in OS temp, NOT added to repo):**
`Test.createTestingModule({ imports: [GlobalsModule, QueueModule] })` and
`{ imports: [GlobalsModule, ExportEngineModule, QueueModule] }` (exact AppModule wiring)
both fail to compile with the exact error above, **3/3 tests fail**. The unit specs cannot catch it
because they mock `ExportStorageService` directly; the full-suite 96/1227 pass does not bootstrap
`AppModule`.

**Why tests missed it:** no test imports `AppModule` (grep across `*.spec.ts` in `apps/api/src` → 0 matches).

**Fix (NOT applied — audit is read-only):** add `ExportStorageService` to
`ExportEngineModule.exports` (i.e., `exports: [ExportEngineService, ExportStorageService]`).
One-line, but requires a rebuild + full-gate rerun + redeploy; **out of scope for this audit**.

**Impact staging:** P0 if deployed as-is (API fails to start → total outage).
Because P4-05 is uncommitted and not deployed, current runtime is unaffected; classify as
**P1 blocker for P4-05 acceptance/deployment**.

## 8. TEST VERIFICATION (independently executed)

- Full suite: **96 suites / 1227 tests passed** (run fresh: `npx jest --config apps/api/jest.config.ts --runInBand`).
- Typecheck: `npx tsc --noEmit -p apps/api/tsconfig.app.json` **exit 0**.
- Lint: `npx eslint . --ext .ts` **exit 0**.
- P4-05-specific new tests reviewed: cron (lock wrap/skip-when-locked), DTO (valid/invalid cron,
  empty recipients), service (trigger lifecycle, runDueReports), email processor (attachment
  happy/missing/empty/containment/invalid path), cleanup (report exports retention ordering),
  export-engine (COMPLETED only after write; event only when scheduledReportId present),
  export-storage (write/delete/traversal).
- Coverage note: no test covers the full AppModule bootstrap (root cause of §7 escape).

## 9. RUNTIME PROVENANCE

- **P4-05: NOT DEPLOYED.** Docker engine present but daemon not running (Docker Desktop not
  installed at standard path; WSL distro stopped; `docker ps` fails to connect). No node/API
  process listening. Therefore no container, no live bundle, no runtime proof for P4-05.
- Working-tree bundle (if built) differs from deployed P4-03 bundle — see §2. The P4-03 report’s
  byte-identical claim refers to an **earlier** artifact (mo present).
- Deployment verification for P4-05 is **NOT_VERIFIED** (environment-blocked), independent of the
  DI blocker.

## 10. DISCOVERED DEFECTS & RESIDUAL RISKS

1. **[P1] DI bootstrap failure (§7)** — must fix before any deploy of this working tree.
2. **[P2] Idempotency gap**: `trigger()` creates `PENDING` row, enqueues the job, THEN updates
   `lastRunAt` (`scheduled-reports.service.ts:166-185`) — not atomic. If `addJob` succeeds but the
   subsequent `update` (or audit) fails, the next minute-scan re-triggers → duplicate export jobs.
   Mitigate with a unique per-run mark (e.g., dedupe key / transactional re-check before enqueue).
3. **[P3] No retention for stale PENDING/PROCESSING report exports**: retention query
   (`cleanup.processor.ts`) only removes `COMPLETED`; stuck PENDING rows survive forever.
4. **[P3] `recipients.join(', ')` single-envelope**: one message to all recipients (nodemailer
   `to` list), not per-recipient privacy; matches resolved design but note PII/leakage surface.
5. **[P3] Pre-existing audit-log `userId: tenantId` mislabel** in update/remove
   (`scheduled-reports.service.ts:127,152`) — copies P4-03-era pattern; low impact, pre-existing.
6. **[P3] Email job fire-and-forget**: if `handleReportExportCompleted` throws after event, error is
   logged but BullMQ email job is never queued; no retry mechanism for the enqueue itself.
7. **[micro] Timezone semantics not defined (§3)**.
8. **[micro] `email` queue attempts=5 / timeout=30s** (`queue.service.ts:38`): PDF/EXCEL attach may
   be large; verify timeout adequacy for max attachment sizes.

## 11. SECURITY REVIEW (P4-05 surface)

- Tenant scoping on creation/list/get/update/remove/trigger uses `user.tenantId!` +
  `findFirst({ where: { id, tenantId } })` — no cross-tenant read path found.
- Email recipients constrained to `@IsEmail`; no header injection vector found (nodemailer API).
- Attachment path flows from server-controlled `writeExport` output; download path guard = resolve +
  containment + must-exist (+ symlink handling: unlink removes link not target).
- Sanitized message/attachment naming; no user-supplied filename used verbatim beyond exportId (uuid).
- Redis lock names namespaced `cron:...`; TTL present; stale-lock risk minimal (60s for scan, 5min cleanup).

## 12. CONFIG / ENV REVIEW

- `env.validation.ts:82` `REPORT_EXPORT_RETENTION_DAYS` (Joi number, default 30) ✅
- `env.validation.ts:102` `EXPORT_DIR` (Joi string) ✅
- `.env.example` EXPORTS section documents both + SMTP comment mentions scheduled delivery ✅
- Compose prod: `EXPORT_DIR: ${EXPORT_DIR:-/app/exports}` (f:77), retention default 30 (f:78),
  `exports_data:/app/exports` (f:127, 147) ✅
- Dockerfile: `/app/exports` mkdir + `chown nestjs:nodejs` (f:62-63), `USER nestjs` (f:65) ✅
- Sibling `.env` present but unrelated to P4-05 vars; SMTP creds absent → email BLOCKED_EXTERNAL.

## 13. FAILURE / ROLLBACK REVIEW

- Undeployed and uncommitted → rollback = simply do not deploy; no prod impact today.
- If deployed after DI fix: BullMQ retries (export-engine attempts 2; email 5) then dead-letter;
  failed jobs captured; alert threshold on DLQ size. File+row ordering of cleanup is crash-safe.
- `lastRunAt` update failure duplicates exports (see §10.2) — no data loss, only duplicates.

## 14. CLAIM-BY-CLAIM RECONCILIATION (P4-05 implementation intents)

| Claim/intent                                               | Verdict                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| Scheduled reports are triggered by cron (not per-request)  | VERIFIED (cron file + lock)                              |
| Reports execute via existing export pipeline, no new queue | VERIFIED (export-engine job; no new queue)               |
| Phantom scheduled-reports queue/worker removed             | VERIFIED (deleted processor; 20 queues)                  |
| COMPLETED only after real file write                       | VERIFIED (write then update)                             |
| Email sent with the generated file attached                | PARTIAL — code path verified; live SMTP BLOCKED_EXTERNAL |
| 30-day retention clean-up of report exports                | VERIFIED (code) — retention logic + scheduler cron       |
| Zero DB migration for P4-05                                | VERIFIED (no new migration; schema valid)                |
| Tests/typecheck/lint green                                 | VERIFIED (96/1227, tsc 0, eslint 0)                      |
| Deployed and runtime-verified                              | NOT VERIFIED — not deployed; Docker down                 |
| App boots with the new wiring                              | **FALSE — confirmed DI bootstrap failure (§7)**          |

## 15. DEPLOYMENT STATUS

- P4-05: **NOT DEPLOYED / NOT VERIFIED**.
- Current runtime: no running containers/processes observed (Docker daemon down).
- Do NOT deploy the working tree until §7 is fixed.

## 16. CONDITIONS (BEFORE GO)

1. **Fix §7 (export `ExportStorageService` from `ExportEngineModule`)** and add an AppModule-bootstrap
   (or QueueModule+ExportEngineModule) test that compiles the real graph — prevents regression.
2. Operator authorization record for P4-05 (missing).
3. Timezone semantics decision + (optionally) a `timeZone` column or config.
4. Decide on idempotency fix (§10.2) and stale-PENDING cleanup (§10.3) for GO, or accept as documented
   P2/P3 backlog for a later patch.
5. Live SMTP verification (creds + a real send) to lift email to RUNTIME VERIFIED; otherwise the email
   requirement remains BLOCKED_EXTERNAL (acceptable if operator accepts partial-live status).

## 17. RECOMMENDATION FOR NEXT WORK PACKAGE

P4-05 is **NOT CLEARED** until §7 is fixed and the two conditions in §16.1/16.2 are met.
Guardrail for P4-06/Phase-5: **always include an AppModule-context integration test** in the gate;
branch of this audit: the "all tests green" signal is insufficient.

## 18. FINAL STOP STATEMENT

This is a **READ-ONLY** audit. No source, tests, Prisma files, `.env`, credentials, or running state
were modified; nothing was deployed, committed, pushed, or seeded. The only write performed is this
report (plus ephemeral audit harness files under the OS temp directory, outside the repo).
**AUDIT COMPLETE. NO-GO for P4-05 deployment until §7 is resolved. STOP.**
