# PHASE 7 — MILESTONE 1: SECURITY HARDENING — IMPLEMENTATION PLAN v2

**Derived from:** PHASE7-VERIFIED-ROADMAP.md, FORENSIC-VALIDATION.md, FINAL-ENTERPRISE-AUDIT-v6.4.md, PHASE7-M1-PLAN-VALIDATION.md  
**Branch:** `feature/phase7-m1`  
**Baseline release:** v6.4.0  
**Date:** 2026-07-31

---

## 1. OBJECTIVE

Eliminate 8 P0 and 3 P1 security findings from the production audit to raise Security score from 3/10 to 5/10 and Enterprise Readiness from 3/10 to 4/10. Prevent catastrophic data breach, financial fraud, and regulatory fines (GDPR/PCI-DSS).

---

## 2. SCOPE

### In Scope — Mandatory (11 tasks, 11 unique findings)

| ID | Task | Finding | Severity |
|----|------|---------|----------|
| 7.1.1 | `@Roles('OWNER')` on backup controller | P0-1 | P0 |
| 7.1.2 | `@Roles('OWNER','MANAGER')` on privacy controller | P0-2 | P0 |
| 7.1.3 | `@Roles('OWNER','MANAGER')` on gift-cards controller | P0-3 | P0 |
| 7.1.4 | Fix webhook event routing (event name from @OnEvent context) | P0-4 | P0 |
| 7.1.5 | Fix webhook signing (encrypt raw secret at rest, decrypt for HMAC) | P0-5 | P0 |
| 7.1.6 | Body/query tenantId validation via TenantBodyGuard | P0-8 | P0 |
| 7.1.7 | API key scope enforcement with `@Scopes()` decorator | P0-9 | P0 |
| 7.1.8 | Tenant/subscription status check in login() and JwtStrategy.validate() | P1-2 | P1 |
| 7.1.10 | Sensitive data sanitizer in logger | P0-13 | P0 |
| 7.1.11 | Persist revoked JWT blacklist to DB; wire `blacklistToken()` into logout | P1-3 | P1 |
| 7.1.12 | Generic error message on duplicate registration | P1-4 | P1 |

### Out of Scope — Permanent

- MFA/2FA (P1-1) — deferred to Phase 7.7
- Permissions system (P1-5) — deferred to Phase 7.7
- npm audit / dependency scanning — deferred to Phase 7.5
- CD pipeline — deferred to Phase 7.5
- Cache TTL standardization (P2-12 refinement) — deferred to later milestone
- Any P0/P1/P2 finding not listed above

### Out of Scope — Removed After Validation

- TenantStatusGuard (global per-request guard) — scope creep beyond P1-2. P1-2 only requires inline checks in login() + JWT validate().
- SkipTenantStatus decorator — unnecessary without TenantStatusGuard.
- SanitizeInterceptor — redundant with logger-only approach.
- BullMQ cleanup job for RevokedToken — performance optimization deferred to later milestone.
- SCRYPT_ENABLED config — UNJUSTIFIED, not tied to any finding.
- TENANT_STATUS_CHECK_ENABLED env var — unnecessary without TenantStatusGuard.

---

## 3. SUCCESS CRITERIA

All must pass before M1 is considered complete:

- [ ] **7.1.1–7.1.3**: Non-OWNER user receives 403 on backup/privacy/gift-cards endpoints; OWNER passes
- [ ] **7.1.4**: Webhook delivery log shows events dispatched with correct event names; consumer receives valid payload
- [ ] **7.1.5**: HMAC signature computed with raw secret (not hash); consumer-side verification passes
- [ ] **7.1.6**: POST/PUT/PATCH with `body.tenantId !== JWT tenantId` returns 403; query params also checked
- [ ] **7.1.7**: Read-only API key cannot create/update/delete; read-only key passes on GET; write scope keys match route
- [ ] **7.1.8**: Disabled tenant or expired subscription returns 403 on login; active tenant/subscription passes
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
Controller                  Guard/Decorator Layer               Service                    Prisma
──────────                ─────────────────────             ────────────                 ───────

backup.controller.ts     @Roles('OWNER')                       backup.service.ts
privacy.controller.ts    @Roles('OWNER','MANAGER')             privacy.service.ts
gift-cards.controller    @Roles('OWNER','MANAGER')             gift-cards.service.ts
                         (redeem open to STAFF)

api-keys/guard           @Scopes() + ApiKeyGuard (scope)       api-keys.service.ts
auth/controller          JwtAuthGuard                          auth.service.ts
                                                               └── tenant status check (inline)

common/guards/
  tenant-body.guard.ts [NEW] — validates body/query tenantId against JWT

api-keys/decorators/
  scopes.decorator.ts [NEW] — @Scopes('read') / @Scopes('write')

webhooks/
  webhook-event-emitter.ts [MODIFIED] — uses EventEmitter2 event name context
  webhook-delivery.service.ts [MODIFIED] — decrypts secret for HMAC signing
  webhook-processor.ts [MODIFIED] — uses raw secret from decrypted field

auth/
  auth.service.ts [MODIFIED] — tenant status check in login(), generic registration error
  jwt.strategy.ts [MODIFIED] — tenant status check in validate()

redis/
  redis.service.ts [MODIFIED] — blacklistToken() persists to DB AND Redis

prisma/
  schema.prisma [MODIFIED] — single migration: RevokedToken model + encryptedSecret field

common/logger/
  logger.service.ts [MODIFIED] — deep-copy + redact sensitive keys
  http-logging.middleware.ts [MODIFIED] — redact request/response body sensitive fields
```

---

## 5. MODULE DESIGN

### 5.1 Backup Controller (7.1.1)

**File:** `apps/api/src/modules/backup/backup.controller.ts`

**Change:** Add `@Roles('OWNER')` decorator.

```
Current:
@UseGuards(JwtAuthGuard, TenantGuard)

Target:
@Roles('OWNER')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
```

### 5.2 Privacy Controller (7.1.2)

**File:** `apps/api/src/modules/privacy/privacy.controller.ts`

**Change:** Add `@Roles('OWNER', 'MANAGER')`.

### 5.3 Gift Cards Controller (7.1.3)

**File:** `apps/api/src/modules/gift-cards/gift-cards.controller.ts`

**Change:** Add `@Roles('OWNER', 'MANAGER')` on create/recharge/deactivate endpoints. Keep redeem open to STAFF (cashiers need to redeem).

### 5.4 Webhook Event Emitter (7.1.4)

**File:** `apps/api/src/modules/webhooks/webhook-event-emitter.ts`

**Root cause — Two bugs:**
1. `payload.eventType` is checked but `eventType` is never in the payload — events are emitted as `this.eventEmitter.emit('order.created', payload)` where payload has no `eventType` field.
2. Event name mismatch: emitted as `'order.created'` (singular) but subscribed as `'orders.created'` (plural).

**Fix:** Use EventEmitter2's event name from context:

```typescript
@OnEvent('**', { async: true })
async handleEvent(payload: any, eventName?: string) {
  const eventType = eventName || payload?.eventType;
  // ... rest of logic
}
```

Also fix all emitters to use consistent naming (`order.created` not `orders.created`, etc.).

### 5.5 Webhook Processor / Delivery (7.1.5)

**Current flow:**
1. `generateSecret()` creates random 32-byte hex `secret`, computes `hmac(sha256, secret).digest('hex')` as `hash`
2. `secretHash` in WebhookRegistration stores `hash` (the HMAC output)
3. `getWebhookSecret()` returns `registration.secretHash` (the HMAC hash, not the raw secret)
4. `signPayload(payloadBody, secret)` signs with `hash` instead of `secret`

**Fix:**
1. Add `encryptedSecret` field to WebhookRegistration — stores AES-256-GCM encrypted raw secret
2. Add env var `WEBHOOK_SECRET_ENCRYPTION_KEY` (32 hex chars = 16 bytes for AES-256)
3. `generateSecret()` returns `{ secret, hash, encryptedSecret, prefix }`:
   - `secret` = raw 32-byte hex (one-time display)
   - `encryptedSecret` = `AES-256-GCM.encrypt(secret, key)` (stored in DB)
   - `hash` = `hmac(sha256, secret).digest('hex')` (stored for verification)
4. `getWebhookSecret()` decrypts `registration.encryptedSecret` → raw secret
5. `signPayload()` uses raw secret for HMAC

### 5.6 API Key Scope Guard (7.1.7)

**New file:** `apps/api/src/modules/api-keys/decorators/scopes.decorator.ts`
**Modified file:** `apps/api/src/modules/api-keys/guards/api-key.guard.ts`

```typescript
// scopes.decorator.ts
export const SCOPES_KEY = 'scopes';
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);
```

**Route-scope mapping default:**
| HTTP Method | Required Scope |
|-------------|---------------|
| GET, HEAD, OPTIONS | `read` |
| POST, PUT, PATCH, DELETE | `write` |

Individual routes can override with explicit `@Scopes('read','write')`.

---

## 6. SERVICES

### 6.1 Auth Service (7.1.8, 7.1.12)

**File:** `apps/api/src/modules/auth/auth.service.ts`

**Changes for 7.1.8 (inline tenant check in login()):**
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

**Changes for 7.1.12 (generic registration error):**
```typescript
const existingUser = await this.prisma.user.findUnique({ where: { email } });
if (existingUser) {
  throw new ConflictException('User already exists');
}
```

### 6.2 JWT Strategy (7.1.8)

**File:** `apps/api/src/modules/auth/jwt.strategy.ts`

**Change:** Add inline tenant status check in `validate()`. Load Tenant by `payload.tenantId`, verify `tenant.status === 'ACTIVE'` and subscription active. Same logic as login() above.

### 6.3 Redis Service (7.1.11)

**File:** `apps/api/src/redis/redis.service.ts`

**Change:** Modify `blacklistToken()` to:
1. Persist JTI + expiry to `RevokedToken` table via Prisma
2. Keep Redis SET as fast-check cache (TTL matches token expiry)
3. Add `isTokenBlacklisted(jti: string): Promise<boolean>` — checks Redis first, falls back to DB

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

### 7.1 TenantBodyGuard (NEW — 7.1.6)

**File:** `apps/api/src/common/guards/tenant-body.guard.ts`

Purpose: Validate that `request.body.tenantId` (if present) and `request.query.tenantId` (if present) match the JWT's tenantId claim.

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

### 7.2 Scopes Decorator (NEW — 7.1.7)

**File:** `apps/api/src/modules/api-keys/decorators/scopes.decorator.ts`

See §5.6 for design.

---

## 8. INTERCEPTORS

None required. Sensitive data sanitization (7.1.10) is implemented at the logger level.

---

## 9. MIDDLEWARE

No new middleware required. TenantBodyGuard (Guard) handles cross-tenant validation.

---

## 10. PRISMA / DATABASE CHANGES

### 10.1 Single Migration: `m1_security_hardening`

Combines both schema changes into one migration.

**New model — RevokedToken (7.1.11):**
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

**New field — WebhookRegistration.encryptedSecret (7.1.5):**
```prisma
model WebhookRegistration {
  // ... existing fields ...
  encryptedSecret String?  // AES-256-GCM encrypted raw secret
}
```

### 10.2 Backward Compatibility

- `encryptedSecret` is nullable (`String?`). Existing records without encrypted secrets continue to work (webhooks already broken from P0-4 + P0-5 — no regression).
- `RevokedToken` is a new table — no impact on existing data.
- All changes are additive — zero data migration risk.

### 10.3 RevokedToken Retention Policy

Expired rows can be cleaned up manually or via a future BullMQ job. For M1, no automatic cleanup is implemented. The `expiresAt` field allows future cleanup jobs to identify eligible rows. Tokens past their `expiresAt` are treated as expired by the blacklist check logic.

### 10.4 No Index Changes in M1

Index improvements (P1-6, P1-10, P1-14) deferred to Phase 7.4.

---

## 11. API DESIGN

### 11.1 No New Endpoints

All changes are internal — no new API endpoints.

### 11.2 Response Changes

| Endpoint | Change |
|----------|--------|
| `POST /auth/register` | 409 response: `{ "message": "User already exists" }` (was detailed user object) |
| `POST /auth/login` | Now returns 403 if tenant disabled or subscription expired |
| `POST /backup/*` | Now returns 403 for non-OWNER (was accessible to all) |
| `POST /privacy/*` | Now returns 403 for non-OWNER/MANAGER (was accessible to all) |
| `POST /gift-cards/*` | Now returns 403 for non-OWNER/MANAGER on create/recharge/deactivate |
| All endpoints | Body/query tenantId mismatch → 403 |

---

## 12. DTO DESIGN

No DTO changes required. All changes are in guards, services, and internal logic.

---

## 13. CONFIGURATION

### 13.1 New Configuration Entries

| Config Key | Source | Default | Used By |
|------------|--------|---------|---------|
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | Env var | (required) | webhook-delivery.service.ts |

### 13.2 Config Module Updates

Add to `config/webhook.config.ts`:
```typescript
encryptionKey: {
  env: 'WEBHOOK_SECRET_ENCRYPTION_KEY',
  type: 'string',
  default: '',
},
```

---

## 14. ENVIRONMENT VARIABLES

### 14.1 New Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | Yes | 32-hex-char (16 byte) AES-256 key for encrypting webhook secrets |

### 14.2 .env.example Additions

```env
# Phase 7 — Security Hardening (M1)
WEBHOOK_SECRET_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
```

### 14.3 Webhook Encryption Key Rotation Procedure

If the key needs to be rotated:
1. Generate a new key
2. For each WebhookRegistration, decrypt the existing `encryptedSecret` with the old key, re-encrypt with the new key, and update the row
3. Update the environment variable
4. Roll out the change

There is no key versioning in M1. If key rotation is expected to be frequent, add a `secretKeyVersion` column in a future milestone.

---

## 15. SECURITY DESIGN

### 15.1 Defense-in-Depth Layers

```
Layer 1: JwtAuthGuard — validates JWT signature + expiry
Layer 2: RolesGuard + @Roles() — RBAC enforcement (7.1.1-7.1.3)
Layer 3: TenantGuard — extracts tenantId from JWT (existing)
Layer 4: TenantBodyGuard — validates body/query tenantId (NEW — 7.1.6)
Layer 5: ApiKeyGuard + @Scopes() — API key + scope enforcement (NEW — 7.1.7)
Layer 6: Sensitive data redaction in logger (NEW — 7.1.10)
Layer 7: JWT blacklist — revoked tokens rejected (NEW — 7.1.11)
Layer 8: Inline tenant status check in login() + JWT validate() (NEW — 7.1.8)
```

### 15.2 Encryption-at-Rest (Webhook Secrets)

**Algorithm:** AES-256-GCM  
**Key:** Direct from `WEBHOOK_SECRET_ENCRYPTION_KEY` (32 hex chars → 16 bytes)  
**Implementation:** `crypto.createCipheriv('aes-256-gcm', key, iv)`  
**Storage:** Hex-encoded ciphertext + IV + auth tag in `WebhookRegistration.encryptedSecret`

### 15.3 JWT Blacklist Persistence

- Primary store: `RevokedToken` table (durable, survives Redis restart)
- Cache store: Redis SET with TTL matching token expiry
- Check order: Redis SET → DB query (if not found in Redis)
- M1 scope: No automatic cleanup of expired RevokedToken rows. Acceptable because:
  - `expiresAt` field is set at creation time
  - Old rows can be pruned manually or via future BullMQ job
  - Table growth rate is bounded by logout frequency (not login)

---

## 16. TESTING STRATEGY

### 16.1 Unit Tests (per mandatory task)

| Task | Test | Coverage Target |
|------|------|----------------|
| 7.1.1–7.1.3 | RolesGuard rejects non-OWNER for each controller | 3 test cases each |
| 7.1.4 | `handleEvent()` resolves event name from EventEmitter2 context | 2 test cases |
| 7.1.5 | `generateSecret()` produces valid encrypted secret; `getWebhookSecret()` decrypts correctly | 3 test cases |
| 7.1.6 | TenantBodyGuard rejects body.tenantId mismatch | 3 test cases |
| 7.1.7 | ApiKeyGuard rejects read key on POST; passes read key on GET | 4 test cases |
| 7.1.8 | `login()` throws when tenant disabled; `validate()` throws when subscription expired | 4 test cases |
| 7.1.10 | Logger redacts sensitive keys; preserves non-sensitive keys | 2 test cases |
| 7.1.11 | `blacklistToken()` persists to DB; `isTokenBlacklisted()` returns true | 3 test cases |
| 7.1.12 | `register()` returns generic error on duplicate email | 2 test cases |

### 16.2 Smoke Tests (manual)

1. Login as STAFF → try backup create → expect 403
2. Login as OWNER → backup create → expect 200/201
3. POST to endpoint with `body.tenantId` mismatched → expect 403
4. Login with disabled tenant → expect 401/403
5. Register duplicate email → expect 409 with generic message
6. Create API key with read scope → POST with that key → expect 403
7. Create API key with write scope → POST with that key → expect 200
8. Login → logout → reuse token → expect 401

### 16.3 Existing Test Risk

**Risk level: Medium-High.** The existing 213 tests in 26 files may exercise backup, privacy, or gift-cards endpoints with non-OWNER roles. Before implementing 7.1.1–7.1.3, grep all test files for affected endpoints:

```bash
rg -l "backup|privacy|gift-card" apps/api/src/**/*.spec.ts
```

If any test uses non-OWNER roles on these endpoints, update the test role or add a role setup step. This must be done BEFORE applying the `@Roles()` decorators to avoid test suite breakage.

---

## 17. MIGRATION STRATEGY

### 17.1 Deployment Order

```
Step 1: Prisma migration (npx prisma migrate dev --name m1_security_hardening)
Step 2: Deploy webhook fixes (encryptedSecret, event routing, signing)
Step 3: Deploy guard/scope changes (TenantBodyGuard, @Scopes())
Step 4: Deploy controller @Roles() decorators
Step 5: Deploy auth inline checks (login, JWT validate)
Step 6: Deploy logger sanitization
Step 7: Deploy JWT blacklist persistence
Step 8: Verify all via tests + smoke tests
```

### 17.2 Prisma Migration

```bash
npx prisma migrate dev --name m1_security_hardening
```

Single migration containing:
- Create `revoked_tokens` table
- Add `encrypted_secret` column to `webhook_registrations`

### 17.3 API Key Scope Migration Path

To avoid breaking existing API consumers:
1. **Phase A** (before scope enforcement): Add `@Scopes()` to ALL routes with read/write as appropriate. Do NOT enable scope checking in ApiKeyGuard yet.
2. **Phase B** (scope enforcement): Enable scope checking in ApiKeyGuard. Existing keys will work if their stored scope field covers their route usage.
3. **Audit** (post-deployment): Review ApiKey records to ensure scope field matches intended usage. Update any mismatches.

---

## 18. ROLLBACK STRATEGY

### 18.1 Per-Task Rollback

| Task | Rollback Action |
|------|----------------|
| 7.1.1–7.1.3 | Remove `@Roles()` decorators |
| 7.1.4 | Restore original `handleEvent()` using `payload.eventType` |
| 7.1.5 | Remove `encryptedSecret` field (migration down); revert `getWebhookSecret()` |
| 7.1.6 | Remove `TenantBodyGuard` from providers |
| 7.1.7 | Remove `@Scopes()` decorators; revert `ApiKeyGuard` |
| 7.1.8 | Remove tenant status check from `login()` and `validate()` |
| 7.1.10 | Restore original logger methods |
| 7.1.11 | Drop `RevokedToken` table (migration down); revert `redis.service.ts` |
| 7.1.12 | Restore original registration response |

### 18.2 Full Rollback

```bash
git checkout feature/phase7-m1~1
npx prisma migrate down
```

### 18.3 Data Safety

All changes are additive — no destructive operations, no data loss risk. `RevokedToken` can be dropped safely. `encryptedSecret` is nullable — dropping it is safe.

---

## 19. RISKS

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | API key scope enforcement breaks existing integrations | Medium | High | Deploy @Scopes on routes BEFORE enabling enforcement (two-phase rollout). Document scope requirement change. |
| R2 | Webhook encryption key lost | Low | High | Document key generation + rotation in README. Add startup validation that key is set. |
| R3 | Existing tests fail due to new RBAC restrictions | **Medium-High** | Medium | Grep test files for affected endpoints BEFORE applying decorators. Update test roles proactively. |
| R4 | RevokedToken table unbounded growth | Low (short-term) | Low (short-term) | M1 ships without cleanup. Acceptable — growth rate is bounded by logout frequency. `expiresAt` enables future cleanup. |
| R5 | Webhook encryption key rotation breaks existing secrets | Low | High | Document rotation procedure in §14.3. Key rotation is rare — acceptable for M1. |
| R6 | Rate limiting bypass via API key | Low | Low | Known limitation — not in M1 scope. |
| R7 | Race condition in RevokedToken (token used between logout and DB write) | Low | Low | Acceptable — Redis TTL is primary check; DB is fallback for Redis restart. |


---

## 20. EFFORT ESTIMATES

### 20.1 Mandatory Tasks

| ID | Task | Est. Time | Complexity |
|----|------|-----------|------------|
| 7.1.1 | `@Roles('OWNER')` on backup controller | 30 min | Trivial |
| 7.1.2 | `@Roles('OWNER', 'MANAGER')` on privacy controller | 30 min | Trivial |
| 7.1.3 | `@Roles('OWNER', 'MANAGER')` on gift-cards controller | 30 min | Trivial |
| 7.1.4 | Fix webhook event routing | 1 hr | Medium |
| 7.1.5 | Fix webhook signing with encryption | 4 hrs | High |
| 7.1.6 | Add TenantBodyGuard | 1 day | Medium |
| 7.1.7 | Implement @Scopes() + ApiKeyGuard enforcement | 2 days | High |
| 7.1.8 | Add tenant status check in login() + JWT validate() | 4 hrs | Medium |
| 7.1.10 | Add sensitive data sanitizer to logger | 2 hrs | Medium |
| 7.1.11 | Persist JWT blacklist to DB | 2 days | High |
| 7.1.12 | Generic error on duplicate registration | 30 min | Trivial |
| **Total mandatory** | | **~7–9 days** | |

### 20.2 Parallel Execution

```
Track A (trivial): 7.1.1, 7.1.2, 7.1.3, 7.1.12 — 0.5 day
Track B (webhooks): 7.1.4, 7.1.5 — 1 day
Track C (guards + auth): 7.1.6, 7.1.7, 7.1.8 — 2.5 days
Track D (data): 7.1.10, 7.1.11 — 2 days
Remaining: Testing, debugging, smoke tests — 1 day
```

**With 2 engineers: ~4–5 calendar days**

---

## 21. DELIVERABLES

### 21.1 Files to Create (2)

| # | File | Purpose | Task |
|---|------|---------|------|
| 1 | `apps/api/src/common/guards/tenant-body.guard.ts` | Cross-tenant body/query validation | 7.1.6 |
| 2 | `apps/api/src/modules/api-keys/decorators/scopes.decorator.ts` | `@Scopes()` decorator | 7.1.7 |

### 21.2 Files to Modify (18)

| # | File | Change | Task |
|---|------|--------|------|
| 1 | `apps/api/src/modules/backup/backup.controller.ts` | Add `@Roles('OWNER')` | 7.1.1 |
| 2 | `apps/api/src/modules/privacy/privacy.controller.ts` | Add `@Roles('OWNER', 'MANAGER')` | 7.1.2 |
| 3 | `apps/api/src/modules/gift-cards/gift-cards.controller.ts` | Add `@Roles('OWNER', 'MANAGER')` | 7.1.3 |
| 4 | `apps/api/src/modules/webhooks/webhook-event-emitter.ts` | Fix event routing | 7.1.4 |
| 5 | `apps/api/src/modules/webhooks/webhook-delivery.service.ts` | Add secret decryption | 7.1.5 |
| 6 | `apps/api/src/modules/webhooks/webhook-processor.ts` | Use decrypted secret for signing | 7.1.5 |
| 7 | `apps/api/src/modules/webhooks/webhook-registration.service.ts` | Encrypt secret on create | 7.1.5 |
| 8 | `apps/api/src/modules/api-keys/guards/api-key.guard.ts` | Add scope checking | 7.1.7 |
| 9 | `apps/api/src/modules/auth/auth.service.ts` | Add tenant status check, generic registration error | 7.1.8, 7.1.12 |
| 10 | `apps/api/src/modules/auth/jwt.strategy.ts` | Add tenant status check in validate() | 7.1.8 |
| 11 | `apps/api/src/common/logger/logger.service.ts` | Add sensitive data redaction | 7.1.10 |
| 12 | `apps/api/src/common/logger/http-logging.middleware.ts` | Redact sensitive headers | 7.1.10 |
| 13 | `apps/api/src/redis/redis.service.ts` | Add DB persistence for blacklist | 7.1.11 |
| 14 | `apps/api/src/modules/auth/auth.module.ts` | Register blacklist service dependency | 7.1.11 |
| 15 | `apps/api/src/app.module.ts` | Register TenantBodyGuard, ApiKeyGuard scope | 7.1.6, 7.1.7 |
| 16 | `prisma/schema.prisma` | Add RevokedToken model, encryptedSecret field | 7.1.5, 7.1.11 |
| 17 | `.env.example` | Add WEBHOOK_SECRET_ENCRYPTION_KEY | 7.1.5 |
| 18 | `apps/api/src/config/webhook.config.ts` | Add encryption key config | 7.1.5 |

### 21.3 Verification Scripts (7)

| # | Script | Purpose |
|---|--------|---------|
| 1 | `scripts/verify-rbac.sh` | Hit backup/privacy/gift-cards endpoints with each role, verify 403 vs 200 |
| 2 | `scripts/verify-cross-tenant.sh` | POST with body.tenantId mismatched, verify 403 |
| 3 | `scripts/verify-webhook-routing.sh` | Trigger order.created event, verify webhook delivery log |
| 4 | `scripts/verify-webhook-signing.sh` | Verify HMAC signature matches consumer-side expected value |
| 5 | `scripts/verify-jwt-blacklist.sh` | Login → logout → use same token, verify 401 |
| 6 | `scripts/verify-registration-leak.sh` | Register twice with same email, verify generic 409 |
| 7 | `scripts/verify-sanitizer.sh` | Send request with password/token in body, verify logs show [REDACTED] |

### 21.4 Prisma Migrations (1)

| Name | Changes |
|------|---------|
| `m1_security_hardening` | Create `revoked_tokens` table + add `encrypted_secret` column to `webhook_registrations` |

### 21.5 Dependency/CI-CD Changes

- No new npm packages (AES-256-GCM uses built-in Node.js `crypto`)
- No CI/CD changes
- No Dockerfile changes

---

## APPENDIX A: VERIFICATION CHECKLIST

- [ ] All 11 mandatory tasks implemented
- [ ] 1 Prisma migration generated and tested
- [ ] 2 new files created
- [ ] 18 existing files modified
- [ ] 7 verification scripts created
- [ ] All existing 213 tests pass
- [ ] Test files grepped for affected endpoints BEFORE applying RBAC
- [ ] @Scopes() deployed to all routes BEFORE enabling enforcement
- [ ] Manual smoke test: auth flow (register → login → create resource → logout → reuse token)
- [ ] Manual smoke test: webhook event emitted → delivered → signature verified
- [ ] Manual smoke test: cross-tenant injection blocked
- [ ] Manual smoke test: API key read scope blocked on write endpoint
- [ ] Manual smoke test: duplicate registration returns generic message
- [ ] Manual smoke test: disabled tenant cannot log in
- [ ] `.env.example` updated with WEBHOOK_SECRET_ENCRYPTION_KEY
- [ ] Encryption key rotation procedure documented
- [ ] RevokedToken retention policy understood
- [ ] Rollback strategy documented

---

## APPENDIX B: CONSISTENCY REVIEW (POST-CORRECTION)

### B.1 Every Mandatory Task Maps to a Verified Finding

| Task | Finding | FORENSIC-VALIDATION Status | Severity |
|------|---------|---------------------------|----------|
| 7.1.1 | P0-1 | ✅ CONFIRMED (lines 26-31) | P0 |
| 7.1.2 | P0-2 | ✅ CONFIRMED (lines 33-38) | P0 |
| 7.1.3 | P0-3 | ✅ CONFIRMED (lines 40-45) | P0 |
| 7.1.4 | P0-4 | ✅ CONFIRMED (lines 47-53) | P0 |
| 7.1.5 | P0-5 | ✅ CONFIRMED (lines 55-61) | P0 |
| 7.1.6 | P0-8 | ✅ CONFIRMED (lines 88-94) | P0 |
| 7.1.7 | P0-9 | ✅ CONFIRMED (lines 96-102) | P0 |
| 7.1.8 | P1-2 | ✅ CONFIRMED (line 161) | P1 |
| 7.1.10 | P0-13 | ✅ CONFIRMED (lines 124-130) | P0 |
| 7.1.11 | P1-3 | ✅ CONFIRMED (line 162) | P1 |
| 7.1.12 | P1-4 | ✅ CONFIRMED (line 163) | P1 |

**Result:** 11/11 mandatory tasks map to CONFIRMED findings. 8 P0 + 3 P1. ✅

### B.2 No Scope Creep Remaining

- ~~TenantStatusGuard~~ → REMOVED (scope creep)
- ~~SkipTenantStatus decorator~~ → REMOVED (dependent)
- ~~SanitizeInterceptor~~ → REMOVED (redundant)
- ~~SCRYPT_ENABLED config~~ → REMOVED (UNJUSTIFIED)
- ~~TENANT_STATUS_CHECK_ENABLED env var~~ → REMOVED (dependent)
- ~~BullMQ cleanup job~~ → REMOVED (deferred)
- ~~7.1.9 Prisma query audit~~ → REMOVED from M1 (not a separate verified finding)

**Result:** Zero scope creep in mandatory tasks. ✅

### B.3 Every File is Directly Required

| File | Required By | Verdict |
|------|------------|---------|
| tenant-body.guard.ts | P0-8 — guard never inspects body/query tenantId | ✅ REQUIRED |
| scopes.decorator.ts | P0-9 — no @Scopes() decorator exists | ✅ REQUIRED |
| backup.controller.ts | P0-1 — no @Roles() on backup controller | ✅ REQUIRED |
| privacy.controller.ts | P0-2 — no @Roles() on privacy controller | ✅ REQUIRED |
| gift-cards.controller.ts | P0-3 — no @Roles() on gift-cards controller | ✅ REQUIRED |
| webhook-event-emitter.ts | P0-4 — events never dispatched (wrong name, missing eventType) | ✅ REQUIRED |
| webhook-delivery.service.ts | P0-5 — returns hash instead of secret | ✅ REQUIRED |
| webhook-processor.ts | P0-5 — signs with wrong key | ✅ REQUIRED |
| webhook-registration.service.ts | P0-5 — must encrypt raw secret on creation | ✅ REQUIRED |
| api-key.guard.ts | P0-9 — never inspects result.scopes | ✅ REQUIRED |
| auth.service.ts | P1-2 (no tenant check), P1-4 (leaks user details) | ✅ REQUIRED |
| jwt.strategy.ts | P1-2 — no tenant check in validate() | ✅ REQUIRED |
| logger.service.ts | P0-13 — no sensitive data redaction | ✅ REQUIRED |
| http-logging.middleware.ts | P0-13 — no redaction in HTTP logging (FORENSIC line 128) | ✅ REQUIRED |
| redis.service.ts | P1-3 — blacklistToken() never called + Redis-only | ✅ REQUIRED |
| auth.module.ts | P1-3 — needs redis.service dependency for blacklist | ✅ REQUIRED |
| app.module.ts | P0-8 (TenantBodyGuard), P0-9 (ApiKeyGuard scope) | ✅ REQUIRED |
| schema.prisma | P0-5 (encryptedSecret), P1-3 (RevokedToken) | ✅ REQUIRED |
| .env.example | P0-5 (WEBHOOK_SECRET_ENCRYPTION_KEY) | ✅ REQUIRED |
| webhook.config.ts | P0-5 (encryption key config) | ✅ REQUIRED |

**Result:** 20/20 files required. Zero UNJUSTIFIED. ✅

### B.4 Architecture Consistency Check

| Section | Claim | Reality | Match |
|---------|-------|---------|-------|
| §4 | scopes.decorator under api-keys/decorators/ | §21.1 lists same path | ✅ |
| §4 | No phantom middleware | No middleware listed | ✅ |
| §4 | auth.service.ts — inline check only | No TenantStatusGuard mentioned | ✅ |
| §8 | No interceptors | Section removed | ✅ |
| §9 | No new middleware | Section confirms | ✅ |
| §10 | Single migration `m1_security_hardening` | Listed in §21.4 | ✅ |
| §13 | Only WEBHOOK_SECRET_ENCRYPTION_KEY | No SCRYPT_ENABLED | ✅ |
| §14 | Only WEBHOOK_SECRET_ENCRYPTION_KEY | No TENANT_STATUS_CHECK_ENABLED | ✅ |
| §15 | 8-layer defense-in-depth | No TenantStatusGuard layer | ✅ |

**Result:** All architecture sections internally consistent. No contradictions. ✅

### B.5 Effort Estimate Cross-Check

| Metric | v1 Plan | v2 Plan | Delta | Reason |
|--------|---------|---------|-------|--------|
| Files created | 5 | 2 | -3 | Removed TenantStatusGuard, SkipTenantStatus, SanitizeInterceptor |
| Files modified | 20 | 18 | -2 | Removed app.config.ts, reduced auth.module.ts scope |
| Migrations | 2 | 1 | -1 | Combined into single migration |
| Verification scripts | 8 | 7 | -1 | Removed cross-tenant query script (7.1.9 removed from M1) |
| Mandatory tasks | 12 | 11 | -1 | 7.1.9 removed from M1 (not a separate verified finding) |
| Effort (mandatory) | ~10–17 days | ~7–9 days | -3–8 days | Removal of scope creep items |
| Effort (2 engineers) | 5–7 days | 4–5 days | -1–2 days | Reduced scope |

**Result:** Effort estimates reduced proportionally to scope reduction. Statistically consistent. ✅

---

*End of Phase 7 Milestone 1 Implementation Plan v2. All 9 validation corrections applied. Ready for approval.*
