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
```bash
# Build and start all services
docker compose -f docker/docker-compose.prod.yml up -d --build

# View logs
docker compose -f docker/docker-compose.prod.yml logs -f api
```

The production compose file includes:
- PostgreSQL 16 with health check
- Redis 7 with persistence
- API service with multi-stage build
- Automatic service dependency ordering
- Health checks on all services

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

| Job | Schedule | Description |
|-----|----------|-------------|
| cleanup_expired_sessions | Every 6 hours | Removes expired sessions |
| cleanup_expired_tokens | Every 12 hours | Removes expired verification tokens |
| archive_old_audit_logs | Daily at midnight | Archives audit logs beyond retention period |

### Configurable Retention
| Variable | Default | Description |
|----------|---------|-------------|
| `CLEANUP_SESSION_RETENTION_DAYS` | 30 | Session retention in days |
| `CLEANUP_TOKEN_RETENTION_DAYS` | 7 | Token retention in days |
| `AUDIT_LOG_RETENTION_DAYS` | 365 | Audit log retention before archival |

## Health Checks

- `GET /api/v1/health` — Returns database, Redis, and memory status
- Used by Docker HEALTHCHECK and load balancer probes
- Returns 200 OK when all systems operational

## Production Checklist

- [ ] Strong random JWT secrets (not the example values)
- [ ] CORS_ORIGINS set to explicit allowed origins (not `*`)
- [ ] HTTPS enabled behind reverse proxy (nginx, Caddy, etc.)
- [ ] PostgreSQL connection uses SSL/TLS
- [ ] Redis connection uses password authentication
- [ ] Database backups configured and tested
- [ ] Monitoring and alerting configured
- [ ] Rate limiting limits tuned for expected traffic
- [ ] Security headers verified (CSP, HSTS, etc.)
- [ ] Logs shipped to centralized logging system
- [ ] Application runs as non-root user ✅ (Dockerfile default)
- [ ] Multi-stage Docker build ✅ (minimal production image)
- [ ] Prisma migrations applied via `migrate deploy`
- [ ] Secrets managed via environment variables (not in code)
