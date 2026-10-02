# Tablofy

Enterprise multi-tenant restaurant management platform. The backend is a NestJS 11
application backed by PostgreSQL (Prisma), Redis (cache + BullMQ queues) and
Socket.IO, exposing a versioned REST API, Prometheus metrics and a hardened
production deployment.

This repository is an [Nx](https://nx.dev) workspace containing the API application
and the shared libraries it depends on.

## Table of contents

- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Running the API](#running-the-api)
- [Testing](#testing)
- [Linting, formatting and building](#linting-formatting-and-building)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Observability and health checks](#observability-and-health-checks)
- [Payments](#payments)
- [Single sign-on (OIDC and SAML 2.0)](#single-sign-on-oidc-and-saml-20)
- [File uploads](#file-uploads)
- [Webhooks](#webhooks)
- [Deployment](#deployment)
- [Security notes](#security-notes)

## Tech stack

| Layer            | Technology                                                          |
| ---------------- | ------------------------------------------------------------------- |
| Runtime          | Node.js 22, TypeScript 6                                            |
| Framework        | NestJS 11 (Express 5)                                               |
| Database         | PostgreSQL + Prisma ORM (128 models)                                |
| Cache / queues   | Redis 7, ioredis, BullMQ (+ Bull Board UI)                          |
| Realtime         | Socket.IO                                                           |
| Auth             | JWT access/refresh, Passport, TOTP MFA, API keys, OIDC + SAML SSO   |
| Docs             | OpenAPI / Swagger                                                   |
| Observability    | winston, Prometheus (`prom-client`), Sentry, Terminus health checks |
| Monorepo tooling | Nx 23, Jest 30, ESLint 10, Prettier                                 |

## Repository layout

```
apps/
  api/                     NestJS API application
    src/
      app/                 Root module and application wiring
      config/              Typed, validated configuration factories
      common/              Guards, interceptors, filters, upload, logger, ws, ...
      health/              Terminus health indicators and probes
      modules/             Feature modules (auth, orders, inventory, payments, ...)
      prisma/              PrismaService
      redis/               Redis module/service
      test/                Test helpers (contract harness, auto-mock, app factory)
libs/
  shared/                  Shared constants, types and utilities
docker/                    Dockerfile, docker-compose (dev + prod), nginx, backup
docs/
  deployment-guide.md      Production deployment runbook
prisma/
  schema.prisma            Database schema
  migrations/              Versioned migrations
```

## Prerequisites

- Node.js 22+
- npm 10+
- Docker (for local PostgreSQL and Redis, or for the full stack)
- A PostgreSQL and Redis instance reachable from the API

## Getting started

1. Install dependencies:

   ```sh
   npm install
   ```

   `postinstall` runs `prisma generate`.

2. Create your environment file from the template and fill in the required values
   (see [Configuration](#configuration)):

   ```sh
   cp .env.example .env
   ```

3. Start PostgreSQL and Redis. The dev compose file ships a strong dev-only default
   password for Redis:

   ```sh
   docker compose -f docker/docker-compose.yml up -d
   ```

4. Apply migrations and seed data:

   ```sh
   npm run prisma:migrate:dev
   npm run prisma:seed
   ```

   Destructive Prisma scripts are guarded by `prisma/scripts/assert-safe-db.js` and
   refuse to run against production-like databases.

## Running the API

```sh
npm run start:api        # equivalent to: nx serve api
```

- API base URL: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/docs` (enabled by default outside production)
- Prometheus metrics: `http://localhost:3000/api/v1/metrics` (when metrics are enabled)

## Testing

```sh
npm test                                   # nx test api
npm run test:coverage                      # with coverage thresholds
npm run test:watch                         # watch mode
npx nx test api --testPathPatterns=<regex> # single file / pattern
```

The suite uses Jest with `ts-jest`, `clearMocks` and `restoreMocks` enabled globally.
Contract tests build every controller handler through `apps/api/src/test/helpers`.

## Linting, formatting and building

```sh
npm run lint          # nx run-many -t lint
npm run format        # prettier --write
npm run format:check  # prettier --check
npm run build:api     # nx build api (webpack)
```

## Configuration

All configuration is validated at boot; the application fails fast on invalid or
missing values. The canonical, documented list of variables lives in
[`.env.example`](.env.example). Production values live in
[`docker/.env.prod.example`](docker/.env.prod.example).

Key groups:

| Group         | Variables (examples)                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| Application   | `NODE_ENV`, `PORT`, `API_PREFIX`, `CORS_ORIGINS`, `FRONTEND_URL`, `TRUST_PROXY`    |
| Database      | `DATABASE_URL`                                                                     |
| Redis         | `REDIS_HOST`, `REDIS_PORT`, `REDIS_URL`, `REDIS_PASSWORD`                          |
| JWT           | `JWT_SECRET`, `JWT_EXPIRATION`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRATION`     |
| Rate limiting | `THROTTLE_TTL`, `THROTTLE_LIMIT`                                                   |
| Observability | `SENTRY_*`, `METRICS_*`, `HEALTH_*`, `LOG_*`                                       |
| Payments      | `PAYMENTS_MODE`, `STRIPE_*`, `PAYMOB_*`                                            |
| Webhooks      | `WEBHOOK_ENCRYPTION_KEY`, `WEBHOOK_*`                                              |
| Email         | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`                    |
| Exports       | `EXPORT_DIR`, `REPORT_EXPORT_RETENTION_DAYS`                                       |
| SSO           | `SSO_ENABLED`, `SSO_ENCRYPTION_KEY`, `SSO_CALLBACK_BASE_URL`, `SSO_*_REDIRECT_URL` |
| Uploads       | `UPLOAD_DIR`, `UPLOAD_PUBLIC_BASE_URL`, `UPLOAD_MAX_IMAGE_SIZE_BYTES`              |
| Dependencies  | `SMS_PROVIDER_URL`, `SMS_API_KEY`, `HEALTH_DEPENDENCY_TIMEOUT_MS`                  |

Production boot requires, at minimum: a non-empty `REDIS_PASSWORD` (16+ chars),
`WEBHOOK_ENCRYPTION_KEY` (32+ chars), `SMTP_HOST` + `SMTP_FROM`, and `METRICS_AUTH_TOKEN`
(16+ chars) whenever metrics are enabled. Live payment gateways require their webhook
secrets.

## Architecture

### Layers

- **Controllers** expose versioned routes (`/api/v1/...`), declare RBAC with
  `@Roles()` / `@Permissions()`, and stay thin.
- **Services** hold business logic. They use `PrismaService` directly, scoped by
  `tenantId`.
- **Guards / interceptors / filters** provide authentication (JWT, API key),
  authorization, throttling, tenant isolation, response transformation, audit and
  error normalization.
- **Events / queues** decouple side effects: domain events are emitted with
  `@nestjs/event-emitter` and heavy work runs on BullMQ queues with retries,
  backoff and a dead-letter queue.

### Multi-tenancy

Every tenant-scoped record carries `tenantId`. Request context (tenant, user, role)
is resolved from the JWT and enforced by guards and the tenant-isolation
middleware. Cross-tenant reads and writes are rejected.

### Module map

Feature modules live under `apps/api/src/modules` and include: `auth`, `tenants`,
`users`, `invitations`, `sessions`, `restaurants`, `branches`, `floors`,
`dining-areas`, `tables`, `menu`, `orders`, `kds`, `inventory` (ingredients,
suppliers, purchasing, transfers, cycle-counts, warehouses), `crm`, `payments`,
`subscriptions`, `webhooks`, `api-keys`, `gift-cards`, `privacy`, `backup`, `usage`,
`sso`, `scheduler`, `scheduled-reports`, `export-engine`, `queues`, and the analytics
modules (`sales`, `financial`, `live`, `customer`, `inventory`, `kitchen`,
`supplier`, `forecasting`, `executive-dashboard`).

## Observability and health checks

All API routes include the global prefix: `/api/v1`. Swagger at `/docs` and Bull
Board at `/admin/queues` are mounted outside the prefixed router.

| Endpoint                          | Purpose                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/v1/health`              | Full health check (memory, disk, prisma, redis)                                  |
| `GET /api/v1/health/live`         | Liveness                                                                         |
| `GET /api/v1/health/ready`        | Readiness for load balancers                                                     |
| `GET /api/v1/health/dependencies` | External probes: SMTP `verify()`, optional SMS gateway, configured Stripe/Paymob |
| `GET /api/v1/metrics`             | Prometheus metrics (authenticated in production)                                 |
| `/admin/queues`                   | Bull Board queue dashboard (protected)                                           |

Sentry is enabled only when both `SENTRY_ENABLED=true` and `SENTRY_DSN` are set.
When Sentry is disabled the app installs explicit `unhandledRejection` /
`uncaughtException` handlers with fallback logging and forced shutdown.

## Payments

Payment processing supports Stripe (card) and Paymob (mobile payment) behind a
provider abstraction. `PAYMENTS_MODE` controls behavior:

- `mock` — fake gateway responses. Forbidden in production (boot fails).
- `test` — real Stripe API with `sk_test_*` keys. Forbidden in production.
- `live` — real credentials required; live Stripe requires `STRIPE_WEBHOOK_SECRET`
  and Paymob requires a positive `PAYMOB_INTEGRATION_ID` + `PAYMOB_WEBHOOK_SECRET`.

## Single sign-on (OIDC and SAML 2.0)

Per-tenant SSO connections are supported for both OIDC and SAML 2.0. OIDC uses
PKCE + state/nonce; SAML validates signed assertions. IdP client secrets are
encrypted at rest with AES-256-GCM. Successful logins use JIT provisioning with
domain/role enforcement and complete through a one-time exchange code. SP metadata
is served at `GET /auth/sso/:id/saml/metadata`. See `.env.example` for the full
variable list.

## File uploads

Product images are uploaded via
`POST /restaurants/:restaurantId/products/:productId/images/upload`
(`multipart/form-data`, field `file`, `OWNER`/`MANAGER` only). Uploads use memory
storage with a configurable size limit, a MIME + extension allowlist and
magic-byte verification. Files are written under `UPLOAD_DIR` in a
tenant/product-scoped path and served from `/uploads/...` (or the configured
`UPLOAD_PUBLIC_BASE_URL`). Use a shared volume or object storage in multi-instance
deployments.

## Webhooks

Tenants register HTTP endpoints that receive signed, retried event deliveries.
Signing secrets are encrypted at rest (AES-256-GCM) using
`WEBHOOK_ENCRYPTION_KEY`; deliveries use exponential backoff and a dead-letter
queue, with per-tenant registration limits and secret rotation.

## Deployment

The production deployment (Docker image, `docker/docker-compose.prod.yml`, nginx
TLS/load balancing/WebSocket proxying, offsite backups) is documented in
[`docs/deployment-guide.md`](docs/deployment-guide.md). CI publishes images and runs
security scanning via the workflows in `.github/workflows`.

## Security notes

- Helmet with a strict production CSP, HSTS and cross-origin policies.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`.
- Per-IP throttling (`TRUST_PROXY` must be set behind a reverse proxy) and plan-based
  throttling.
- Swagger is off by default in production; enabling it requires HTTP Basic auth.
- `/metrics` requires a bearer token in production.
- JWT refresh tokens are rotated and revoked tokens are blacklisted.

## License

MIT
