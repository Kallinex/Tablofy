# POST-P4-03 INDEPENDENT DECISION AUDIT

**Audited work package:** P4-03 — Export Engine: Real Local File Storage & Safe Download
**Baseline claim doc:** `P4-03-EXPORT-ENGINE-REAL-STORAGE-AND-DOWNLOAD-REPORT.md` (treated as UNVERIFIED evidence; all claims re-derived below from source, tests, git, Prisma, Docker, and the running container)
**Date:** 2026-08-14
**Method:** read-only inspection and live testing. No source modified. No schema/migrations modified. No .env/credentials modified. Nothing deployed, committed, or pushed. P4-04/P4-05 not started.

---

## 0. EXECUTIVE VERDICT

**Verdict: GO — P4-03 is safe to mark CLOSED.**

Every core P4-03 claim was independently re-verified from source and from the live deployment:
real files replace phantom metadata; download serves real bytes with correct headers; tenant isolation and traversal/absolute-path/identifier guards hold against live attacks (cross-tenant 404, traversal 400, absolute path 400, restored 200); COMPLETED cannot be set without a verified file; zero schema migration and zero live-DB drift; all gates green (92 suites / 1191 tests, tsc, ESLint, production build); the deployed bundle is byte-identical to the locally built artifact (`85B8460950…`, 2,594,086 B) and contains P4-03 while excluding Phase-3 content; only `tablofy-api` was recreated; live cleanup restored the zero-state `0|0|0`.

Residual, non-blocking items are documented (see §14 Residual Risks): (1) `/app/exports` is **not a Docker volume** — export files are lost if the container is recreated (the report itself classified this as an accepted limitation); (2) DB-update failure after a successful file write leaves an **orphan file** (no compensation/GC); (3) no `realpath` symlink check (not reachable under current non-root permissions); (4) the entire P4-x delta is **uncommitted** — provenance is reproducible from artifacts but not from git history alone.

**Next work package:** P4-05 is **NOT authorized by existing scope**. No document in the repository references P4-04 or P4-05. A separate decision/authorization is required before P4-05 begins.

---

## 1. BASELINE

- Report under audit: `D:\New folder (8)\tablofy-p4-01-clean\P4-03-EXPORT-ENGINE-REAL-STORAGE-AND-DOWNLOAD-REPORT.md` (exists, 2026-08-14 00:56, untracked).
- Worktree: `D:\New folder (8)\tablofy-p4-01-clean` (isolated worktree for P4-x work; original repo `D:\New folder (8)\tablofy` is intentionally untouched and holds the Phase-3 uncommitted changes).
- The audited report's core assertions were all re-checked from primary evidence; nothing was accepted on faith.

## 2. GIT STATE

- Branch: **detached HEAD** at `16d70e546d28252babf3e830d85015c55bcb6e00` — commit message "chore(backend): finalize pre-phase-3 hardening" (the P4-01 baseline commit).
- Working tree: ~800 files marked `M`. **Mostly line-ending noise**: `git diff -w` shows real content changes in only 10 files. Prisma schema + all 24 `migrations/*.sql` are whitespace-only diffs (LF→CRLF), i.e. **no migration content changes**.
- Real content changes in the worktree:
  - P4-03 attributable: `apps/api/src/config/env.validation.ts` (+4, `EXPORT_DIR`), `apps/api/src/modules/export-engine/export-engine.module.ts` (+2/-1), `apps/api/src/modules/export-engine/export-engine.service.ts` (+48/-17), `tests/export-engine.service.spec.ts` (+177/-3), plus **untracked** `export-storage.service.ts` and `tests/export-storage.service.spec.ts`. Docker: `docker/Dockerfile` (mkdir/chown `/app/exports`), `docker/docker-compose.prod.yml` (`EXPORT_DIR` env).
  - Pre-P4-03 (prior authorized P4-01/P4-02 hardening, uncommitted): `orders/orders.service.ts` (+9/-2), `usage/usage-tracking.service.ts` (+62/-12), and 3 small test-file edits.
- Untracked files: the P4-03 report, `export-storage.service.ts`, `export-storage.service.spec.ts`.
- **Provenance finding:** the P4-x delta (P4-01 + P4-02 + P4-03) has never been committed. "Exactly which files belong to P4-03" can only be isolated by content inspection (done above), not by git. The deployed bundle therefore contains the entire uncommitted P4-x delta. The report's "No commits/pushes" statement is consistent with this.

## 3. P4-03 FILE INVENTORY (by content inspection)

| File                                   | Status    | P4-03 content                                                                                |
| -------------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `export-storage.service.ts`            | NEW       | Storage service, atomic write/read, guards, `EXPORT_EXTENSIONS`/`EXPORT_MIME_TYPES`          |
| `export-engine.service.ts`             | MODIFIED  | Real-file `processExport`, `getExportFile`, `StreamableFile` download; phantom paths removed |
| `export-engine.module.ts`              | MODIFIED  | `ExportStorageService` provider added                                                        |
| `env.validation.ts`                    | MODIFIED  | Optional `EXPORT_DIR`                                                                        |
| `docker/Dockerfile`                    | MODIFIED  | `/app/exports` mkdir + chown `nestjs:nodejs`                                                 |
| `docker/docker-compose.prod.yml`       | MODIFIED  | `EXPORT_DIR: ${EXPORT_DIR:-/app/exports}`                                                    |
| `tests/export-storage.service.spec.ts` | NEW       | 9 tests                                                                                      |
| `tests/export-engine.service.spec.ts`  | REWRITTEN | 10 tests (was 3)                                                                             |

## 4. SOURCE VERIFICATION

Files re-read in full: `export-storage.service.ts` (159 lines), `export-engine.service.ts` (421 lines), controller, module, processor, both DTOs.

- **Where files are written:** `{EXPORT_DIR}/{tenantId}/{exportId}.{ext}`, `EXPORT_DIR` from config default `path.join(process.cwd(),'exports')` → `/app/exports` in container (`export-storage.service.ts:44-46`).
- **Really persisted:** yes — tmp `writeFile(flag:'wx')` → `rename` → `stat` verify (`isFile && size>0 && size===buffer.length`) before returning (`:73-79`). Live container confirmed the file on disk (26 bytes, owner `nestjs`).
- **COMPLETED without a real file:** impossible. The `COMPLETED` DB update occurs strictly after `writeExport` returns the stat-verified result (`export-engine.service.ts:104-114`). Any write/verify failure → catch → `FAILED` + rethrow (`:125-132`).
- **Path construction/normalization:** DB stores only the relative `{tenantId}/{exportId}.{ext}`; `absolutePath` is returned to the caller but never persisted. `exportId`/`tenantId` validated by regex `^[A-Za-z0-9_-]+$` (`:31,110-114`); `ext` comes from a server-side constant map (never user-controlled; any unsupported type throws before write).
- **Traversal/absolute protection:** `readExport` rejects absolute paths, `.`/`..`/empty segments, requires the `{tenantId}/` prefix, then enforces `path.resolve` containment under the root (`:91-138`). Double-separators normalize inward. The string `assertContained` check is correct (uses root+`path.sep`), so sibling-prefix attacks (`root2`) fail.
- **Symlink/path escape risk:** no `realpath` check. A planted symlink under the root could be followed on read. **Not reachable** in current deployment: container runs non-root `nestjs`, the root dir is app-owned (`755`, owner `nestjs:nodejs`), only the app writes there, and tmp writes use `flag:'wx'`. Residual/theoretical only.
- **Cleanup:** best-effort stale-tmp sweep scoped to the tenant dir and the exact `${exportId}.${ext}.tmp-` prefix (`:140-148`); cannot delete another tenant's export or the final file.
- **Failure:** write failure unlinks tmp and rethrows (`:85-88`); DB state set to FAILED.
- **Retry:** second write of the same exportId renames over the same final path (POSIX `rename` overwrite; Node Windows `MoveFileEx` also replaces) → no duplicate, no temp litter (unit tests + live double-generation assert this).
- **Partial-file:** impossible at the final path — only a completed file appears at `finalPath` after rename.
- **Atomicity of DB vs FS:** NOT transactional. File write and DB update are separate steps.
  - DB record → nonexistent file: possible only for legacy/phantom-era rows or manual DB edits; `readExport` returns 404 (graceful). No way to produce it through P4-03 code.
  - Orphan files after failure: write-failure → tmp cleaned. **DB-update failure after successful write → orphan final file remains** (no compensation/GC). Documented limitation (§14.2).

## 5. DOWNLOAD VERIFICATION

Route: `GET /api/v1/export-engine/exports/:id/download` (controller `:31-34`), tenant-scoped `findFirst({id, tenantId, deletedAt:null})`, `COMPLETED` gate, `readExport`, `StreamableFile` with `type` + `attachment; filename="{id}.{ext}"` (`export-engine.service.ts:176-203`). Independently tested live (19/19 PASS):

- Authorized tenant download: **200**, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="{id}.csv"`, exactly 26 bytes, body `Order ID,Status,Total,Date…`, no filesystem path in body.
- Cross-tenant: **404** (tenant B token for tenant A export → "Export not found").
- Nonexistent export: **404** (id `nonexistent-id`).
- Traversal (DB-forged `filePath='../outside.csv'`): **400** "Export file path is invalid".
- Absolute path (DB-forged `filePath='/etc/passwd'`): **400**.
- Encoded traversal: the URL path parameter is resolved as a UUID record id (`findFirst`), so `%2e%2e%2f…` in `:id` cannot match a record → 404 before any FS access; stored paths are never URL-decoded, so an encoded `..` is a literal segment and cannot escape. Verified by reasoning + live nonexistent-id 404.
- Arbitrary filesystem exposure: only `readExport` can read, and it is contained under the root (live `/etc/passwd` stored-path attempt rejected).
- Auth: **401** with no token and with a garbage token.
- No path leakage: response body, `GET` record JSON (`filePath` stays relative), and container logs (0 occurrences of `/app/exports`) are clean. The `getExportFile` fallback path (`export-engine.service.ts:187`) re-derives `{tenantId}/{exportId}.{ext}` from validated UUIDs only.

## 6. TENANT ISOLATION TRACE

`JWT (iss/aud/jti) → JwtStrategy → CurrentUser` → class guard `@Permissions('reports:read')` (+ `@Roles('OWNER','MANAGER')` on generate) → `user.tenantId!` (authoritative, from auth context) → service `findFirst({id, tenantId, deletedAt:null})` (DB-scoped) → `readExport(tenantId, storedPath)` which **requires the caller's `tenantId/` prefix** and containment under `{root}` → file `{root}/{tenantId}/{exportId}.{ext}`. The user-supplied URL `:id` can only select a row within the caller's tenant; the stored path is re-validated against the caller's tenantId; no user-supplied path is ever used to reach the filesystem. **VERIFIED** (also proven live: cross-tenant 404, and the write path derives `tenantId` from the DB record rather than the job payload — `export-engine.service.ts:68-73`).

## 7. STORAGE BOUNDARY

- Local filesystem only; inside the container at `/app/exports` (`EXPORT_DIR=/app/exports` confirmed via `printenv`). No S3/object storage, no external credentials, no new infrastructure. No host bind-mount (compose has no volume for exports) → no accidental host-filesystem exposure.
- Deterministic, app-managed root; directory `755` owned `nestjs:nodejs`.
- **Persistence across container recreation is NOT guaranteed** — `/app/exports` is not a Docker volume; a container recreation loses export files (DB rows would then dangle to nonexistent files, which fail safe to 404). This is a real limitation (the report's own §18 acknowledged it) and must be carried forward as a durability decision, not assumed persistent.

## 8. DATABASE VERIFICATION

- Prisma schema: `ReportExport` unchanged (`prisma/schema.prisma:3749-3772`); `filePath String?`, `fileSize Int?` reused; no new columns/constraints.
- Migration count: **24** migrations; `prisma migrate status` = "Database schema is up to date!" (exit 0).
- Schema-vs-live diff: `prisma migrate diff --from-url <live> --to-schema-datamodel --exit-code` = **"No difference detected"** (exit 0).
- No destructive operations performed or detected; validation ran read-only.
- Consistency during audit: live `report_exports` row was COMPLETED exactly while the 26-byte file existed on disk; after cleanup `0|0|0`.

## 9. TEST VERIFICATION (independently executed)

- Focused export suite: **2 suites / 19 tests PASS** (storage spec 9 + service spec 10; matches the report's "2/19").
- Full Jest: **92 suites / 1191 tests PASS** (`--runInBand --no-cache`).
- `tsc -p apps/api/tsconfig.app.json --noEmit`: exit 0.
- ESLint on export-engine (and full module scope): exit 0.
- Production build: `nx build api --configuration=production` exit 0, webpack compiled successfully.
- `prisma validate`: valid. `prisma migrate status`: up-to-date. `prisma migrate diff`: none.
- Baseline delta claim (+1 suite/+16 tests): **reconciled** — old service spec had 3 `it()`; new has 10; new storage spec has 9; net +16 test functions and +1 suite. The absolute baseline "91 suites/1175 tests" cannot be independently re-derived from git (tests were never committed), so that figure is classified as NOT independently verifiable; the current 92/1191 is verified.

## 10. RUNTIME PROVENANCE

- Running container `c308af44be5f`, image `docker-api` → `sha256:85f465fcf11e7345df71344792f933f08565dbd269b505d797df0832c2b2866c`, `healthy`, `RestartCount=0`, started 2026-08-13T21:53:00Z.
- Container bundle `/app/app/main.js` = SHA-256 **`85B8460950D88AFD86AF466553B3C46E790794C0E342D979CDC0F1B389E28AA6`**, 2,594,086 B.
- Local production build `dist/apps/api/main.js` = **same hash, same size** — byte-identical to the running bundle.
- Running bundle contains P4-03 (ExportStorageService ×15, "Cannot write an empty export file", "Export file path is invalid" ×3, "Export file not found" ×3, `EXPORT_DIR`, `text/csv`); old phantom pattern `exports/${tenantId}` = **0**; Phase-3 content markers (`retrySweepIntervalMs`, etc.) = **0**.
- P4-01 markers present (usage tracking `resolveUsageItems`, `Ignoring order.created`); Phase-3 modifications confirmed to exist ONLY in the original repo (payments.service.ts, queue.service.ts, webhook-\*, bull-health.indicator.ts all modified there) and to have **zero content diff** in the worktree — the isolation is real.

## 11. RUNTIME EVIDENCE (live, ephemeral, cleaned)

Independent script (`p4-03-audit-runtime.ps1`) against the running API created 2 throwaway tenants + OWNERs, generated an export, and asserted 19 checks — **19/19 PASS**:
generate 201 → COMPLETED (relative `filePath`, `fileSize=26`) → real file in container `/app/exports/{tenant}/{id}.csv` (26 B, owner `nestjs`) → download 200 with `text/csv; charset=utf-8`, `attachment; filename="{id}.csv"`, 26 bytes, CSV header, no path in body → cross-tenant 404 → nonexistent 404 → traversal 400 → absolute-path 400 → restored 200. Post-run cleanup restored **`users=0|tenants=0|report_exports=0`** and `/app/exports` is empty. Container logs during the audit: 3 "Processing export job" and 3 "Export … completed for tenant … (26 bytes)" lines; **0** occurrences of `/app/exports` in logs.

## 12. SECURITY REVIEW

- **Path traversal:** mitigated — identifier regex, segment rejection, tenant prefix, resolve-containment; proven 400 live and in unit tests.
- **Tenant breakout:** prevented at DB lookup and at FS prefix requirement; proven 404 live.
- **Arbitrary file read:** contained to root; `/etc/passwd` attempt rejected 400.
- **Arbitrary file deletion:** no delete API exposed; the only delete path is the stale-tmp sweep, scoped to the exact own-export tmp pattern, inside the tenant dir.
- **Predictable filenames:** `{exportId}.{ext}` with UUID exportIds; not guessable; regex-constrained.
- **Insecure permissions:** dir `755` owner `nestjs:nodejs`; tmp `flag:'wx'`; container non-root. Acceptable.
- **User-controlled extension/path:** extension from a constant map; path from DB, re-validated; none user-controlled.
- **Symlink attacks:** theoretical gap (no `realpath`); not reachable with current permissions/ownership.
- **Sensitive data leakage:** export contents are tenant-scoped and only served to authorized downloaders; no contents logged.
- **Path leakage in errors/logs:** none found (0 `/app/exports` in logs). Minor: `safeUnlink` could log an absolute tmp path on a rare non-ENOENT failure (low severity, ops-only, not per-request).
- **Logging of export contents:** none.

## 13. FAILURE / ROLLBACK REVIEW

- FS write failure cannot produce a false COMPLETED (unit test "marks FAILED never COMPLETED" + code path) — **verified**.
- DB failure after file creation can leave an **orphan file** (no compensation); FAILED row + orphan non-empty CSV inside the tenant dir — **documented limitation**, no security impact.
- Cleanup failure is observable only via `safeUnlink` warn log (best-effort) — partial observability.
- Retries do not corrupt/overwrite another export — writes are scoped to the job's own `exportId`; same-name overwrite is content-identical for a re-run of the same job.
- Rollback: schema untouched, so rollback = restore the 8 listed files + redeploy; no data migration needed. Not executed (no code changes to roll back); classified as reversible-by-construction.

## 14. DISCOVERED DEFECTS & RESIDUAL RISKS

1. **Export storage is not durable** — `/app/exports` is not a named volume; container recreation loses export files. (Documented in the report as accepted; still a real production durability risk.)
2. **Orphan files on DB-failure-after-write** — no compensation or GC; storage leaks possible under rare failure interleavings.
3. **No `realpath` symlink containment** — theoretical; not reachable under current non-root permissions and app-owned root.
4. **Uncommitted P4-x baseline** — deployed bundle is the aggregate of uncommitted P4-01/P4-02/P4-03 work; provenance is artifact-verifiable but not git-verifiable. The worktree's hundreds of `M` entries are line-ending noise, but orders/usage service changes from earlier P4-x work are genuinely in the bundle.
5. **`safeUnlink` warn log** could emit an absolute tmp path (rare, ops-only).
6. **No automated GC/retention policy** for export files (acknowledged in report §18).

None of these is an exploitable defect in the current deployment; all are tracked as limitations/risks.

## 15. CLAIM-BY-CLAIM RECONCILIATION

| P4-03 report claim                                                                        | Audit classification | Evidence                                                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Phantom paths replaced with real local file storage                                       | **VERIFIED**         | Code diff (phantom `exports/{tenantId}/{exportId}.csv` removed; `writeExport` writes real file) + live 26 B container file       |
| Real download works                                                                       | **VERIFIED**         | Live 200, 26 B, correct content-type/disposition                                                                                 |
| Traversal protection exists                                                               | **VERIFIED**         | Live 400 (`../outside.csv`) + unit tests + code guards                                                                           |
| Tenant isolation exists                                                                   | **VERIFIED**         | Live cross-tenant 404 + controller/service/FS trace                                                                              |
| Export lifecycle is atomic                                                                | **PARTIAL**          | Write is atomic (tmp→rename→stat); DB-vs-FS is NOT transactional (orphan risk on DB-update failure — documented)                 |
| Zero migrations                                                                           | **VERIFIED**         | 24 migrations, up-to-date; schema/migration files content-unchanged                                                              |
| Zero DB drift                                                                             | **VERIFIED**         | `migrate diff` = no difference (exit 0)                                                                                          |
| 11 proving scenarios                                                                      | **VERIFIED**         | All 11 scenarios map to real assertions across the 19 tests                                                                      |
| 1191 tests green                                                                          | **VERIFIED**         | Full Jest 92/1191 PASS; focused 2/19 PASS; baseline 91/1175 **NOT INDEPENDENTLY VERIFIABLE** but +16/+1 reconciled               |
| Build provenance `85B84609…` == image == container                                        | **VERIFIED**         | Local dist = image bundle = container bundle = `85B8460950…` (2,594,086 B)                                                       |
| Only `tablofy-api` recreated                                                              | **VERIFIED**         | api created 08-14 00:52; postgres/redis created 08-11 (untouched)                                                                |
| Runtime proofs (26 B CSV, cross-tenant 404, traversal 400, restored 200, cleanup 0\|0\|0) | **VERIFIED**         | Independent 19/19 live PASS + 0\|0\|0 + empty exports dir                                                                        |
| Rollback verified                                                                         | **PARTIAL**          | Reversible-by-construction (schema untouched, 8 files revert); no rollback execution exists to verify                            |
| No external dependencies                                                                  | **VERIFIED**         | Pure Node `fs` + Nest `StreamableFile`; no new deps in package.json diff                                                         |
| Phase-3 KEEP EXCLUDED                                                                     | **VERIFIED**         | Phase-3 content markers = 0 in bundle; Phase-3 mods present only in original repo; worktree has zero content diff on those files |

## 16. DEPLOYMENT STATUS

The currently running `tablofy-api` (container `c308af44be5f`, image `85f465fcf1…`) **IS the audited P4-03 build**: bundle byte-identical to the freshly built local artifact, P4-03 markers present, Phase-3 absent, healthy, and it is the only container recreated at deploy time. Deployment = **VERIFIED**.

## 17. CONDITIONS

No blocking conditions for P4-03. Recommended (track, not gate) carry-forward items:

1. Decide durability for `/app/exports` (named volume vs accepted ephemeral) — required before any claim of persistent exports.
2. Add GC/reconciliation for orphan export files.
3. Commit the P4-x delta to make provenance reproducible from git.

## 18. RECOMMENDATION FOR NEXT WORK PACKAGE

- P4-03: **CLOSED**.
- P4-05: **NOT AUTHORIZED**. No repository document references P4-04 or P4-05; no scope document grants it. A new decision/authorization is required before P4-05 (or P4-04) may start. Until then, no further implementation or deployment.

## 19. FINAL STOP STATEMENT

Audit complete. No files modified, no schema/migrations changed, no credentials touched, nothing deployed, committed, or pushed, and no next work package started. Stopping here.
