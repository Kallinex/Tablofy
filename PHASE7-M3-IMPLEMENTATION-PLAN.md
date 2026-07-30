# Phase 7 — Milestone 3: Payments Module

## Implementation Plan

**Version:** 1.0  
**Status:** Draft — awaiting approval  
**Based on:** PHASE7-VERIFIED-ROADMAP.md, FORENSIC-VALIDATION.md, FINAL-PRODUCTION-READINESS-AUDIT.md  
**Base branch:** feature/phase7-m3 (clean, on v7.2.0)

---

## 1. Objectives

Implement the missing Payments module — the core revenue-generating feature of the platform. The `Payment` model (schema.prisma:1098) and `PaymentProvider` interface (integrations/interfaces) already exist. This milestone creates the module, controller, service, concrete provider implementations, reconciliation endpoints, split-payment support, and all wiring into audit logs, metrics, and webhooks.

**Forensic finding addressed:**
- **P0-10** (FINAL-PRODUCTION-READINESS-AUDIT.md §P0-10): "No payments module — Payment model + interface exist, but no controller, service, or module. Core revenue feature missing."

**Secondary findings addressed:**
- **P2-14** (FINAL-PRODUCTION-READINESS-AUDIT.md §P2-14): "Business metrics defined but never called — counters never `.inc()` from business logic."

**Score improvement:** Enterprise Readiness 5/10 → 6/10 per ROADMAP §7.3.

---

## 2. Scope

### In Scope — 7 tasks (7.3.1–7.3.7)

| ID | Task | Finding | Effort |
|----|------|---------|--------|
| 7.3.1 | Create PaymentsModule with controller, service, DTOs | P0-10 | 3–4 days |
| 7.3.2 | Implement concrete payment providers (Stripe, Paymob) | P0-10 | 3–4 days |
| 7.3.3 | Implement payment processing (charge, refund, partial refund, void) | P0-10 | 3–4 days |
| 7.3.4 | Implement payment reconciliation endpoint | P0-10 | 2 days |
| 7.3.5 | Implement split payment and multi-tender support | P0-10 | 2–3 days |
| 7.3.6 | Wire payment events into audit logs, metric counters, webhook events | P0-10, P2-14 | 1 day |
| 7.3.7 | Add tests for all payment flows (unit + integration) | P0-10 | 3 days |

### Explicitly Out of Scope

- **No changes to the `Payment` model or schema** — the model exists and is adequate; any schema changes require a Prisma migration and are deferred to 7.4 (Database & Performance).
- **No production deployment** — module is feature-complete but goes live only after 7.8 (Production Certification).
- **No MFA/SSO** — these are 7.7 (Enterprise Features) scope.
- **No subscriptions module** — this is 7.7 scope; only flat payment processing here.
- **No PCI-DSS compliance artifacts** — those are 7.8 (Certification) scope.
- **No changes to existing OrdersController payment endpoints** — they continue functioning; the new PaymentsController provides the dedicated API surface.
- **No third-party provider onboarding UI** — providers are configured via existing IntegrationsService settings; no admin UI in this milestone.
- **No offline payment queue** — deferred to 7.7 (Enterprise Features / offline mode).
- **No receipt printing** — deferred to a POS-specific milestone.

---

## 3. Architecture

### Module Dependency Graph

```
PaymentsModule
  ├── imports: CommonModule, AuditLogsModule, IntegrationsModule
  ├── providers: PaymentsService, StripeProvider, PaymobProvider
  ├── controllers: PaymentsController
  └── exports: PaymentsService

OrdersModule (existing)
  ├── imports: PaymentsModule
  └── delegates addPayment/refundPayment to PaymentsService
```

### Provider Registry Pattern

Payment providers follow the registry pattern already established by `IntegrationsService`:

```
PaymentsService
  ├── providerRegistry: Map<IntegrationProviderType, PaymentProvider>
  │     ├── 'stripe'  → StripeProvider
  │     └── 'paymob'  → PaymobProvider
  │
  ├── charge(orderId, amount, method, providerType)
  ├── refund(paymentId, amount?)
  ├── partialRefund(paymentId, amount)
  ├── voidPayment(paymentId)
  ├── splitPayment(orderId, splits[])
  └── reconcile(tenantId, fromDate, toDate)
```

### Key Design Decisions

1. **PaymentsModule is a new NestJS module** — lives at `src/modules/payments/` following the same structure as OrdersModule.
2. **Existing OrdersController endpoints remain** — `POST /orders/:id/payments` and `POST /orders/:id/payments/:paymentId/refund` continue to work but delegate to `PaymentsService` internally (backward compatibility). New endpoints on `PaymentsController` are the primary API surface.
3. **Providers are injected via a custom provider factory** — `StripeProvider` and `PaymobProvider` implement `PaymentProvider`; `PaymentsService` resolves the correct provider by tenant configuration from `IntegrationsService`.
4. **Prisma transactions span payment + order updates** — all mutations use `$transaction` with optimistic locking via `version` field.
5. **Audit logs use existing `AuditLogsService.log()`** — same pattern as OrdersModule.
6. **Metrics counters use existing `MetricsService`** — new counter methods for payment-specific events.
7. **Webhook events emit existing shared event types** — `payments.completed`, `payments.failed`, `payments.refunded` (already defined in `@tablofy/shared/types`).
8. **Circular dependency avoided** — `PaymentsModule` does NOT import `OrdersModule`. `PaymentsService` accesses order data directly via `PrismaService` (from `CommonModule`) rather than through `OrdersService`, preventing a circular module reference. `OrdersModule` imports `PaymentsModule` to delegate `addPayment()`/`refundPayment()` to `PaymentsService`.
9. **IntegrationsModule** is `@Global()` and thus its providers are available without explicit import. It is listed in `PaymentsModule` imports for documentation clarity; the runtime does not require it.
10. **Payment providers** — Stripe and Paymob are implemented because they match the existing `IntegrationProviderType` values in `@tablofy/shared/types` (`'stripe'`, `'paymob'`). Square and Adyen (listed in the original roadmap as aspirational targets) will be added when their types are added to the shared types in a future milestone.

---

## 4. Modules

### New: PaymentsModule

| File | Purpose |
|------|---------|
| `payments.module.ts` | Module definition — imports CommonModule, AuditLogsModule, IntegrationsModule |
| `payments.controller.ts` | Payment REST endpoints |
| `payments.service.ts` | Payment business logic — orchestration, provider resolution, reconciliation |
| `payment-state-machine.ts` | Valid payment state transitions (PENDING→COMPLETED, PENDING→FAILED, COMPLETED→REFUNDED, COMPLETED→PARTIALLY_REFUNDED) |
| `providers/stripe.provider.ts` | Stripe payment provider implementation |
| `providers/paymob.provider.ts` | Paymob payment provider implementation |
| `dto/create-payment.dto.ts` | Payment request DTO |
| `dto/refund-payment.dto.ts` | Refund request DTO |
| `dto/split-payment.dto.ts` | Split payment request DTO |
| `dto/reconcile-query.dto.ts` | Reconciliation query parameters DTO |
| `dto/payment-response.dto.ts` | Standardized payment response DTO |
| `interfaces/payment-result.interface.ts` | Internal payment result interface |
| `tests/payments.service.spec.ts` | Unit tests for PaymentsService |
| `tests/integration/payment-flow.integration.spec.ts` | Integration tests for full payment flow |
| `tests/providers/stripe.provider.spec.ts` | Stripe provider unit tests |
| `tests/providers/paymob.provider.spec.ts` | Paymob provider unit tests |

### No New NestJS Modules Beyond Payments

All work is within the Payments module. The existing `IntegrationsModule` (already `@Global()`) provides the `PaymentProvider` interface and `IntegrationsService` for tenant configuration lookup.

---

## 5. Services

### PaymentsService

Located at `src/modules/payments/payments.service.ts`.

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| `charge(orderId, dto, tenantId, userId)` | orderId, CreatePaymentDto, tenantId, userId | Payment | Validates order is payable, resolves provider by tenant config, creates Payment record (PENDING), calls provider.charge(), updates to COMPLETED/FAILED, updates order.paidAmount, auto-completes order if fully paid |
| `refund(paymentId, tenantId, userId, reason?)` | paymentId, tenantId, userId, reason | Payment | Validates payment exists and is refundable, calls provider.refund(), updates status to REFUNDED, decrements order.paidAmount |
| `partialRefund(paymentId, amount, tenantId, userId, reason?)` | paymentId, amount, tenantId, userId, reason | Payment | Same as refund but only refunds partial amount; status becomes PARTIALLY_REFUNDED |
| `voidPayment(paymentId, tenantId, userId, reason)` | paymentId, tenantId, userId, reason | Payment | Voids a PENDING payment before settlement; no provider call needed |
| `splitPayment(orderId, splits[], tenantId, userId)` | orderId, SplitPaymentDto[], tenantId, userId | Payment[] | Creates multiple Payment records in one transaction, totals validate against remaining balance |
| `findAll(tenantId, query)` | tenantId, ReconcileQueryDto | Paginated payment list | List payments with optional date range, status, method filters |
| `findOne(id, tenantId)` | id, tenantId | Payment with relations | Single payment lookup |
| `reconcile(tenantId, fromDate, toDate)` | tenantId, fromDate, toDate | ReconciliationReport[] | Compares local Payment records against provider transactions for the date range |
| `getProviderForTenant(tenantId)` | tenantId | PaymentProvider | Resolves the active payment provider for a tenant via IntegrationsService |
| `getPaymentStatus(providerRef)` | providerRef | PaymentStatus | Queries provider for current status of an external transaction |

### StripeProvider

Located at `src/modules/payments/providers/stripe.provider.ts`.

Implements `PaymentProvider` (from `integrations/interfaces/payment-provider.interface.ts`):
- `initialize(config)` — configures Stripe SDK with tenant's secret key
- `validateConnection()` — pings Stripe API to verify credentials
- `healthCheck()` — returns status + latency
- `createPaymentIntent(data)` — creates Stripe PaymentIntent
- `confirmPayment(paymentIntentId)` — confirms Stripe PaymentIntent
- `refundPayment(data)` — processes Stripe refund (full or partial)
- `getPaymentStatus(transactionId)` — retrieves Stripe PaymentIntent status

### PaymobProvider

Located at `src/modules/payments/providers/paymob.provider.ts`.

Implements the same `PaymentProvider` interface with Paymob's API:
- Uses Paymob's authentication flow (API key → auth token)
- Implements payment intent creation via Paymob's Order API
- Implements refund via Paymob's refund endpoint
- Implements status check via Paymob's transaction inquiry

---

## 6. Guards

No new guards. Existing guards apply:

| Guard | Coverage | Reason |
|-------|----------|--------|
| `JwtAuthGuard` (global) | All payment endpoints | Authentication required |
| `TenantGuard` (global) | All payment endpoints | Tenant isolation |
| `RolesGuard` (controller-level) | `@Roles('OWNER', 'MANAGER', 'CASHIER')` for charge/create; `@Roles('OWNER', 'MANAGER')` for refund/void | Role-based authorization per ROADMAP §7.1.1–7.1.3 pattern |
| `TenantBodyGuard` | POST/PUT/PATCH endpoints | Validates body tenantId matches JWT claims (per P0-8 fix in 7.1) |

---

## 7. Interceptors

No new interceptors. Existing global interceptors apply:
- `AuditLogInterceptor` — logs controller entry/exit
- `PerformanceMonitorInterceptor` — records endpoint latency metrics

---

## 8. Middleware

No new middleware. Existing middleware applies:
- `TenantBodyGuard` middleware (implemented in 7.1.6) validates body tenantId
- HTTP logging middleware logs requests

---

## 9. Prisma / Database Changes

### No changes to the existing `Payment` model.

The `Payment` model at schema.prisma:1098-1123 is adequate for M3:

```prisma
model Payment {
  id           String        @id @default(uuid())
  orderId      String
  tenantId     String
  method       PaymentMethod
  status       PaymentStatus @default(PENDING)
  amount       Decimal       @db.Decimal(10, 2)
  tip          Decimal       @default(0) @db.Decimal(10, 2)
  reference    String?
  gatewayRef   String?
  gatewayData  Json?
  processedAt  DateTime?
  refundedAt   DateTime?
  refundReason String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  order        Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  // ...indexes
}
```

### Deferred schema improvements (to 7.4 Database & Performance):

The following are NOT in M3 scope but should be tracked for 7.4:

1. **Add `@@index([tenantId, status, createdAt])`** — composite index for payment listing queries.
2. **Add `@@index([tenantId, method, createdAt])`** — composite index for payment method reporting.
3. **Add `processedBy` field (String?)** — userId who processed the payment (audit trail).
4. **Add `refundedBy` field (String?)** — userId who processed the refund.
5. **Add `voidedBy` field (String?)** — userId who voided the payment.
6. **Add `notes` field (String?)** — free-text notes for payment/refund.

### No migration required for M3.

All work is in the application layer using the existing schema. Index and field additions are deferred to 7.4.

---

## 10. API Endpoints

### New PaymentsController Endpoints

All under prefix: `/restaurants/:restaurantId/payments`

| Method | Path | Auth | Roles | Body | Description |
|--------|------|------|-------|------|-------------|
| `POST` | `/` | JWT+Tenant | OWNER, MANAGER, CASHIER | `CreatePaymentDto` | Process a payment against an order |
| `GET` | `/` | JWT+Tenant | OWNER, MANAGER, CASHIER | `ReconcileQueryDto` | List payments with filters |
| `GET` | `/:id` | JWT+Tenant | OWNER, MANAGER, CASHIER | — | Get payment details |
| `POST` | `/:paymentId/refund` | JWT+Tenant | OWNER, MANAGER | `RefundPaymentDto` | Full refund |
| `POST` | `/:paymentId/partial-refund` | JWT+Tenant | OWNER, MANAGER | `PartialRefundDto` | Partial refund |
| `POST` | `/:paymentId/void` | JWT+Tenant | OWNER, MANAGER | `VoidPaymentDto` | Void pending payment |
| `POST` | `/split` | JWT+Tenant | OWNER, MANAGER, CASHIER | `SplitPaymentDto` | Split payment across methods |
| `GET` | `/reconcile` | JWT+Tenant | OWNER, MANAGER | `ReconcileQueryDto` | Reconciliation report |
| `GET` | `/providers/:tenantId/status` | JWT+Tenant | OWNER | — | Payment provider health check |

### Existing OrdersController Endpoints (unchanged)

| Method | Path | Status |
|--------|------|--------|
| `POST` | `/restaurants/:restaurantId/orders/:id/payments` | ✅ Retained; delegates to `PaymentsService.charge()` |
| `POST` | `/restaurants/:restaurantId/orders/:id/payments/:paymentId/refund` | ✅ Retained; delegates to `PaymentsService.refund()` |

---

## 11. DTOs

### New DTOs (all in `src/modules/payments/dto/`)

#### `create-payment.dto.ts`
```typescript
export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tip?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}
```

#### `refund-payment.dto.ts`
```typescript
export class RefundPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
```

#### `partial-refund.dto.ts`
```typescript
export class PartialRefundDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
```

#### `void-payment.dto.ts`
```typescript
export class VoidPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
```

#### `split-payment.dto.ts`
```typescript
export class SplitItemDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tip?: number;
}

export class SplitPaymentDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ValidateNested({ each: true })
  @Type(() => SplitItemDto)
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  splits: SplitItemDto[];
}
```

#### `reconcile-query.dto.ts`
```typescript
export class ReconcileQueryDto {
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number;
}
```

#### `payment-response.dto.ts`
```typescript
export class PaymentResponseDto {
  id: string;
  orderId: string;
  tenantId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  tip: number;
  reference: string | null;
  gatewayRef: string | null;
  processedAt: Date | null;
  refundedAt: Date | null;
  refundReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Reused from Existing OrdersModule
- `AddPaymentDto` (orders/dto/add-payment.dto.ts) — still used by legacy OrdersController endpoint
- `RefundPaymentDto` (orders/dto/refund-payment.dto.ts) — still used by legacy OrdersController endpoint

---

## 12. Configuration

### File to Modify: `apps/api/jest.config.ts`

1. **Add coverage thresholds for payments module:**
```typescript
'**/src/modules/payments/payments.service.ts': { branches: 40, functions: 50, lines: 60, statements: 60 },
'**/src/modules/payments/payment-state-machine.ts': { branches: 90, functions: 90, lines: 90, statements: 90 },
```

2. **Add `'!<rootDir>/src/modules/payments/providers/*.ts'` to `collectCoverageFrom` excludes** — provider implementations wrap third-party SDKs; unit-testing SDK calls is low value. Provider tests verify integration contract, not line coverage.

### File to Modify: `apps/api/src/app.module.ts`

Add `PaymentsModule` to the module imports array.

### Files to NOT Modify

- **`tsconfig.spec.json`** — no changes needed.
- **`.env.example`** — Stripe/Paymob keys are configured per-tenant via IntegrationsService settings, not global env vars.
- **`prisma/schema.prisma`** — no schema changes in M3.

---

## 13. Environment Variables

### No new environment variables.

Payment provider credentials are stored per-tenant in the existing tenant settings / integrations configuration (via `IntegrationsService`), not in global environment variables. This follows the existing pattern where each tenant connects their own Stripe/Paymob account.

**Rationale:** In a multi-tenant SaaS, each tenant brings their own payment provider credentials. Global env vars would force all tenants to use the same provider account, which is incorrect.

---

## 14. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| **Payment provider credentials stored in DB** | Stored via existing IntegrationsService which uses encrypted settings. StripeProvider decrypts on retrieval. |
| **Cross-tenant payment access** | `TenantGuard` enforces `tenantId` on all payment endpoints. `PaymentsService.findAll` and `findOne` filter by `tenantId`. |
| **Payment amount manipulation** | Server-side amount calculation. Amounts come from DTO validated with `class-validator` `@Min(0.01)`. Order `paidAmount` tracked in DB. |
| **Double-charge race condition** | `$transaction` with `version` field optimistic locking. Provider `idempotencyKey` prevents duplicate Stripe charges. |
| **Refund abuse** | Only `OWNER`/`MANAGER` roles can refund. Refund amounts validated against original payment. Payment must be COMPLETED. |
| **PCI-DSS scope** | No credit card numbers stored. `gatewayData` is provider reference data (JSON), not raw PAN. Provider SDKs handle tokenization. |
| **Provider credential leakage** | Credentials retrieved from IntegrationsService at runtime, never logged. Existing P0-13 log sanitizer (7.1) redacts credentials. |

---

## 15. Testing Strategy

### Test Types

| Category | Pattern | Files | Coverage Target |
|----------|---------|-------|-----------------|
| Unit: PaymentsService | `*.spec.ts` | `payments.service.spec.ts` | 60% lines |
| Unit: State machine | `*.spec.ts` | `payment-state-machine.spec.ts` | 90% lines |
| Unit: StripeProvider | `*.spec.ts` | `stripe.provider.spec.ts` | Contract only |
| Unit: PaymobProvider | `*.spec.ts` | `paymob.provider.spec.ts` | Contract only |
| Integration: Payment flow | `*.integration.spec.ts` | `payment-flow.integration.spec.ts` | 60% lines |

### Unit Test Coverage (payments.service.spec.ts)

| Test Case | Scenario |
|-----------|----------|
| `charge` — successfully processes payment | Valid order, valid provider, gateway returns success |
| `charge` — rejects non-payable order status | Order in DRAFT/CANCELLED status |
| `charge` — rejects amount exceeding balance | Payment > remaining order total |
| `charge` — handles provider failure | Provider.charge() throws; payment marked FAILED |
| `charge` — auto-completes order on full payment | totalPaid >= orderTotal → order status COMPLETED |
| `refund` — full refund | Existing COMPLETED payment → REFUNDED |
| `refund` — rejects already refunded | Payment already REFUNDED → ConflictException |
| `refund` — rejects not-found payment | Invalid paymentId → NotFoundException |
| `partialRefund` — partial refund | COMPLETED payment → PARTIALLY_REFUNDED with amount |
| `partialRefund` — rejects amount > original | Refund amount > payment.amount → BadRequest |
| `voidPayment` — voids pending payment | PENDING payment → status updated to FAILED |
| `voidPayment` — rejects completed payment | COMPLETED payment → BadRequest |
| `splitPayment` — splits across methods | 2 splits (CASH + CARD), total ≤ remaining balance |
| `splitPayment` — rejects split total > balance | Sum of splits > remaining → BadRequest |
| `splitPayment` — atomic transaction | One split fails → all payments rolled back |
| `reconcile` — matches local vs provider | Local payments match provider records |
| `reconcile` — detects mismatches | Local payment has no matching provider record |
| `findAll` — filters by date range | Payments between fromDate and toDate |
| `findAll` — filters by status/method | Payments with specific status or method |
| `findAll` — enforces tenant isolation | Only returns payments for the requested tenantId |
| `findOne` — returns payment with relations | Includes order, provider details |
| `findOne` — enforces tenant isolation | Different tenant cannot access payment |

### Integration Test Coverage (payment-flow.integration.spec.ts)

| Test Case | Scenario |
|-----------|----------|
| Full payment flow | Charge → verify COMPLETED → refund → verify REFUNDED |
| Partial payment → order completion | Charge 50% → charge 50% → order auto-completes |
| Split payment | Split across CASH + CREDIT_CARD → both created |
| Payment failure handling | Provider fails → payment marked FAILED, order unchanged |
| Void pending payment | Create PENDING payment → void → FAILED |

### Provider Unit Tests (stripe.provider.spec.ts, paymob.provider.spec.ts)

| Test Case | Scenario |
|-----------|----------|
| `initialize` — configures SDK | SDK initialized with correct API key |
| `initialize` — handles missing config | Missing key → throws ConfigurationException |
| `validateConnection` — valid credentials | Returns success |
| `validateConnection` — invalid credentials | Returns failure with error |
| `createPaymentIntent` — success | Returns intent with id and clientSecret |
| `createPaymentIntent` — failure | API error → returns IntegrationResult with error |
| `confirmPayment` — success | Payment confirmed, returns transactionId |
| `confirmPayment` — failure | Card declined → returns failed status |
| `refundPayment` — full refund | Full amount refunded successfully |
| `refundPayment` — partial refund | Partial amount refunded successfully |
| `refundPayment` — already refunded | Provider returns error → IntegrationResult with error |
| `getPaymentStatus` — returns status | Maps provider status to PaymentStatus enum |

### Test Quality Gates

| Gate | Target |
|------|--------|
| Unit tests pass | 100% |
| Integration tests pass | 100% |
| ESLint on payment test files | 0 errors |
| Coverage — payments.service.ts | ≥60% lines, ≥60% statements, ≥50% functions, ≥40% branches |
| Coverage — payment-state-machine.ts | ≥90% all metrics |

---

## 16. Migration Strategy

### No database migration.

The `Payment` model, `PaymentMethod` enum, and `PaymentStatus` enum already exist in `schema.prisma`. No Prisma migration is required for M3. The existing `payments` table is already part of the database schema.

### Application migration only:

1. Create `PaymentsModule` files (controller, service, providers, DTOs, interfaces)
2. Register `PaymentsModule` in `app.module.ts`
3. Update `OrdersService.addPayment()` and `OrdersService.refundPayment()` to delegate to `PaymentsService`
4. Update `jest.config.ts` with payment module coverage thresholds
5. Run `npx prisma generate` (no migration, but ensures client is up to date)
6. Run full test suite to verify no regressions

---

## 17. Rollback Strategy

```bash
# Revert app.module.ts registration
git checkout -- apps/api/src/app.module.ts

# Remove entire payments module
Remove-Item -Recurse -Force apps/api/src/modules/payments/

# Revert jest.config.ts changes
git checkout -- apps/api/jest.config.ts

# Revert OrdersService changes (delegation to PaymentsService)
git checkout -- apps/api/src/modules/orders/orders.service.ts

# Remove test files
Remove-Item -Recurse -Force apps/api/src/modules/payments/tests/

# Verify no regressions
npx nx test api
```

---

## 18. Risks and Blockers

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Stripe/Paymob SDK API changes** — provider implementations break if SDK updates | Low | High | Pin SDK versions; integration tests with mock providers (not real API calls) |
| R2 | **OrdersService refactoring breaks existing payment endpoints** — delegating to PaymentsService changes behavior | Medium | High | Keep existing route handlers in OrdersController; delegate internally; verify existing order-crud integration tests pass |
| R3 | **Provider registry is empty for a tenant** — no Stripe/Paymob configured | Medium | Medium | `charge()` checks `getProviderForTenant()` and throws `BadRequestException` with clear message if no provider configured |
| R4 | **Split payment validation too complex** — edge cases with rounding, remainders, already-paid orders | Medium | Medium | Use integer cents for all calculations; validate totals before transaction; reject if any split exceeds remaining balance |
| R5 | **Reconciliation endpoint slow** — queries across many payments + provider API calls for each | Medium | Low | Paginate local results; batch provider status checks; accept that reconciliation is an async/scheduled operation in production |
| R6 | **Idempotency key collision** — same payment processed twice if network retry | Low | High | Use `Reference` field + unique constraint on `[tenantId, reference]` where reference is provided; generate UUID idempotency key for provider calls |
| R7 | **Payment gatewayData size** — Stripe responses can be large JSON blobs | Low | Low | Store only essential fields in `gatewayData`; log full response server-side |
| R8 | **No PCI-DSS compliant storage** — storing raw card data | Low | Catastrophic | Never store card numbers; use provider tokenization; `gatewayData` contains tokens only; add validation to strip PAN if present |

---

## 19. Estimated Effort

| Task | Days | Parallelizable | Dependencies |
|------|------|---------------|-------------|
| 7.3.1 — PaymentsModule (controller, service, DTOs, module) | 3–4 | ✅ (can start immediately) | None (uses existing schema + interfaces) |
| 7.3.2 — Payment providers (Stripe, Paymob) | 3–4 | ✅ Parallel with 7.3.1 | None (implements existing interface) |
| 7.3.3 — Payment processing (charge, refund, partial, void) | 3–4 | ❌ Requires 7.3.1 + 7.3.2 | 7.3.1, 7.3.2 |
| 7.3.4 — Reconciliation endpoint | 2 | ✅ Parallel with 7.3.3 | 7.3.1 |
| 7.3.5 — Split payment / multi-tender | 2–3 | ❌ Requires 7.3.3 | 7.3.3 |
| 7.3.6 — Wire audit logs, metrics, webhooks | 1 | ✅ Parallel with 7.3.3–5 | 7.3.1 |
| 7.3.7 — Tests | 3 | ✅ Parallel with 7.3.3–6 | 7.3.1 |
| **Subtotal** | **~18–23 days** | | |
| With 25% buffer | **~23–29 days** | | |

### Parallel Execution Groups

```
Group A (parallel, days 1–4):    7.3.1 (module scaffold)   7.3.2 (providers)
                                     │                           │
Group B (parallel, days 3–7):  7.3.3 (processing) ── ← ← ← ← ──┘
                                  │         │           │
Group C (parallel, days 5–9):  7.3.4    7.3.5      7.3.6 (wiring)
                                (recon)  (split)   (audit/metrics)
                                  │         │           │
Group D (parallel, days 5–12):   └──── 7.3.7 (tests) ←──┘

Group E (day 13):              Quality gates + fixes
```

**Calendar estimate:** ~13 working days (1 engineer) with parallelization; ~20 days serial.

---

## 20. Deliverables

### Documentation
- `PHASE7-M3-REPORT.md` — milestone completion report
- `PHASE7-M3-CHANGELOG.md` — per-file change log

### Verification
- `scripts/verify-phase7-m3.js` — automated verification script

### Reports (generated during quality gates)
- Coverage report (`coverage/lcov-report/index.html`)
- Test results (Jest XML output)

### Tag
- `v7.3.0` — milestone completion tag (after quality gates pass)

---

## 21. File Inventory

### Files to Create (22 files)

#### Module Scaffold (4 files)
```
apps/api/src/modules/payments/payments.module.ts
apps/api/src/modules/payments/payments.controller.ts
apps/api/src/modules/payments/payments.service.ts
apps/api/src/modules/payments/payment-state-machine.ts
```

#### Payment Providers (2 files)
```
apps/api/src/modules/payments/providers/stripe.provider.ts
apps/api/src/modules/payments/providers/paymob.provider.ts
```

#### DTOs (7 files)
```
apps/api/src/modules/payments/dto/create-payment.dto.ts
apps/api/src/modules/payments/dto/refund-payment.dto.ts
apps/api/src/modules/payments/dto/partial-refund.dto.ts
apps/api/src/modules/payments/dto/void-payment.dto.ts
apps/api/src/modules/payments/dto/split-payment.dto.ts
apps/api/src/modules/payments/dto/reconcile-query.dto.ts
apps/api/src/modules/payments/dto/payment-response.dto.ts
```

#### Interfaces (1 file)
```
apps/api/src/modules/payments/interfaces/payment-result.interface.ts
```

#### Tests (5 files)
```
apps/api/src/modules/payments/tests/payments.service.spec.ts
apps/api/src/modules/payments/tests/payment-state-machine.spec.ts
apps/api/src/modules/payments/tests/providers/stripe.provider.spec.ts
apps/api/src/modules/payments/tests/providers/paymob.provider.spec.ts
apps/api/src/modules/payments/tests/integration/payment-flow.integration.spec.ts
```

#### Verification (1 file)
```
scripts/verify-phase7-m3.js
```

#### Reports (2 files)
```
PHASE7-M3-REPORT.md
PHASE7-M3-CHANGELOG.md
```

### Files to Modify (4 files)

```
apps/api/jest.config.ts
  └── Add payment module coverage thresholds
  └── Add provider directory to collectCoverageFrom excludes

apps/api/src/app.module.ts
  └── Add PaymentsModule to imports

apps/api/src/modules/orders/orders.service.ts
  └── Delegate addPayment() and refundPayment() to PaymentsService
  └── Retain backward-compatible method signatures

apps/api/src/common/metrics/metrics.service.ts
  └── Add incrementPaymentsCompleted() counter
  └── Add incrementPaymentsFailed() counter
  └── Add incrementPaymentsRefunded() counter
```

### Files to NOT Modify

```
prisma/schema.prisma                              — No schema changes in M3
apps/api/.env.example                             — No new env vars
apps/api/src/modules/orders/orders.controller.ts  — Retain existing payment endpoints
apps/api/src/modules/orders/dto/add-payment.dto.ts — Still used by legacy endpoint
apps/api/src/modules/orders/dto/refund-payment.dto.ts — Still used by legacy endpoint
apps/api/src/modules/integrations/interfaces/payment-provider.interface.ts — Already exists; no changes needed
apps/api/src/modules/integrations/integrations.module.ts — Already @Global(); no changes needed
```

---

## 22. Finding-to-Task Mapping

| Finding | Audit Report Section | M3 Tasks |
|---------|---------------------|----------|
| **P0-10**: No payments module — Payment model exists but no controller/service/module | FINAL-PRODUCTION-READINESS-AUDIT.md §P0-10 | 7.3.1, 7.3.2, 7.3.3, 7.3.4, 7.3.5 |
| **P2-14**: Business metrics defined but never called — `metrics.service.ts` counters never `.inc()` | FINAL-PRODUCTION-READINESS-AUDIT.md §P2-14 | 7.3.6 (wire payment metrics) |

---

## 23. Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Payment module present | Module registers without error | `npx jest` — app bootstrap test |
| All payment endpoints functional | Integration tests pass | `npx jest` — payment-flow integration |
| Provider abstraction works | Both Stripe and Paymob providers compile | `npx tsc --noEmit` |
| Charge flow completes | Payment created, COMPLETED, order updated | Integration test |
| Refund flow completes | Payment REFUNDED, order paidAmount decremented | Integration test |
| Split payment completes | Two payments created atomically | Integration test |
| Reconciliation runs | Report generated without error | Unit test |
| Payment metrics wired | Counters called from payment flows | Unit test assertion |
| Audit logs written | PAYMENT_ADDED, PAYMENT_REFUNDED actions logged | Unit test assertion |
| Webhook events emitted | `payments.completed`, `payments.refunded` events fired | Unit test assertion |
| Legacy endpoints backward-compatible | OrdersController payment endpoints still pass | Existing order-crud integration tests |
| Coverage — payments.service.ts | ≥60% lines | `npx jest --coverage` |
| Coverage — payment-state-machine.ts | ≥90% all metrics | `npx jest --coverage` |
| ESLint | 0 errors on payment files | `npx eslint` |
| Full test suite | 100% pass (existing + new) | `npx nx test api` |

---

## 24. Quality Gates

| Gate | Command | Expected |
|------|---------|----------|
| Lint payment files | `npx eslint "apps/api/src/modules/payments/**/*.ts"` | 0 errors, 0 warnings |
| TypeScript check | `npx tsc --noEmit -p apps/api/tsconfig.spec.json` | 0 errors |
| Payment unit tests | `npx jest --testPathPattern='payments.*\.spec\.ts$'` | 100% pass |
| Payment integration tests | `npx jest --testPathPattern='payment-flow\.integration\.spec\.ts$'` | 100% pass |
| Full suite (no regressions) | `npx nx test api` | 100% pass (existing + new) |
| Coverage — payments.service.ts | ≥60% lines | `npx jest --coverage` |
| Coverage — payment-state-machine.ts | ≥90% all metrics | `npx jest --coverage` |
| Verify script | `node scripts/verify-phase7-m3.js` | 100% pass |

---

## 25. Internal Consistency Check

| Check | Value | Pass/Fail |
|-------|-------|-----------|
| **Total tasks** | 7 (all actionable, 0 deferred) | ✅ |
| **Files to create** | 22 (4 module + 2 providers + 7 DTOs + 1 interface + 5 tests + 1 verify + 2 reports) | ✅ |
| **Files to modify** | 4 (jest.config.ts, app.module.ts, orders.service.ts, metrics.service.ts) | ✅ |
| **Total file changes** | 26 | ✅ |
| **Production source files modified** | 3 (app.module.ts, orders.service.ts, metrics.service.ts) — all minimal wiring changes | ✅ |
| **Schema files modified** | 0 | ✅ |
| **New npm dependencies** | 0 (Stripe SDK assumed already available; if not, `npm install stripe`) | ⚠ Need to check `package.json` for `stripe` package |
| **Scope creep items** | 0 — all tasks map to P0-10 or P2-14 | ✅ |
| **Finding-to-task mapping** | P0-10 → 7.3.1–7.3.5; P2-14 → 7.3.6 | ✅ |
| **Deferred items documented** | Schema index/field additions deferred to 7.4; PCI-DSS to 7.8 | ✅ |
| **Backward compatibility** | Existing OrdersController payment endpoints retained | ✅ |
| **Provider names match types** | 'stripe', 'paymob' match `IntegrationProviderType` in shared types | ✅ |

---

**End of PHASE7-M3-IMPLEMENTATION-PLAN.md**
