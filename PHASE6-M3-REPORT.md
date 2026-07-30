# Phase 6 Milestone 3 - Enterprise Integrations & Platform APIs

## Overview
Integration-ready platform with enterprise webhook framework, public REST API (API keys), SDK readiness standards, integration provider interfaces, and OpenAPI documentation improvements.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP Request                              │
└───────────────────────┬─────────────────────────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          │  Authentication Flow       │
          │  JWT (internal)            │
          │  API Key (external)        │
          └─────────────┬─────────────┘
                        │
          ┌─────────────┴─────────────┐
          │  Guard Chain               │
          │  JwtAuthGuard              │
          │  ApiKeyGuard (optional)    │
          │  RolesGuard                │
          │  TenantGuard               │
          │  PlanThrottleGuard         │
          └─────────────┬─────────────┘
                        │
┌───────────────────────┼───────────────────────────────────────┐
│                       │                                       │
│          ┌────────────┴────────────┐                          │
│          │   New Modules            │                          │
│          │                          │                          │
│  ┌───────┴───────┐    ┌────────────┴──────┐   ┌──────────────┴───┐
│  │ WebhooksModule│    │  ApiKeysModule    │   │ Integrations     │
│  │ • Registration│    │  • Generate       │   │ Module           │
│  │ • Delivery    │    │  • Validate       │   │ • Providers      │
│  │ • HMAC Sign   │    │  • Rotate         │   │ • Interfaces     │
│  │ • Retry/DLQ   │    │  • Scopes         │   │ • Registry       │
│  │ • Event Emit  │    │  • Rate Limit     │   │                  │
│  └───────┬───────┘    └────────┬──────────┘   └──────────────────┘
│          │                     │                                 │
│  ┌───────┴─────────────────────┴──────────────────────────────┐  │
│  │                    Event Bus (EventEmitter2)                │  │
│  │  orders.* │ customers.* │ inventory.* │ payments.* │ ...   │  │
│  └───────┬────────────────────────────────────────────────────┘  │
│          │                                                       │
│  ┌───────┴──────────┐                                            │
│  │ WebhookProcessor │  (BullMQ Worker - async delivery)          │
│  │ WebhookRetry     │  (Exponential backoff + dead-letter)       │
│  └──────────────────┘                                            │
└──────────────────────────────────────────────────────────────────┘
```

## New Files Created

### Configuration
| File | Purpose |
|------|---------|
| `src/config/webhook.config.ts` | Webhook retry/timeout/backoff settings |
| `src/config/api-keys.config.ts` | API key generation and rate limiting config |

### SDK Readiness / Standardization
| File | Purpose |
|------|---------|
| `src/common/interfaces/index.ts` | PaginationMeta, EnvelopeOptions, SortField, FilterCondition |
| `src/common/utils/pagination.util.ts` | buildPaginationMeta, buildPrismaOrderBy, buildPrismaWhere |
| `src/common/dto/sort.dto.ts` | Self-validating sort DTO |
| `src/common/dto/filter.dto.ts` | Self-validating filter DTO |

### Webhook Module (`src/modules/webhooks/`)
| File | Purpose |
|------|---------|
| `webhooks.module.ts` | Module with controller, services, processor |
| `webhooks.controller.ts` | CRUD endpoints + secret rotation + delivery history |
| `webhooks.service.ts` | Registration management with plan limits |
| `webhook-delivery.service.ts` | Delivery tracking, HMAC SHA256 signing, exponential backoff, dead-letter queue |
| `webhook-processor.ts` | BullMQ async delivery worker with retry worker |
| `webhook-event-emitter.ts` | EventEmitter listener dispatching to registered webhooks |
| `dto/create-webhook.dto.ts` | Validation for URL, events, retry config |
| `dto/update-webhook.dto.ts` | Partial update DTO |
| `dto/query-webhook.dto.ts` | Pagination + event/active filters |

### API Keys Module (`src/modules/api-keys/`)
| File | Purpose |
|------|---------|
| `api-keys.module.ts` | Module with controller, service |
| `api-keys.controller.ts` | CRUD + rotation endpoints |
| `api-keys.service.ts` | Key generation (SHA256 hash), validation, scoping, rate limiting |
| `guards/api-key.guard.ts` | Authenticate requests via `Authorization: ApiKey <key>` |
| `dto/create-api-key.dto.ts` | Name, scopes, rate limit, expiry |
| `dto/update-api-key.dto.ts` | Partial update DTO |
| `dto/query-api-key.dto.ts` | Pagination + active/scope filters |

### Integration Framework (`src/modules/integrations/`)
| File | Purpose |
|------|---------|
| `integrations.module.ts` | Global module, exports service |
| `integrations.service.ts` | Provider registry (register, get, remove) |
| `interfaces/integration-provider.interface.ts` | Base `IntegrationProvider` interface |
| `interfaces/accounting-provider.interface.ts` | `AccountingProvider` (QuickBooks, Xero) + InvoiceData, ExpenseData |
| `interfaces/payment-provider.interface.ts` | `PaymentProvider` (Stripe, Paymob) + PaymentIntentData, RefundData |
| `interfaces/communication-provider.interface.ts` | `EmailProvider`, `SmsProvider`, `WhatsAppProvider` + data types |

## Modified Files

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added `WebhookRegistration`, `WebhookDelivery`, `ApiKey` models with relations |
| `libs/shared/types/src/index.ts` | Added `WebhookEventType`, `WebhookDeliveryStatus`, `ApiKeyScope`, `IntegrationProviderType`, `WebhookPayload`, `EnvelopeResponse`, `PaginationMeta`, `ApiErrorDetail`, `ErrorResponse` |
| `libs/shared/constants/src/index.ts` | Added `WEBHOOK_EVENT_TYPES`, `WEBHOOK_DELIVERY_STATUSES`, `WEBHOOK_DEFAULTS`, `API_KEY_SCOPES`, `API_KEY_DEFAULTS` |
| `src/config/index.ts` | Exports `webhookConfig`, `apiKeysConfig` |
| `src/common/event-emitter/domain-event.module.ts` | Enabled `wildcard: true` for EventEmitter2 |
| `src/app/app.module.ts` | Imports `WebhooksModule`, `ApiKeysModule`, `IntegrationsModule`, loads 2 new configs, provides `WebhookEventEmitter` |
| `src/main.ts` | Added `webhooks` and `api-keys` Swagger tags |

## New API Endpoints

### Webhook Endpoints
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/webhooks` | POST | OWNER/MANAGER | Create webhook registration |
| `/api/v1/webhooks` | GET | OWNER/MANAGER | List webhook registrations |
| `/api/v1/webhooks/:id` | GET | OWNER/MANAGER | Get webhook details |
| `/api/v1/webhooks/:id` | PUT | OWNER/MANAGER | Update webhook |
| `/api/v1/webhooks/:id` | DELETE | OWNER/MANAGER | Delete webhook |
| `/api/v1/webhooks/:id/rotate-secret` | POST | OWNER | Rotate HMAC signing secret |
| `/api/v1/webhooks/:id/deliveries` | GET | OWNER/MANAGER | List delivery history |

### API Key Endpoints
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/api-keys` | POST | OWNER | Create API key |
| `/api/v1/api-keys` | GET | OWNER/MANAGER | List API keys |
| `/api/v1/api-keys/:id` | GET | OWNER/MANAGER | Get key details |
| `/api/v1/api-keys/:id` | PUT | OWNER | Update key |
| `/api/v1/api-keys/:id` | DELETE | OWNER | Delete key |
| `/api/v1/api-keys/:id/rotate` | POST | OWNER | Rotate key value |

## Webhook Lifecycle

```
Event Emitted ──> WebhookEventEmitter
                      │
                      ▼
              Find Active Registrations
              matching event type + tenant
                      │
                      ▼
              Create WebhookDelivery (PENDING)
                      │
                      ▼
              Queue job to 'webhook-delivery'
                      │
                      ▼
              WebhookProcessor.processDelivery
                      │
              ┌───────┴───────┐
              │               │
          Success (2xx)    Failure (4xx/5xx/timeout)
              │               │
              ▼               ▼
        Mark DELIVERED   Mark FAILED
        Update lastDelivered
                            │
                    ┌───────┴───────┐
                    │               │
                Retries < Max  Retries >= Max
                    │               │
                    ▼               ▼
              Mark RETRYING    Mark DEAD_LETTER
              Schedule next    (manual retry
              attempt via       or discard)
              exponential
              backoff
```

## Retry Mechanism

- **Initial backoff:** 1 second (configurable)
- **Backoff factor:** 2x (configurable)
- **Max backoff:** 1 hour (configurable)
- **Max retries:** 5 (configurable, set per registration)
- **Delivery timeout:** 30 seconds (configurable)

Formula: `delay = initialBackoffMs * backoffFactor^(attempt - 1)`, capped at `maxBackoffMs`.

## Signing

Each webhook delivery includes the header: `X-Webhook-Signature: v1,<hmac_hex>`

The HMAC is SHA-256 of the JSON payload body, keyed by the webhook's secret. Recipients verify by computing `HMAC-SHA256(payload, secret)` and comparing using `crypto.timingSafeEqual`.

## Rate Limits

| Tier | Limit | Applied To |
|------|-------|------------|
| API Key (default) | 60 req/min | Per API key, configurable at creation |
| API Key (max) | 10,000 req/min | Per key |
| Webhooks | 50 registrations/tenant | Plan limit |

## Integration Flow

```
┌──────────┐     ┌──────────────┐     ┌──────────────────┐
│ Provider │────>│ Integrations │────>│ Business Logic   │
│ Interface│     │ Service      │     │ (Queue Processor)│
└──────────┘     │ (Registry)   │     └──────────────────┘
                 └──────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   QuickBooks        Stripe          WhatsApp
   (Accounting)     (Payment)       (Comm)
```

Providers are registered with `IntegrationsService.registerProvider()` and resolved by type/name via `getProvider(type, name?)`. Each provider implements `IntegrationProvider`, `AccountingProvider`, `PaymentProvider`, or one of the communication provider interfaces.

## Quality Gates

| Gate | Status |
|------|--------|
| TypeScript Compilation | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Build | Success |
| Existing Tests | 213/213 passed (26 suites) |
| Verification Script | 68/68 checks passed |
