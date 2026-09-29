# FINAL P1-REMEDIATION DEPLOYMENT INDEPENDENT AUDIT

Independent, read-only, evidence-only verification of whether the **currently running** `tablofy-api`
runtime is synchronized with the **verified working tree** containing the P1 CleanupProcessor DI
remediation.

- **Date:** 2026-08-28
- **Verifier:** independent audit agent (no source/test/schema/migration/`.env`/Docker/Redis/Postgres/git modifications).
- **Method:** every claim below was re-proven live from git state, fresh builds, fresh test/gate runs,
  Prisma read-only commands, container inspection, byte-level bundle extraction and SHA-256 hashing,
  and live HTTP probes. No prior report was trusted as evidence.

---

## 1. EXECUTIVE VERDICT

# NO-GO — deployment is NOT synchronized with the verified source.

**One-line reason:** the verified local production bundle and the running container bundle are
**byte-different** (SHA-256 mismatch, size mismatch), and the running bundle still contains the
**un-remediated export wiring** (`ExportEngineModule exports: [ExportEngineService]` —
`ExportStorageService` is NOT exported; CleanupProcessor has a **3-parameter** constructor and
does not inject `ExportStorageService`).

| Requirement (Phase 9 rubric)            | Finding                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running bundle == verified bundle       | **FALSE** (SHA-256 differ, sizes differ)                                                                                                                                  |
| DI defect remains in running deployment | **YES — dormant**: the running bundle has the P1 export-side wiring (provider present, not exported). It boots only because CleanupProcessor never consumes it (3-param). |
| Application boots from deployed bundle  | TRUE (old bundle boots; Nest started) — but irrelevant to remediation sync                                                                                                |
| Health checks                           | TRUE (200 on /health, /health/live, /health/ready) — of the OLD code                                                                                                      |
| Unrelated source accidentally deployed  | N/A — nothing deployed this audit (deployment was NOT authorized and NOT performed)                                                                                       |
| Regression suite                        | PASS on the verified tree (97/1229, tsc 0, eslint 0, build SUCCESS)                                                                                                       |
| DB/schema drift                         | None (validate PASS, status up-to-date, diff "No difference detected")                                                                                                    |
| PostgreSQL/Redis recreated              | NO (IDs + creation timestamps unchanged)                                                                                                                                  |
| Provenance cryptographically proven     | Proven — for both bundles — and the resulting inequality is the basis of this verdict                                                                                     |

**Deployment action (Phase 4) was NOT authorized by this mission and was NOT performed.**
No container was created, recreated, restarted, or otherwise touched. Therefore the mismatch could
not be remediated here; it is reported as the blocker.

**Required remediation (outside this audit's authority):** rebuild the image via the official
`docker/Dockerfile` path from the verified working tree and recreate **only** `tablofy-api`, without
touching PostgreSQL/Redis, then re-verify. Until then, the running API serves pre-remediation code.

---

## 2. EXACT GIT BASELINE

- Working directory: `D:\New folder (8)\tablofy-p4-01-clean`
- `git branch --show-current` → **empty (detached HEAD)**
- HEAD: `16d70e546d28252babf3e830d85015c55bcb6e00` — "chore(backend): finalize pre-phase-3 hardening"
- Tags: `v3.1.0 … v7.5.0` present; **no tag points at the remediation** (remediation is uncommitted).
- **Key fact: the P1 remediation exists ONLY as uncommitted working-tree state. There is NO commit,
  tag, or branch that contains it.** This is why byte-level (not ref-level) provenance is mandatory.

---

## 3. WORKING-TREE STATE

- `git status --short` → 855 lines, of which the real content signal is:
  - **28 tracked files differ from HEAD** (git diff --stat: `28 files changed, 981 insertions(+), 131 deletions(-)`); most of the 855 lines are CRLF (autocrlf) line-ending noise, not content.
  - **15 untracked project files** (remediation docs/reports + P4-03/P4-05 source & spec files).
- Verified _again_ this session — inventory stable; nothing added by this audit (the only new artifact will be this report, which is the mission deliverable).
- Diffed file list includes the deployment-relevant changes: `docker/Dockerfile` (+`/app/exports` writable dir), `docker/docker-compose.prod.yml` (+`EXPORT_DIR`, `REPORT_EXPORT_RETENTION_DAYS`, `exports_data` volume), `package.json` (+`cron@4.4.0`). These are part of the verified tree.

## 4. REMEDIATION FILES (exact set)

| File                                                         | Role                                                | State                          |
| ------------------------------------------------------------ | --------------------------------------------------- | ------------------------------ |
| `apps/api/src/modules/export-engine/export-engine.module.ts` | P1 fix: adds `ExportStorageService` to `exports`    | TRACKED, modified vs HEAD      |
| `apps/api/src/modules/queues/tests/queue-module.di.spec.ts`  | P1 regression harness (real Nest graph)             | UNTRACKED (new)                |
| `apps/api/src/modules/queues/cleanup.processor.ts`           | consumer: 4-param ctor incl. `ExportStorageService` | TRACKED, modified (P4-03 + P1) |

Source hashes (SHA-256, recorded before build):

- `export-engine.module.ts` → `29C5169A094AD2228C15FF3A002A48595DBB064D6D765D7927B96DF7F13C8985` (702 B)
- `cleanup.processor.ts` → `E85F3B53FAE28675042ABBC7EE3768BB2AD270C1B0BE0E117EDC390285154918` (6896 B)
- `queue-module.di.spec.ts` → `4F66CFEA70EF3AE971201C9CC0A667AE0DFDB2BDB02DFA746E4B5BF1C2FEEC82` (3687 B)

## 5. SOURCE VERIFICATION (independent re-read)

**export-engine.module.ts (lines 9–14):**

```ts
@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [ExportEngineController],
  providers: [ExportEngineService, ExportEngineProcessor, ExportStorageService],
  exports: [ExportEngineService, ExportStorageService], // <- P1 fix
})
export class ExportEngineModule {}
```

**cleanup.processor.ts (lines 12–17):** constructor `(queueService, prisma, configService, exportStorageService)` — index 3 satisfied.
**queue.module.ts:** `@Global()`, `imports: [ExportEngineModule]`, provides `CleanupProcessor`.
**app.module.ts:** imports `ExportEngineModule` (line 229) and `QueueModule` (line 198).

## 6. DI DEPENDENCY-GRAPH PROOF (source-tree graph)

```
AppModule
 ├── ExportEngineModule ──provides→ ExportEngineService, ExportEngineProcessor, ExportStorageService
 │     └── exports→ [ExportEngineService, ExportStorageService]   (export makes it usable cross-module)
 └── QueueModule (@Global) imports ExportEngineModule
       └── provides→ CleanupProcessor ──index[3]→ ExportStorageService  (resolvable ONLY via the export)
```

Resolution succeeds only because of the export added by the P1 fix. Without it, Nest throws
`Nest can't resolve dependencies of the CleanupProcessor (?) ... ExportStorageService ... at index [3]`.

## 7. TEST PROOF (no mock-only primary proof)

`queue-module.di.spec.ts` compiles the **real** graph: `Imports: [InfraTestModule, ExportEngineModule, QueueModule]`. The only stubs are connection-level infrastructure (Config/Prisma/Redis/Metrics/EventEmitter) so no live DB/Redis is needed. The dependency under test is completely real:

- Test 1 asserts `moduleRef.get(CleanupProcessor)` and identity `injected === moduleRef.get(ExportStorageService)` (same instance through the real graph).
- Test 2 asserts `QueueService`, `ExportEngineService`, `ExportStorageService` all resolve from the module graph.
- Result on fresh run: **2/2 PASS** (included in the 97/1229 below). This suite would fail immediately if `ExportStorageService` were removed from `exports` again — it renders the historical CI hole closed.

## 8. BUILD PROOF (official path only)

- Official build command: `npx nx build api` → executes `webpack-cli build` with `NODE_ENV=production`
  (project.json build target; identical env to the Dockerfile's `npx nx build api --configuration=production`, which falls back to the same options).
- Output artifact: `dist/apps/api/main.js`.
- Result: `webpack compiled successfully`, `nx run api:build`, **exit 0** (17.9 s, cache 0/1).
- Pre-build source hashes recorded (§4) so the exact input tree is known.
- The build consumes the **full verified working tree** (all P4-03/P4-05/P1 content). No "isolated" build was performed — and no isolated build was required because **no deployment was authorized** (the mission's Phase-3 conflict rule applies at deployment time, not to the verification build).

**Fresh bundle (post-build):**

- `dist/apps/api/main.js` → SHA-256 `7D150B897031E07193BBC26C3749F40BB882B3F555728CD54187BE1213859806`, MD5 `6EB60759422A5809583EC55B6E854C22`, size **2 603 079 B**
- byte-level confirmation: `exports: [export_engine_service_1.ExportEngineService, export_storage_service_1.ExportStorageService]` and CleanupProcessor `constructor(queueService, prisma, configService, exportStorageService)` (4-parameter).

## 9. DOCKER / IMAGE PROVENANCE

- Image: `docker-api:latest` = `sha256:85f465fcf11e7345df71344792f933f08565dbd269b505d797df0832c2b2866c`, created **2026-08-14 00:52:14 +03:00 EEST** (= 2026-08-13 21:52:14Z), size 986 MB.
- Official image build path (`docker/Dockerfile`): `npx prisma generate` + `npx nx build api --configuration=production`; runner copies `dist/apps/api` → `/app/app`, ships `prisma/migrations` + `schema.prisma` + `prisma.config.ts`; `CMD ["sh","-c","npx prisma migrate deploy && node app/main.js"]`. Healthcheck: `wget … /api/v1/health`.
- `docker/docker-compose.prod.yml` (verified tree) defines `api` service with `build: context: .. dockerfile: docker/Dockerfile`, `container_name: tablofy-api`, `exports_data` volume → `/app/exports`, `EXPORT_DIR=/app/exports`, depends_on postgres+redis healthy.
- **The running container does NOT match the verified compose's declared intent** (no volume mounts at all; old env set), consistent with it being an older image/stack — confirmed by bundle bytes below.

## 10. RUNNING-CONTAINER PROVENANCE

Container `tablofy-api`:

- ID `c308af44be5f061623c6875e31f32007369209fc64ca7f23e599b0034b2285ae`, Created **2026-08-13T21:52:58Z**, Started `2026-08-27T20:59:04Z`, **RestartCount=0**, State running, Health **healthy** (wget /api/v1/health).
- Image `sha256:85f465fcf11e…` (= `docker-api:latest` above).
- Command: `sh -c npx prisma migrate deploy && node app/main.js` (as-from-Dockerfile).
- **Mounts: NONE** (no `exports_data` bind/volume present at runtime).
- Env (non-secret keys, redacted secrets): `NODE_ENV=production`, `PORT=3000`, `PAYMENTS_MODE=live`, `EXPORT_DIR=/app/exports` present, `REPORT_EXPORT_RETENTION_DAYS` **absent**, plus standard JWT/THROTTLE/queue/monitoring settings.
- Bundle extracted from the running container: `/app/app/main.js` →

## 11. SHA-256 COMPARISON (cryptographic provenance)

| Bundle                                                       | SHA-256                                                            | Size        |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ----------- |
| **Verified local production bundle** `dist/apps/api/main.js` | `7D150B897031E07193BBC26C3749F40BB882B3F555728CD54187BE1213859806` | 2 603 079 B |
| **Running container bundle** `/app/app/main.js`              | `85B8460950D88AFD86AF466553B3C46E790794C0E342D979CDC0F1B389E28AA6` | 2 594 086 B |

**VERDICT: NOT byte-identical. Hash mismatch. File sizes differ by 8 993 B.**
No timestamp, tag, source-version, or container-name equivalence is being (or could be) used as
proof — the hashes themselves are the proof, and they prove **divergence**.

Corroborating byte-level difference inside the running bundle:

- `ExportEngineModule`: `exports: [export_engine_service_1.ExportEngineService]` — **`ExportStorageService` NOT exported (P1 force-side wiring un-remediated).**
- `CleanupProcessor`: `constructor(queueService, prisma, configService)` — **3 parameters** (no injection of `ExportStorageService`; hence dormant, boots fine).
- Present: `ExportStorageService` symbol (20 refs) + "Export storage root ready" log string; `generate-export` job (2 refs); `reportExport` (12 refs). **Absent: `expired_report_exports` cleanup case (0 refs).**
- The verified local bundle instead shows `exports: [ExportEngineService, ExportStorageService]` and the 4-parameter CleanupProcessor ctor.

## 12. RUNTIME BOOT PROOF (running container)

From `docker logs tablofy-api` (full window, read-only) at its 2026-08-27T20:59:12Z start:

```
24 migrations found in prisma/migrations
No pending migrations to apply.
[NestFactory] Starting Nest application...
{"context":"CleanupProcessor","message":"Cleanup processor registered", ...20:59:13.213Z}
{"context":"ExportStorageService","message":"Export storage root ready", ...20:59:13.217Z}
{"context":"NestApplication","message":"Nest application successfully started", ...20:59:13.247Z}
{"context":"Bootstrap","message":"Application is running on: http://localhost:3000/api/v1", ...20:59:13.250Z}
```

- `Nest can't resolve dependencies` occurrences: **0**.
- The old bundle boots — but **the deployed Node process is running the un-remediated bundle** (§11).

## 13. HEALTH PROOF (live, read-only GET)

| Endpoint                   | HTTP | App status                                         |
| -------------------------- | ---- | -------------------------------------------------- |
| `GET /api/v1/health`       | 200  | db up, redis up, bullmq up, memory_rss up, disk up |
| `GET /api/v1/health/live`  | 200  | db up, redis up                                    |
| `GET /api/v1/health/ready` | 200  | db/redis/bullmq/memory/disk up                     |

BullMQ metrics visible (old-bundle queue set): e.g. `email failed 3`, `export-engine completed 7 / failed 7`, `dead-letter completed 14` — informative about the sleeping old stack, not about the fixed tree.

## 14. DB / REDIS / BULLMQ CONNECTIVITY PROOF

- DB/Redis/BullMQ: healthy from container health payload + Prisma CLI queries from host (below).
- Postgres `tablofy_prod` reachable and schema-consistent (Prisma validate/status/diff, §15–16).
- Redis alive: `DBSIZE = 254` keys (read-only), password-authenticated.

## 15. MIGRATION STATUS

`npx prisma migrate status` (fresh, read-only):

```
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "tablofy_prod", schema "public" at "127.0.0.1:5432"
24 migrations found in prisma/migrations
Database schema is up to date!   [exit 0]
```

`_prisma_migrations` row count: **24** (bookkeeping intact).

## 16. SCHEMA DIFF

`npx prisma migrate diff --from-url <live DATABASE_URL> --to-schema-datamodel prisma/schema.prisma` (read-only) →
**"No difference detected."** [exit 0]
`npx prisma validate` → schema **valid** [exit 0]. No schema drift.

## 17. DATA-SAFETY VERIFICATION

- **PostgreSQL NOT recreated:** ID `d21bc90d1102bbdecb9be3bd7a4c23c6cfa21e0dd33cf67a2e422f6cfc176524`, Created `2026-08-11T01:42:06Z` — unchanged this session.
- **Redis NOT recreated:** ID `d15d3124f207ac6fc76501ee66c8c46d33fb64d2119b05888bc6cadc4eb467e7`, Created `2026-08-11T01:42:06Z` — unchanged.
- **No test data inserted:** live row counts (read-only), unchanged from baseline: `tenants=0`, `users=0`, `orders=0`, `report_exports=0`.
- **No migration applied by this audit:** only read-only `validate` / `status` / `diff` were run. (The running container's own `prisma migrate deploy` at ITS start was not this audit's action.)
- **No destructive DB command executed** (only `SELECT`/counts + Prisma read-only).
- **Redis data intact:** DBSIZE 254, no writes performed (healthcheck pings only).

## 18. REGRESSION RESULTS (fresh runs, exact counts/exit codes)

| Gate            | Command                                           | Result                               | Exit |
| --------------- | ------------------------------------------------- | ------------------------------------ | ---- |
| Full Jest       | `npx jest --silent`                               | **97 suites / 1229 tests, all PASS** | 0    |
| DI regression   | within above (queue-module.di.spec.ts)            | 2/2 PASS                             | 0    |
| TypeScript      | `npx tsc --noEmit -p apps/api/tsconfig.app.json`  | clean                                | 0    |
| ESLint          | `npx eslint .`                                    | clean                                | 0    |
| Prod build      | `npx nx build api` (webpack, NODE_ENV=production) | compiled successfully                | 0    |
| Prisma validate | `npx prisma validate`                             | schema valid                         | 0    |
| Prisma status   | `npx prisma migrate status`                       | up to date (24)                      | 0    |
| Prisma diff     | `npx prisma migrate diff --from-url …`            | no difference                        | 0    |

(Note: a bare root `npx tsc --noEmit` without `-p` is invalid in this repo — there is no root
`tsconfig.json` — and returns exit 1 with usage text; the app check is defined by the `-p` variant.)

## 19. EXTERNAL BLOCKERS (SEPARATELY CLASSIFIED)

- **BLOCKED_EXTERNAL:** Stripe live, Paymob live, SMTP email delivery. No live credentials/round-trip
  available in this environment. No claim of "live verified" is made for any external provider.

## 20. DEVIATIONS FROM PREVIOUS AUDIT

| Prior conclusion (previous session)                                                      | This audit's finding                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Running container predates the P4-03 work; never contained the buggy or the fixed code" | **CORRECTED — materially different.** The running bundle **does contain the P1 export-side wiring defect**: `ExportEngineModule exports: [ExportEngineService]` (no `ExportStorageService`). It runs only because CleanupProcessor is 3-parameter (never consumes `ExportStorageService`). So the deployed code is the **un-remediated** version, not a neutral older version. |
| Container md5 `ACF7CD20…`                                                                | Confirmed independently (MD5 `ACF7CD2041244EE550DE840F2C628F61`, SHA-256 `85B84609…`).                                                                                                                                                                                                                                                                                         |
| Fixed bundle md5 `6EB60759…`                                                             | Confirmed independently on a fresh build (SHA-256 `7D150B89…`).                                                                                                                                                                                                                                                                                                                |
| "Stale but harmless" deployment framing                                                  | Revised: the deployment is out-of-sync in a **security/correctness-relevant** way (remediation absent).                                                                                                                                                                                                                                                                        |

## 21. RESIDUAL RISKS

1. **Deployment divergence is the sole release blocker** — stale image `docker-api:latest` (2026-08-13) must be rebuilt from the verified tree.
2. Data tables are empty in the audited DB (0 rows) — pre-existing posture; confirm with data owner before seed/prod use.
3. Live integrations untested (BLOCKED_EXTERNAL).
4. 15 untracked project files must be committed for a reproducible release state.
5. The dormant mis-wiring type (provider present but not exported) can recur; the new `queue-module.di.spec.ts` guard makes recurrence fail CI.

## 22. FINAL DECISION

# **NO-GO** (current deployment is NOT synchronized; remediation NOT deployed)

- **Code tree:** verified, all gates green → promotable _after_ rebuild/redeploy.
- **Deployment:** running bundle ≠ verified bundle (cryptographic proof, §11) and contains the
  **un-remediated P1 export wiring** (§11). This hits the mission's NO-GO condition
  ("running bundle differs from verified bundle" / "DI defect remains" in the deployment).
- **Not CONDITIONAL GO:** the blocker is not an external integration; it is a deployment sync gap
  that the mission forbade us from closing (deployment not authorized).
- **Remediation path (for a separately-authorized deployment step):** `docker compose -f docker/docker-compose.prod.yml build api && docker compose -f docker/docker-compose.prod.yml up -d --no-deps --force-recreate api` (recreate **only** `tablofy-api`, never postgres/redis), then verify health + one export e2e. Old container `c308af44be5f` → new container ID; PG `d21bc90d1102` / Redis `d15d3124f207` must stay.

## 23. EXACT COMMANDS / EVIDENCE USED

Git: `git branch --show-current`, `git rev-parse HEAD`, `git log --oneline -10`, `git tag`,
`git status --short`, `git diff --name-only HEAD`, `git diff --stat`, `git ls-files --others --exclude-standard`.
Source: fresh reads of `export-engine.module.ts`, `cleanup.processor.ts`, `queue.module.ts`,
`queue-module.di.spec.ts`, `app.module.ts`, `apps/api/project.json`, `docker/Dockerfile`,
`docker/docker-compose.prod.yml`.
Build/hash: `npx nx build api`; `Get-FileHash -Algorithm SHA256/MD5` on sources and bundles.
Container: `docker ps -a`, `docker inspect` (env redacted), `docker logs --since 168h tablofy-api`,
`docker cp tablofy-api:/app/app/main.js <temp>`, `docker images docker-api`.
Bytes: substring extraction (IndexOf + Substring) of webpack module decorators/constructors in both bundles.
Runtime: `curl.exe` GETs to `http://localhost:3000/api/v1/{health,health/live,health/ready}`.
Prisma (inline `DATABASE_URL=postgresql://tablofy:tablofy_prod@127.0.0.1:5432/tablofy_prod?schema=public`):
`npx prisma validate`, `npx prisma migrate status`, `npx prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma`.
Data safety: `docker exec tablofy-postgres psql -U tablofy -d tablofy_prod -t -A -c '<SELECT counts>'`,
`docker exec tablofy-redis redis-cli -a <asked> --no-auth-warning DBSIZE`.
Regression: `npx jest --silent`, `npx tsc --noEmit -p apps/api/tsconfig.app.json`, `npx eslint .`.

Evidence artifacts (temp, outside repo): `C:\Users\ELNOUR~1\AppData\Local\Temp\opencode\deploy-audit\container-main.js`.

## 24. EXPLICIT STATEMENT OF WHAT WAS NOT MODIFIED

- **No source code, test, Prisma schema, migration, or `.env` file was created, edited, or deleted.**
- **No Docker configuration was changed** (no `docker compose`, no `docker build`, no container create/start/stop/rm in the mission — `docker cp` was read-only from container→host temp).
- **No PostgreSQL or Redis data was modified** (only read-only SELECT/counts/DBSIZE + Prisma read-only commands; no migration applied, no seed, no reset, no drop).
- **No Git history was changed** (no commit/stash/reset/branch/tag).
- **No deployment or rollback was performed** (Phase 4 was not authorized).
- The only file created by this mission in the repository is **this report** (a required deliverable).
