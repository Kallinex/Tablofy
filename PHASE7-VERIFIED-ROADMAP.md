# PHASE 7 — VERIFIED ROADMAP

**Derived from:** FINAL-PRODUCTION-READINESS-AUDIT.md (95% audited)  
**Forensic verification date:** 2026-07-31  
**Verification result:** 57/58 findings confirmed (1 false positive: P2-12 — shared library exists)  
**Baseline score:** 4.0/10  
**Target score:** 8+/10  

---

## Verified Finding Inventory

| Priority | Count | Adjusted Tasks |
|----------|-------|----------------|
| P0 (Critical) | 16 | All confirmed — Security, Database, Testing, Infrastructure |
| P1 (High) | 20 | All confirmed — Security, Performance, Infrastructure, Observability |
| P2 (Medium) | 15 | 1 FP removed (P2-12). Replaced with "Standardize cache TTL usage" |
| P3 (Low) | 6 | All confirmed — Documentation, Configuration, Code Quality |
| **Total** | **57** | **All substantively confirmed** |

---

## Milestone Prioritization

| Rank | Milestone | Score Impact | Business Value | Risk Reduction | Effort | ROI |
|------|-----------|-------------|---------------|----------------|--------|-----|
| **1** | 7.1 Security Hardening | 3→5/10 | 🔴 Prevents data breach/financial fraud | 🔴 Extreme | 2–3 weeks | 🔴 Highest |
| **2** | 7.2 Testing Foundation | 2→4/10 | 🔴 Enables safe deployment | 🔴 Extreme | 3–4 weeks | 🔴 Highest |
| **3** | 7.3 Payments Module | 5→6/10 | 🔴 Enables core revenue | 🔴 Blocking business | 3–4 weeks | 🔴 Highest |
| **4** | 7.4 Database & Performance | 5→7/10 | 🟠 Prevents data loss | 🟠 High | 2–3 weeks | 🟠 High |
| **5** | 7.5 Observability & Infrastructure | 3→6/10 | 🟠 Enables production ops | 🟠 High | 2–3 weeks | 🟠 High |
| **6** | 7.6 API Quality & Documentation | 4→6/10 | 🟡 Developer experience | 🟡 Medium | 2 weeks | 🟡 Medium |
| **7** | 7.7 Enterprise Features | 6→8/10 | 🟡 Competitive positioning | 🟡 Medium | 8–12 weeks | 🟡 Medium |
| **8** | 7.8 Production Certification | 8→9+/10 | 🟢 Compliance artifacts | 🟢 Low | 3–4 weeks | 🟢 Nice-to-have |

---

## Milestone 7.1 — Security Hardening

**Objective:** Eliminate 8 P0 and 4 P1 security findings  
**Score before:** Security 3/10, Enterprise Readiness 3/10  
**Score after:** Security 5/10, Enterprise Readiness 4/10  
**Est. effort:** 2–3 weeks (1–2 engineers)  
**Business case:** Prevents catastrophic data breach, financial fraud, and regulatory fines

### Tasks

| ID | Task | Finding | Effort | Depends On |
|----|------|---------|--------|------------|
| 7.1.1 | Add `@Roles('OWNER')` to backup controller (create, list, read, verify, restore) | P0-1 | 30 min | — |
| 7.1.2 | Add `@Roles('OWNER', 'MANAGER')` to privacy controller; restrict anonymize to self | P0-2 | 30 min | — |
| 7.1.3 | Add `@Roles('OWNER', 'MANAGER')` to gift-cards controller for create/recharge/deactivate | P0-3 | 30 min | — |
| 7.1.4 | Fix webhook event routing — use event name from @OnEvent context, not payload.eventType. Fix event name mismatch (singular vs plural) | P0-4 | 1 hr | — |
| 7.1.5 | Fix webhook signing — store raw secret encrypted at rest (AES-256) in `secretHash` field, decrypt on retrieval for HMAC signing | P0-5 | 4 hrs | — |
| 7.1.6 | Add body/query tenantId validation middleware against JWT claims | P0-8 | 2–3 days | — |
| 7.1.7 | Implement API key scope enforcement in ApiKeyGuard. Add `@Scopes()` decorator and route-scope mapping | P0-9 | 2–3 days | — |
| 7.1.8 | Add tenant/subscription status check in login() and JwtStrategy.validate() | P1-2 | 1 day | — |
| 7.1.9 | Fix cross-tenant Prisma queries — verify all services have tenantId WHERE filter | P0-8 (extended) | 2–3 days | — |
| 7.1.10 | Add sensitive data sanitizer middleware for logger (passwords, tokens, secrets) | P0-13 | 2–3 hrs | — |
| 7.1.11 | Persist revoked JWT blacklist to DB; wire `blacklistToken()` calls into logout flow | P1-3 | 2–3 days | — |
| 7.1.12 | Return generic message on duplicate registration (remove user details) | P1-4 | 30 min | — |

**Risk if skipped:** Data breach, financial fraud, GDPR fines, complete platform compromise.

---

## Milestone 7.2 — Testing Foundation

**Objective:** Establish regression safety net for confident deployments  
**Score before:** Testing 2/10, DevOps 3/10  
**Score after:** Testing 4/10, DevOps 4/10  
**Est. effort:** 3–4 weeks (1 engineer)  
**Business case:** Without tests, every deployment risks catastrophic regressions

### Tasks

| ID | Task | Finding | Effort | Depends On |
|----|------|---------|--------|------------|
| 7.2.1 | Create integration tests for auth flow (login, register, refresh, logout, token revocation) | P0-11, P0-12 | 2 days | — |
| 7.2.2 | Create integration tests for tenant isolation (cross-tenant data access prevented) | P0-11, P0-12 | 2 days | — |
| 7.2.3 | Create integration tests for order CRUD + status transitions (create, update, complete, cancel) | P0-11, P0-12 | 2 days | — |
| 7.2.4 | Create integration tests for RBAC enforcement (backup, privacy, gift-cards after 7.1) | P0-11, P0-12 | 1 day | 7.1 |
| 7.2.5 | Create unit tests for all analytics/service DTOs (validation rules) | P0-11 | 2 days | — |
| 7.2.6 | Create unit tests for PrismaService (connection lifecycle, retry, shutdown) | P0-11 | 1 day | — |
| 7.2.7 | Create tests for global exception filter (all HTTP error cases, validation errors) | P0-11 | 1 day | — |
| 7.2.8 | Add test factories for all major entities (Product, Menu, Branch, InventoryItem, Customer, Payment, etc.) | P0-11 | 2–3 days | — |
| 7.2.9 | Raise coverage thresholds to 40% minimum; 60% for critical modules (auth, orders, tenants) | P0-11 | 1 day | 7.2.1–7.2.8 |
| 7.2.10 | Create E2E tests: auth → tenant → order → payment (needs payments module) | P0-12 | 3 days | 7.3 |
| 7.2.11 | Add global test setup (env vars, DB configuration, setupFilesAfterSetup) | P0-11 | 2 hrs | — |
| 7.2.12 | Remove DTO exclusion from coverage in jest.config.ts | P0-11 | 30 min | — |

**Risk if skipped:** Regression bugs in production, inability to deploy safely.

---

## Milestone 7.3 — Payments Module

**Objective:** Implement core revenue-generating feature  
**Score before:** Enterprise Readiness 3/10  
**Score after:** Enterprise Readiness 5/10  
**Est. effort:** 3–4 weeks (1–2 engineers)  
**Business case:** Platform cannot process transactions without this. Complete business model failure.

### Tasks

| ID | Task | Finding | Effort | Depends On |
|----|------|---------|--------|------------|
| 7.3.1 | Implement PaymentModule (module, controller, service, DTOs) | P0-10 | 3–4 days | 7.1 (security base) |
| 7.3.2 | Implement payment provider abstraction (Stripe, Square, Adyen interfaces) | P0-10 | 3–4 days | — |
| 7.3.3 | Implement payment processing (charge, refund, partial refund, void) | P0-10 | 3–4 days | 7.3.1, 7.3.2 |
| 7.3.4 | Implement payment reconciliation endpoints | P0-10 | 2 days | 7.3.1 |
| 7.3.5 | Implement split payment and multi-tender support | P0-10 | 2–3 days | 7.3.3 |
| 7.3.6 | Wire payment events into audit logs, metrics counters, webhook events | P0-10, P2-14 | 1 day | 7.3.1 |
| 7.3.7 | Add tests for all payment flows (unit + integration) | P0-10 | 3 days | 7.3.1–7.3.6 |

**Risk if skipped:** No payment processing capability. Platform cannot generate revenue.

---

## Milestone 7.4 — Database & Performance

**Objective:** Prevent data loss, improve query performance, ensure referential integrity  
**Score before:** Database 5/10, Performance 5.5/10  
**Score after:** Database 7/10, Performance 7/10  
**Est. effort:** 2–3 weeks (1 engineer)  
**Business case:** Data integrity violations will cause silent corruption and customer-facing errors

### Tasks

| ID | Task | Finding | Effort | Depends On |
|----|------|---------|--------|------------|
| 7.4.1 | Add `onDelete: Cascade` to all 19 missing Tenant/User FK relations | P0-6 | 2 hrs | — |
| 7.4.2 | Add Prisma `@relation` declarations to MembershipHistory and EventLog | P0-7 | 2 hrs | — |
| 7.4.3 | Add `@@index([tenantId, createdAt])` to all dashboard/report models (90+ models) | P1-6 | 3 hrs | — |
| 7.4.4 | Add `@@index([tenantId, deletedAt])` to all 48 soft-delete models | P2-6 | 2 hrs | — |
| 7.4.5 | Add composite indexes to Order: `@@index([tenantId, status, createdAt])`, `@@index([tenantId, branchId, createdAt])` | P1-10 | 1 hr | — |
| 7.4.6 | Replace `CacheService.deletePattern()` KEYS with SCAN cursor-based iteration | P1-9 | 1–2 days | — |
| 7.4.7 | Add composite `@@index([createdAt, isArchived])` on AuditLog | P1-14 | 30 min | — |
| 7.4.8 | Push low-stock/critical-stock filtering into database query (Prisma WHERE) | P1-11 | 2 hrs | — |
| 7.4.9 | Add pagination (page/limit) to all unbounded stock endpoints | P1-12 | 2 hrs | — |
| 7.4.10 | Add `deletedAt DateTime?` to 77 models that lack soft delete | P2-7 | 4 hrs | — |
| 7.4.11 | Add `updatedAt DateTime @updatedAt` to 38 models that lack it | P2-8 | 2 hrs | — |
| 7.4.12 | Convert String status/type fields to enums (24 fields) | P1-7 | 8 hrs | — |
| 7.4.13 | Add `@db.Decimal(10,2)` precision annotations to 9 monetary fields | P1-8 | 1 hr | — |
| 7.4.14 | Standardize cache TTL usage across modules to use shared CACHE_TTL constants | P2-12 (revised) | 2 hrs | — |

**Risk if skipped:** Data integrity corruption, query degradation at scale, permanent data loss on tenant deletion.

---

## Milestone 7.5 — Observability & Infrastructure

**Objective:** Enable production operations, monitoring, alerting, and reliable deployments  
**Score before:** Observability 3/10, DevOps 3/10  
**Score after:** Observability 6/10, DevOps 6/10  
**Est. effort:** 2–3 weeks (1 engineer)  
**Business case:** Without this, operators are blind to production incidents and cannot deploy reliably

### Tasks

| ID | Task | Finding | Effort | Depends On |
|----|------|---------|--------|------------|
| 7.5.1 | Add Docker build + push to CI pipeline with container registry and git SHA tagging | P0-15 | 4–8 hrs | — |
| 7.5.2 | Add security scanning to CI: `npm audit` or `snyk test` (SCA) + CodeQL or SonarCloud (SAST) | P0-16 | 4–8 hrs | — |
| 7.5.3 | Add `SENTRY_DSN`, `SENTRY_ENABLED`, `METRICS_AUTH_TOKEN` to .env.example + env validation + startup warning | P1-17 | 30 min | — |
| 7.5.4 | Require non-empty `METRICS_AUTH_TOKEN` in production env validation | P0-14 | 30 min | 7.5.3 |
| 7.5.5 | Wire business metric counters into Orders, Inventory, Kitchen services | P2-14 | 2–4 hrs | — |
| 7.5.6 | Fix "Disk" health indicator to use `checkDiskSpace()` or `@nestjs/terminus` DiskHealthIndicator | P2-15 | 1–2 hrs | — |
| 7.5.7 | Add Bull Board UI at protected admin route (`/admin/queues`) | P1-19 | 4–8 hrs | — |
| 7.5.8 | Add dead letter queue for failed BullMQ jobs + alerting on failure rates | P1-18 | 4–6 hrs | — |
| 7.5.9 | Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` with fallback logging | P1-related | 1 hr | — |
| 7.5.10 | Change `Dockerfile` to `npm ci --omit=dev` in production stage | P1-16 | 1–2 hrs | — |
| 7.5.11 | Configure BullMQ job timeouts and retry strategies per queue type | P1-18 (extended) | 1–2 hrs | — |
| 7.5.12 | Add cron job overlap prevention with Redis distributed locks | P2-related | 2 hrs | — |
| 7.5.13 | Implement actual inventory processor logic (alerts, expiration, waste reports) | P1-20 | 1 week | — |
| 7.5.14 | Add graceful shutdown timeout to `main.ts` | P2-1 | 1 hr | — |

**Risk if skipped:** No deployable CI artifact, no security scanning, no queue monitoring, all ops blind.

---

## Milestone 7.6 — API Quality & Documentation

**Objective:** Deliver production-grade API documentation and consistent developer experience  
**Score before:** API Design 5/10, Documentation 3/10, Developer Experience 4.5/10  
**Score after:** API Design 6/10, Documentation 6/10, DX 6/10  
**Est. effort:** 2 weeks (1 engineer)  
**Business case:** Poor API docs cause integration friction and slow partner onboarding

### Tasks

| ID | Task | Finding | Effort | Depends On |
|----|------|---------|--------|------------|
| 7.6.1 | Add `@ApiProperty({ example, description })` to all auth DTOs | P3-related | 4 hrs | — |
| 7.6.2 | Add `@ApiBearerAuth()` to 22 controllers missing it | P1-related | 1–2 hrs | — |
| 7.6.3 | Register `TransformResponseInterceptor` as global `APP_INTERCEPTOR` | P2-3 | 1 hr | — |
| 7.6.4 | Implement structured validation error responses (field-level `errors: [{ field, constraints }]`) | P1-related | 1 day | — |
| 7.6.5 | Add response DTOs for all endpoints | P2-13 | 2–3 days | — |
| 7.6.6 | Standardize route prefixes across all controllers | P1-related | 1–2 days | — |
| 7.6.7 | Standardize pagination metadata format across all list endpoints | P1-related | 2 days | — |
| 7.6.8 | Add compression middleware | P2-2 | 1 hr | — |
| 7.6.9 | Rewrite README with project overview, architecture, setup, env vars, testing, deployment | P1-related | 1–2 days | — |
| 7.6.10 | Create CONTRIBUTING.md and CHANGELOG.md | P3-related | 2 hrs | — |
| 7.6.11 | Document all env vars in .env.example with defaults and descriptions | P1-17 | 30 min | — |

**Risk if skipped:** API consumer frustration, integration errors, slow developer onboarding.

---

## Milestone 7.7 — Enterprise Features

**Objective:** Close competitive gaps against Toast, Square, MICROS for enterprise deals  
**Score before:** Enterprise Readiness 3/10, Security 5/10 (after 7.1)  
**Score after:** Enterprise Readiness 7/10, Security 7/10  
**Est. effort:** 8–12 weeks (1–2 engineers)  
**Business case:** Required to win enterprise deals against established competitors

### Tasks

| ID | Task | Finding | Effort | Depends On |
|----|------|---------|--------|------------|
| 7.7.1 | Implement MFA/TOTP with setup, verify, backup codes | P1-1 | 3–5 days | 7.1 |
| 7.7.2 | Implement permission-based RBAC system with role-permission mapping and `@Permissions()` decorator | P1-5 | 3–5 days | 7.1 |
| 7.7.3 | Implement subscriptions module (plan management, renewals, billing integration) | P1-15 | 1–2 weeks | 7.3 |
| 7.7.4 | Add Redis Cluster/Sentinel support for high availability | P2-11 | 1–2 weeks | — |
| 7.7.5 | Add OpenTelemetry with BullMQ, Prisma, HTTP instrumentations | P2-16 | 1–2 weeks | — |
| 7.7.6 | Implement SSO/SAML (OIDC, SAML2.0) for enterprise customers | Enterprise gap | 1–2 weeks | 7.1 |
| 7.7.7 | Implement offline mode (localforage/IndexedDB for POS continuity) | Competitive gap | 2–3 weeks | 7.3 |
| 7.7.8 | Add file upload handling (Multer config, size limits, MIME validation) for product images | P2-related | 1 day | — |
| 7.7.9 | Add external API dependency health checks (email, SMS, payment gateway) | P2-related | 2 hrs | 7.5 |
| 7.7.10 | Protect Swagger docs with authentication in production | P3-2 | 1 day | — |

**Risk if skipped:** Cannot compete with Toast, Square, MICROS for enterprise contracts.

---

## Milestone 7.8 — Production Certification

**Objective:** Achieve verifiable production readiness with documented compliance artifacts  
**Score before:** All areas at post-milestone levels  
**Score after:** Overall 9/10  
**Est. effort:** 3–4 weeks (1 engineer)  
**Business case:** Required for SOC2/ISO27001 compliance and enterprise procurement

### Tasks

| ID | Task | Effort | Depends On |
|----|------|--------|------------|
| 7.8.1 | Generate re-audit after all Phase 7 milestones applied | 2 days | All above |
| 7.8.2 | Create SOC2 evidence artifacts (access control, audit trail, encryption at rest documentation) | 1 week | 7.1, 7.2 |
| 7.8.3 | Add per-tenant and per-key rate limiting with configurable limits | 2 days | 7.1 |
| 7.8.4 | Add comprehensive startup config validation with warnings for degraded observability | 2 hrs | 7.5 |
| 7.8.5 | Add image vulnerability scanning to CI pipeline (Trivy) | 1 day | 7.5 |
| 7.8.6 | Add environment promotion strategy (dev → staging → prod) to CI/CD | 1 week | 7.5 |
| 7.8.7 | Harden Dockerfile — specific COPY instead of `COPY . .`, multi-stage optimization | 2 hrs | — |
| 7.8.8 | Enable type-aware ESLint rules (`parserOptions.project`) | 1 hr | — |
| 7.8.9 | Squash Prisma migrations to 2–3 versioned releases | 2 hrs | — |
| 7.8.10 | Fix `enableImplicitConversion` in ValidationPipe (remove or restrict with explicit `@Type()`) | 1 hr | — |

**Risk if skipped:** Cannot produce SOC2/ISO27001 evidence; enterprise procurement blocked.

---

## Changes from Original Roadmap

| Original Task | Status | Change |
|---------------|--------|--------|
| "Create shared library with constants and types" | ❌ Removed | Library already exists at `libs/shared/constants`, `libs/shared/types`, `libs/shared/utils`. Was based on false positive P2-12. |
| "Standardize cache TTL usage" | ✅ Added | Replaces above. All modules should use `CACHE_TTL.SHORT`, `CACHE_TTL.MEDIUM`, `CACHE_TTL.LONG` from shared constants instead of hardcoding values. |
| All other tasks | ✅ Retained | 57/58 confirmed findings — no other changes needed. |

---

## Resource Requirements

| Milestone | Engineers | Duration | Total Hours | Dependencies |
|-----------|-----------|----------|-------------|--------------|
| 7.1 Security Hardening | 1–2 | 2–3 weeks | 80–240 | None |
| 7.2 Testing Foundation | 1 | 3–4 weeks | 120–160 | 7.1 (partial) |
| 7.3 Payments Module | 1–2 | 3–4 weeks | 120–320 | 7.1 |
| 7.4 Database & Performance | 1 | 2–3 weeks | 80–120 | None |
| 7.5 Observability & Infrastructure | 1 | 2–3 weeks | 80–120 | None |
| 7.6 API Quality & Documentation | 1 | 2 weeks | 80 | None |
| 7.7 Enterprise Features | 1–2 | 8–12 weeks | 320–960 | 7.1, 7.3 |
| 7.8 Production Certification | 1 | 3–4 weeks | 120–160 | All above |

**Total: 6–9 months (4 engineers full-time) — same as original estimate.**

---

## Milestone Dependencies Graph

```
7.1 Security ──→ 7.2 Testing (partial)
    │
    └──→ 7.3 Payments
           │
           └──→ 7.7 Enterprise (partial)
                    │
                    └──→ 7.8 Certification

7.4 Database (independent)
7.5 Observability (independent)
7.6 API Quality (independent)
```

Milestones 7.4, 7.5, and 7.6 can run in parallel with 7.1, 7.2, and 7.3.

---

## Score Trajectory

```
10 |                                              ★ 9.0 (7.8)
   |                                          ★ 8.0
   |                                      ★ 7.0
   |                                  ★ 6.0
   |                             ★ 5.0
   |                       ★ 4.5
   |                  ★ 4.0
   |             ★ 3.5
   |        ★ 3.0
   |  ★ 2.0
 0 └────────────────────────────────────────────────────────►
   Current  7.1   7.2   7.3   7.4   7.5   7.6   7.7   7.8
            (Sec) (Tst) (Pay) (DB)  (Obs) (API) (Ent) (Cert)
```

**Current: 4.0/10**  
**Post-7.1–7.3: 5.0/10**  
**Post-7.4–7.6: 7.0/10**  
**Post-7.7–7.8: 9.0/10**

---

## Go/No-Go Criteria for Production Deployment

**Production release is BLOCKED until ALL of the following are met:**

- [ ] 7.1.1–7.1.4 complete: RBAC on backup, privacy, gift-cards + webhooks functional
- [ ] 7.2.1–7.2.4 complete: Integration tests for auth, tenant isolation, orders, RBAC
- [ ] 7.3.1–7.3.3 complete: Payments module basic functionality (charge, refund)
- [ ] 7.4.1–7.4.2 complete: onDelete Cascade on Tenant relations, orphaned model fix
- [ ] 7.5.1–7.5.2 complete: CI artifact + security scanning
- [ ] 7.5.3–7.5.4 complete: Sentry configured, /metrics authenticated
- [ ] 7.5.5 complete: Business metrics wired and reporting
- [ ] 7.5.9 complete: Unhandled rejection/exception handlers
- [ ] 7.6.9 complete: README with architecture and setup documentation

**Minimum acceptable score before production: 6.0/10 overall**  
**Target: 8.0/10**
