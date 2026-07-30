# PHASE 7 — MILESTONE 1: SECURITY HARDENING — IMPLEMENTATION PLAN

**Derived from:** PHASE7-VERIFIED-ROADMAP.md, FORENSIC-VALIDATION.md, FINAL-ENTERPRISE-AUDIT-v6.4.md  
**Branch:** `feature/phase7-m1`  
**Baseline release:** v6.4.0  
**Date:** 2026-07-31

---

## 1. OBJECTIVE

Eliminate 8 P0 and 3 P1 security findings from the production audit to raise Security score from 3/10 to 5/10 and Enterprise Readiness from 3/10 to 4/10. Prevent catastrophic data breach, financial fraud, and regulatory fines (GDPR/PCI-DSS).

---

## 2. SCOPE

### In Scope (12 tasks, 11 unique findings)

| ID | Task | Finding | Severity |
|----|------|---------|----------|
| 7.1.1 | `@Roles('OWNER')` on backup controller | P0-1 | P0 |
| 7.1.2 | `@Roles('OWNER','MANAGER')` on privacy controller | P0-2 | P0 |
| 7.1.3 | `@Roles('OWNER','MANAGER')` on gift-cards controller | P0-3 | P0 |
| 7.1.4 | Fix webhook event routing (event name from @OnEvent context) | P0-4 | P0 |
| 7.1.5 | Fix webhook signing (encrypt raw secret at rest, decrypt for HMAC) | P0-5 | P0 |
| 7.1.6 | Body/query tenantId validation middleware | P0-8 | P0 |
| 7.1.7 | API key scope enforcement with `@Scopes()` decorator | P0-9 | P0 |
| 7.1.8 | Tenant/subscription status check on login + JwtStrategy.validate() | P1-2 | P1 |
| 7.1.9 | Cross-tenant Prisma query audit — tenantId WHERE filter in all services | P0-8 ext | P0 |
| 7.1.10 | Sensitive data sanitizer for logger | P0-13 | P0 |
| 7.1.11 | Persist revoked JWT blacklist to DB; wire calls into logout flow | P1-3 | P1 |
| 7.1.12 | Generic error message on duplicate registration | P1-4 | P1 |

### Out of Scope

- MFA/2FA (P1-1) — deferred to Phase 7.7
- Permissions system (P1-5) — deferred to Phase 7.7
- npm audit / dependency scanning — deferred to Phase 7.5
- CD pipeline — deferred to Phase 7.5
- Cache TTL standardization (P2-12 refinement) — deferred to later milestone
- Any P0/P1/P2 finding not listed above

---

## 3. SUCCESS CRITERIA

All must pass before M1 is considered complete:

- [ ] **7.1.1–7.1.3**: Non-OWNER user receives 403 on backup/privacy/gift-cards endpoints; OWNER passes
- [ ] **7.1.4**: Webhook delivery log shows events dispatched with correct event names; consumer receives valid payload
- [ ] **7.1.5**: HMAC signature computed with raw secret (not hash); consumer-side verification passes
- [ ] **7.1.6**: POST/PUT/PATCH with `body.tenantId !== JWT tenantId` returns 403; query params also checked
- [ ] **7.1.7**: Read-only API key cannot create/update/delete; read-only key passes on GET; write scope keys match route
- [ ] **7.1.8**: Disabled tenant or expired subscription returns 403 on login; active tenant/subscription passes
- [ ] **7.1.9**: Every Prisma query in services/ includes `tenantId` in WHERE clause; grep audit clean
- [ ] **7.1.10**: Logger output sanitizes `password`, `token`, `authorization`, `secret`, `apiKey` fields; plaintext never logged
- [ ] **7.1.11**: Logout calls `blacklistToken()`; DB persists revoked JTI; middleware blocks blacklisted tokens
- [ ] **7.1.12**: Duplicate registration email returns `409 User already exists` (generic); no user details leaked
- [ ] **All existing 213 tests pass**
- [ ] **No regression in existing API contracts** (checked via manual smoke test)

---

## 4. ARCHITECTURE

### Current Architecture (Before)

```
Controller                Guard Layer                  Service                  Prisma
──────────              ─────────────              ────────────              ───────
                                          
backup.controller.ts    JwtAuthGuard + TenantGuard     backup.service.ts       BackupRecord
privacy.controller.ts   JwtAuthGuard + TenantGuard     privacy.service.ts      ConsentRecord, etc.
gift-cards.controller   JwtAuthGuard + TenantGuard     gift-cards.service.ts   GiftCard

webhook-event-emitter.ts    (event routing broken)     webhook-processor.ts    WebhookRegistration
                                                       webhook-delivery.ts     WebhookDelivery

api-keys/guard              ApiKeyGuard (valid only)   api-keys.service.ts     ApiKey
auth/controller             JwtAuthGuard               auth.service.ts         User
redis.service                                           blacklistToken() [NEVER CALLED]
```

### Target Architecture (After)

```
Controller                  Guard Layer                         Service                    Prisma
──────────                ──────────────                   ────────────                 ───────

backup.controller.ts     JwtAuthGuard + RolesGuard('OWNER')     backup.service.ts
privacy.controller.ts    JwtAuthGuard + RolesGuard('OWNER','MANAGER')
gift-cards.controller    JwtAuthGuard + RolesGuard('OWNER','MANAGER')

api-keys/guard           ApiKeyGuard (checks scope via @Scopes())
auth/controller          JwtAuthGuard + TenantGuard (status check)
                           └── TenantStatusGuard [NEW]

common/guards/
  tenant-body.guard.ts [NEW] — validates body/query tenantId against JWT
  scopes.decorator.ts [NEW] — @Scopes('read') / @Scopes('write') decorator
  tenant-status.guard.ts [NEW] — loads Tenant+Subscription on every auth'd request

common/interceptors/
  sanitize.interceptor.ts [NEW] — redacts sensitive fields from log output

common/middleware/
  tenant-status.middleware.ts [NEW] — enriches request with tenant/subscription status

webhooks/
  webhook-event-emitter.ts [MODIFIED] — uses EventEmitter2 event name context
  webhook-delivery.service.ts [MODIFIED] — decrypts secret for HMAC signing
  webhook-processor.ts [MODIFIED] — uses raw secret from decrypted field

auth/
  auth.service.ts [MODIFIED] — tenant status check in login, generic registration error
  jwt.strategy.ts [MODIFIED] — tenant status check in validate()

redis/
  redis.service.ts [MODIFIED] — blacklistToken() persists to DB AND Redis

prisma/
  schema.prisma [MODIFIED] — new RevokedToken model, add encryptedSecret to WebhookRegistration

common/logger/
  logger.service.ts [MODIFIED] — deep-copy + redact sensitive keys
  http-logging.middleware.ts [MODIFIED] — redact request/response body sensitive fields
```

---

## 5. MODULE DESIGN

### 5.1 Backup Controller (7.1.1)

**File:** `apps/api/src/modules/backup/backup.controller.ts`

**Change:** Add `@Roles('OWNER')` decorator. Keep existing `@UseGuards(JwtAuthGuard, TenantGuard)`.

```
Current:
@UseGuards(JwtAuthGuard, TenantGuard)

Target:
@Roles('OWNER')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
```

Remove redundant `JwtAuthGuard` + `TenantGuard` if RolesGuard is in APP_GUARD. Verify via existing guard registration.

### 5.2 Privacy Controller (7.1.2)

**File:** `apps/api/src/modules/privacy/privacy.controller.ts`

**Change:** Add `@Roles('OWNER', 'MANAGER')`. Additionally restrict anonymize endpoint to self-only (user can only anonymize their own data).

### 5.3 Gift Cards Controller (7.1.3)

**File:** `apps/api/src/modules/gift-cards/gift-cards.controller.ts`

**Change:** Add `@Roles('OWNER', 'MANAGER')` on create/recharge/deactivate endpoints. Keep redeem open to `STAFF` (cashiers need to redeem).

### 5.4 Webhook Event Emitter (7.1.4)

**File:** `apps/api/src/modules/webhooks/webhook-event-emitter.ts`

**Root cause:** Two bugs:
1. `payload.eventType` is checked but `eventType` is never in the payload — events are emitted as `this.eventEmitter.emit('order.created', payload)` where payload has no `eventType` field
2. Event name mismatch: emitted as `'order.created'` (singular) but subscribed as `'orders.created'` (plural)

**Fix:** Use EventEmitter2's event name from context. EventEmitter2 passes the event name as the second argument to `@OnEvent('**')` handlers:

```typescript
@OnEvent('**', { async: true })
async handleEvent(payload: any, eventName?: string) {
  // Use eventName from EventEmitter2 context instead of payload.eventType
  const eventType = eventName || payload?.eventType;
  // ... rest of logic
}
```

Also fix all emitters to use consistent naming:
- `order.created` (not `orders.created`)
- `inventory.low-stock` (not `inventories.low-stock`)
- etc.

### 5.5 Webhook Processor / Delivery (7.1.5)

**Current flow:**
1. `generateSecret()` creates random 32-byte hex `secret`, computes `hmac(sha256, secret).digest('hex')` as `hash`
2. `secretHash` in `WebhookRegistration` stores `hash` (the HMAC output)
3. `getWebhookSecret()` returns `registration.secretHash` (the HMAC hash, not the raw secret)
4. `signPayload(payloadBody, secret)` signs with `hash` instead of `secret`

**Fix:**
1. Add `encryptedSecret` field to `WebhookRegistration` schema — stores AES-256-GCM encrypted raw secret
2. Add an environment variable `WEBHOOK_SECRET_ENCRYPTION_KEY` (32 hex chars = 16 bytes AES-256 key)
3. `generateSecret()` returns `{ secret, hash, encryptedSecret, prefix }`:
   - `secret` = raw 32-byte hex (for one-time display to user)
   - `encryptedSecret` = `AES-256-GCM.encrypt(secret, WEBHOOK_SECRET_ENCRYPTION_KEY)` (stored in DB)
   - `hash` = `hmac(sha256, secret).digest('hex')` (stored in DB for verification)
4. `getWebhookSecret()` decrypts `registration.encryptedSecret` → raw secret
5. `signPayload()` uses raw secret for HMAC

**Note:** `secretHash` field is repurposed or a new field `encryptedSecret` is added. We keep `secretHash` as-is for backward compatibility (consumer-side verification uses `sha256=` prefix + hash).

### 5.6 API Key Scope Guard (7.1.7)

**New files:**
- `apps/api/src/modules/api-keys/decorators/scopes.decorator.ts`
- `apps/api/src/modules/api-keys/guards/api-key-scope.guard.ts` (or modify `api-key.guard.ts`)

**Design:**
```typescript
// scopes.decorator.ts
export const SCOPES_KEY = 'scopes';
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);
```

```typescript
// Modified api-key.guard.ts — check scopes from metadata
const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
  context.getHandler(),
  context.getClass(),
]);
if (requiredScopes && result.scopes) {
  const hasScope = requiredScopes.some(s => result.scopes?.includes(s));
  if (!hasScope) throw new ForbiddenException('API key scope insufficient');
}
```

**Route-scope mapping:**
| HTTP Method | Required Scope |
|-------------|---------------|
| GET, HEAD, OPTIONS | `read` |
| POST, PUT, PATCH, DELETE | `write` |

---

## 6. SERVICES

### 6.1 Auth Service (7.1.8, 7.1.12)

**File:** `apps/api/src/modules/auth/auth.service.ts`

**Changes for 7.1.8:**
```typescript
// Inside login() — after user authentication, before token generation
const tenant = await this.prisma.tenant.findUnique({
  where: { id: user.tenantId },
  include: { subscription: true },
});
if (!tenant || tenant.status !== 'ACTIVE') {
  throw new UnauthorizedException('Tenant account is disabled');
}
if (tenant.subscription?.status !== 'ACTIVE') {
  throw new UnauthorizedException('Subscription is not active');
}
```

**Changes for 7.1.12:**
```typescript
// Current: returns { user: existingUser } with full user details
// Target: returns generic error
const existingUser = await this.prisma.user.findUnique({ where: { email } });
if (existingUser) {
  throw new ConflictException('User already exists');
}
```

### 6.2 JWT Strategy (7.1.8)

**File:** `apps/api/src/modules/auth/jwt.strategy.ts`

**Change:** Add tenant status check in `validate()` method. Load Tenant record by `payload.tenantId` and verify `tenant.status === 'ACTIVE'` and subscription is active.

### 6.3 Redis Service (7.1.11)

**File:** `apps/api/src/redis/redis.service.ts`

**Change:** Modify `blacklistToken()` to:
1. Persist JTI + expiry to `RevokedToken` table via Prisma
2. Keep Redis SET as fast-check cache
3. Add `isTokenBlacklisted(jti: string): Promise<boolean>` that checks Redis first, falls back to DB

### 6.4 Webhook Delivery Service (7.1.5)

**File:** `apps/api/src/modules/webhooks/webhook-delivery.service.ts`

**Change:** `getWebhookSecret()` decrypts `encryptedSecret` field:
```typescript
async getWebhookSecret(registrationId: string): Promise<string> {
  const reg = await this.prisma.webhookRegistration.findUnique({
    where: { id: registrationId },
    select: { encryptedSecret: true },
  });
  if (!reg?.encryptedSecret) throw new NotFoundException();
  return decrypt(reg.encryptedSecret, WEBHOOK_SECRET_ENCRYPTION_KEY);
}
```

---

## 7. GUARDS

### 7.1 Tenant Body Guard (NEW — 7.1.6)

**File:** `apps/api/src/common/guards/tenant-body.guard.ts`

**Purpose:** Validate that `request.body.tenantId` (if present) and `request.query.tenantId` (if present) match the JWT's tenantId claim.

**Design:**
```typescript
@Injectable()
export class TenantBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const jwtTenantId = request.user?.tenantId;
    const bodyTenantId = request.body?.tenantId;
    const queryTenantId = request.query?.tenantId;

    if (bodyTenantId && bodyTenantId !== jwtTenantId) return false;
    if (queryTenantId && queryTenantId !== jwtTenantId) return false;

    return true;
  }
}
```

Register as global guard or apply to specific controllers.

### 7.2 Tenant Status Guard (NEW — 7.1.8)

**File:** `apps/api/src/common/guards/tenant-status.guard.ts`

**Purpose:** Check Tenant.status and Subscription.status on every authenticated request (not just login). Provides defense-in-depth.

**Design:**
```typescript
@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipCheck = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_STATUS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipCheck) return true;

    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;
    if (!tenantId) return true; // public routes pass through

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: true },
    });
    if (!tenant || tenant.status !== 'ACTIVE') return false;
    if (tenant.subscription?.status !== 'ACTIVE') return false;

    return true;
  }
}
```

### 7.3 Scopes Decorator (NEW — 7.1.7)

**File:** `apps/api/src/modules/api-keys/decorators/scopes.decorator.ts`

### 7.4 SkipTenantStatus Decorator (NEW — 7.1.8 companion)

**File:** `apps/api/src/common/decorators/skip-tenant-status.decorator.ts`

Mark public routes (login, register, health) that should skip status check.

---

## 8. INTERCEPTORS

### 8.1 Sensitive Data Sanitizer (NEW — 7.1.10)

**File:** `apps/api/src/common/interceptors/sanitize.interceptor.ts` or modifications to `common/logger/`

**Design approach (Interceptor method):**
Intercept all responses, deep-clone, and redact sensitive fields from body/headers.

**Design approach (Logger method — PREFERRED):**
Modify `logger.service.ts` to sanitize metadata objects before logging. This is more comprehensive because it catches all log levels, not just HTTP responses.

```typescript
// Add to LoggerService
private sensitiveKeys = ['password', 'token', 'authorization', 'secret', 'apiKey', 'twoFactorSecret'];

private sanitize(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(sanitized)) {
    if (this.sensitiveKeys.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = this.sanitize(sanitized[key]);
    }
  }
  return sanitized;
}
```

Apply `sanitize()` in `log()`, `error()`, `warn()`, `info()`, `debug()` before calling winston methods.

Also modify `http-logging.middleware.ts` to redact sensitive headers (`authorization`, `x-api-key`) before logging.

---

## 9. MIDDLEWARE

### 9.1 No new middleware required

The cross-tenant validation (7.1.6) will be implemented as a **Guard** (TenantBodyGuard), not middleware. Guards have access to NestJS DI and the reflector, which is more appropriate for this use case.

---

## 10. PRISMA / DATABASE CHANGES

### 10.1 New Model: RevokedToken (7.1.11)

```prisma
model RevokedToken {
  id        String   @id @default(cuid())
  jti       String   @unique
  tenantId  String
  userId    String
  expiresAt DateTime
  revokedAt DateTime @default(now())
  reason    String?

  @@index([jti])
  @@index([tenantId, userId])
  @@map("revoked_tokens")
}
```

### 10.2 WebhookRegistration: Add encryptedSecret field (7.1.5)

```prisma
model WebhookRegistration {
  // ... existing fields ...
  encryptedSecret String?  // AES-256-GCM encrypted raw secret
  // secretHash remains for backward compatibility (one-time display verification)
}
```

### 10.3 No index changes for M1

Index improvements (P1-6, P1-10, P1-14) deferred to 7.4 Database & Performance.

---

## 11. API DESIGN

### 11.1 No new endpoints

All changes are internal — no new API endpoints. Existing API contracts remain unchanged.

### 11.2 Response changes

| Endpoint | Change |
|----------|--------|
| `POST /auth/register` | 409 response body: `{ "message": "User already exists" }` (was detailed user object) |
| `POST /auth/login` | Now returns 403 if tenant disabled or subscription expired |
| `POST /backup/*` | Now returns 403 for non-OWNER (was accessible to all) |
| `POST /privacy/*` | Now returns 403 for non-OWNER/MANAGER (was accessible to all) |
| `POST /gift-cards/*` | Now returns 403 for non-OWNER/MANAGER on create/recharge/deactivate |
| All endpoints | Body/query tenantId matching JWT claim — 403 if mismatch |

---

## 12. DTO DESIGN

No DTO changes required for M1. All changes are in guards, services, and internal logic.

---

## 13. CONFIGURATION

### 13.1 New configuration entries

| Config Key | Source | Default | Used By |
|------------|--------|---------|---------|
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | Env var | (required) | webhook-delivery.service.ts |
| `SCRYPT_ENABLED` | Env var | `false` | Guard registrations |

### 13.2 Config module updates

Add to `config/webhook.config.ts`:
```typescript
encryptionKey: {
  env: 'WEBHOOK_SECRET_ENCRYPTION_KEY',
  type: 'string',
  default: '',
},
```

Add to `config/app.config.ts`:
```typescript
tenantStatusCheck: {
  env: 'TENANT_STATUS_CHECK_ENABLED',
  type: 'boolean',
  default: true,
},
```

---

## 14. ENVIRONMENT VARIABLES

### 14.1 New environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | Yes | 32-hex-char (16 byte) AES-256 key for encrypting webhook secrets |
| `TENANT_STATUS_CHECK_ENABLED` | No | Enable/disable tenant status guard (default: true) |

### 14.2 .env.example additions

```env
# Phase 7 — Security Hardening (M1)
WEBHOOK_SECRET_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
TENANT_STATUS_CHECK_ENABLED=true
```

---

## 15. SECURITY DESIGN

### 15.1 Defense-in-depth layers

```
Layer 1: JwtAuthGuard — validates JWT signature + expiry
Layer 2: RolesGuard + @Roles() — RBAC enforcement (7.1.1-7.1.3)
Layer 3: TenantGuard — extracts tenantId from JWT (existing)
Layer 4: TenantBodyGuard — validates body/query tenantId (NEW — 7.1.6)
Layer 5: TenantStatusGuard — checks tenant/subscription active (NEW — 7.1.8)
Layer 6: ApiKeyGuard + @Scopes() — API key + scope enforcement (NEW — 7.1.7)
Layer 7: SanitizeInterceptor — redacts sensitive data from logs (NEW — 7.1.10)
Layer 8: JWT blacklist — revoked tokens rejected (NEW — 7.1.11)
```

### 15.2 Encryption-at-rest (Webhook secrets)

**Algorithm:** AES-256-GCM  
**Key derivation:** Direct from `WEBHOOK_SECRET_ENCRYPTION_KEY` (32 hex chars)  
**Implementation:** `crypto.createCipheriv('aes-256-gcm', key, iv)`  
**Storage:** Hex-encoded ciphertext + IV + auth tag in `WebhookRegistration.encryptedSecret`

### 15.3 JWT blacklist persistence

- Primary store: `RevokedToken` table (durable, survives Redis restart)
- Cache store: Redis SET with TTL matching token expiry
- Check order: Redis SET → DB query (if not in Redis)
- Cleanup: TTL-based auto-expiry in Redis; periodic cleanup of expired `RevokedToken` records (via BullMQ job)

---

## 16. TESTING STRATEGY

### 16.1 Unit Tests (per task)

| Task | Test | Coverage Target |
|------|------|----------------|
| 7.1.1–7.1.3 | `RolesGuard` rejects non-OWNER for each controller | 3 test cases each |
| 7.1.4 | `handleEvent()` resolves event name from EventEmitter2 context | 2 test cases |
| 7.1.5 | `generateSecret()` produces valid encrypted secret; `getWebhookSecret()` decrypts correctly | 3 test cases |
| 7.1.6 | `TenantBodyGuard` rejects body.tenantId mismatch | 3 test cases |
| 7.1.7 | `ApiKeyGuard` rejects read key on POST; passes read key on GET | 4 test cases |
| 7.1.8 | `login()` throws when tenant disabled; `validate()` throws when subscription expired | 4 test cases |
| 7.1.10 | Logger redacts sensitive keys; preserves non-sensitive keys | 2 test cases |
| 7.1.11 | `blacklistToken()` persists to DB; `isTokenBlacklisted()` returns true | 3 test cases |
| 7.1.12 | `register()` returns generic error on duplicate email | 2 test cases |

### 16.2 Smoke Tests (manual)

After all changes, run the existing test suite:
```bash
npx jest --passWithNoTests
```

Verify via curl/integration:
1. Login as STAFF → try backup create → expect 403
2. Login as OWNER → backup create → expect 200/201
3. POST to endpoint with `body.tenantId` mismatched → expect 403
4. Login with disabled tenant → expect 401/403
5. Register duplicate email → expect 409 with generic message

### 16.3 Cross-tenant query audit (7.1.9)

Run grep to verify tenantId filter presence:
```bash
rg "tenantId" --include="*.service.ts" -l | wc -l
# Expected: all service files that access Prisma
```

Review each service file that uses PrismaService but doesn't filter by `tenantId`.

---

## 17. MIGRATION STRATEGY

### 17.1 Deployment order

```
Step 1: Prisma migration (add RevokedToken table, encryptedSecret column)
Step 2: Deploy guard/service changes
Step 3: Deploy controller decorator changes
Step 4: Deploy webhook fixes
Step 5: Verify all changes via tests + smoke tests
```

### 17.2 Prisma migration steps

```bash
npx prisma migrate dev --name add_revoked_token_model
npx prisma migrate dev --name add_webhook_encrypted_secret
```

### 17.3 Backward compatibility

- `WebhookRegistration.encryptedSecret` is optional (`String?`). Existing records with `secretHash` only continue to work (they will fail HMAC verification until secret is re-generated with encryption). This is acceptable because webhooks were already broken (P0-4 + P0-5).
- `RevokedToken` is a new table — no backward compatibility issue.
- `@Roles()` additions are new restrictions — previously-accessible endpoints become restricted. This is the intended fix.

---

## 18. ROLLBACK STRATEGY

### 18.1 Per-task rollback

| Task | Rollback Action |
|------|----------------|
| 7.1.1–7.1.3 | Remove `@Roles()` decorators; restore original guard line |
| 7.1.4 | Restore original `handleEvent()` signature; re-enable `payload.eventType` check |
| 7.1.5 | Remove `encryptedSecret` field from schema; revert `getWebhookSecret()` |
| 7.1.6 | Remove `TenantBodyGuard` from module providers |
| 7.1.7 | Remove `@Scopes()` decorators; revert `ApiKeyGuard` |
| 7.1.8 | Remove tenant status check from `login()` and `validate()`; remove `TenantStatusGuard` |
| 7.1.9 | Revert `tenantId` WHERE filters (highly unlikely to need rollback) |
| 7.1.10 | Restore original logger methods (remove `sanitize()` calls) |
| 7.1.11 | Remove `RevokedToken` table (migration down); revert `redis.service.ts` |
| 7.1.12 | Restore original registration response |

### 18.2 Full rollback

```bash
git checkout feature/phase7-m1~1  # revert to previous commit
npx prisma migrate down           # revert DB changes
```

### 18.3 Data safety

- No destructive migrations — all changes are additive (new table, new column)
- No data loss risk
- `RevokedToken` table can be dropped safely if rolled back
- `encryptedSecret` column is nullable — dropping it is safe

---

## 19. RISKS

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| API key scope enforcement breaks existing integrations | Medium | High | Add `@Scopes('read','write')` to all existing routes before deploying scope guard. Document scope requirement change. |
| Tenant status guard causes login failures if Tenant record missing | Low | High | Add null-check: skip status check if Tenant not found (defense-in-depth, not gate) |
| Webhook encryption key lost | Low | High | Document key generation + rotation procedure in README. Add startup validation that key exists. |
| Performance impact of cross-tenant Prisma query audit (7.1.9) | Low | Medium | Audit is static analysis only. Adding missing `tenantId` WHERE improves query performance. |
| JWT blacklist DB fallback adds latency | Medium | Low | Redis remains primary check; DB is fallback. Latency only on Redis miss (rare). |
| Existing tests fail due to new restrictions | Low | Medium | Verify before committing; fix test expectations to match new auth behavior. |

---

## 20. EFFORT ESTIMATES

| ID | Task | Est. Time | Complexity | Owner |
|----|------|-----------|------------|-------|
| 7.1.1 | `@Roles('OWNER')` on backup controller | 30 min | Trivial | Backend |
| 7.1.2 | `@Roles('OWNER', 'MANAGER')` on privacy controller | 30 min | Trivial | Backend |
| 7.1.3 | `@Roles('OWNER', 'MANAGER')` on gift-cards controller | 30 min | Trivial | Backend |
| 7.1.4 | Fix webhook event routing | 1 hr | Medium | Backend |
| 7.1.5 | Fix webhook signing with encryption | 4 hrs | High | Backend |
| 7.1.6 | Add TenantBodyGuard | 2–3 days | High | Backend |
| 7.1.7 | Implement `@Scopes()` + ApiKeyGuard enforcement | 2–3 days | High | Backend |
| 7.1.8 | Add tenant status check on login + JWT validate | 1 day | Medium | Backend |
| 7.1.9 | Cross-tenant Prisma query audit | 2–3 days | High | Backend |
| 7.1.10 | Add sensitive data sanitizer for logger | 2–3 hrs | Medium | Backend |
| 7.1.11 | Persist JWT blacklist to DB | 2–3 days | High | Backend |
| 7.1.12 | Generic error on duplicate registration | 30 min | Trivial | Backend |
| **Total** | | **~10–17 days** | | |

**Optimal parallel execution:**
- Track A (trivial): 7.1.1, 7.1.2, 7.1.3, 7.1.12 — 1 day
- Track B (webhooks): 7.1.4, 7.1.5 — 1 day
- Track C (guards): 7.1.6, 7.1.7, 7.1.8 — 3 days
- Track D (audit): 7.1.9 — 2 days (parallel with Track C)
- Track E (data): 7.1.10, 7.1.11 — 2 days
- Remaining: Testing, debugging, smoke tests — 1 day

**With 2 engineers: ~5–7 calendar days**

---

## 21. DELIVERABLES

### 21.1 Files to Create

| # | File | Purpose | Task |
|---|------|---------|------|
| 1 | `apps/api/src/common/guards/tenant-body.guard.ts` | Cross-tenant body/query validation | 7.1.6 |
| 2 | `apps/api/src/common/guards/tenant-status.guard.ts` | Tenant/subscription status check on all routes | 7.1.8 |
| 3 | `apps/api/src/common/decorators/skip-tenant-status.decorator.ts` | Skip status check for public routes | 7.1.8 |
| 4 | `apps/api/src/modules/api-keys/decorators/scopes.decorator.ts` | `@Scopes()` decorator | 7.1.7 |
| 5 | `apps/api/src/common/interceptors/sanitize.interceptor.ts` | Response sanitization | 7.1.10 |

### 21.2 Files to Modify

| # | File | Change | Task |
|---|------|--------|------|
| 6 | `apps/api/src/modules/backup/backup.controller.ts` | Add `@Roles('OWNER')` | 7.1.1 |
| 7 | `apps/api/src/modules/privacy/privacy.controller.ts` | Add `@Roles('OWNER', 'MANAGER')` | 7.1.2 |
| 8 | `apps/api/src/modules/gift-cards/gift-cards.controller.ts` | Add `@Roles('OWNER', 'MANAGER')` | 7.1.3 |
| 9 | `apps/api/src/modules/webhooks/webhook-event-emitter.ts` | Fix event routing | 7.1.4 |
| 10 | `apps/api/src/modules/webhooks/webhook-delivery.service.ts` | Add secret decryption | 7.1.5 |
| 11 | `apps/api/src/modules/webhooks/webhook-processor.ts` | Use decrypted secret for signing | 7.1.5 |
| 12 | `apps/api/src/modules/webhooks/webhook-registration.service.ts` | Encrypt secret on create | 7.1.5 |
| 13 | `apps/api/src/modules/api-keys/guards/api-key.guard.ts` | Add scope checking | 7.1.7 |
| 14 | `apps/api/src/modules/auth/auth.service.ts` | Add tenant status check, generic registration error | 7.1.8, 7.1.12 |
| 15 | `apps/api/src/modules/auth/jwt.strategy.ts` | Add tenant status check in validate() | 7.1.8 |
| 16 | `apps/api/src/common/logger/logger.service.ts` | Add sensitive data redaction | 7.1.10 |
| 17 | `apps/api/src/common/logger/http-logging.middleware.ts` | Redact sensitive headers | 7.1.10 |
| 18 | `apps/api/src/redis/redis.service.ts` | Add DB persistence for blacklist | 7.1.11 |
| 19 | `apps/api/src/modules/auth/auth.module.ts` | Register new guards/providers | 7.1.8, 7.1.11 |
| 20 | `apps/api/src/app.module.ts` | Register global guards/interceptors | 7.1.6, 7.1.7, 7.1.10 |
| 21 | `prisma/schema.prisma` | Add RevokedToken model, encryptedSecret | 7.1.5, 7.1.11 |
| 22 | `.env.example` | Add new env vars | 7.1.5, 7.1.8 |
| 23 | `apps/api/src/config/webhook.config.ts` | Add encryption key config | 7.1.5 |
| 24 | `apps/api/src/config/app.config.ts` | Add tenant status check config | 7.1.8 |

### 21.3 Verification Scripts

| # | Script | Purpose |
|---|--------|---------|
| 1 | `scripts/verify-rbac.sh` | Hit backup/privacy/gift-cards endpoints with each role, verify 403 vs 200 |
| 2 | `scripts/verify-cross-tenant.sh` | POST with body.tenantId mismatched, verify 403 |
| 3 | `scripts/verify-webhook-routing.sh` | Trigger order.created event, verify webhook delivery log |
| 4 | `scripts/verify-webhook-signing.sh` | Verify HMAC signature matches consumer-side expected value |
| 5 | `scripts/verify-jwt-blacklist.sh` | Login → logout → use same token, verify 401 |
| 6 | `scripts/verify-registration-leak.sh` | Register twice with same email, verify generic 409 response |
| 7 | `scripts/verify-sanitizer.sh` | Send request with password/token in body, verify logs show [REDACTED] |
| 8 | `scripts/verify-cross-tenant-queries.sh` | Grep all service files for tenantId in WHERE clause |

### 21.4 Prisma Migrations

| # | Name | Changes |
|---|------|---------|
| 1 | `add_revoked_token_model` | Create `revoked_tokens` table |
| 2 | `add_webhook_encrypted_secret` | Add `encryptedSecret` column to `webhook_registrations` |

### 21.5 Dependency/CI-CD Changes

- No new npm packages required (AES-256-GCM uses built-in Node.js `crypto`)
- No CI/CD changes for M1
- No Dockerfile changes

---

## APPENDIX A: VERIFICATION CHECKLIST

- [ ] All 12 tasks implemented against `feature/phase7-m1` branch
- [ ] 2 Prisma migrations generated and tested
- [ ] 5 new files created
- [ ] 20 existing files modified
- [ ] 8 verification scripts created
- [ ] All existing 213 tests pass
- [ ] Manual smoke test: auth flow (register → login → create resource → logout → reuse token)
- [ ] Manual smoke test: webhook event emitted → delivered → signature verified
- [ ] Manual smoke test: cross-tenant injection blocked
- [ ] Manual smoke test: API key read scope blocked on write endpoint
- [ ] Manual smoke test: duplicate registration returns generic message
- [ ] Manual smoke test: disabled tenant cannot log in
- [ ] `.env.example` updated with all new required vars
- [ ] Rollback strategy documented and understood
- [ ] Code reviewed (self-review at minimum)

---

## APPENDIX B: MINOR INCONSISTENCIES NOTED DURING VERIFICATION

| # | Source | Issue | Resolution |
|---|--------|-------|------------|
| 1 | PHASE7-VERIFIED-ROADMAP.md:40 | Header says "4 P1 security findings" but only 3 P1 tasks listed | Minor documentation error — actual count is 3. No impact on implementation. |
| 2 | FINAL-ENTERPRISE-AUDIT-v6.4.md:3.2 | Claims "✅ RolesGuard with @Roles()" — contradicts P0-1/P0-2/P0-3 | v6.4 audit assessed infrastructure existence, not completeness. Production audit is authoritative. |
| 3 | FINAL-ENTERPRISE-AUDIT-v6.4.md:3.3 A08 | Claims "✅ Webhook HMAC signing" — contradicts P0-5 | v6.4 did not verify HMAC key correctness. Production audit is authoritative. |
| 4 | FINAL-ENTERPRISE-AUDIT-v6.4.md:3.2 | Claims "✅ ApiKeyGuard — scopes" — contradicts P0-9 | Scope field exists in schema but is dead code. Production audit confirmed no enforcement. |

---

*End of Phase 7 Milestone 1 Implementation Plan. Ready for review and approval before implementation.*
