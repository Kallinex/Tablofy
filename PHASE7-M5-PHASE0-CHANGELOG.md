# Phase 0 — Post-Release Changelog

Changelog for the Phase 0 recovery + verification session (post-crash). Only code changes made to fix
**new, verified** boot blockers are listed; all other pre-crash Phase 0 modifications were left untouched
and remain uncommitted.

## Docker

### Dockerfile prod log directory (modified)

- `docker/Dockerfile` — added `RUN mkdir -p /app/logs && chown -R nestjs:nodejs /app/logs` in the `runner`
  stage **before** `USER nestjs`. Fixes runtime EACCES on winston daily-rotate-file target `/app/logs`.
  Boot now writes `/app/logs/app-*.log`, `/app/logs/error-*.log`, and audit JSON as `nestjs`.

## API Boot Blockers

### Payments per-provider mode (modified)

- `apps/api/src/modules/payments/payments.module.ts` — `STRIPE_PROVIDER_OPTIONS` / `PAYMOB_PROVIDER_OPTIONS`
  now derive live/mock **from that provider's own credential** (live only when `stripeSecretKey` /
  `paymobApiKey` present; else mock). Previously the global `PAYMENTS_MODE=live` forced both providers
  live, so a Stripe-only production deployment threw on boot (`StripeProvider` requires `secretKey`,
  `PaymobProvider` requires `apiKey`) — contradicting the config guard permitting a single gateway.
  Mock-in-prod remains loudly blocked by the existing `assertNotMockInProduction` guard.
  Stripe-only prod now boots: Stripe live, Paymob mock.

### Logger resolve (modified)

- `apps/api/src/main.ts` — `app.get(AppLoggerService)` → `await app.resolve(AppLoggerService)`.
  `AppLoggerService` is `@Injectable({ scope: Scope.TRANSIENT })`; `app.get()` on a scoped provider
  throws `InvalidClassScopeException`. Root `ConfigService` stays `app.get()` (default-scoped — safe).

### init() ordering + global prefix/versioning (modified — root-caused fix)

- `apps/api/src/main.ts` — `await app.init()` was originally inserted before `setGlobalPrefix('api')` and
  `enableVersioning({ type: URI, prefix: 'v', defaultVersion: '1' })`. Because `init()` registers routes
  (nestjs/core `NestApplication.init()` → `registerRouter()`), the subsequent prefix/versioning calls were
  no-ops: **every controller was served at root** (`/health`, `/metrics`, `/auth/login`, `/tenants`, ...) and
  all `/api/v1/*` routes returned 404, breaking the compose healthcheck (`/api/v1/health`).
- `init()` moved to **after** all global config (prefix, versioning, CORS, helmet, validation pipe, Swagger
  setup) and immediately **before** the Bull Board wiring (where the lifecycle hook is actually required).
- Result: `/api/v1/health` 200, `/health` 404, `POST /api/v1/auth/login` reachable, container `(healthy)`.

### Bull Board mount order (modified — root-caused fix)

- `apps/api/src/common/bull-board/bull-board.module.ts` — `ExpressAdapter` + board (`createBullBoard`)
  created in the **constructor** instead of `onModuleInit`, so `getRouter()` works before `init()`;
  `onModuleInit` keeps the queue listener + existing-queue registration + "Bull Board initialized" log.
  Non-null assertion (`this.board!`) added where TS can no longer narrow within `onModuleInit`.
- `apps/api/src/main.ts` — Bull Board mounted **before** `await app.init()`:
  `app.use(BULL_BOARD_PATH, authMiddleware, getRouter())`.
  Rationale: `init()` mounts the core router and its not-found handler (nestjs/core
  `registerRouterHooks()`), so any `app.use()` mounted after `init()` sits behind the router's 404 handler
  and is unreachable — `/admin/queues` returned `404 Cannot GET`.
- Result: `/admin/queues` returns 401 without a token (OWNER-role auth middleware firing).

## Verification

- `PHASE7-M5-PHASE0-REPORT.md` (new) — recovery summary, boot-blocker table, runtime probe results,
  full M1–M5 suite results, next steps.
- Re-ran `scripts/verify-phase7-m1.js` … `verify-phase7-m5.js` after all fixes:
  M1 55/55, M2 33/33 (55 suites / 513 tests), M3 39/39, M4 33 passed + 2 documented info, M5 39/39.
  `nx build api`, `nx lint api`, `prisma validate`, `prisma migrate status`, enum-data audit, orphan-data
  audit all green.

## Behavioral / Contract Notes

- `/api/v1/*` prefix + URI versioning (`v1`) now behave as configured for the production build.
- `/admin/queues` (Bull Board) reachable; returns 401/403 without a valid OWNER-role JWT.
- `GET /api/v1/metrics` requires `Bearer ${METRICS_AUTH_TOKEN}` (401 otherwise).
- Log files are written to `/app/logs` with correct ownership (EACCES resolved).
