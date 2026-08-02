# Phase 7 — Milestone 5: Observability & Infrastructure

## Implementation Plan

**Version:** 1.0
**Status:** Draft — awaiting approval
**Based on:** PHASE7-VERIFIED-ROADMAP.md, FINAL-PRODUCTION-READINESS-AUDIT.md
**Base branch:** feature/phase7-m5 (clean, on v7.4.0, tagged 4202812)

---

## 1. Objectives

Deliver the Observability & Infrastructure milestone: enable production operations, monitoring, alerting, queue reliability, and reliable containerized deployments. This milestone is **application/DevOps-heavy** — CI/CD pipelines, Docker, env validation, health checks, metrics wiring, queue reliability (Bull Board, DLQ, timeouts), distributed cron locks, and real inventory job processors. No Prisma schema changes are expected.

**Forensic findings addressed (from FINAL-PRODUCTION-READINESS-AUDIT.md, confirmed):**

| Finding | Verdict | Summary |
|---------|---------|---------|
| **P0-14** | ✅ Confirmed | `/metrics` has optional bearer auth only; no requirement that `METRICS_AUTH_TOKEN` be set in production |
| **P0-15** | ✅ Confirmed | CI builds/test only — no Docker build/push, no container registry, no git-SHA tagging (`.github/workflows/ci.yml`) |
| **P0-16** | ✅ Confirmed | No security scanning in CI — no SCA (`npm audit`/Snyk), no SAST (CodeQL/SonarCloud), no image scan (Trivy) |
| **P1-16** | ✅ Confirmed | Dockerfile `runner` copies full `node_modules` from `npm ci` — dev dependencies leak into the runtime image (docker/Dockerfile) |
| **P1-17** | ✅ Confirmed | `SENTRY_*`, `METRICS_*`, `MONITOR_*`, `LOG_*` configs read `process.env` directly but are **not** in `env.validation.ts` nor `.env.example` |
| **P1-18** | ✅ Confirmed | No dead letter queue; failed BullMQ jobs only retained via `removeOnFail`; no failure-rate alerting |
| **P1-19** | ✅ Confirmed | No Bull Board UI for queue monitoring |
| **P1-20** | ✅ Confirmed | Inventory processors (`low-stock-alerts`, `expiration-checks`, `waste-reports`, `inventory-sync`) are log-only stubs (inventory.processor.ts) |
| **P2-14** | ✅ Confirmed | Business metric counters exist in `metrics.service.ts` but are only wired into payments.service.ts — Orders, Inventory, Kitchen are not instrumented |
| **P2-15** | ✅ Confirmed | `disk-health.indicator.ts` measures **RAM** (`os.freemem()`/`os.totalmem()`), not disk |
| **P2-1** | ✅ Confirmed | `main.ts` has manual SIGINT/SIGTERM handlers but no shutdown timeout; `app.enableShutdownHooks()` not called |
| **P2-related** | ✅ Confirmed | 9 `@Cron` jobs in scheduler.service.ts enqueue without any overlap prevention — multi-replica double execution risk |

**Score improvement:** Observability 3/10 → 6/10, DevOps 3/10 → 6/10 per ROADMAP §7.5.

---

## 2. Scope

### In Scope — 14 tasks (7.5.1–7.5.14)

| ID | Task | Finding | Effort |
|----|------|---------|--------|
| 7.5.1 | Add Docker build + push to CI with container registry and git SHA tagging | P0-15 | 4–8 hrs |
| 7.5.2 | Add security scanning to CI: `npm audit` (SCA) + CodeQL (SAST) | P0-16 | 4–8 hrs |
| 7.5.3 | Add `SENTRY_DSN`, `SENTRY_ENABLED`, `METRICS_AUTH_TOKEN` + related observability vars to `.env.example`, env validation, startup warning | P1-17 | 30 min |
| 7.5.4 | Require non-empty `METRICS_AUTH_TOKEN` in production env validation | P0-14 | 30 min |
| 7.5.5 | Wire business metric counters into Orders, Inventory, Kitchen services | P2-14 | 2–4 hrs |
| 7.5.6 | Fix "Disk" health indicator to use real disk space check | P2-15 | 1–2 hrs |
| 7.5.7 | Add Bull Board UI at protected admin route (`/admin/queues`) | P1-19 | 4–8 hrs |
| 7.5.8 | Add dead letter queue for failed BullMQ jobs + alerting on failure rates | P1-18 | 4–6 hrs |
| 7.5.9 | Add `process.on('unhandledRejection')`/`process.on('uncaughtException')` with fallback logging | P1-related | 1 hr |
| 7.5.10 | Change `Dockerfile` so the production runtime stage uses `npm ci --omit=dev` | P1-16 | 1–2 hrs |
| 7.5.11 | Configure BullMQ job timeouts and retry strategies per queue type | P1-18 (extended) | 1–2 hrs |
| 7.5.12 | Add cron job overlap prevention with Redis distributed locks | P2-related | 2 hrs |
| 7.5.13 | Implement actual inventory processor logic (low-stock alerts, expiration checks, waste reports, sync) | P1-20 | 1 week |
| 7.5.14 | Add graceful shutdown timeout to `main.ts` | P2-1 | 1 hr |

### Explicitly Out of Scope

- **No Prisma schema changes** — no migrations in M5 (7.5 has no schema tasks).
- **No new business features** — inventory processors implement real logic for the existing 4 queues only.
- **No OpenTelemetry/tracing** (P2-16) — 7.7.5 scope.
- **No Redis Cluster/Sentinel** (P2-11) — 7.7.4 scope.
- **No security-hardening additions** (MFA, RBAC scopes, body tenant check) — 7.1/7.7 scope.
- **No API documentation work** (response DTOs, Swagger annotations) — 7.6 scope.
- **No enterprise/subscriptions work** — 7.7 scope.
- **No production deployment** — goes live only after 7.8 (Production Certification).
- **No registry setup on a real container registry** — CI job is written and gated on secrets; it runs once a registry is configured. Deliverable is the pipeline.
- **No email/SMS/payment provider implementation** — external-dependency health checks deferred to 7.7.9.
- **No migration of metrics to OpenTelemetry** — prom-client stays the metrics backbone.

---

## 3. Architecture

### 3.1 New modules/files

| File | Purpose |
|------|---------|
| `apps/api/src/common/bull-board/bull-board.module.ts` | Sets up Bull Board adapter for all registered queues, serves `/admin/queues` behind OWNER-role auth |
| `apps/api/src/common/redis/redis-lock.service.ts` | Distributed lock (`SET key token NX PX ttl`) + release via Lua/`GETDEL` |
| `apps/api/src/modules/queues/dead-letter.processor.ts` | Consumes `dead-letter` queue, logs/reports failures |
| `.github/workflows/docker-publish.yml` | Docker build + push to registry (ghcr.io default), git SHA + branch + semver tags |
| `.github/workflows/codeql.yml` | CodeQL SAST on push + PR |
| `scripts/verify-phase7-m5.js` | Gate harness (G1–G12) mirroring M4 pattern |

### 3.2 Modified areas

| Area | Files |
|------|-------|
| Env validation | `apps/api/src/config/env.validation.ts`, `apps/api/src/config/sentry.config.ts`, `apps/api/src/config/metrics.config.ts`, `.env.example` |
| Health | `apps/api/src/health/disk-health.indicator.ts`, `apps/api/src/health/bull-health.indicator.ts` |
| Metrics wiring | `orders.service.ts`, `inventory.service.ts`, kitchen module service |
| Queues | `queue.service.ts` (DLQ, per-queue timeouts/retries, job-id dedup), `queue.module.ts`, `queue.controller.ts` |
| Scheduler | `modules/scheduler/scheduler.service.ts` (lock acquisition) |
| Redis | `apps/api/src/redis/redis.service.ts` (lock primitives) |
| main.ts | graceful shutdown timeout, process handlers, SentryFilter registration |
| Docker | `docker/Dockerfile` (prod-pruned node_modules + prisma CLI preserve) |
| CI | `.github/workflows/ci.yml` (npm audit step) |

### 3.3 Dependency decisions

- **Bull Board:** `@bull-board/api` + `@bull-board/express` (peer `bullmq`). Adapter reads queue instances from `QueueService` so all 37 queues appear in the UI.
- **Auth for `/admin/queues`:** a dedicated express middleware reusing the existing JWT strategy (verify `JWT_SECRET`, check Redis blacklist via `RedisService`, require claim `role === 'OWNER'`) — self-contained, no new auth deps.
- **DLQ:** a `dead-letter` queue + per-worker `QueueEvents` `failed` listener; jobs that exhaust retries are re-enqueued to DLQ with `error`/`attemptsMade`/`failedAt` metadata. Failure-rate alerting: DLQ depth exposed via `bull_queue_depth{status="dead-letter"}` and a scheduled check that logs `error` above a threshold (config `QUEUE_DLQ_ALERT_THRESHOLD`, default 50).
- **Per-queue job opts:** a `QUEUE_JOB_OPTIONS` map in `queue.service.ts` merged over the global defaults (email attempts 5 / timeout 30s; cleanup timeout 60s; forecast-generation/export-engine longer timeouts; webhook-delivery keeps its existing custom retry contract).
- **Cron overlap prevention:** `RedisLockService.acquire(key, ttlMs)` around each of the 9 cron enqueues in `scheduler.service.ts`; skip when lock not acquired. TTLs chosen ≥ expected run window.
- **Dockerfile:** new `deps-prod` stage (`npm ci --omit=dev`) feeding the `runner`; `prisma` CLI + `@prisma/client` + `.prisma` copied explicitly so `migrate deploy` still works at deploy time.
- **Metrics interval loop:** implement the documented-but-unused `METRICS_COLLECT_INTERVAL_MS` gauge refresh loop (event loop delay, memory, CPU, GC) as part of 7.5.5 so the gauges actually update.

---

## 4. Task Details

### 7.5.1 — Docker build + push to CI
- New `.github/workflows/docker-publish.yml`: build + push on `main` push and on version tags (`v*`), using `docker/login-action` → `ghcr.io` and `docker/build-push-action` with tags `{git_sha}`, `{ref_name}`, and `latest`/`v7.x` on tags. Gated on `secrets.GITHUB_TOKEN` (default) so the job is inert until a registry is configured.
- Keep `ci.yml` untouched for its build/test role.

### 7.5.2 — Security scanning in CI
- Add `npm audit --audit-level=high` step to `ci.yml` (SCA).
- New `.github/workflows/codeql.yml` (GitHub-provided `codeql-action/init` → `autobuild` → `analyze`, `security-extended` queries).
- Image scanning (Trivy) is 7.8.5 — out of scope here.

### 7.5.3 — Observability env vars
- Extend `env.validation.ts` with optional: `SENTRY_DSN` (URL), `SENTRY_ENABLED` (bool), `SENTRY_TRACES_SAMPLE_RATE` (num), `SENTRY_PROFILES_SAMPLE_RATE` (num), `METRICS_ENABLED` (bool), `METRICS_ENDPOINT`, `METRICS_AUTH_TOKEN` (min 16 if set), `METRICS_COLLECT_DEFAULT` (bool), `METRICS_COLLECT_INTERVAL_MS` (num ≥ 1000).
- Add all to `.env.example` with comments/defaults.
- Startup warning in `main.ts` (or SentryModule factory): `SENTRY_ENABLED=true` without a DSN → `logger.warn`.

### 7.5.4 — Production METRICS_AUTH_TOKEN requirement
- In `validate()`: when `NODE_ENV === 'production'` and `METRICS_ENABLED !== 'false'`, reject empty/short `METRICS_AUTH_TOKEN`. Update `metrics.config.ts` so `authToken` is sourced from the validated config.

### 7.5.5 — Business metrics wiring
- `orders.service.ts`: `incrementOrdersCreated()` on create, `incrementOrdersCompleted()` + `addRevenue()` on complete/payment, `incrementOrdersCompleted` on status→completed transitions.
- `inventory.service.ts`: `incrementInventoryMovements()` on stock create/adjust/movement.
- Kitchen service: `incrementKitchenTickets()` on ticket create/complete.
- Implement the `METRICS_COLLECT_INTERVAL_MS` gauge loop in `metrics.service.ts`.

### 7.5.6 — Real disk health indicator
- Rewrite `disk-health.indicator.ts` to use `@nestjs/terminus` `DiskHealthIndicator.checkDiskSpace({ path, threshold })` (path from config `HEALTH_DISK_PATH`, default `/`; threshold default 200MB free). Keep the RAM check as a separate `memory` indicator or drop it (it duplicates built-in MemoryHealthIndicator).

### 7.5.7 — Bull Board
- Add deps; `BullBoardModule` (Global) configures `ExpressAdapter`, creates `createQueueAdapter` per queue from `QueueService`, mounts at `/admin/queues` behind an OWNER-role auth middleware. Add metrics/logging on access. Verify 401 without token, 403 non-OWNER, 200 OWNER.

### 7.5.8 — DLQ + failure alerting
- `QueueService`: `dead-letter` queue; per-worker `QueueEvents.failed` listener re-enqueues exhausted jobs; DLQ stats in `queue.controller.ts`; metric `bull_queue_depth{queue,status="dead-letter"}`; scheduled DLQ threshold alert (config `QUEUE_DLQ_ALERT_THRESHOLD`).

### 7.5.9 — Process handlers
- `main.ts`: register `unhandledRejection`/`uncaughtException` handlers with winston fallback logging (and `process.exit(1)`), guarded so Sentry's built-in integrations don't double-handle when enabled. Register `SentryFilter` as `APP_FILTER` when Sentry is enabled (5xx capture with correlationId/tenantId/user).

### 7.5.10 — Dockerfile prod-prune
- Add `deps-prod` stage (`npm ci --omit=dev`); `runner` copies prod `node_modules` + explicit `prisma`/`@prisma/client`/`.prisma`/migrations/config; builder still uses full `node_modules`. Validate via `docker build` (or at minimum a docker-availability gate).

### 7.5.11 — Per-queue timeouts/retries
- `QUEUE_JOB_OPTIONS` map merged over global defaults in `queue.service.ts`; per-queue `timeout`, `attempts`, `backoff`. Config-driven where sensible (`QUEUE_TIMEOUT_*` not required — map is code).

### 7.5.12 — Cron overlap prevention
- `RedisLockService` in Redis module; `scheduler.service.ts` wraps each of the 9 cron enqueues: `if (await lock.acquire(key, ttl)) { enqueue; }`. Unit tests for acquire/release/skip.

### 7.5.13 — Real inventory processors
- Inspect schema/models for `InventoryItem`/`InventoryLot`/`StockMovement`/`Alert`/`WasteReport`.
- `low-stock-alerts`: find items with `currentStock <= reorderPoint` (or payload threshold), create `Alert` rows / enqueue email/notification; metrics `inventory_movements_total` unaffected.
- `expiration-checks`: find lots with `expiryDate` within N days or past; create alerts (expiring/expired).
- `waste-reports`: aggregate `StockMovement` where type = waste by period; persist a report record.
- `inventory-sync`: reconcile/structured log with counts.
- Add specs for each handler with mocked Prisma + QueueService.

### 7.5.14 — Graceful shutdown timeout
- `app.enableShutdownHooks()` + keep SIGINT/SIGTERM handlers with a forced-exit timer (default 15s, config `SHUTDOWN_TIMEOUT_MS`) that logs and `process.exit(1)` if `app.close()` exceeds the deadline.

---

## 5. Gates

After each task (except pure CI/Docker tasks, which are YAML/Dockerfile review + syntax validation):
- `npx nx build api --configuration=production`
- `npx eslint --ext .ts apps/api/src` (project lint)
- `npx nx test api` (unit tests)
- `npx prisma validate` (schema untouched, sanity check only)
- New/changed specs must pass; coverage thresholds unchanged from HEAD for M5-touched paths where applicable.

Task gates:
- 7.5.3/7.5.4: unit test for `validate()` — prod without `METRICS_AUTH_TOKEN` throws.
- 7.5.6: health endpoint test asserting real disk check.
- 7.5.7: `/admin/queues` 401/403/200 test.
- 7.5.8: DLQ unit test — job fails past retries → re-enqueued to `dead-letter`.
- 7.5.12: lock acquire/release/skip tests.
- 7.5.13: handler specs with mocked Prisma.

---

## 6. Verification

`scripts/verify-phase7-m5.js` (mirrors M4 harness pattern):

- **G1** npm audit wired: `ci.yml` contains `npm audit`; `codeql.yml` exists with `codeql-action`.
- **G2** docker publish workflow exists, contains `build-push-action`, `login-action`, SHA tagging.
- **G3** env.validation.ts contains `SENTRY_DSN`, `SENTRY_ENABLED`, `METRICS_AUTH_TOKEN`, `METRICS_COLLECT_INTERVAL_MS`; `.env.example` mirrors them.
- **G4** prod validation rejects missing `METRICS_AUTH_TOKEN` (unit test reference).
- **G5** metrics wiring: orders/inventory/kitchen services reference `MetricsService` increment methods.
- **G6** disk-health.indicator.ts uses `DiskHealthIndicator`/`checkDiskSpace`; bull-health no longer references `audit-log`.
- **G7** Bull Board: `bull-board` deps present, route registered, auth middleware applied.
- **G8** DLQ: `dead-letter` queue registered; failed-event listener exists; alert threshold config exists.
- **G9** process handlers registered in `main.ts`; `enableShutdownHooks` + shutdown timeout present.
- **G10** Dockerfile: `deps-prod` stage with `npm ci --omit=dev`; `runner` copies prod node_modules; prisma CLI preserved.
- **G11** queue.service.ts has per-queue job options map with `timeout`.
- **G12** scheduler uses `RedisLockService` for all 9 cron jobs.
- **G13** inventory processors contain real Prisma queries (no log-only stubs).

Deliverables: `PHASE7-M5-REPORT.md`, `PHASE7-M5-CHANGELOG.md`, commit `feat(ops): implement Phase 7 M5 observability & infrastructure milestone`, tag `v7.5.0`.

---

## 7. Risks

- **Bull Board dependency install** may pull transitive peer requirements — pin `@bull-board/api`/`@bull-board/express` to a compatible version for `bullmq ^5.81.2`.
- **`npm ci --omit=dev` prune** can break `prisma migrate deploy` in the runner — mitigated by explicit CLI copy; must be verified with a real `docker build`.
- **CI tasks cannot be executed locally** (GitHub-hosted runners, registry, CodeQL) — validated by YAML review + actionlint-style syntax check; marked `info` if not runnable.
- **Metrics gauges loop** must be careful not to double-register prom-client metrics on module reload (guarded by `MetricsService` singleton).
- **Scheduler locks** must never deadlock — always acquire with TTL; release only after successful enqueue; jobs that crash leave TTL-expiring locks.
