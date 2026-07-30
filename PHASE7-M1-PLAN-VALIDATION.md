# PHASE 7 M1 — PLAN VALIDATION

**Audit of:** PHASE7-M1-IMPLEMENTATION-PLAN.md  
**Against:** PHASE7-VERIFIED-ROADMAP.md, FORENSIC-VALIDATION.md, FINAL-ENTERPRISE-AUDIT-v6.4.md  
**Date:** 2026-07-31  
**Method:** Systematic cross-reference of every task, file, migration, architecture change, and scope claim

---

## 1. TASK-TO-FINDING VALIDATION

| Task ID | Finding ID | Severity | FORENSIC-VALIDATION Status | Plan Match | Verdict |
|---------|-----------|----------|---------------------------|------------|---------|
| 7.1.1 | P0-1 | P0 | ✅ CONFIRMED (lines 26-31) | ✅ Correct | **VALID** |
| 7.1.2 | P0-2 | P0 | ✅ CONFIRMED (lines 33-38) | ✅ Correct | **VALID** |
| 7.1.3 | P0-3 | P0 | ✅ CONFIRMED (lines 40-45) | ✅ Correct | **VALID** |
| 7.1.4 | P0-4 | P0 | ✅ CONFIRMED (lines 47-53) | ✅ Correct | **VALID** |
| 7.1.5 | P0-5 | P0 | ✅ CONFIRMED (lines 55-61) | ✅ Correct | **VALID** |
| 7.1.6 | P0-8 | P0 | ✅ CONFIRMED (lines 88-94) | ✅ Correct | **VALID** |
| 7.1.7 | P0-9 | P0 | ✅ CONFIRMED (lines 96-102) | ✅ Correct | **VALID** |
| 7.1.8 | P1-2 | P1 | ✅ CONFIRMED (line 161) | ✅ Correct | **VALID** |
| 7.1.9 | P0-8 (extended) | P0 | ⚠️ **No separate finding** | ⚠️ Task claims P0-8 extended but P0-8 is about guard body injection (7.1.6), not Prisma query audits | **NOT DIRECTLY BACKED** |
| 7.1.10 | P0-13 | P0 | ✅ CONFIRMED (lines 124-130) | ✅ Correct | **VALID** |
| 7.1.11 | P1-3 | P1 | ✅ CONFIRMED (line 162) | ✅ Correct | **VALID** |
| 7.1.12 | P1-4 | P1 | ✅ CONFIRMED (line 163) | ✅ Correct | **VALID** |

### Issue 1-A: Task 7.1.9 lacks direct finding

**Detail:** Task 7.1.9 says "Fix cross-tenant Prisma queries — verify all services have tenantId WHERE filter" and maps to "P0-8 (extended)". However, FORENSIC-VALIDATION.md P0-8 only addresses the TenantGuard not checking body/query tenantId — it does NOT include a separate finding about Prisma query WHERE filters. The roadmap itself labels it "P0-8 (extended)" rather than a separate finding ID, confirming this is an extrapolation.

**Impact:** This task adds 2–3 days of audit work not explicitly required by any verified finding. While the audit is reasonable defense-in-depth, it is **not strictly required** by the forensic findings.

**Recommendation:** Keep task 7.1.9 but reclassify it as **RECOMMENDED** (not REQUIRED) and reduce priority within M1. Consider deferring to M2 if timeline is tight.

---

## 2. FILE VALIDATION

### 2.1 Files to Create (5 total)

| # | File | Task | Finding | Required? | Verdict |
|---|------|------|---------|-----------|---------|
| 1 | `common/guards/tenant-body.guard.ts` | 7.1.6 | P0-8 | ✅ **REQUIRED** | VALID |
| 2 | `common/guards/tenant-status.guard.ts` | 7.1.8 | P1-2 | ⚠️ **OVER-ENGINEERED** | P1-2 only requires login() + JWT validate() check — a full per-request guard goes beyond. Recommend removing the guard and implementing as inline checks in auth.service.ts + jwt.strategy.ts only. |
| 3 | `common/decorators/skip-tenant-status.decorator.ts` | 7.1.8 | P1-2 | ❌ **UNNECESSARY** | Only needed if TenantStatusGuard exists. If guard is removed as recommended, this decorator is not needed. |
| 4 | `api-keys/decorators/scopes.decorator.ts` | 7.1.7 | P0-9 | ✅ **REQUIRED** | VALID |
| 5 | `common/interceptors/sanitize.interceptor.ts` | 7.1.10 | P0-13 | ❌ **REDUNDANT** | Plan itself says logger modification is "PREFERRED". If logger.service.ts is modified to sanitize, a separate interceptor is redundant and adds unnecessary overhead. Recommend removing this file; use logger-only approach. |

**Subtotal: 2 UNNECESSARY files, 0 UNJUSTIFIED files**

### 2.2 Files to Modify (20 total)

| # | File | Task | Finding | Required? | Verdict |
|---|------|------|---------|-----------|---------|
| 6 | `backup.controller.ts` | 7.1.1 | P0-1 | ✅ **REQUIRED** | VALID |
| 7 | `privacy.controller.ts` | 7.1.2 | P0-2 | ✅ **REQUIRED** | VALID |
| 8 | `gift-cards.controller.ts` | 7.1.3 | P0-3 | ✅ **REQUIRED** | VALID |
| 9 | `webhook-event-emitter.ts` | 7.1.4 | P0-4 | ✅ **REQUIRED** | VALID |
| 10 | `webhook-delivery.service.ts` | 7.1.5 | P0-5 | ✅ **REQUIRED** | VALID |
| 11 | `webhook-processor.ts` | 7.1.5 | P0-5 | ✅ **REQUIRED** | VALID |
| 12 | `webhook-registration.service.ts` | 7.1.5 | P0-5 | ✅ **REQUIRED** | VALID |
| 13 | `api-key.guard.ts` | 7.1.7 | P0-9 | ✅ **REQUIRED** | VALID |
| 14 | `auth.service.ts` | 7.1.8, 7.1.12 | P1-2, P1-4 | ✅ **REQUIRED** | VALID |
| 15 | `jwt.strategy.ts` | 7.1.8 | P1-2 | ✅ **REQUIRED** | VALID |
| 16 | `logger.service.ts` | 7.1.10 | P0-13 | ✅ **REQUIRED** | VALID |
| 17 | `http-logging.middleware.ts` | 7.1.10 | P0-13 | ✅ **REQUIRED** | Forensic explicitly lists this file |
| 18 | `redis.service.ts` | 7.1.11 | P1-3 | ✅ **REQUIRED** | VALID |
| 19 | `auth.module.ts` | 7.1.8, 7.1.11 | P1-2, P1-3 | ✅ **REQUIRED** | VALID |
| 20 | `app.module.ts` | 7.1.6, 7.1.7, 7.1.10 | P0-8, P0-9, P0-13 | ✅ **REQUIRED** | VALID |
| 21 | `schema.prisma` | 7.1.5, 7.1.11 | P0-5, P1-3 | ✅ **REQUIRED** | VALID |
| 22 | `.env.example` | 7.1.5, 7.1.8 | P0-5, P1-2 | ✅ **REQUIRED** | VALID |
| 23 | `webhook.config.ts` | 7.1.5 | P0-5 | ✅ **REQUIRED** | VALID |
| 24 | `app.config.ts` | 7.1.8 | P1-2 | ⚠️ **RECOMMENDED** | Not strictly required by P1-2, but config toggle is reasonable ops practice. Acceptable. |

**Subtotal: 0 UNJUSTIFIED files, 1 RECOMMENDED (not required)**

### 2.3 Architectural Contradictions Found

| Section | Claim | Contradiction | Severity |
|---------|-------|--------------|----------|
| §4 Architecture | `scopes.decorator.ts` listed under `common/guards/` | §21.1 correctly places it under `api-keys/decorators/` | Minor — fix path in §4 |
| §4 Architecture | `tenant-status.middleware.ts [NEW]` listed under `common/middleware/` | §9 says "No new middleware required" and guard is implemented as Guard, not middleware | Minor — remove phantom middleware from §4 |
| §8 Sanitizer | Proposes BOTH an interceptor AND logger modifications | Redundant design; plan says "PREFERRED" is logger-only approach | Medium — pick one approach |
| §13 Config | `SCRYPT_ENABLED` config entry listed | NOT mentioned in any task, finding, or requirement. Zero justification. | **UNJUSTIFIED** — remove completely |

---

## 3. PRISMA MIGRATION VALIDATION

### Migration 1: `add_revoked_token_model`

| Dimension | Assessment |
|-----------|-----------|
| **Purpose** | Persist revoked JWT blacklist to durable storage |
| **Finding** | P1-3 (FORENSIC-VALIDATION.md:162) — "Revoked JWT blacklist is Redis-only" |
| **Backward compatible** | ✅ Yes — new table, no existing data affected |
| **Rollback** | ✅ Simple — DROP TABLE revoked_tokens |
| **Deployment risk** | ✅ Low — no consumers depend on this table |
| **Data loss risk** | ✅ None — additive change |
| **Verdict** | **REQUIRED** |

### Migration 2: `add_webhook_encrypted_secret`

| Dimension | Assessment |
|-----------|-----------|
| **Purpose** | Store AES-256-GCM encrypted raw webhook secret |
| **Finding** | P0-5 (FORENSIC-VALIDATION.md:55-61) — signing uses hash instead of secret |
| **Backward compatible** | ✅ Yes — `String?` nullable, existing records continue to function (webhooks already broken) |
| **Rollback** | ✅ Simple — ALTER TABLE webhook_registrations DROP COLUMN encrypted_secret |
| **Deployment risk** | ✅ Low — nullable column, no impact on existing writes/reads |
| **Data loss risk** | ✅ None — additive change |
| **Verdict** | **REQUIRED** |

### 3.1 Migration Consolidation

**Recommendation:** Combine both changes into a SINGLE migration. Two separate migrations for two additive schema changes in the same milestone adds unnecessary deployment steps with zero benefit. Generate one migration named `m1_security_hardening`.

---

## 4. ARCHITECTURE CHANGE VALIDATION

| Change | Finding | Classification | Rationale |
|--------|---------|---------------|-----------|
| **TenantBodyGuard** | P0-8 | **REQUIRED** | P0-8 explicitly requires body/query tenantId validation. Guard is the correct architectural choice. |
| **TenantStatusGuard** | P1-2 | **RECOMMENDED** | P1-2 only requires login() + JwtStrategy.validate() to check tenant status. A global per-request guard is defense-in-depth but exceeds the finding's scope. Recommend implementing inline in auth.service.ts and jwt.strategy.ts only — removes need for guard + SkipTenantStatus decorator + config toggle. |
| **@Scopes decorator** | P0-9 | **REQUIRED** | P0-9 explicitly states "No @Scopes() decorator exists". Essential for scope enforcement. |
| **SanitizeInterceptor** | P0-13 | **RECOMMENDED** | P0-13 requires sensitive data redaction. Logger-only approach (modify logger.service.ts + http-logging.middleware.ts) is sufficient and more comprehensive. Interceptor file is redundant. |
| **AES-256-GCM encryption** | P0-5 | **REQUIRED** | The raw secret must be stored and retrieved for correct HMAC signing. Encryption-at-rest is the correct security pattern. |
| **RevokedToken model** | P1-3 | **REQUIRED** | Redis-only blacklist is insufficient (survives restart). Durable persistence via Prisma is necessary. |
| **encryptedSecret field** | P0-5 | **REQUIRED** | Stores AES-256 encrypted raw secret for HMAC signing. |

---

## 5. SCOPE VERIFICATION

### 5.1 Scope Creep Found

| # | Item | Source | Issue | Action |
|---|------|--------|-------|--------|
| 1 | **TenantStatusGuard** (global per-request) | §7.2 | P1-2 only requires login() + JWT validate() check. Adding a guard on every request extends scope. | **Remove guard** — implement inline checks only |
| 2 | **SkipTenantStatus decorator** | §7.4 | Only needed if TenantStatusGuard exists | **Remove** (follows from #1) |
| 3 | **SanitizeInterceptor** (separate file) | §8.1 | Redundant with logger modification. Plan itself prefers logger approach. | **Remove interceptor file** — logger-only approach |
| 4 | **SCRYPT_ENABLED config** | §13.1 | Not tied to any finding. No mention in roadmap, forensic, or audit. | **Remove** — completely UNJUSTIFIED |
| 5 | **BullMQ cleanup job for RevokedToken** | §15.3 | P1-3 only requires persistence. Periodic cleanup is a performance optimization outside M1 scope. | **Defer** — remove from M1 plan, add note for later |
| 6 | **"restrict anonymize to self"** in privacy controller | §5.2 | Roadmap mentions this but P0-2 only requires @Roles(). Self-restriction is a nice-to-have, not a P0 requirement. | **Defer** or make explicit that this is extra |
| 7 | **Task 7.1.9 — Prisma query audit** | §2 | Not a separate verified finding. Extrapolation from P0-8. | **Reclassify as RECOMMENDED** — reduce priority |
| 8 | **TENANT_STATUS_CHECK_ENABLED env var** | §14 | Config toggle for TenantStatusGuard. If guard is removed, this env var is unnecessary. | **Remove** (follows from #1) |
| 9 | **app.config.ts modification** | §21.2 (#24) | Config entry for TENANT_STATUS_CHECK_ENABLED | **Remove** (follows from #1, #8) |

### 5.2 Scope That is Correct

- All 3 controller @Roles() additions (7.1.1–7.1.3) ✅
- Webhook event routing fix (7.1.4) ✅
- Webhook signing + encryption fix (7.1.5) ✅
- TenantBodyGuard (7.1.6) ✅
- @Scopes decorator + ApiKeyGuard scope enforcement (7.1.7) ✅
- Auth service login + JWT validate tenant status check (7.1.8) ✅ — **inline only, no guard**
- Logger sensitive data redaction (7.1.10) ✅ — **logger-only, no interceptor**
- JWT blacklist persistence (7.1.11) ✅ — **no BullMQ cleanup job**
- Generic registration error (7.1.12) ✅
- All Prisma schema changes ✅
- All webhook service changes ✅
- Config + env vars for webhook encryption ✅

### 5.3 Modules Touched

| Module | Justification |
|--------|---------------|
| `backup/` | Finding P0-1 — direct hit |
| `privacy/` | Finding P0-2 — direct hit |
| `gift-cards/` | Finding P0-3 — direct hit |
| `webhooks/` | Findings P0-4, P0-5 — direct hit |
| `auth/` | Findings P1-2, P1-4 — direct hit |
| `api-keys/` | Finding P0-9 — direct hit |
| `redis/` | Finding P1-3 — direct hit |
| `common/guards/` | New guard for P0-8 |
| `common/logger/` | Finding P0-13 — direct hit |
| `common/config/` | Config for P0-5 encryption key |

All modules touched are directly justified by verified findings. ✅

---

## 6. RISK REVIEW

### 6.1 Risks Already Documented (in plan)

| Risk | Mitigation |
|------|-----------|
| API key scope breaks existing integrations | Add @Scopes to all routes before deploying |
| Tenant status guard causes login failures | Add null-check |
| Webhook encryption key lost | Document key rotation, add startup validation |
| Cross-tenant query audit perf impact | Static analysis only |
| JWT blacklist DB fallback latency | Redis primary, DB fallback |
| Existing tests fail | Verify before commit |

### 6.2 Hidden Risks — NOT Documented in Plan

| # | Risk | Severity | Recommendation |
|---|------|----------|---------------|
| **HR-1** | **TenantStatusGuard DB load:** Every authenticated request queries Tenant + Subscription tables. For high-traffic deployments (1000+ req/s), this creates significant DB pressure — especially since Subscription includes payment details. | **High** | Remove TenantStatusGuard (see §5). Inline login check is sufficient. |
| **HR-2** | **Auth module circular dependency:** TenantStatusGuard needs PrismaService and the reflector. If registered as global guard, it may create dependency resolution issues in AppModule initialization order. | **Medium** | Eliminated if TenantStatusGuard is removed. |
| **HR-3** | **RevokedToken table unbounded growth:** Every logout creates a RevokedToken row. Without cleanup, this table grows without bound. The plan mentions "periodic cleanup (via BullMQ job)" but without retention policy or TTL. | **Medium** | Add TTL to RevokedToken model (expiresAt is already there — use it). Add cleanup plan or document that this is deferred. |
| **HR-4** | **API key scope granularity is too coarse:** GET=read, POST/PUT/PATCH/DELETE=write. Some GET endpoints require write scope (e.g., GET /admin/export). Some POST endpoints may be read-like (e.g., POST /search). The plan has no exception mechanism. | **Medium** | Document that `@Scopes()` accepts explicit scope strings, not just HTTP-method mapping. Add override ability. |
| **HR-5** | **Existing test failure risk is UNDERESTIMATED:** Plan says "Low" likelihood. But if ANY test exercises backup/privacy/gift-cards endpoints with non-OWNER roles, it WILL fail. Existing test suite has 213 tests across 26 files — we haven't inspected them. | **High** | Change risk to "Medium-High". Add explicit step to grep tests for affected endpoints before implementation. |
| **HR-6** | **Webhook encryption key rotation:** If `WEBHOOK_SECRET_ENCRYPTION_KEY` is changed, all existing encrypted secrets become undecryptable. No rotation procedure documented. | **High** | Add key rotation documentation. Consider adding key version field to schema for future rotation support. |
| **HR-7** | **X-API-Key header migration for existing API consumers:** If integrations use read-scope keys for write operations, adding scope enforcement breaks them immediately with no migration window. | **High** | Document in plan: Deploy @Scopes('read','write') on ALL routes FIRST. THEN deploy scope enforcement. This gives a window to fix any misconfigured keys. |
| **HR-8** | **Race condition in RevokedToken:** Token could be used between logout and DB write completion. In Redis-only setup, this is milliseconds. With DB fallback, the window is larger. | **Low** | Acceptable — use Redis TTL as primary check; DB is fallback for Redis restarts. |
| **HR-9** | **Rate limiting bypass via API key:** Plan adds scope enforcement but doesn't mention that API key auth bypasses rate limiting. Not a M1 concern but worth noting. | **Low** | Document as known limitation. |

---

## 7. FINAL VERDICT

### Verdict: B — Plan requires minor corrections before implementation.

The plan is **fundamentally sound** but has **9 specific corrections** needed. None require major redesign.

### Required Corrections (9 items)

| # | Correction | Severity | Rationale |
|---|-----------|----------|-----------|
| **C1** | **Remove TenantStatusGuard** — implement tenant status check inline in `auth.service.ts` and `jwt.strategy.ts` only | **Required** | Global guard is scope creep beyond P1-2. Creates DB load on every request. Eliminates SkipTenantStatus decorator, TENANT_STATUS_CHECK_ENABLED config, and app.config.ts modification. |
| **C2** | **Remove SkipTenantStatus decorator** | **Required** | Follows from C1. |
| **C3** | **Remove SanitizeInterceptor** — use logger-only approach | **Required** | Redundant with logger.service.ts modification. Plan itself prefers logger approach. |
| **C4** | **Remove `SCRYPT_ENABLED` config entry** | **Required** | UNJUSTIFIED — not tied to any finding or task. |
| **C5** | **Remove `TENANT_STATUS_CHECK_ENABLED` env var** | **Required** | Follows from C1. |
| **C6** | **Remove BullMQ cleanup job for RevokedToken** from M1 scope | **Required** | Performance optimization outside M1 scope. Document as deferred. |
| **C7** | **Reclassify task 7.1.9 (Prisma query audit) as RECOMMENDED** | **Recommended** | Not a separate verified finding. Extrapolation from P0-8. Defer to M2 if timeline is tight. |
| **C8** | **Fix architectural contradictions:** §4 shows scopes.decorator under common/guards/ (should be api-keys/decorators/) and phantom tenant-status.middleware.ts (should not exist) | **Required** | Inconsistencies between architecture diagram and file list. |
| **C9** | **Combine both Prisma migrations into one (`m1_security_hardening`)** | **Recommended** | Two additive changes in same milestone → one migration. Reduces deployment steps. |

### Additional Documentation Required

| # | Item | Why |
|---|------|-----|
| D1 | Escalate existing test failure risk from Low to **Medium-High** | Tests may exercise affected endpoints with unexpected roles |
| D2 | Document API key scope migration path | Deploy @Scopes on routes FIRST, then deploy enforcement |
| D3 | Document webhook encryption key rotation procedure | Without it, key change breaks all existing webhook registrations |
| D4 | Add RevokedToken retention policy | Table grows unbounded without cleanup; document cleanup approach |

### Corrected File Inventory

**After applying corrections C1–C9:**

**Files to Create (reduced from 5 → 2):**
1. `common/guards/tenant-body.guard.ts` — REQUIRED (P0-8)
2. `api-keys/decorators/scopes.decorator.ts` — REQUIRED (P0-9)

**Files to Modify (reduced from 20 → 17):**
1. `backup.controller.ts` — REQUIRED (P0-1)
2. `privacy.controller.ts` — REQUIRED (P0-2)
3. `gift-cards.controller.ts` — REQUIRED (P0-3)
4. `webhook-event-emitter.ts` — REQUIRED (P0-4)
5. `webhook-delivery.service.ts` — REQUIRED (P0-5)
6. `webhook-processor.ts` — REQUIRED (P0-5)
7. `webhook-registration.service.ts` — REQUIRED (P0-5)
8. `api-key.guard.ts` — REQUIRED (P0-9)
9. `auth.service.ts` — REQUIRED (P1-2, P1-4) — inline tenant check only
10. `jwt.strategy.ts` — REQUIRED (P1-2) — inline tenant check only
11. `logger.service.ts` — REQUIRED (P0-13)
12. `http-logging.middleware.ts` — REQUIRED (P0-13)
13. `redis.service.ts` — REQUIRED (P1-3)
14. `auth.module.ts` — REQUIRED (P1-2, P1-3)
15. `app.module.ts` — REQUIRED (P0-8, P0-9, P0-13)
16. `schema.prisma` — REQUIRED (P0-5, P1-3)
17. `.env.example` — REQUIRED (P0-5)
18. `webhook.config.ts` — REQUIRED (P0-5)

**Removed:**
- `common/guards/tenant-status.guard.ts` (UNNECESSARY)
- `common/decorators/skip-tenant-status.decorator.ts` (UNNECESSARY)
- `common/interceptors/sanitize.interceptor.ts` (REDUNDANT)
- `app.config.ts` modification (UNNECESSARY)
- `SCRYPT_ENABLED` config (UNJUSTIFIED)
- `TENANT_STATUS_CHECK_ENABLED` env var (UNNECESSARY)

**Prisma Migrations (reduced from 2 → 1):**
- `m1_security_hardening` — adds RevokedToken table + encryptedSecret column

---

*End of Plan Validation. 9 required corrections identified before implementation approval.*
