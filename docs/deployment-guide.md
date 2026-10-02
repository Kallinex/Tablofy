# Tablofy — Deployment Guide

## Prerequisites

- **Node.js** 22+
- **Docker** & Docker Compose
- **PostgreSQL** 16 (via Docker or native)
- **Redis** 7 (via Docker or native)

## Environment Setup

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set production values:
   - `NODE_ENV=production`
   - `JWT_SECRET` — strong random string (min 32 chars)
   - `JWT_REFRESH_SECRET` — strong random string (min 32 chars, different from above)
   - `CORS_ORIGINS` — comma-separated list of allowed origins (never `*` in production)
   - `DATABASE_URL` — production PostgreSQL connection string
   - `REDIS_URL` — production Redis connection string

## Database Migrations

```bash
# Apply migrations to production database
npm run prisma:migrate:prod

# Verify migration status
npm run prisma:status
```

**Migration workflow:**

- **Development**: `npm run prisma:migrate:dev` — creates and applies migrations
- **Production**: `npm run prisma:migrate:prod` — applies pending migrations only
- **Reset**: `npm run prisma:reset` — drops and recreates database (dev only)

**Rollback strategy:**

- Prisma Migrate does not support automatic rollback of individual migrations
- To revert: create a new migration that reverses the unwanted changes
- For emergencies: restore from database backup, then re-apply migrations

## Docker Deployment

### Development

```bash
docker compose -f docker/docker-compose.yml up -d
```

### Production

1. Copy and fill the production environment file (see `docker/.env.prod.example`):

   ```bash
   cp docker/.env.prod.example docker/.env
   # edit docker/.env — every CHANGE_ME_* value must be replaced
   ```

   Run commands with `--env-file docker/.env` (or from the `docker/` directory).

2. Provide TLS certificates (or use certbot, below) and an rclone config, then:

   ```bash
   docker compose -f docker/docker-compose.prod.yml --env-file docker/.env up -d --build

   # Scale the API for load balancing / HA (nginx balances across replicas)
   docker compose -f docker/docker-compose.prod.yml --env-file docker/.env up -d --scale api=3

   # View logs
   docker compose -f docker/docker-compose.prod.yml --env-file docker/.env logs -f api
   ```

The production compose file includes:

- PostgreSQL 16 with health check
- Redis 7 with persistence
- API service with multi-stage build
- **nginx** reverse proxy (TLS termination, HTTP→HTTPS redirect, WebSocket upgrade, round-robin load balancing)
- **backup** sidecar (nightly `pg_dump` uploaded offsite via rclone)
- Automatic service dependency ordering
- Health checks on all services
- Fail-fast interpolation: the stack refuses to start unless `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `METRICS_AUTH_TOKEN`, `WEBHOOK_ENCRYPTION_KEY`, `SMTP_HOST` and `SMTP_FROM` are set

## Reverse Proxy, TLS, DNS & HA

The bundled `nginx` service terminates TLS on `:443` and redirects `:80` to
HTTPS:

- **DNS**: point an `A`/`AAAA` record (e.g. `api.example.com`) at the host
  running the stack. Use a managed load balancer (ALB, etc.) instead of the
  bundled nginx when running multi-host; forward `X-Forwarded-For` and
  `X-Forwarded-Proto`, and keep `TRUST_PROXY` set to the number of trusted hops.
- **TLS certificates**: mount `fullchain.pem` + `privkey.pem` into
  `docker/nginx/certs` (override with `TLS_CERT_PATH` / `TLS_KEY_PATH`), or
  issue/renew with certbot against the shared `certbot_webroot` volume:

  ```bash
  docker run --rm \
    -v "$PWD/docker/nginx/certs:/etc/letsencrypt" \
    -v "$PWD/docker/nginx/webroot:/var/www/certbot" \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    -d api.example.com --email ops@example.com --agree-tos --no-eff-email
  # then point the stack at the issued certs in docker/.env:
  #   TLS_CERT_PATH=./nginx/certs/live/api.example.com/fullchain.pem
  #   TLS_KEY_PATH=./nginx/certs/live/api.example.com/privkey.pem
  ```

- **HA / scaling**: run multiple api replicas (`--scale api=N`) across hosts;
  nginx or an external load balancer distributes traffic. Keep sessions
  stateless (JWT) and Redis/Postgres shared/managed. Use managed PostgreSQL with
  automated failover and a replicated Redis for availability.

## Offsite Backups

The `backup` sidecar runs `pg_dump` nightly (`BACKUP_CRON`, default `0 2 * * *`)
and uploads the custom-format dump to an rclone remote, then prunes remote
dumps older than `BACKUP_RETENTION_DAYS`.

```bash
# One-time: create an rclone remote named "offsite" (s3 / b2 / drive / spaces)
rclone config --config docker/rclone/rclone.conf

# Run a backup immediately
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env \
  run --rm --entrypoint /usr/local/bin/run-backup.sh backup
```

Restore into a fresh database:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "$DATABASE_URL" tablofy-<stamp>.dump
```

Test restores regularly; an untested backup is not a backup.

## Manual Deployment

```bash
# Install dependencies
npm ci

# Generate Prisma client
npx prisma generate

# Build
npx nx build api

# Apply migrations
npx prisma migrate deploy

# Start
node dist/apps/api/app/main.js
```

## Enterprise SSO (OIDC + SAML 2.0)

Optional per-tenant single sign-on against an OIDC-compliant identity provider
(Microsoft Entra ID, Okta, Google Workspace, Keycloak, Auth0, ...) or any
SAML 2.0 IdP (ADFS, Entra ID, Okta, OneLogin, ...). OIDC uses the Authorization
Code flow with PKCE, state and nonce. SAML uses the HTTP-Redirect binding for
the AuthnRequest and the HTTP-POST binding for the Assertion Consumer Service;
assertion signatures are verified against the configured IdP certificate.
IdP client secrets are encrypted at rest (AES-256-GCM).

```bash
# .env (or docker/.env)
SSO_ENABLED=true
SSO_ENCRYPTION_KEY=<openssl rand -hex 32>   # falls back to WEBHOOK_ENCRYPTION_KEY
SSO_CALLBACK_BASE_URL=https://api.example.com/api   # include the global prefix
SSO_SUCCESS_REDIRECT_URL=https://app.example.com/sso/callback
SSO_FAILURE_REDIRECT_URL=https://app.example.com/login
```

**OIDC:** register the redirect URI
`<SSO_CALLBACK_BASE_URL>/auth/sso/callback` at the IdP. Create the connection
with `type: "OIDC"` plus `issuerUrl`, `clientId` and `clientSecret`.

**SAML:** register the ACS URL
`<SSO_CALLBACK_BASE_URL>/auth/sso/saml/acs` at the IdP and download the SP
metadata from `GET /api/v1/auth/sso/:id/saml/metadata`. Create the connection
with `type: "SAML"` plus `idpEntityId`, `idpSsoUrl` (the IdP SSO/redirect
endpoint) and `idpCertificate` (the IdP X.509 signing certificate, PEM or
base64 DER); `spEntityId` defaults to the metadata URL.

After either flow the browser is sent to
`SSO_SUCCESS_REDIRECT_URL?code=<one-time-code>`; exchange that code once at
`POST /auth/sso/exchange` to receive the Tablofy token pair.

Tenant admins manage the connection:

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/api/v1/auth/sso/connections` | OWNER/MANAGER | Create an OIDC or SAML connection |
| GET | `/api/v1/auth/sso/connections` | OWNER/MANAGER | Read it (secret hidden) |
| PATCH | `/api/v1/auth/sso/connections/:id` | OWNER/MANAGER | Update (issuer/IdP/domains/role) |
| DELETE | `/api/v1/auth/sso/connections/:id` | OWNER | Remove it |
| GET | `/api/v1/auth/sso/discover?email=` | public | Login hint for a domain |
| GET | `/api/v1/auth/sso/:id/authorize` | public | Start the OIDC or SAML redirect flow |
| POST | `/api/v1/auth/sso/saml/acs` | public | SAML Assertion Consumer Service |
| GET | `/api/v1/auth/sso/:id/saml/metadata` | public | SP metadata XML for a SAML connection |

`autoProvision` (default true) creates a local user on first login with
`defaultRole`; `allowedEmailDomains` restricts which domains may sign in. Set
`autoProvision=false` to require pre-invited users only. Users disabled or
suspended locally cannot sign in via SSO.

## Queue Configuration

BullMQ queues (Redis-based):
| Queue | Concurrency | Purpose |
|-------|-------------|---------|
| email | 3 | Email delivery |
| cleanup | 1 | Expired session/token cleanup |
| notification | 5 | In-app notifications |

Queue stats available at `GET /api/v1/queues/:name/stats` (OWNER/MANAGER role).

## Scheduler Configuration

Cron jobs (via @nestjs/schedule):

| Job                      | Schedule          | Description                                 |
| ------------------------ | ----------------- | ------------------------------------------- |
| cleanup_expired_sessions | Every 6 hours     | Removes expired sessions                    |
| cleanup_expired_tokens   | Every 12 hours    | Removes expired verification tokens         |
| archive_old_audit_logs   | Daily at midnight | Archives audit logs beyond retention period |

### Configurable Retention

| Variable                         | Default | Description                         |
| -------------------------------- | ------- | ----------------------------------- |
| `CLEANUP_SESSION_RETENTION_DAYS` | 30      | Session retention in days           |
| `CLEANUP_TOKEN_RETENTION_DAYS`   | 7       | Token retention in days             |
| `AUDIT_LOG_RETENTION_DAYS`       | 365     | Audit log retention before archival |

## Health Checks

- `GET /api/v1/health` — Returns database, Redis, and memory status
- Used by Docker HEALTHCHECK and load balancer probes
- Returns 200 OK when all systems operational

## Production Checklist

- [ ] Strong random JWT secrets (not the example values) — **enforced at boot**
- [ ] CORS_ORIGINS set to explicit allowed origins (not `*`) — **enforced at boot**
- [ ] HTTPS enabled behind reverse proxy (bundled nginx) and `TRUST_PROXY` set
- [ ] PostgreSQL connection uses SSL/TLS (`sslmode=require` for managed DBs)
- [ ] Redis connection uses password authentication — **enforced at boot**
- [ ] `METRICS_AUTH_TOKEN` set (min 16 chars) — **enforced at boot**
- [ ] `WEBHOOK_ENCRYPTION_KEY` set (min 32 chars) — **enforced at boot**
- [ ] `SMTP_HOST` + `SMTP_FROM` set — **enforced at boot**
- [ ] Live payment gateways fully configured (`sk_live_*` + webhook secret, Paymob integration id + webhook secret) — **enforced at boot**
- [ ] Swagger, if enabled in production, protected by `SWAGGER_AUTH_USER`/`SWAGGER_AUTH_PASSWORD` — **enforced at boot**
- [ ] If SSO is enabled: `SSO_ENCRYPTION_KEY` (or `WEBHOOK_ENCRYPTION_KEY`), `SSO_CALLBACK_BASE_URL` and the redirect URLs set; redirect URI registered at the IdP — **enforced at boot**
- [ ] Offsite database backups configured (rclone remote) and **restore tested**
- [ ] Monitoring and alerting configured
- [ ] Rate limiting limits tuned for expected traffic
- [ ] Application runs as non-root user ✅ (Dockerfile default)
- [ ] Multi-stage Docker build ✅ (minimal production image, `npm ci --omit=dev`)
- [ ] Prisma migrations applied via `migrate deploy`
- [ ] Secrets managed via environment variables (not in code)
- [ ] HA: multiple api replicas behind the LB; managed/replicated Postgres and Redis
