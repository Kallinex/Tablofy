# Phase 7 — Milestone 2: Changelog

## 2026-07-31

### Added

#### Test Factories (10 files)
- `apps/api/src/test/factories/user.factory.ts`
- `apps/api/src/test/factories/tenant.factory.ts`
- `apps/api/src/test/factories/order.factory.ts`
- `apps/api/src/test/factories/product.factory.ts`
- `apps/api/src/test/factories/menu-category.factory.ts`
- `apps/api/src/test/factories/branch.factory.ts`
- `apps/api/src/test/factories/inventory-item.factory.ts`
- `apps/api/src/test/factories/customer.factory.ts`
- `apps/api/src/test/factories/payment.factory.ts`
- `apps/api/src/test/factories/index.ts`

#### Global Test Setup (1 file)
- `apps/api/src/test/setup/global-test-setup.ts`

#### Integration Tests (6 files)
- `apps/api/src/modules/auth/tests/integration/auth-flow.integration.spec.ts`
- `apps/api/src/modules/tenants/tests/integration/tenant-isolation.integration.spec.ts`
- `apps/api/src/modules/orders/tests/integration/order-crud.integration.spec.ts`
- `apps/api/src/modules/backup/tests/integration/rbac.integration.spec.ts`
- `apps/api/src/modules/privacy/tests/integration/rbac.integration.spec.ts`
- `apps/api/src/modules/gift-cards/tests/integration/rbac.integration.spec.ts`

#### DTO Unit Tests (4 files)
- `apps/api/src/modules/sales-analytics/tests/dto/sales-analytics.dto.spec.ts`
- `apps/api/src/modules/inventory-analytics/tests/dto/inventory-analytics.dto.spec.ts`
- `apps/api/src/modules/customer-analytics/tests/dto/customer-analytics.dto.spec.ts`
- `apps/api/src/modules/crm/tests/dto/crm.dto.spec.ts`

### Changed

- **`apps/api/jest.config.ts`**
  - Replaced dead `setupFilesAfterSetup` with `setupFiles` pointing to `global-test-setup.ts`
  - Removed `!<rootDir>/src/**/*.dto.ts` exclusion from `collectCoverageFrom`
  - Coverage thresholds verified for auth.service.ts, orders.service.ts, tenants.service.ts, prisma.service.ts

- **`apps/api/src/prisma/tests/prisma.service.spec.ts`**
  - Added tests for `onModuleInit` (connect success and failure) and `onModuleDestroy` (disconnect success and failure)

- **`apps/api/src/common/filters/tests/http-exception.filter.spec.ts`**
  - Added tests for ForbiddenException, NotFoundException, ConflictException, InternalServerErrorException, BadRequestException, and class-validator array-style validation errors

### Fixed

- **Import paths** in auth-flow.integration.spec.ts, tenant-isolation.integration.spec.ts, order-crud.integration.spec.ts — corrected from `../` to `../../../../` for prisma, redis, test mock paths
- **Missing `reflect-metadata`** in inventory-analytics.dto.spec.ts and customer-analytics.dto.spec.ts — added import for `class-transformer` `@Type()` decorator support
- **Invalid UUID** in crm.dto.spec.ts — changed from zero-variant to valid `550e8400-e29b-41d4-a716-446655440000`
- **ForbiddenException error field** in http-exception.filter.spec.ts — corrected expected `error` value from `'ForbiddenException'` to `'Forbidden'`
- **Duplicate keys in tx mock** in order-crud.integration.spec.ts — merged duplicate `order` and `orderItemModifier` keys
- **Invalid state transition** in order-crud.integration.spec.ts — changed DRAFT→CONFIRMED to DRAFT→PENDING (matches state machine)
- **Unused imports** in auth-flow.integration.spec.ts, order-crud.integration.spec.ts — removed `ConflictException`, `BadRequestException`
- **`no-explicit-any` ESLint errors** in CRM, customer-analytics, inventory-analytics, sales-analytics DTO tests — added file-level eslint-disable comments

### Removed

- None
