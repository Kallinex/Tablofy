# Phase 7 Milestone 1 — Changelog

## Migration: `m1_security_hardening`

- **Added** `encryptedSecret` column to `WebhookRegistration` table
- **Added** `RevokedToken` table (jti, tenantId, userId, expiresAt, createdAt + indexes)

---

## Per-File Changes

### `prisma/schema.prisma`
- Added `encryptedSecret String?` field to `WebhookRegistration` model
- Added `RevokedToken` model with:
  - `id` (UUID PK)
  - `jti` (unique)
  - `tenantId String?`
  - `userId String?`
  - `expiresAt DateTime`
  - `createdAt DateTime`
  - Index on `[jti]`, `[expiresAt]`

### `apps/api/src/modules/auth/auth.service.ts`
- `register()`: Throws `ConflictException('User already exists')` instead of returning user object on duplicate email
- `login()`: Added tenant status check — verifies tenant is ACTIVE/TRIALING and subscription is ACTIVE/TRIALING/PAST_DUE before login

### `apps/api/src/modules/auth/auth.controller.ts`
- Removed `alreadyExists` property from registration response type
- Removed logic detecting duplicate key errors
- Now delegates all duplicate handling to service layer

### `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
- After loading user, validates user's tenant is ACTIVE/TRIALING and tenant subscription is ACTIVE/TRIALING/PAST_DUE
- Throws `UnauthorizedException` with descriptive message if tenant is suspended/canceled

### `apps/api/src/modules/backup/backup.controller.ts`
- Added class-level `@Roles('OWNER')` decorator
- Added `RolesGuard` to `@UseGuards()` array

### `apps/api/src/modules/privacy/privacy.controller.ts`
- Added class-level `@Roles('OWNER','MANAGER')` decorator
- Added `RolesGuard` to `@UseGuards()` array

### `apps/api/src/modules/gift-cards/gift-cards.controller.ts`
- Added class-level `@Roles('OWNER','MANAGER')` decorator
- Added `RolesGuard` at class level
- Added `redeem` endpoint-specific `@Roles('OWNER','MANAGER','STAFF')` override

### `apps/api/src/common/decorators/roles.decorator.ts`
- Added `ClassDecorator` to `@Roles()` return type union (`ClassDecorator | PropertyDecorator | MethodDecorator`)

### `apps/api/src/common/guards/tenant-body.guard.ts` (NEW)
- Created `TenantBodyGuard` that extracts tenantId from JWT payload and compares to body/query `tenantId`
- Returns `ForbiddenException` on mismatch
- Passes through when JWT has no tenantId
- Implements `CanActivate` interface

### `apps/api/src/modules/api-keys/decorators/scopes.decorator.ts` (NEW)
- Created `@Scopes(...)` decorator storing metadata via `Reflect.setMetadata(SCOPES_KEY, scopes)`

### `apps/api/src/modules/api-keys/guards/api-key.guard.ts`
- Added scope checking logic:
  - Checks for `SCOPES_KEY` metadata on route handler or class
  - If no metadata, derives scope from HTTP method (GET/HEAD/OPTIONS → `read`, others → `write`)
  - Verifies API key scopes include the required scope
  - Returns `ForbiddenException` on mismatch

### `apps/api/src/modules/webhooks/webhook-event-emitter.ts`
- Changed `@OnEvent('**')` handler to use second parameter `eventName` for routing instead of `payload.eventType`
- Added `logEvent` parameter toggle

### `apps/api/src/modules/webhooks/webhook-delivery.service.ts`
- Added `encryptSecret(plaintext: string): string` using AES-256-GCM with scrypt-derived key
- Added `decryptSecret(ciphertext: string): string` decrypting AES-256-GCM payload
- Format: `iv:tag:ciphertext` (hex-colon-delimited)

### `apps/api/src/modules/webhooks/webhooks.service.ts`
- Calls `encryptSecret()` before saving secret on create and rotate operations

### `apps/api/src/modules/webhooks/webhook-processor.ts`
- Calls `decryptSecret()` to decrypt `registration.encryptedSecret` before HMAC signing
- Falls back to `registration.secretHash` for backward compatibility with existing records

### `apps/api/src/config/webhook.config.ts`
- Added `encryptionKey` configuration property (reads from `WEBHOOK_ENCRYPTION_KEY` env var)
- Added `encryptionAlgorithm: 'aes-256-gcm'` configuration property

### `apps/api/src/common/logger/logger.service.ts`
- Added `sensitiveKeys: Set<string>` with fields: `password`, `token`, `authorization`, `secret`, `apiKey`, `refreshToken`, `accessToken`, `jwt`, `creditCard`, `ssn`, `twoFactorSecret`, `newPassword`, `currentPassword`
- Added `sanitize(data: any, depth?: number): any` method that deep-clones and redacts sensitive keys (max depth 10)
- `extractMeta()` now applies `sanitize()` to metadata before returning

### `apps/api/src/redis/redis.service.ts`
- `blacklistToken(jti, expiresAt)` now upserts a `RevokedToken` record via Prisma
- `isTokenBlacklisted(jti)` checks Redis cache first; if not found, queries `RevokedToken` table and backfills cache

### Test files fixed
- `apps/api/src/modules/auth/tests/auth.controller.spec.ts` — Added ConflictException test; removed alreadyExists assertions
- `apps/api/src/modules/auth/tests/auth.service.spec.ts` — Removed alreadyExists assertions; added tenant mock for login
- `apps/api/src/modules/auth/tests/jwt.strategy.spec.ts` — Added tenant mock with subscription
- `apps/api/src/redis/tests/redis.service.spec.ts` — Added PrismaService mock
