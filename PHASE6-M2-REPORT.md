# Phase 6 Milestone 2 - Enterprise Observability & Production Operations

## Overview
Production-grade observability stack: structured logging, request correlation, Prometheus metrics, Sentry error monitoring, health checks, audit enhancements, and performance monitoring.

## Architecture

```
                        ┌─────────────────────────┐
                        │     HTTP Request          │
                        └──────────┬──────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │    Middleware Chain           │
                    │  CorrelationMiddleware       │
                    │  HttpLoggingMiddleware       │
                    │  PrometheusMiddleware        │
                    │  TenantMiddleware             │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
     ┌────────┴───────┐   ┌───────┴───────┐   ┌────────┴───────┐
     │ APP_INTERCEPTOR│   │   Controller   │   │ APP_FILTER     │
     │ PerformanceMon │   │               │   │ HttpException  │
     │ AuditLogInter  │   │               │   │  (+ Sentry)    │
     └────────────────┘   └───────┬───────┘   └────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │      Global Modules         │
                    │  LoggerModule (Winston)     │
                    │  CorrelationModule (ALS)    │
                    │  MetricsModule (prom-client)│
                    │  SentryModule              │
                    │  MonitoringModule          │
                    └───────────────────────────┘
```

## New Files Created

### Config
| File | Purpose |
|------|---------|
| `src/config/logging.config.ts` | Winston structured logging config |
| `src/config/sentry.config.ts` | Sentry DSN, environment, sample rates |
| `src/config/metrics.config.ts` | Prometheus metrics endpoint settings |
| `src/config/monitoring.config.ts` | Performance threshold values |

### Common - Correlation
| File | Purpose |
|------|---------|
| `src/common/correlation/correlation.service.ts` | AsyncLocalStorage-based context propagation |
| `src/common/correlation/correlation.middleware.ts` | X-Request-ID / X-Correlation-ID header handling |
| `src/common/correlation/correlation.module.ts` | Global correlation module |

### Common - Logger
| File | Purpose |
|------|---------|
| `src/common/logger/logger.service.ts` | Winston NestJS LoggerService with JSON, rotation, correlation |
| `src/common/logger/http-logging.middleware.ts` | Request/response logging with duration |
| `src/common/logger/logger.module.ts` | Global logger module |

### Common - Metrics
| File | Purpose |
|------|---------|
| `src/common/metrics/metrics.service.ts` | prom-client histograms, counters, gauges |
| `src/common/metrics/metrics.controller.ts` | GET /metrics endpoint |
| `src/common/metrics/metrics.module.ts` | Global metrics module |
| `src/common/metrics/prometheus.middleware.ts` | HTTP duration observation |

### Common - Sentry
| File | Purpose |
|------|---------|
| `src/common/sentry/sentry.module.ts` | Sentry.init factory with integrations |
| `src/common/sentry/sentry.filter.ts` | Global exception filter for Sentry |

### Common - Monitoring
| File | Purpose |
|------|---------|
| `src/common/monitoring/monitoring.service.ts` | Slow query/request/queue/payload/memory checks |
| `src/common/monitoring/performance-monitor.interceptor.ts` | Duration and payload size interception |
| `src/common/monitoring/monitoring.module.ts` | Global monitoring module |

### Health
| File | Purpose |
|------|---------|
| `src/health/bull-health.indicator.ts` | BullMQ queue health via QueueService |
| `src/health/disk-health.indicator.ts` | OS memory usage health check |

## Modified Files

| File | Changes |
|------|---------|
| `src/config/index.ts` | Exports 4 new config modules |
| `src/common/filters/http-exception.filter.ts` | AppLoggerService, CorrelationService, Sentry 5xx reporting |
| `src/common/interceptors/audit-log.interceptor.ts` | Browser/device/IP/duration/requestId capture, AuditLogsService integration |
| `src/health/health.controller.ts` | BullHealthIndicator + DiskHealthIndicator, /health/live, /health/ready |
| `src/health/health.module.ts` | Imports QueueModule, registers 2 new indicators |
| `src/app/app.module.ts` | 5 new modules, APP_FILTER, APP_INTERCEPTOR, middleware chain, 4 new configs |
| `src/main.ts` | AppLoggerService as NestJS logger, no manual filter registration, metrics Swagger tag |
| `src/modules/audit-logs/audit-logs.service.ts` | Extended AuditLogEntry interface (requestId, correlationId, browser, device, executionDuration) |

## Quality Gates

| Gate | Status |
|------|--------|
| TypeScript Compilation | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Build | Success |
| Existing Tests | 213/213 passed (26 suites) |
| Verification Script | 70/70 checks passed |

## API Endpoints Added

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/metrics` | GET | Prometheus metrics (optional Bearer token auth) |
| `/health/live` | GET | Liveness check (DB + Redis) |
| `/health/ready` | GET | Readiness check (DB + Redis + BullMQ + memory + disk) |

## Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| winston | 3.19.0 | Structured logging |
| winston-daily-rotate-file | latest | Log rotation |
| @sentry/node | 10.69.0 | Error monitoring |
| prom-client | 15.1.3 | Prometheus metrics |
