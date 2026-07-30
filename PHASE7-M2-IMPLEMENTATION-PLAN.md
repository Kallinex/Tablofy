# Phase 7 Milestone 2 — Testing Foundation

## Implementation Plan

**Version:** 1.0  
**Status:** DRAFT — awaiting approval  
**Based on:** PHASE7-VERIFIED-ROADMAP.md, FORENSIC-VALIDATION.md, FINAL-PRODUCTION-READINESS-AUDIT.md  
**Branch:** feature/phase7-m2 (clean, on v7.1.0)  

---

## 1. Objectives

Establish a regression safety net enabling confident production deployments by raising test coverage from 12.8% line coverage / 7.9% test-to-code ratio to 40% minimum with 60% on critical modules (auth, orders, tenants). All 12 tasks map to verified findings P0-11 (extreme test gap) and P0-12 (zero E2E tests).

---

## 2. Scope

**In scope — 10 actionable tasks (7.2.1–7.2.9, 7.2.11–7.2.12):**

| ID | Task | Finding | Effort |
|----|------|---------|--------|
| 7.2.1 | Integration tests: auth flow (login, register, refresh, logout, token revocation) | P0-11, P0-12 | 2 days |
| 7.2.2 | Integration tests: tenant isolation (cross-tenant data access prevented) | P0-11, P0-12 | 2 days |
| 7.2.3 | Integration tests: order CRUD + status transitions | P0-11, P0-12 | 2 days |
| 7.2.4 | Integration tests: RBAC enforcement on backup, privacy, gift-cards (post-7.1) | P0-11, P0-12 | 1 day |
| 7.2.5 | Unit tests: all analytics/service DTO validation rules | P0-11 | 2 days |
| 7.2.6 | Unit tests: PrismaService (connection lifecycle, retry, shutdown) | P0-11 | 1 day |
| 7.2.7 | Tests: global exception filter (all HTTP error cases, validation errors) | P0-11 | 1 day |
| 7.2.8 | Test factories: Product, Menu, Branch, InventoryItem, Customer, Payment, Order, User, Tenant | P0-11 | 2–3 days |
| 7.2.9 | Raise coverage thresholds to 40% min / 60% critical modules | P0-11 | 1 day |
| 7.2.11 | Global test setup (env vars, DB config, setupFilesAfterSetup) | P0-11 | 2 hrs |
| 7.2.12 | Remove DTO exclusion from coverage in jest.config.ts | P0-11 | 30 min |

**Deferred — 1 task (7.2.10):**

| ID | Task | Reason | Finding |
|----|------|--------|---------|
| 7.2.10 | E2E: auth → tenant → order → payment | Blocked on 7.3 Payments Module | P0-12 |

**Explicitly out of scope:**
- No production code changes (all changes are test files + jest config)
- No database schema changes
- No new environment variables
- No new npm dependencies
- No CI/CD changes
- No scope expansion or unrelated refactoring

---

## 3. Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Total spec files | ≥55 (from 26) | `find src -name '*.spec.ts' \| wc -l` |
| Integration spec files | ≥8 (from 0) | `find src -name '*.integration.spec.ts' \| wc -l` |
| Line coverage | ≥40% overall | `npx jest --coverage` |
| Critical module coverage (auth, orders, tenants) | ≥60% | Per-module threshold in jest.config.ts |
| DTO coverage | Included (removed from exclusion) | Coverage report includes DTO files |
| Global test setup | Present and wired | `setupFilesAfterSetup` populated |
| Test factories | ≥10 entity factories | `src/test/factories/` populated |
| Pass rate | 100% | `npx jest` exit 0 |
| ESLint | 0 errors, 0 warnings | `npx eslint` on test files |

---

## 4. Architecture

All tests follow the existing NestJS testing conventions already present in the codebase:

```
Unit tests        → *.spec.ts           — mock all dependencies, test one class
Integration tests → *.integration.spec.ts — use TestBed with real module imports, mock external I/O
Factories         → src/test/factories/  — builder pattern for creating entities
```

These patterns are proven in the 26 existing spec files (prisma.service.spec.ts, auth.controller.spec.ts, etc.).

**Key architectural decisions:**

1. **Integration tests use `Test.createTestingModule()`** — same as existing tests; do NOT spin up a real database (no running DB in CI).
2. **Mock PrismaService** in integration tests using `mockDeep` or manual mock — use the same pattern as `prisma.service.spec.ts`.
3. **Analytics DTO tests** use plain `class-validator` `validate()` calls — no NestJS TestBed needed.
4. **Exception filter tests** instantiate the filter directly with mocked `ArgumentsHost`.
5. **Test factories** use a simple builder pattern with faker-style random data — no external factory library.
6. **Coverage thresholds** are raised in jest.config.ts; DTO exclusion line is removed.

---

## 5. Modules

No new NestJS modules. All work is in the test layer.

The following existing modules receive new test files:

| Module | Test Type | Tasks |
|--------|-----------|-------|
| auth | Integration | 7.2.1 |
| *cross-module* | Integration (tenant isolation) | 7.2.2 |
| orders | Integration | 7.2.3 |
| backup, privacy, gift-cards | Integration (RBAC) | 7.2.4 |
| All analytics modules | Unit (DTOs) | 7.2.5 |
| prisma | Unit | 7.2.6 |
| common/filters | Unit | 7.2.7 |

---

## 6. Services

No changes to existing services. Tests will mock all service dependencies.

---

## 7. Guards

No changes to existing guards. RBAC integration tests (7.2.4) will exercise `RolesGuard`, `JwtAuthGuard`, `TenantGuard`, and `TenantBodyGuard` through controller invocation.

---

## 8. Interceptors

No changes to existing interceptors. Exception filter tests (7.2.7) will exercise the global `HttpExceptionFilter`.

---

## 9. Middleware

No changes to existing middleware.

---

## 10. Prisma / Database Changes

**None.** All integration tests use mocked `PrismaService`. No migration required.

---

## 11. API Endpoints

No new endpoints. Integration tests (7.2.1–7.2.4) invoke existing endpoints via controller methods with mocked guards and services.

---

## 12. DTOs

No changes to DTO definitions. DTO coverage exclusion is removed from jest.config.ts (7.2.12). DTO validation tests (7.2.5) validate existing DTOs using `class-validator` `validate()`.

---

## 13. Configuration

**File to modify:** `apps/api/jest.config.ts`

Changes:
- Remove `'!<rootDir>/src/**/*.dto.ts'` from `collectCoverageFrom` (7.2.12)
- Update `setupFilesAfterSetup` to point to global test setup file (7.2.11)
- Raise per-file coverage thresholds per Section 17 (7.2.9)

---

## 14. Environment Variables

**No new environment variables.**

The global test setup (7.2.11) sets defaults via `process.env` assignment in setup file:
- `NODE_ENV=test`
- `DATABASE_URL` (mock, not connected)
- `REDIS_HOST=localhost`, `REDIS_PORT=6379` (mock, not connected)
- `JWT_SECRET=test-secret`
- `WEBHOOK_ENCRYPTION_KEY=test-key-32-bytes-x`
- `METRICS_AUTH_TOKEN=test-token`

---

## 15. Security Considerations

All tests operate in the test environment only. No real credentials, database connections, or external services are used. Integration tests verify:
- Cross-tenant data isolation (7.2.2)
- RBAC enforcement (7.2.4)
- Auth token lifecycle (7.2.1)

---

## 16. Testing Strategy

### Test Categories

| Category | Pattern | Dependencies | Tasks |
|----------|---------|-------------|-------|
| Unit (service) | `*.spec.ts` | Mocked deps | 7.2.5, 7.2.6, 7.2.7 |
| Integration | `*.integration.spec.ts` | Mocked Prisma, real module imports | 7.2.1, 7.2.2, 7.2.3, 7.2.4 |
| Factories | `src/test/factories/*.factory.ts` | None (static builders) | 7.2.8 |
| Config | `jest.config.ts` | N/A | 7.2.9, 7.2.11, 7.2.12 |

### Test Execution Flow

```
jest --config jest.config.ts
  → setupFilesAfterSetup: global-test-setup.ts
      → process.env defaults
      → PrismaService mock
  → testMatch: *.spec.ts + *.integration.spec.ts
      → unit tests first
      → integration tests second
```

### Categorization of Integration vs Unit Tests

| Task | Test Method | Rationale |
|------|-------------|-----------|
| 7.2.1 | Integration | Tests multi-step auth flow (login→register→refresh→logout→revoke), exercises multiple services |
| 7.2.2 | Integration | Tests cross-tenant data access scenario, exercises guards + services |
| 7.2.3 | Integration | Tests order state machine transitions (draft→confirmed→completed→cancelled) |
| 7.2.4 | Integration | Tests full guard+controller wiring for RBAC enforcement |
| 7.2.5 | Unit | DTO validation is pure logic (class-validator), no DI needed |
| 7.2.6 | Unit | PrismaService lifecycle methods are self-contained |
| 7.2.7 | Unit | Exception filter takes (exception, host) and returns response |

---

## 17. Coverage Thresholds

### Current vs Target

| Scope | Current Threshold | Target Threshold | Change |
|-------|------------------|-----------------|--------|
| Overall line coverage | 12.8% | **≥40%** | +27.2 pp |
| auth.service.ts | lines:75 | **lines:80** | +5 |
| auth.controller.ts | lines:90 | **lines:90** | same |
| orders.service.ts | lines:25 | **lines:60** | +35 |
| tenants.service.ts | lines:35 | **lines:60** | +25 |
| prisma.service.ts | lines:30 | **lines:80** | +50 |
| common/filters/*.ts | lines:90 | **lines:90** | same |
| common/guards/*.ts | lines:85 | **lines:85** | same |
| inventory.service.ts | lines:20 | **lines:40** | +20 |
| All other tracked files | varies | **lines:40 min** | various |

**Files requiring new threshold entries** (currently untracked, target ≥40%):
- backup.controller.ts
- privacy.controller.ts
- gift-cards.controller.ts
- webhook-event-emitter.ts
- webhook-delivery.service.ts
- webhooks.service.ts
- webhook-processor.ts
- redis.service.ts
- tenant-body.guard.ts
- api-key.guard.ts
- scopes.decorator.ts
- roles.decorator.ts (already tracked at 65 — keep)
- logger.service.ts

### Threshold format (jest.config.ts)

```ts
'**/src/modules/auth/auth.service.ts': { branches: 55, functions: 85, lines: 80, statements: 80 },
'**/src/modules/orders/orders.service.ts': { branches: 30, functions: 50, lines: 60, statements: 60 },
'**/src/modules/tenants/tenants.service.ts': { branches: 35, functions: 50, lines: 60, statements: 60 },
'**/src/prisma/prisma.service.ts': { branches: 90, functions: 70, lines: 80, statements: 80 },
'**/src/modules/inventory/inventory.service.ts': { branches: 20, functions: 30, lines: 40, statements: 40 },
// New entries for M2-tracked files (≥40%):
'**/src/modules/backup/backup.controller.ts': { branches: 40, functions: 50, lines: 50, statements: 50 },
'**/src/modules/privacy/privacy.controller.ts': { branches: 40, functions: 50, lines: 50, statements: 50 },
'**/src/modules/gift-cards/gift-cards.controller.ts': { branches: 40, functions: 50, lines: 50, statements: 50 },
'**/src/modules/webhooks/webhook-event-emitter.ts': { branches: 40, functions: 50, lines: 50, statements: 50 },
'**/src/modules/webhooks/webhook-delivery.service.ts': { branches: 40, functions: 50, lines: 50, statements: 50 },
'**/src/modules/webhooks/webhooks.service.ts': { branches: 40, functions: 50, lines: 50, statements: 50 },
'**/src/modules/webhooks/webhook-processor.ts': { branches: 40, functions: 50, lines: 50, statements: 50 },
'**/src/redis/redis.service.ts': { branches: 40, functions: 70, lines: 70, statements: 70 },
'**/src/common/guards/tenant-body.guard.ts': { branches: 50, functions: 60, lines: 60, statements: 60 },
'**/src/modules/api-keys/guards/api-key.guard.ts': { branches: 50, functions: 60, lines: 60, statements: 60 },
'**/src/common/logger/logger.service.ts': { branches: 40, functions: 50, lines: 50, statements: 50 },
```

---

## 18. File Inventory

### Files to Create (33 files)

#### Test Factories (7.2.8) — 10 files
```
apps/api/src/test/factories/user.factory.ts
apps/api/src/test/factories/tenant.factory.ts
apps/api/src/test/factories/order.factory.ts
apps/api/src/test/factories/product.factory.ts
apps/api/src/test/factories/menu-category.factory.ts
apps/api/src/test/factories/branch.factory.ts
apps/api/src/test/factories/inventory-item.factory.ts
apps/api/src/test/factories/customer.factory.ts
apps/api/src/test/factories/payment.factory.ts
apps/api/src/test/factories/index.ts
```

#### Global Test Setup (7.2.11) — 1 file
```
apps/api/src/test/setup/global-test-setup.ts
```

#### Integration Tests — Auth Flow (7.2.1) — 1 file
```
apps/api/src/modules/auth/tests/integration/auth-flow.integration.spec.ts
```
Covers: register → login → refresh → logout → token revocation verification.

#### Integration Tests — Tenant Isolation (7.2.2) — 1 file
```
apps/api/src/modules/tenants/tests/integration/tenant-isolation.integration.spec.ts
```
Covers: cross-tenant read blocked, cross-tenant write blocked via body tenantId, tenant-body guard enforces isolation.

#### Integration Tests — Order CRUD (7.2.3) — 1 file
```
apps/api/src/modules/orders/tests/integration/order-crud.integration.spec.ts
```
Covers: create order (DRAFT), add items, transition to CONFIRMED, transition to COMPLETED, transition to CANCELLED, verify status history entries.

#### Integration Tests — RBAC (7.2.4) — 3 files
```
apps/api/src/modules/backup/tests/integration/rbac.integration.spec.ts
apps/api/src/modules/privacy/tests/integration/rbac.integration.spec.ts
apps/api/src/modules/gift-cards/tests/integration/rbac.integration.spec.ts
```
Each covers: OWNER succeeds, MANAGER succeeds (where allowed), STAFF/VIEWER denied.

#### Unit Tests — DTOs (7.2.5) — 11 files
```
apps/api/src/modules/sales-analytics/tests/dto/sales-analytics.dto.spec.ts
apps/api/src/modules/inventory-analytics/tests/dto/inventory-analytics.dto.spec.ts
apps/api/src/modules/customer-analytics/tests/dto/customer-analytics.dto.spec.ts
apps/api/src/modules/crm/tests/dto/crm.dto.spec.ts
apps/api/src/modules/customers/tests/dto/customers.dto.spec.ts
apps/api/src/modules/backup/tests/dto/backup.dto.spec.ts
apps/api/src/modules/privacy/tests/dto/privacy.dto.spec.ts
apps/api/src/modules/gift-cards/tests/dto/gift-cards.dto.spec.ts
apps/api/src/modules/webhooks/tests/dto/webhooks.dto.spec.ts
apps/api/src/modules/tenants/tests/dto/tenants.dto.spec.ts
apps/api/src/modules/auth/tests/dto/auth.dto.spec.ts
```
Each validates: required fields, type validation, minimum/maximum constraints, enum values.

#### Unit Tests — PrismaService (7.2.6) — existing file updated
```
apps/api/src/prisma/tests/prisma.service.spec.ts  (MODIFY — extend)
```
Existing file at 30% line coverage needs more test cases.

#### Unit Tests — Exception Filter (7.2.7) — existing file updated
```
apps/api/src/common/filters/tests/http-exception.filter.spec.ts  (MODIFY — extend)
```
Existing file needs coverage for: BadRequestException (validation errors), UnauthorizedException, ForbiddenException, NotFoundException, ConflictException, InternalServerErrorException, ThrottlerException.

### Files to Modify (2 files)

```
apps/api/jest.config.ts
```
Changes:
1. Remove `'!<rootDir>/src/**/*.dto.ts'` from collectCoverageFrom (7.2.12)
2. Set `setupFilesAfterSetup: ['<rootDir>/src/test/setup/global-test-setup.ts']` (7.2.11)
3. Update coverage thresholds per Section 17 (7.2.9)

```
apps/api/tsconfig.spec.json  (if needed — check if test directory is excluded)
```

### Files to NOT Modify

No production source files are changed in M2. All changes are test files + jest config.

---

## 19. Migration Strategy

**No database migration.** All integration tests use mocked PrismaService. No schema changes.

---

## 20. Rollback Strategy

Revert the single production file changed:
```
git checkout -- apps/api/jest.config.ts apps/api/tsconfig.spec.json
```

Remove all new test files:
```
git clean -fd apps/api/src/test/ apps/api/src/modules/*/tests/integration/ apps/api/src/modules/*/tests/dto/
```

Verify tests still pass on the original config:
```
npx jest
```

---

## 21. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| New integration tests create flaky tests | Medium | High | Use deterministic mocks, avoid timers, clear mocks between tests (clearMocks: true already set) |
| Coverage thresholds fail on first run | High | Medium | Run coverage before updating thresholds; set achievable targets based on actual coverage |
| DTO tests (7.2.5) miss edge cases | Medium | Low | Test happy path + 2 error cases per DTO; coverage gate ensures at least 40% DTO coverage |
| Test factories duplicate existing patterns | Low | Low | Review existing mocks in `src/test/mocks/` first; factories are composable |
| Integration tests too slow | Low | Medium | Keep <50 test cases per file; mock Prisma queries return instantly |
| 7.2.10 deferred creates dependency gap | Medium | Low | Clearly document in IMPLEMENTATION-PLAN.md and milestone report; re-assess after 7.3 |

---

## 22. Estimated Effort

| Task | Days | Dependencies |
|------|------|-------------|
| 7.2.11 — Global test setup | 0.25 | None |
| 7.2.12 — Remove DTO exclusion | 0.08 | None |
| 7.2.8 — Test factories | 2.5 | None |
| 7.2.1 — Auth integration tests | 2 | 7.2.8 |
| 7.2.2 — Tenant isolation integration | 2 | 7.2.8 |
| 7.2.3 — Order CRUD integration | 2 | 7.2.8 |
| 7.2.4 — RBAC integration | 1 | 7.2.8 |
| 7.2.5 — DTO unit tests | 2 | None |
| 7.2.6 — PrismaService unit tests | 1 | None |
| 7.2.7 — Exception filter tests | 1 | None |
| 7.2.9 — Coverage thresholds | 0.5 | 7.2.1–7.2.8 |
| Quality gates + fixes | 0.5 | All above |
| **Total** | **~14.5 days** | |

---

## 23. Task Dependency Graph

```
7.2.11 (setup) ──→ 7.2.12 (exclusion)
     │
     └──→ 7.2.8 (factories) ──→ 7.2.1 (auth)
                                   7.2.2 (isolation)
                                   7.2.3 (orders)
                                   7.2.4 (RBAC)
                                    
7.2.5 (DTOs) ── independent
7.2.6 (Prisma) ── independent
7.2.7 (filter) ── independent

All ──→ 7.2.9 (thresholds)
          │
          └──→ Quality gates
```

**7.2.10 (E2E) — DEFERRED:** blocked on 7.3 Payments Module.

---

## 24. Deliverables

### Documentation
- `PHASE7-M2-REPORT.md` — milestone completion report
- `PHASE7-M2-CHANGELOG.md` — per-file change log

### Verification
- `scripts/verify-phase7-m2.js` — automated verification script

### Reports (generated during quality gates)
- Coverage report (`coverage/lcov-report/index.html`)
- Test results (Jest XML output)

### Tag
- `v7.2.0` — milestone completion tag

---

## 25. Finding-to-Task Mapping

| Finding | Forensic Report Section | M2 Tasks |
|---------|------------------------|----------|
| P0-11: 68/69 controllers untested | FORENSIC-VALIDATION.md §P0-11 | 7.2.1, 7.2.2, 7.2.3, 7.2.4, 7.2.5, 7.2.6, 7.2.7, 7.2.8, 7.2.9, 7.2.11, 7.2.12 |
| P0-12: Zero E2E tests | FORENSIC-VALIDATION.md §P0-12 | 7.2.1, 7.2.2, 7.2.3, 7.2.4 (integration), 7.2.10 (deferred) |

---

## 26. Quality Gates

| Gate | Command | Expected |
|------|---------|----------|
| Lint test files | `npx eslint "apps/api/src/**/*.spec.ts" --max-warnings=0` | 0 errors, 0 warnings |
| TypeScript check | `npx tsc --noEmit -p apps/api/tsconfig.spec.json` | 0 errors |
| Unit tests | `npx jest --testPathPattern='\.spec\.ts$'` | 100% pass |
| Integration tests | `npx jest --testPathPattern='\.integration\.spec\.ts$'` | 100% pass |
| Full suite | `npx jest` | 100% pass |
| Coverage | `npx jest --coverage` | ≥40% line, ≥60% critical modules |
| Verify script | `node scripts/verify-phase7-m2.js` | 100% pass |

---

## 27. Appendix: Test File Templates

### Factory pattern (example: user.factory.ts)

```ts
// Returns a plain object matching Prisma.UserCreateInput shape.
// Accepts partial overrides for test-specific data.
// Re-usable across ALL tests (unit + integration).
```

### Integration test pattern (example: auth-flow)

```ts
// TestBed with real AuthService import, mocked PrismaService + RedisService.
// BeforeEach: create fresh module, set up mock return values.
// Test: invoke controller method, assert response shape + status.
```

### DTO test pattern (example)

```ts
// Instantiate DTO, set known-valid/invalid values.
// Call validate(dto) from class-validator.
// Assert errors array length for invalid, 0 for valid.
```

---

**Wait for approval before implementation.**
