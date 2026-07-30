# Phase 7 Milestone 1 — Security Hardening Report

## Summary

- **Milestone**: Phase 7 M1 — Security Hardening
- **Plan**: PHASE7-M1-IMPLEMENTATION-PLAN-v2.md (11 mandatory tasks)
- **Status**: ✅ COMPLETED
- **Findings addressed**: 8 P0 + 3 P1 = 11 total

## Tasks Completed

| ID | Finding | Description | Files Changed | Status |
|---|---|---|---|---|
| 7.1.12 | P1-4 | Generic registration error (no info leak) | auth.service.ts, auth.controller.ts | ✅ |
| 7.1.1 | P0-1 | @Roles('OWNER') on backup controller | backup.controller.ts | ✅ |
| 7.1.2 | P0-2 | @Roles('OWNER','MANAGER') on privacy controller | privacy.controller.ts | ✅ |
| 7.1.3 | P0-3 | @Roles on gift-cards controller | gift-cards.controller.ts | ✅ |
| 7.1.4 | P0-4 | Fix webhook event routing | webhook-event-emitter.ts | ✅ |
| 7.1.5 | P0-5 | Fix webhook HMAC signing with AES-256 encryption | webhook-delivery.service.ts, webhooks.service.ts, webhook-processor.ts, webhook.config.ts, schema.prisma | ✅ |
| 7.1.6 | P0-6 | TenantBodyGuard | tenant-body.guard.ts (NEW) | ✅ |
| 7.1.7 | P0-9 | @Scopes() decorator + ApiKeyGuard enforcement | scopes.decorator.ts (NEW), api-key.guard.ts | ✅ |
| 7.1.8 | P1-2 | Tenant status check in login + JwtStrategy | auth.service.ts, jwt.strategy.ts | ✅ |
| 7.1.10 | P0-13 | Sensitive data sanitizer in logger | logger.service.ts | ✅ |
| 7.1.11 | P1-3 | JWT blacklist persistence (RevokedToken + DB fallback) | schema.prisma, redis.service.ts | ✅ |

## Files Created (2)
- `apps/api/src/common/guards/tenant-body.guard.ts`
- `apps/api/src/modules/api-keys/decorators/scopes.decorator.ts`

## Files Modified (16)
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.controller.ts`
- `apps/api/src/modules/backup/backup.controller.ts`
- `apps/api/src/modules/privacy/privacy.controller.ts`
- `apps/api/src/modules/gift-cards/gift-cards.controller.ts`
- `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
- `apps/api/src/modules/webhooks/webhook-event-emitter.ts`
- `apps/api/src/modules/webhooks/webhook-delivery.service.ts`
- `apps/api/src/modules/webhooks/webhooks.service.ts`
- `apps/api/src/modules/webhooks/webhook-processor.ts`
- `apps/api/src/config/webhook.config.ts`
- `apps/api/src/modules/api-keys/guards/api-key.guard.ts`
- `apps/api/src/common/decorators/roles.decorator.ts`
- `apps/api/src/common/logger/logger.service.ts`
- `apps/api/src/redis/redis.service.ts`
- `prisma/schema.prisma`

## Quality Gates

| Gate | Result |
|---|---|
| Prisma generate | ✅ Passed |
| TypeScript build (nx build api) | ✅ Passed (0 errors) |
| ESLint (nx lint api) | ✅ Passed (0 errors, 0 warnings) |
| Jest tests (nx test api) | ✅ Passed (26 suites, 213 tests) |

## Design Decisions

1. **TenantStatusGuard removed** — P1-2 satisfied via inline checks in auth.service.ts + jwt.strategy.ts; no global per-request guard needed
2. **SanitizeInterceptor removed** — logger-only sanitization approach; modify logger.service.ts + http-logging.middleware.ts
3. **7.1.9 removed** — Prisma query audit deferred to post-M1 (not a verified finding)
4. **BullMQ cleanup deferred** — RevokedToken cleanup via expiresAt field; cleanup job to be added in M2+
5. **Two migrations merged** — RevokedToken + encryptedSecret in single `m1_security_hardening` migration
6. **Roles decorator type widened** — Added `ClassDecorator` to `PropertyDecorator & MethodDecorator` union to enable class-level usage
7. **Legacy secretHash fallback** — Webhook processor falls back to secretHash if encryptedSecret is null (backward compatible)
