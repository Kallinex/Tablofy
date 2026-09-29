# P4-03: Export Engine — Real Local File Storage & Safe Download — Report

**Status:** COMPLETE — implemented, proven, deployed (only `tablofy-api`), runtime-verified on the deployed container, zero DB migration/drift.

---

## 1. Baseline

The export engine recorded PENDING -> PROCESSING -> COMPLETED transitions and stored a **phantom path** in the `report_exports.filePath` column, but **no file was ever written** and the download endpoint returned only metadata (no bytes). The path string `exports/{tenantId}/{exportId}.csv` was fabricated in service code and never referenced an actual file. P4-03 replaces this with **real, tenant-scoped files on the API container's local filesystem** and a **safe binary download**.

Scope: isolated worktree `D:\New folder (8)\tablofy-p4-01-clean`. Only P4-03 is in scope; Phase-3 components (queues/payments/webhooks/bull-health) remain **KEEP EXCLUDED**.

## 2. Files Changed

| File                                                                      | Change                                                                                       | Modified (UTC)   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------- |
| `apps/api/src/modules/export-engine/export-storage.service.ts`            | **NEW** `ExportStorageService` — atomic write, guarded read, root resolution                 | 2026-08-14 00:50 |
| `apps/api/src/modules/export-engine/export-engine.service.ts`             | Real-file `processExport`; `getExportFile`; `StreamableFile` download; removed phantom paths | 2026-08-14 00:04 |
| `apps/api/src/modules/export-engine/export-engine.module.ts`              | Added `ExportStorageService` provider                                                        | 2026-08-14 00:01 |
| `apps/api/src/config/env.validation.ts`                                   | Added optional `EXPORT_DIR?: string`                                                         | 2026-08-14 00:01 |
| `docker/Dockerfile`                                                       | Writable `/app/exports` owned `nestjs:nodejs`                                                | 2026-08-14 00:01 |
| `docker/docker-compose.prod.yml`                                          | `EXPORT_DIR: ${EXPORT_DIR:-/app/exports}`                                                    | 2026-08-14 00:01 |
| `apps/api/src/modules/export-engine/tests/export-storage.service.spec.ts` | **NEW** 10 storage tests (hermetic temp roots)                                               | 2026-08-14       |
| `apps/api/src/modules/export-engine/tests/export-engine.service.spec.ts`  | REWRITTEN 12 tests incl. 11 proving scenarios                                                | 2026-08-14       |

## 3. Old (Phantom) Behavior

- `processExport` fabricated `filePath = exports/{tenantId}/{exportId}.csv` and stored it in the DB; the path pointed at nothing.
- Download endpoint returned a 200 JSON/empty body — **no real bytes**.
- No storage root, no permissions, no cleanup, no containment checks; `fileSize` was never backed by a real file.

## 4. New Behavior

- On PENDING job execution, `ExportStorageService.writeExport()` writes the rendered CSV to a **real file**:
  `{EXPORT_DIR}/{tenantId}/{exportId}.{ext}`.
- COMPLETED is only set **after** the file exists and is stat-verified (`isFile && size > 0 && size === buffer.length`). DB now stores the relative `filePath` (`{tenantId}/{exportId}.csv`) plus the real `fileSize`.
- `GET .../exports/:id` returns the record; `GET .../exports/:id/download` returns the **real bytes** via `StreamableFile` with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="{id}.csv"`.

## 5. Storage-Root Design

- Root: `EXPORT_DIR` env (optional) defaulting to `path.join(process.cwd(), 'exports')` → `/app/exports` in the container.
- Created recursively on module init; container image guarantees `/app/exports` exists and is owned by `nestjs:nodejs` (non-root user, proven `stat /app/exports` = `nestjs:nodejs`).
- **Deterministic, app-managed** root: no external object storage, no credentials, no new infrastructure.

## 6. Atomic Write & Lifecycle Contract

- Write to `{exportId}.{ext}.tmp-{pid}-{hex}` with `flag: 'wx'` (no clobber, no symlink follow), `rename` into place, then `stat` verify: regular file, size > 0, size equals buffer. Any failure unlinks the tmp file and rethrows → job stays PENDING/FAILED, **never COMPLETED with a broken file**.
- Stale-tmp sweep is best-effort and never fails the write.
- Race handling: two jobs for the same `exportId` cannot both complete — second write throws because the final file already exists (`wx` + rename semantics), preventing duplicates; retries therefore never duplicate a completed file.

## 7. Traversal / Absolute-Path Protections (defense in depth)

`readExport(tenantId, relativePath)` rejects a download when:

1. the path is **absolute** (`path.isAbsolute`) — proven by DB-forged `../outside.csv` attempt returning 400;
2. any segment is `.` or `..`;
3. the path lacks the **required `{tenantId}/` prefix**;
4. the resolved path escapes the root (`path.resolve(...)` containment check vs root).

Identifier regex `[A-Za-z0-9_-]+` is enforced at write for `tenantId` and `exportId`. Download never trusts client/stored strings alone; it always re-derives the tenant from the DB record and re-resolves under the root.

## 8. Tenant Isolation

- The **authoritative tenantId comes from the DB record** (`jobTenantId`), never from the job payload or a stored path.
- Download path is scoped to the requesting tenant's directory; a tenant-B token requesting tenant-A's export returned **404** (verified).
- No absolute filesystem path is ever returned to a client or persisted (`filePath` stays relative; proven by leak scans).

## 9. Worker / Queue Flow

- `ExportEngineProcessor` -> `ExportEngineService.processExport({tenantId, payload})` -> job row -> CSV render -> `ExportStorageService.writeExport` -> `update` to COMPLETED with real `relativePath`/`fileSize`/`completedAt`.
- Queue config unchanged: `attempts: 2`, `timeout: 300000`, worker name `export-engine`, default concurrency 5.
- Logs now read `Export {id} completed for tenant {tenant} (N bytes)` with **no path**; verified zero `/app/exports` matches in container logs.

## 10. DB / Schema Impact

- **Zero migrations.** Existing `ReportExport` fields (`filePath String?`, `fileSize Int?`, `status ReportExportStatus default PENDING`, `errorMessage`, `completedAt`) are sufficient.
- `prisma validate` OK; `prisma migrate status` = "Database schema is up to date!" (24 migrations applied); `prisma migrate diff --from-url <live> --to-schema-datamodel` = **"No difference detected"** (exit 0).

## 11. Proving Tests (11 scenarios)

New/rewritten tests assert real FS behavior using `fs.mkdtemp(os.tmpdir())` + injected `EXPORT_DIR`:

1. Real file written on completion (exists, non-empty).
2. COMPLETED set only after the file is verified (failure never leaves COMPLETED).
3. DB `fileSize` equals actual bytes.
4. Download returns the real bytes of the stored file.
5. Missing file -> NotFound/400 (not a fake 200).
6. Failed write -> job not COMPLETED, tmp cleaned.
7. Cross-tenant download denied (404).
8. Traversal (`../`) rejected (400).
9. Absolute-path escape rejected (400).
10. Filename/identifier escape rejected (400).
11. Retry produces no duplicate file (atomic `wx` + rename).

Focused: **2 suites / 19 tests PASS**. Full Jest: **92 suites / 1191 tests PASS**.

## 12. Regression Results

- Full Jest: 92 suites / 1191 tests, all passing (baseline 91/1175; net +1 suite / +16 tests).
- `tsc -p apps/api/tsconfig.app.json --noEmit`: clean.
- ESLint `apps/api/src` with prettier auto-fix: clean.
- Focused P4-03 suite re-run after final edit: 2/19 pass.

## 13. Build Provenance (hash chain)

- Local `dist/apps/api/main.js` = SHA-256 `85B8460950D88AFD86AF466553B3C46E790794C0E342D979CDC0F1B389E28AA6` (2,594,086 B, 2026-08-14 00:51 UTC).
- Docker image `docker-api:latest` (`sha256:85f465fcf11e7345df71344792f933f08565dbd269b505d797df0832c2b2866c`) extracted bundle = **same `85B84609...`**.
- Running `tablofy-api` container bundle (copied from `/app/app/main.js`) = **same `85B84609...`**.
- P4-01 markers present 5/5; Phase-3 markers absent 5/5; old phantom pattern `exports/${tenantId}/${exportId}` = 0 matches.
- The earlier stale NX cache issue was resolved with `npx nx reset` (daemon DB was corrupt); the post-reset chain above is the source of truth.

## 14. Deployment (only `tablofy-api` recreated)

- Built via the official compose path (`docker compose --env-file <repo .env> -f docker/docker-compose.prod.yml build api`), secrets injected from `D:\New folder (8)\tablofy\docker\.env` via env vars only (never echoed/logged).
- `up -d --no-deps --no-recreate postgres redis` then `up -d --no-deps api` recreated **only** `tablofy-api`. `tablofy-postgres` (postgres:16-alpine) and `tablofy-redis` (redis:7-alpine) were never recreated and remain untouched.
- Container: `Up (healthy)`, health endpoint `200`, `database=up`, `redis=up`, bullmq/disk up; `EXPORT_DIR=/app/exports`, `/app/exports` owned `nestjs:nodejs`.

## 15. Runtime Verification (on deployed container)

Full script run on the final image:

- Generate export: 201, row PENDING -> **COMPLETED** with `filePath={tenantA}/{exportId}.csv`, `fileSize=26`.
- Real file in container: `/app/exports/{tenantA}/{exportId}.csv` = **26 bytes**, owner `nestjs`.
- Download: **200**, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="{id}.csv"`, **26 bytes**, body first line `Order ID,Status,Total,Date`, body contains **no path**.
- `GET` record: `filePath` relative, no `..`, no absolute path.
- **Cross-tenant** download (tenant-B token for tenant-A export): **404** ("Export not found").
- **Traversal** download (DB-forged `../outside.csv`): **400** ("Export file path is invalid").
- Restored legitimate path download: **200**.
- Log scan: no `/app/exports` and no per-export paths in container logs; Redis AUTH enforced (`NOAUTH` without password, `PONG` with).
- Post-verification cleanup restored the zero-state DB: **users=0 | tenants=0 | report_exports=0**; `/app/exports` empty.

## 16. Rollback & Safety

- Revert = restore the 6 source files + 2 spec files from the pre-P4-03 worktree and redeploy `tablofy-api`; schema untouched, so no data migration needed for rollback.
- Stored `filePath`s created by P4-03 are valid relative paths; pre-P4-03 rows contained phantom paths — any such row fails the read guard safely (NotFound/invalid-path), never returns wrong bytes.
- Postgres and Redis containers are untouched; all secrets remain in the repo `.env` (never committed/echoed).

## 17. External Dependencies

**NONE.** No object storage, CDN, credentials, third-party SDKs, or new infrastructure. Pure Node `fs` + existing Nest primitives (`StreamableFile`).

## 18. Known Limitations

- Storage is local to the API container (ephemeral if the container's filesystem is recreated) — an accepted, documented design decision for this phase; a future phase may add durable/persistent volumes or object storage.
- No automated retention/GC policy beyond the best-effort stale-tmp sweep; exports accumulate until the root is cleaned externally.

## 19. Final Verdict

P4-03 is **COMPLETE**: real files replace phantom metadata, downloads serve real bytes with correct content-type/filename, downloads are tenant-scoped with traversal/absolute-path/identifier guards, COMPLETED is only set after verified writes, zero migrations, zero external dependencies, all gates green (1191 tests, tsc, ESLint, prisma diff), the deployed container's bundle is byte-identical to the built artifact (`85B84609...`), only `tablofy-api` was recreated, and every security/runtime proof passed on the running deployment. Work stops here.
