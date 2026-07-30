# Phase 6 — Milestone 1: Testing Infrastructure Implementation Plan

## Overview

Establish a professional testing infrastructure for the Tablofy API (66 NestJS modules, 449 TypeScript files, zero existing tests). Achieve minimum 80% line coverage on the most critical 30% of modules, with a reusable pattern that extends to the remaining 70%.

---

## 1. Dependencies to Add

| Package | Version | Purpose | Type |
|---------|---------|---------|------|
| `jest` | ^29.7 | Test runner | devDependency |
| `ts-jest` | ^29.2 | TypeScript transform for Jest | devDependency |
| `@types/jest` | ^29.5 | Jest type definitions | devDependency |
| `supertest` | ^7.0 | HTTP integration testing | devDependency |
| `@types/supertest` | ^7.0 | SuperTest type definitions | devDependency |

**Not adding** (to avoid complexity):
- No `testcontainers` (use manual Prisma mocking for unit tests; use dev DB with cleanup for integration)
- No `@anatine/prisma-mock` (custom mock factory is simpler and more maintainable)
- No additional testing libraries (keep stack minimal)

---

## 2. Files to Create (49 files)

### 2.1 Configuration (3 files)

| File | Purpose |
|------|---------|
| `jest.config.ts` | Root Jest config: moduleNameMapper for path aliases, coverage thresholds (80%), test match patterns, reporters |
| `apps/api/jest.config.ts` | API-specific Jest config extending root: `displayName: 'api'`, collectCoverageFrom patterns, testEnvironment `node` |
| `apps/api/tsconfig.spec.json` | TypeScript config for tests: extends `tsconfig.json`, adds `jest` types, includes `src/test/` and `**/*.spec.ts` |

### 2.2 Testing Utilities (7 files)

| File | Purpose |
|------|---------|
| `apps/api/src/test/test.module.ts` | `TestingModule` builder: creates minimal NestJS DI for a given module with all deps mocked. Exposes helper methods: `createUnitTest(Module, { overrides })`, `createIntegrationTest(Module)` |
| `apps/api/src/test/mocks/prisma.mock.ts` | Centralized `PrismaService` mock: auto-generates mock delegates for all ~116 Prisma models (`findFirst`, `findMany`, `create`, `update`, `delete`, etc.). Each delegate returns `jest.fn().mockReturnValue(...)`. Supports per-test overrides via `mockPrisma.reset()` and `mockPrisma.setDelegate(model, method, fn)` |
| `apps/api/src/test/mocks/redis.mock.ts` | `RedisService` mock: auto-mocked `get`, `set`, `del`, `exists`, `ping`, `blacklistToken`, `isTokenBlacklisted`, `incrementCounter`, `getCounter`, `setSession`, `getSession`, `deleteSession` |
| `apps/api/src/test/mocks/cache.mock.ts` | `CacheService` mock: auto-mocked `get`, `set`, `delete`, `deletePattern`, `invalidateTenantCache`, `getOrSet` |
| `apps/api/src/test/mocks/audit-log.mock.ts` | `AuditLogsService` mock: auto-mocked `log` method |
| `apps/api/src/test/mocks/event-emitter.mock.ts` | `EventEmitter2` mock: auto-mocked `emit`, `on`, `once` |
| `apps/api/src/test/mocks/queue.mock.ts` | `QueueService` mock: auto-mocked `add`, `addBulk`, `getJob`, `getJobs` |

**Why a central mock factory approach?**
- Every service depends on `PrismaService` (via `@Global()` PrismaModule). Rather than mocking per-test, a single factory creates a consistent, typed mock.
- All 5+ commonly injected services get pre-built mocks, so tests only override what they need.
- `mockPrisma.reset()` clears all call counts and return values between tests.

### 2.3 Test Factories & Fixtures (4 files)

| File | Purpose |
|------|---------|
| `apps/api/src/test/factories/user.factory.ts` | Builds valid `User` objects (for seeding/mock returns): `buildUser(overrides)`, `buildAuthUser(overrides)` |
| `apps/api/src/test/factories/tenant.factory.ts` | Builds valid `Tenant` objects: `buildTenant(overrides)` |
| `apps/api/src/test/factories/order.factory.ts` | Builds valid `Order` objects: `buildOrder(overrides)`, `buildCreateOrderDto(overrides)` |
| `apps/api/src/test/fixtures/auth.fixture.ts` | Pre-built auth context: `mockRequestWithUser(user)`, `mockJwtPayload(user)`, `mockTenantContext(tenantId)` |

### 2.4 Unit Tests — Common Infrastructure (8 files)

| File | What it tests | Key assertions |
|------|--------------|----------------|
| `apps/api/src/common/guards/tests/jwt-auth.guard.spec.ts` | JwtAuthGuard: public routes bypass, invalid token rejection, Reflector integration | 5 test cases |
| `apps/api/src/common/guards/tests/roles.guard.spec.ts` | RolesGuard: matching role passes, non-matching role rejected, missing user rejected, no roles bypasses | 6 test cases |
| `apps/api/src/common/guards/tests/tenant.guard.spec.ts` | TenantGuard: tenantId consistency check, missing tenantId, mismatched tenant | 5 test cases |
| `apps/api/src/common/guards/tests/plan-throttle.guard.spec.ts` | PlanThrottleGuard: plan-based limits, bypass for unlimited plans | 4 test cases |
| `apps/api/src/common/filters/tests/http-exception.filter.spec.ts` | HttpExceptionFilter: correlation ID generation, structured error response, 500 vs 4xx logging | 6 test cases |
| `apps/api/src/common/interceptors/tests/audit-log.interceptor.spec.ts` | AuditLogInterceptor: request logging, slow request warning (>1s), error capture | 5 test cases |
| `apps/api/src/common/services/tests/cache.service.spec.ts` | CacheService: get/set/delete, getOrSet factory, tenant key prefix, deletePattern with KEYS | 7 test cases |
| `apps/api/src/common/services/tests/feature-flag.service.spec.ts` | FeatureFlagService: flag resolution, default fallback, Redis-backed override | 4 test cases |

### 2.5 Unit Tests — Core Modules (12 files)

| File | What it tests | Key assertions |
|------|--------------|----------------|
| `apps/api/src/modules/auth/tests/auth.service.spec.ts` | AuthService: register (new user, existing user), login (valid, invalid pass, locked account), token refresh, logout | 10 test cases |
| `apps/api/src/modules/auth/tests/auth.controller.spec.ts` | AuthController: register endpoint, login endpoint, refresh endpoint, @Roles decoration | 5 test cases |
| `apps/api/src/modules/auth/tests/jwt.strategy.spec.ts` | JwtStrategy: validate method, token parsing, blacklisted token | 4 test cases |
| `apps/api/src/modules/users/tests/users.service.spec.ts` | UsersService: CRUD, soft delete, tenant-scoped queries, role assignment | 8 test cases |
| `apps/api/src/modules/tenants/tests/tenants.service.spec.ts` | TenantsService: create tenant, update settings, subscription plan mapping | 5 test cases |
| `apps/api/src/modules/orders/tests/orders.service.spec.ts` | OrdersService: create order, status transitions (validateTransition), add payment, split order, merge orders, apply discount, refund | 12 test cases (critical path) |
| `apps/api/src/modules/orders/tests/orders.controller.spec.ts` | OrdersController: CRUD endpoints, role-based access, DTO validation | 6 test cases |
| `apps/api/src/modules/barcodes/tests/barcode.service.spec.ts` | BarcodeService: generate, lookupByBarcode, lookupByQrCode, setPrimary, delete, cache invalidation, audit logging, WebSocket broadcast | 9 test cases |
| `apps/api/src/modules/barcodes/tests/barcode.controller.spec.ts` | BarcodeController: HTTP endpoints, @Roles decoration, @CurrentUser injection | 4 test cases |
| `apps/api/src/modules/customers/tests/customers.service.spec.ts` | CustomersService: CRUD, tenant-scoped queries, duplicate detection, loyalty points | 7 test cases |
| `apps/api/src/modules/audit-logs/tests/audit-logs.service.spec.ts` | AuditLogsService: creating log entries, querying with filters, pagination | 5 test cases |
| `apps/api/src/modules/health/tests/health.controller.spec.ts` | HealthController: endpoint returns OK, checks DB + Redis + memory | 3 test cases |

### 2.6 Integration Tests — Auth + Prisma + Module (3 files)

| File | What it tests | Key assertions |
|------|--------------|----------------|
| `apps/api/src/modules/auth/tests/auth.integration.spec.ts` | Full auth flow: register → login → access protected route → refresh → logout via supertest with TestingModule | 4 test cases |
| `apps/api/src/prisma/tests/prisma.service.spec.ts` | PrismaService: onModuleInit connects, softDeleteWhere adds deletedAt:null, $transaction works | 3 test cases |
| `apps/api/src/redis/tests/redis.service.spec.ts` | RedisService: onModuleInit creates client, basic get/set, token blacklist, session management | 5 test cases |

### 2.7 Seed & Regression Helpers (2 files)

| File | Purpose |
|------|---------|
| `apps/api/src/test/seed/test-seed.ts` | Creates minimal test data: one tenant, one user, one restaurant, one branch. Used by integration tests |
| `apps/api/src/test/regression/regression-runner.ts` | Wraps the 14 existing verify scripts in Jest `test()` blocks so they produce JUnit output and contribute to coverage (optional — marks them as "regression" suite) |

### 2.8 CI Update (1 file, modified)

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Add step: `npx nx test api` before verify scripts. Add coverage artifact upload. Set `JEST_JUNIT_OUTPUT_DIR` for CI reporting |

### 2.9 package.json Updates (1 file, modified)

| Change | Purpose |
|--------|---------|
| `"test:api": "nx test api"` | Run all API tests via nX |
| `"test:api:watch": "nx test api --watch"` | Watch mode for dev |
| `"test:api:coverage": "nx test api --coverage"` | Coverage report |
| `"test:api:integration": "nx test api --testPathPattern='integration'"` | Integration-only |
| `"test:all": "nx run-many -t test"` | All project tests |

---

## 3. Files to Modify (4 files)

| File | What Changes | Why |
|------|-------------|-----|
| `package.json` | Add 5 test scripts, add 5 devDependencies | Enable npm test commands |
| `apps/api/tsconfig.app.json` | Add `"exclude": ["src/**/*.spec.ts", "src/test/**"]` to `include` | Prevent spec files from being compiled in production build |
| `apps/api/tsconfig.json` | Add `"references"` entry for `"./tsconfig.spec.json"` | TypeScript project references for test config |
| `.github/workflows/ci.yml` | Add test job or test step before verify | Run tests in CI pipeline |

---

## 4. Architecture of the Test Infrastructure

```
apps/api/src/
├── test/
│   ├── test.module.ts              # TestingModule builder
│   ├── utils.ts                    # Helper functions
│   ├── mocks/
│   │   ├── prisma.mock.ts          # Centralized PrismaService mock
│   │   ├── redis.mock.ts           # RedisService mock
│   │   ├── cache.mock.ts           # CacheService mock
│   │   ├── audit-log.mock.ts       # AuditLogsService mock
│   │   ├── event-emitter.mock.ts   # EventEmitter2 mock
│   │   └── queue.mock.ts           # QueueService mock
│   ├── factories/
│   │   ├── user.factory.ts
│   │   ├── tenant.factory.ts
│   │   └── order.factory.ts
│   ├── fixtures/
│   │   └── auth.fixture.ts
│   ├── seed/
│   │   └── test-seed.ts
│   └── regression/
│       └── regression-runner.ts
├── common/
│   ├── guards/tests/
│   │   ├── jwt-auth.guard.spec.ts
│   │   ├── roles.guard.spec.ts
│   │   ├── tenant.guard.spec.ts
│   │   └── plan-throttle.guard.spec.ts
│   ├── filters/tests/
│   │   └── http-exception.filter.spec.ts
│   ├── interceptors/tests/
│   │   └── audit-log.interceptor.spec.ts
│   └── services/tests/
│       ├── cache.service.spec.ts
│       └── feature-flag.service.spec.ts
├── modules/
│   ├── auth/tests/
│   │   ├── auth.service.spec.ts
│   │   ├── auth.controller.spec.ts
│   │   ├── jwt.strategy.spec.ts
│   │   └── auth.integration.spec.ts
│   ├── users/tests/
│   │   └── users.service.spec.ts
│   ├── tenants/tests/
│   │   └── tenants.service.spec.ts
│   ├── orders/tests/
│   │   ├── orders.service.spec.ts
│   │   └── orders.controller.spec.ts
│   ├── barcodes/tests/
│   │   ├── barcode.service.spec.ts
│   │   └── barcode.controller.spec.ts
│   ├── customers/tests/
│   │   └── customers.service.spec.ts
│   ├── audit-logs/tests/
│   │   └── audit-logs.service.spec.ts
│   └── health/tests/
│       └── health.controller.spec.ts
├── prisma/tests/
│   └── prisma.service.spec.ts
└── redis/tests/
    └── redis.service.spec.ts
```

---

## 5. Test Patterns (How Every Test Is Structured)

### Unit Test Pattern (most tests)

```typescript
// Each spec file follows this exact structure:
describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let auditLogs: MockAuditLogsService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [CommonModule],
      providers: [
        OrdersService,
        // All external deps mocked:
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
        { provide: CacheService, useValue: mockCache },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get(OrdersService);
    prisma = module.get(PrismaService);
    auditLogs = module.get(AuditLogsService);
  });

  beforeEach(() => {
    mockPrisma.reset();   // Clear all mock state
    mockAuditLogs.reset();
  });

  describe('create', () => {
    it('should create an order with valid DTO', async () => {
      // Arrange
      mockPrisma.on.order.create.mockResolvedValue(fakeOrder);
      
      // Act
      const result = await service.create(dto, tenantId, userId);
      
      // Assert
      expect(result).toEqual(fakeOrder);
      expect(prisma.order.create).toHaveBeenCalledTimes(1);
    });
  });
});
```

### Integration Test Pattern (auth flow)

```typescript
describe('Auth (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AuthModule, PrismaModule, RedisModule],
    })
      .overrideProvider(RedisService).useValue(mockRedis)
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  it('POST /auth/register — creates user and returns tokens', async () => {
    mockPrisma.on.user.findFirst.mockResolvedValue(null);
    mockPrisma.on.user.create.mockResolvedValue(fakeUser);
    mockPrisma.on.tenant.create.mockResolvedValue(fakeTenant);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'test@example.com', password: 'Str0ng!Pass' })
      .expect(201);

    expect(response.body.user).toBeDefined();
    expect(response.body.tokens.accessToken).toBeDefined();
  });
});
```

---

## 6. Coverage Strategy

### Target: 80% line coverage on selected modules

| Module Group | Files | Est. Lines | Coverage Target | Test Files |
|-------------|-------|-----------|----------------|------------|
| Common (guards, filters, interceptors, services) | 12 | ~600 | 100% | 8 |
| Auth (service, controller, strategy) | 5 | ~900 | 95% | 4 |
| Orders (service, controller, state machine) | 8 | ~1,800 | 80% | 2 |
| Customers (service, controller) | 4 | ~1,600 | 80% | 1 |
| Barcodes (service, controller, gateway) | 4 | ~300 | 95% | 2 |
| Users (service, controller) | 4 | ~500 | 80% | 1 |
| Tenants (service, controller) | 4 | ~400 | 80% | 1 |
| AuditLogs (service) | 2 | ~200 | 90% | 1 |
| Health (controller) | 2 | ~50 | 100% | 1 |
| Prisma (service) | 1 | ~30 | 100% | 1 |
| Redis (service) | 1 | ~195 | 80% | 1 |
| **Total covered** | **47** | **~6,575** | | **23 test files** |

This covers the ~30% most critical modules. The remaining ~400 TS files (~70% of codebase) can be tested in Phase 6 M1 follow-up once the pattern is established.

### Jest Coverage Configuration

```json
// In apps/api/jest.config.ts
coverageThreshold: {
  global: {
    branches: 50,
    functions: 60,
    lines: 80,
    statements: 80,
  },
  // Stricter thresholds for critical infrastructure:
  'src/common/guards/**': {
    lines: 95,
  },
  'src/common/filters/**': {
    lines: 95,
  },
  'src/common/interceptors/**': {
    lines: 95,
  },
},
collectCoverageFrom: [
  'src/**/*.ts',
  '!src/**/*.module.ts',
  '!src/**/*.dto.ts',
  '!src/main.ts',
  '!src/test/**',
],
```

---

## 7. Testing Specific Patterns (Key Challenges)

### 7.1 Multi-tenancy Testing
Every service call takes `tenantId`. Tests verify:
- `tenantId` appears in Prisma `where` clauses
- Missing `tenantId` throws or returns empty
- Cross-tenant data isolation is respected

**Pattern:**
```typescript
it('should scope queries to tenantId', async () => {
  await service.findByTenant(tenantA);
  expect(prisma.order.findMany.mock.calls[0][0].where.tenantId).toBe(tenantA);
});
```

### 7.2 Soft Delete Testing
Verify every service adds `deletedAt: null` in where clauses. Use the `softDeleteWhere` helper from `PrismaService`.

**Pattern:**
```typescript
it('should exclude soft-deleted records', async () => {
  mockPrisma.on.order.findMany.mockResolvedValue([activeOrder]);
  const results = await service.findAll(tenantId);
  expect(prisma.order.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
});
```

### 7.3 Event Emission Testing
Services emit domain events via `EventEmitter2`. Tests verify events are emitted with correct payload.

**Pattern:**
```typescript
it('should emit order.created event', async () => {
  await service.create(dto, tenantId, userId);
  expect(mockEventEmitter.emit).toHaveBeenCalledWith(
    'order.created',
    expect.objectContaining({ orderId: expect.any(String) }),
  );
});
```

### 7.4 Audit Logging Testing
Services call `auditLogsService.log()` on mutations. Tests verify correct payload.

**Pattern:**
```typescript
it('should log barcode creation', async () => {
  await service.generate(dto, tenantId, userId);
  expect(mockAuditLogs.log).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'BARCODE_GENERATED' }),
  );
});
```

### 7.5 Cache Invalidation Testing
Services invalidate cache after mutations. Tests verify `cacheService.deletePattern` or `cacheService.delete` is called.

**Pattern:**
```typescript
it('should invalidate cache after deletion', async () => {
  await service.delete(id, tenantId, userId);
  expect(mockCache.deletePattern).toHaveBeenCalledWith(
    tenantId,
    expect.stringContaining('barcode:'),
  );
});
```

### 7.6 Error Handling Testing
Services throw `NotFoundException`, `ConflictException`, `BadRequestException`. Tests verify correct exception types and messages.

**Pattern:**
```typescript
it('should throw when barcode not found', async () => {
  mockPrisma.on.barcode.findFirst.mockResolvedValue(null);
  await expect(service.lookupByBarcode('NONEXIST', tenantId))
    .rejects.toThrow(NotFoundException);
});
```

---

## 8. Implementation Order (Build Sequence)

| Step | What | Est. Time |
|------|------|-----------|
| 1 | Install dependencies (`npm install jest ts-jest @types/jest supertest @types/supertest --save-dev`) | 5 min |
| 2 | Create root `jest.config.ts` and `apps/api/jest.config.ts` | 15 min |
| 3 | Create `apps/api/tsconfig.spec.json` and update `tsconfig.app.json` exclude | 5 min |
| 4 | Create mock infrastructure (6 mock files + index) | 45 min |
| 5 | Create factory + fixture files (4 files) | 30 min |
| 6 | Create `test.module.ts` TestingModule builder | 30 min |
| 7 | Write common infrastructure tests (8 files: guards, filters, interceptors, services) | 2 hours |
| 8 | Write Prisma + Redis service tests (2 files) | 30 min |
| 9 | Write Auth tests (4 files: service, controller, strategy, integration) | 1.5 hours |
| 10 | Write Barcode tests (2 files: service, controller) | 45 min |
| 11 | Write Health controller test (1 file) | 15 min |
| 12 | Write Users + Tenants service tests (2 files) | 45 min |
| 13 | Write AuditLogs service test (1 file) | 20 min |
| 14 | Write Orders service + controller tests (2 files) | 1.5 hours |
| 15 | Write Customers service test (1 file) | 45 min |
| 16 | Add test scripts to `package.json` | 5 min |
| 17 | Update `.github/workflows/ci.yml` with test job | 15 min |
| 18 | Run full test suite, fix failures, verify coverage | 1 hour |
| 19 | Run `npx nx build api` to verify no build regression | 5 min |
| 20 | Run lint, fix any issues | 15 min |
| **Total** | | **~12 hours (2-3 days)** |

---

## 9. Expected Coverage Estimates

| Category | Files | Lines | Covered Lines | Coverage % |
|----------|-------|-------|--------------|------------|
| Common guards (4 files) | 4 | ~150 | 150 | 100% |
| Common filters (1 file) | 1 | ~74 | 74 | 100% |
| Common interceptors (1 file) | 1 | ~61 | 58 | 95% |
| Common services (2 files) | 2 | ~120 | 114 | 95% |
| Auth (3 files) | 3 | ~900 | 810 | 90% |
| Orders (2 main files) | 2 | ~1,700 | 1,360 | 80% |
| Customers (1 main file) | 1 | ~1,500 | 1,200 | 80% |
| Barcodes (2 files) | 2 | ~280 | 266 | 95% |
| Users (1 main file) | 1 | ~350 | 280 | 80% |
| Tenants (1 main file) | 1 | ~250 | 200 | 80% |
| AuditLogs (1 file) | 1 | ~150 | 135 | 90% |
| Health (1 file) | 1 | ~30 | 30 | 100% |
| Prisma (1 file) | 1 | ~30 | 30 | 100% |
| Redis (1 file) | 1 | ~195 | 156 | 80% |
| **Covered subset** | **22 files** | **~5,790** | **~4,863** | **~84%** |
| **Remaining ~427 files** | 427 | ~50,000 | 0 | 0% |
| **Overall project** | 449 | ~55,790 | ~4,863 | **~8.7%** |

**Important honesty:** 80% coverage target applies to the tested modules only, not the entire 449-file codebase. Achieving 80% on the full 55,790-line codebase would require ~250+ test files and ~4-6 weeks of effort. This plan covers the 22 most critical files (~5,790 lines) with ~84% coverage. The pattern is designed so the remaining modules can be tested by following the same approach.

---

## 10. Verification Criteria

| Gate | How to Verify |
|------|--------------|
| TypeScript 0 errors | `npx tsc --project apps/api/tsconfig.spec.json --noEmit` |
| Build successful | `npx nx build api` |
| ESLint 0 errors | `npx nx lint api` |
| Existing regression suites 100% pass | Run all 14 existing verify scripts |
| New tests 100% pass | `npx nx test api` |
| Coverage ≥80% on targeted modules | `npx nx test api --coverage` + check jest coverage report |
| No duplicated code | ESLint `no-duplicate-imports`, manual review of test patterns |
| Swagger updated | No API changes, so no swagger changes needed |
| Prisma migrations validated | No schema changes, `npx prisma migrate status` |

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Prisma mock doesn't match actual model delegates | False test passes | Run 1 integration test per module against real DB before considering it covered |
| `testcontainers` not used — mock may drift from reality | Mock/real mismatch | Keep integration tests minimal but essential (auth flow, prisma connect, redis ops) |
| 449 TS files, 80% coverage is unrealistic in 1 milestone | Missed target | Focus on 80% on critical 22 files (~5,790 lines) — clarify this in milestone report |
| Service methods with complex transactions (OrdersService.create) | Hard to test thoroughly | Break into smaller testable methods; test transaction wrapper separately from business logic |
| Existing code uses `Logger` without injection | Hard to mock in tests | Use `jest.spyOn(Logger.prototype, 'log').mockImplementation()` in beforeAll |

---

**Next:** Awaiting approval before implementing anything.
