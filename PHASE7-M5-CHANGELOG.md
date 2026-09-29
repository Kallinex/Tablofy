# Phase 7 — M5 Changelog

## CI/CD

### 7.5.1 — Docker publish workflow (new)

- `.github/workflows/docker-publish.yml` — builds and pushes to `ghcr.io` on `main` push and `v*` tags.
  Tags: `{git_sha}` always; branch name on branch pushes; `{ref_name}` + `latest` + `v<major>` on version tags.
  `docker/login-action` (ghcr.io, `secrets.GITHUB_TOKEN`), `docker/build-push-action` with gha cache.

### 7.5.2 — Security scanning (new/modified)

- `.github/workflows/ci.yml` — added `Security audit (SCA)` step: `npm audit --audit-level=high`.
- `.github/workflows/codeql.yml` (new) — `codeql-action/init` → `autobuild` → `analyze` with `security-extended`
  queries, on push/PR + weekly schedule.

## Config & Environment

### 7.5.3 / 7.5.4 — Observability env vars (modified)

- `apps/api/src/config/env.validation.ts` — added optional `SENTRY_DSN`, `SENTRY_ENABLED`, `SENTRY_TRACES_SAMPLE_RATE`,
  `SENTRY_PROFILES_SAMPLE_RATE`, `METRICS_ENABLED`, `METRICS_ENDPOINT`, `METRICS_AUTH_TOKEN` (min 16 when set),
  `METRICS_COLLECT_DEFAULT`, `METRICS_COLLECT_INTERVAL_MS` (≥1000), `QUEUE_DLQ_ALERT_THRESHOLD`,
  `SHUTDOWN_TIMEOUT_MS`, `HEALTH_DISK_PATH`, `HEALTH_DISK_THRESHOLD_MB`. Production validation rejects a
  missing/short `METRICS_AUTH_TOKEN` when `METRICS_ENABLED !== 'false'`.
- `.env.example` — documents all new vars with defaults.
- `apps/api/src/config/app.config.ts` — `app.shutdownTimeoutMs` from `SHUTDOWN_TIMEOUT_MS`.
- `apps/api/src/common/sentry/sentry.module.ts` — Sentry bootstrap with env config + startup warning when enabled without DSN.
- `apps/api/src/config/env.validation.spec.ts` (new) — 8 tests incl. prod token rejection.

## Observability

### 7.5.5 — Business metrics wiring (modified)

- `apps/api/src/common/metrics/metrics.service.ts` — `METRICS_COLLECT_INTERVAL_MS` gauge loop (event-loop delay via
  `monitorEventLoopDelay`, GC via `PerformanceObserver`, memory + CPU gauges); `eventLoopHistogram.disable()` on destroy.
- `apps/api/src/modules/orders/orders.service.ts` — `incrementOrdersCreated()` on create, `incrementOrdersCompleted()`
  on completion.
- `apps/api/src/modules/inventory/inventory.service.ts` — `incrementInventoryMovements()` on stock create/adjust/movement.
- `apps/api/src/modules/kds/kds.service.ts` — `incrementKitchenTickets()` on ticket create/complete.
- `apps/api/src/test/mocks/metrics.mock.ts` (new) — shared metrics mock; orders/inventory/kds/payment specs updated.

### 7.5.6 — Real disk health (modified)

- `apps/api/src/health/disk-health.indicator.ts` — **deviation**: real disk check via `fs.promises.statfs`
  (`HEALTH_DISK_PATH`, `HEALTH_DISK_THRESHOLD_MB` default 200MB) + `HealthCheckError` (Terminus v11 exposes no
  public `checkDiskSpace`).
- `apps/api/src/health/bull-health.indicator.ts` — reads real queue stats (`email`, `cleanup`, `notification`,
  `kitchen`, `print`); no audit-log dependency.

### 7.5.9 — Process handlers (modified)

- `apps/api/src/main.ts` — `unhandledRejection`/`uncaughtException` handlers with winston fallback logging + forced
  shutdown when Sentry is disabled (Sentry's own integrations cover them when enabled). **`SentryFilter` skipped**
  (HttpExceptionFilter already captures 5xx → Sentry; would double-capture).

## Queue Reliability

### 7.5.7 — Bull Board (new)

- `apps/api/src/common/bull-board/bull-board.module.ts` — Global module; `ExpressAdapter` + `BullMQAdapter`
  (`@bull-board/api/bullMQAdapter`); registers queues lazily via `QueueService.setQueueListener`; `BULL_BOARD_PATH =
/admin/queues`; OWNER-role auth middleware (JwtService verify + `RedisService.isTokenBlacklisted`).
- `apps/api/src/main.ts` — mounted after Swagger: `app.use(BULL_BOARD_PATH, auth, router)`.
- `package.json` — `@bull-board/api`, `@bull-board/express` (`^8.5.0`).
- `apps/api/src/common/bull-board/tests/bull-board.module.spec.ts` (new) — 401/403/200 + router/path/registration.

### 7.5.8 — Dead letter queue (modified/new)

- `apps/api/src/modules/queues/queue.service.ts` — `dead-letter` queue; worker `failed` listener re-enqueues
  exhausted jobs (attempts >= opts.attempts) with `error`/`attemptsMade`/`failedAt` metadata; DLQ depth monitor
  (`QUEUE_DLQ_ALERT_THRESHOLD`, default 50) logs error + `bull_queue_depth{status="dead-letter"}`.
- `apps/api/src/modules/queues/dead-letter.processor.ts` (new) — consumes `dead-letter`, structured error logging.
- `apps/api/src/modules/queues/queue.module.ts` — registers processor.
- `apps/api/src/common/metrics/metrics.service.ts` — `deadLetter` counter + `incrementBullQueueDeadLetter()`.

### 7.5.11 — Per-queue job options (modified)

- `apps/api/src/modules/queues/queue.service.ts` — `QUEUE_JOB_OPTIONS` map merged over `BASE_JOB_OPTIONS`
  (email/notification/webhook-delivery 5 attempts + 30s; export/forecast/analytics 300–600s; dead-letter 1);
  `getQueueNames()`; global default job options per queue.
- `apps/api/src/modules/queues/tests/queue.service.spec.ts` (new) — 8 tests (opts merge, DLQ, monitor, names).
- `apps/api/src/test/mocks/bullmq.mock.ts` — static `Queue.last`/`Worker.last`; `addBulk`/`getJobCounts`.

## Scheduler & Redis

### 7.5.12 — Cron overlap prevention (new/modified)

- `apps/api/src/redis/redis-lock.service.ts` (new) — `acquire(key, ttlMs)` via `SET key token PX ttl NX`, `release`
  via Lua compare-and-delete, `runIfLocked` skip-if-held + release in `finally`.
- `apps/api/src/redis/redis.module.ts` — Global; exports `RedisLockService`.
- `apps/api/src/modules/scheduler/scheduler.service.ts` — all 9 `@Cron` handlers wrapped via `runLocked('cron:<job>',
5min, task)`; enqueue skipped when lock not held.
- `apps/api/src/redis/tests/redis-lock.service.spec.ts` (new) — 7 tests; scheduler spec (new) 2 tests.

## Inventory

### 7.5.13 — Real processors (modified/new)

- `apps/api/src/modules/inventory/inventory.processor.ts` — replaces log-only stubs:
  - `low-stock-alerts`: Prisma query on `InventoryItem` (reorderLevel/minStock thresholds, optional branch), creates
    `Notification` (`LOW_STOCK`) for active OWNER/MANAGER users, enqueues `notification` summary job.
  - `expiration-checks`: `InventoryBatch` expiring within N days (default 30), dedupes against open
    `ExpirationAlert`s, creates `WARNING`/`CRITICAL`/`EXPIRED` alerts + notification job.
  - `waste-reports`: aggregates `WasteEntry` by type/period (day/week/month) → persists `Report`
    (`INVENTORY`, `GENERATED`) with totals.
  - `inventory-sync`: tenant-scoped counts + batch-quantity reconciliation with structured log.
- `apps/api/src/modules/inventory/tests/inventory.processor.spec.ts` (new) — 8 tests, mocked Prisma + QueueService.

## Runtime / Docker

### 7.5.14 — Graceful shutdown (modified)

- `apps/api/src/main.ts` — `enableShutdownHooks(['SIGINT','SIGTERM'], { useProcessExit: true })`; signal watchdog
  timers enforce `SHUTDOWN_TIMEOUT_MS` (default 15s) forced `process.exit(1)`; non-signal fatal path uses `app.close()`.

### 7.5.10 — Dockerfile prod-prune (modified)

- `docker/Dockerfile` — new `deps-prod` stage (`npm ci --omit=dev` + `npx prisma generate`, with `openssl` for
  Alpine engines); `runner` copies prod `node_modules` from `deps-prod`; prisma CLI/`@prisma/client`/`.prisma`
  preserved for runtime `migrate deploy`; fixed `prisma.config.ts` copy path (root, not `prisma/`).

## Verification

- `scripts/verify-phase7-m5.js` (new) — 39-check harness (G1–G17), mirrors M4 pattern.
- `PHASE7-M5-REPORT.md` (new) — gates, task table, corrections, docker note.

## Contract / Behavioral Notes

- `/admin/queues` (Bull Board) is now exposed but requires an OWNER-role bearer token (existing JWT + Redis
  blacklist); returns 401/403 otherwise.
- Production boot now **fails validation** when metrics are enabled without a `METRICS_AUTH_TOKEN` (≥16 chars).
- Failed BullMQ jobs that exhaust retries are moved to `dead-letter` (kept 7 days) instead of only being dropped.
- Scheduled cleanup jobs skip execution when another replica holds the `cron:*` lock.
- Inventory `waste-reports` requires a `tenantId` in job data (per-tenant by design).
