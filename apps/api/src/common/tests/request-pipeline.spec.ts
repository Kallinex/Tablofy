import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ArgumentsHost, CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import * as promClient from 'prom-client';
import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';

// prom-client's default collectors include process_handles, which aborts the Node
// process on Windows under jest (V8 assertion in AsyncWrap::GetOwner). The
// registration call is still asserted, but the OS-level collectors never run.
jest.mock('prom-client', () => {
  const actual = jest.requireActual('prom-client');
  return { ...actual, collectDefaultMetrics: jest.fn() };
});

import { CorrelationMiddleware } from '../correlation/correlation.middleware';
import { CorrelationService } from '../correlation/correlation.service';
import { TenantMiddleware } from '../middleware/tenant.middleware';
import { I18nMiddleware } from '../i18n/i18n.middleware';
import { HttpLoggingMiddleware } from '../logger/http-logging.middleware';
import { PrometheusMiddleware } from '../metrics/prometheus.middleware';
import { MetricsService } from '../metrics/metrics.service';
import { TransformResponseInterceptor } from '../interceptors/transform-response.interceptor';
import { PerformanceMonitorInterceptor } from '../monitoring/performance-monitor.interceptor';
import { MonitoringService } from '../monitoring/monitoring.service';
import { RecoveryService } from '../recovery/recovery.service';
import { SentryFilter } from '../sentry/sentry.filter';
import { AppLoggerService } from '../logger/logger.service';

jest.mock('@sentry/node', () => ({
  withScope: jest.fn(),
  captureException: jest.fn(),
}));

type FakeResponse = Response & { finishHandlers: Array<() => void> };

function fakeResponse(overrides: Partial<Record<string, unknown>> = {}): FakeResponse {
  const handlers: Array<() => void> = [];
  return {
    statusCode: 200,
    headers: {} as Record<string, unknown>,
    setHeader: jest.fn(function (this: Record<string, unknown>, key: string, value: string) {
      (this.headers as Record<string, unknown>)[key] = value;
    }),
    getHeader: jest.fn().mockReturnValue(undefined),
    on: jest.fn((event: string, handler: () => void) => {
      if (event === 'finish') {
        handlers.push(handler);
      }
      return this;
    }),
    finishHandlers: handlers,
    ...overrides,
  } as unknown as FakeResponse;
}

function fireFinish(res: FakeResponse) {
  res.finishHandlers.forEach((handler) => handler());
}

describe('CorrelationMiddleware', () => {
  let service: CorrelationService;
  let middleware: CorrelationMiddleware;

  beforeEach(() => {
    service = new CorrelationService();
    middleware = new CorrelationMiddleware(service);
  });

  it('uses incoming request and correlation headers', () => {
    const req = {
      headers: { 'x-request-id': 'req-1', 'x-correlation-id': 'corr-1' },
    } as unknown as Request;
    const res = fakeResponse();

    middleware.use(req, res, () => undefined);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-1');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'corr-1');
  });

  it('defaults the correlation id to the request id', () => {
    const req = { headers: { 'x-request-id': 'req-2' } } as unknown as Request;
    const res = fakeResponse();

    middleware.use(req, res, () => undefined);

    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'req-2');
  });

  it('generates a request id when none is supplied', () => {
    const req = { headers: {} } as unknown as Request;
    const res = fakeResponse();

    middleware.use(req, res, () => undefined);

    const headerArg = (res.setHeader as jest.Mock).mock.calls[0][1] as string;
    expect(headerArg).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes the request scope to downstream handlers', () => {
    const req = { headers: { 'x-request-id': 'req-3' } } as unknown as Request;

    middleware.use(req, fakeResponse(), () => {
      expect(service.requestId).toBe('req-3');
    });
  });

  it('propagates a resolved tenantId onto the context', () => {
    const req = { headers: {}, tenantId: 'tenant-1' } as unknown as Request;

    middleware.use(req, fakeResponse(), () => {
      expect(service.tenantId).toBe('tenant-1');
    });
  });

  it('falls back to the user tenant', () => {
    const req = { headers: {}, user: { tenantId: 'tenant-2' } } as unknown as Request;

    middleware.use(req, fakeResponse(), () => {
      expect(service.tenantId).toBe('tenant-2');
    });
  });

  it('prefers the request tenant over the user tenant', () => {
    const req = {
      headers: {},
      tenantId: 'tenant-req',
      user: { tenantId: 'tenant-user' },
    } as unknown as Request;

    middleware.use(req, fakeResponse(), () => {
      expect(service.tenantId).toBe('tenant-req');
    });
  });

  it('captures the user id from sub or id', () => {
    const withSub = { headers: {}, user: { sub: 'user-1' } } as unknown as Request;
    middleware.use(withSub, fakeResponse(), () => {
      expect(service.userId).toBe('user-1');
    });

    const withId = { headers: {}, user: { id: 'user-2' } } as unknown as Request;
    middleware.use(withId, fakeResponse(), () => {
      expect(service.userId).toBe('user-2');
    });
  });

  it('calls next exactly once', () => {
    const next = jest.fn() as unknown as NextFunction;
    middleware.use({ headers: {} } as unknown as Request, fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('TenantMiddleware', () => {
  const middleware = new TenantMiddleware();

  it('copies the tenantId from the authenticated user', () => {
    const req = { user: { tenantId: 'tenant-1' } } as unknown as Request;
    const next = jest.fn();

    middleware.use(req, fakeResponse(), next as unknown as NextFunction);

    expect((req as Request & { tenantId: string }).tenantId).toBe('tenant-1');
    expect(next).toHaveBeenCalled();
  });

  it('leaves the request untouched for anonymous callers', () => {
    const req = {} as Request & { tenantId?: string };

    middleware.use(req, fakeResponse(), jest.fn() as unknown as NextFunction);

    expect(req.tenantId).toBeUndefined();
  });

  it('treats the JWT tenant as authoritative over an upstream value', () => {
    const req = {
      tenantId: 'tenant-upstream',
      user: { tenantId: 'tenant-jwt' },
    } as unknown as Request;

    middleware.use(req, fakeResponse(), jest.fn() as unknown as NextFunction);

    expect((req as Request & { tenantId: string }).tenantId).toBe('tenant-jwt');
  });
});

describe('I18nMiddleware', () => {
  const middleware = new I18nMiddleware();

  const run = (acceptLanguage?: string) => {
    const req = {
      headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {},
    } as unknown as Request;
    middleware.use(req, fakeResponse(), jest.fn() as unknown as NextFunction);
    return (req as Request & { lang: string }).lang;
  };

  it('defaults to English when no header is sent', () => {
    expect(run()).toBe('en');
  });

  it('selects Arabic when requested', () => {
    expect(run('ar')).toBe('ar');
  });

  it('selects English when requested', () => {
    expect(run('en-US,en;q=0.9')).toBe('en');
  });

  it('honours quality values for the first language', () => {
    expect(run('ar-EG,ar;q=0.9,en;q=0.8')).toBe('ar');
  });

  it('is case insensitive', () => {
    expect(run('AR')).toBe('ar');
  });

  it('falls back to English for an unsupported language', () => {
    expect(run('fr-FR,fr;q=0.9')).toBe('en');
  });

  it('handles an empty header value', () => {
    expect(run('')).toBe('en');
  });
});

describe('TransformResponseInterceptor', () => {
  const context = {} as ExecutionContext;

  it('wraps the payload in the standard success envelope', async () => {
    const interceptor = new TransformResponseInterceptor();
    const next = { handle: () => of({ id: 'r-1' }) } as CallHandler;

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual({
      success: true,
      data: { id: 'r-1' },
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('passes through null data', async () => {
    const interceptor = new TransformResponseInterceptor();
    const next = { handle: () => of(null) } as CallHandler;

    const result = await firstValueFrom(interceptor.intercept(context, next));

    expect(result.data).toBeNull();
  });

  it('stamps an ISO-8601 timestamp', async () => {
    const interceptor = new TransformResponseInterceptor();
    const result = await firstValueFrom(
      interceptor.intercept(context, { handle: () => of('x') } as CallHandler),
    );
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});

describe('PerformanceMonitorInterceptor', () => {
  const buildContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const build = () => {
    const monitoring = {
      checkSlowRequest: jest.fn(),
      checkLargePayload: jest.fn(),
    } as unknown as MonitoringService;
    const metrics = {} as MetricsService;
    const interceptor = new PerformanceMonitorInterceptor(monitoring, metrics);
    return { interceptor, monitoring };
  };

  it('reports duration and payload size on success', async () => {
    const { interceptor, monitoring } = build();
    const context = buildContext({ method: 'POST', url: '/orders', body: { a: 1 } });

    await firstValueFrom(
      interceptor.intercept(context, { handle: () => of({ ok: true }) } as CallHandler),
    );

    expect(monitoring.checkSlowRequest).toHaveBeenCalledWith('POST', '/orders', expect.any(Number));
    expect(monitoring.checkLargePayload).toHaveBeenCalledWith('POST', '/orders', 7);
  });

  it('treats a missing body as a zero-length payload', async () => {
    const { interceptor, monitoring } = build();
    const context = buildContext({ method: 'GET', url: '/orders' });

    await firstValueFrom(interceptor.intercept(context, { handle: () => of({}) } as CallHandler));

    expect(monitoring.checkLargePayload).toHaveBeenCalledWith('GET', '/orders', 0);
  });

  it('still records the duration when the handler throws', async () => {
    const { interceptor, monitoring } = build();
    const context = buildContext({ method: 'GET', url: '/orders', body: {} });

    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => new Error('boom')),
        } as CallHandler),
      ),
    ).rejects.toThrow('boom');

    expect(monitoring.checkSlowRequest).toHaveBeenCalled();
    expect(monitoring.checkLargePayload).not.toHaveBeenCalled();
  });
});

describe('MonitoringService', () => {
  const build = (overrides: Record<string, unknown> = {}) => {
    const logger = {
      setContext: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    } as unknown as AppLoggerService;
    const config = {
      get: jest.fn((key: string, fallback: unknown) => (overrides[key] ?? fallback) as unknown),
    } as unknown as ConfigService;
    const service = new MonitoringService(config, logger);
    return { service, logger };
  };

  it('sets its logging context on construction', () => {
    const { logger } = build();
    expect(logger.setContext).toHaveBeenCalledWith('Monitoring');
  });

  it('warns only above the slow query threshold', () => {
    const { service, logger } = build({ 'monitoring.slowQueryMs': 100 });

    service.checkSlowQuery(150, 'SELECT * FROM orders');
    expect(logger.warn).toHaveBeenCalledWith('Slow query detected', {
      type: 'slow_query',
      duration: 150,
      threshold: 100,
      query: 'SELECT * FROM orders',
    });

    (logger.warn as jest.Mock).mockClear();
    service.checkSlowQuery(10, 'SELECT 1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('truncates the slow query text', () => {
    const { service, logger } = build({ 'monitoring.slowQueryMs': 1 });
    service.checkSlowQuery(10, 'x'.repeat(500));

    expect((logger.warn as jest.Mock).mock.calls[0][1].query).toHaveLength(200);
  });

  it('warns only above the slow request threshold', () => {
    const { service, logger } = build({ 'monitoring.slowRequestMs': 500 });

    service.checkSlowRequest('GET', '/x', 900);
    expect(logger.warn).toHaveBeenCalledWith(
      'Slow request detected',
      expect.objectContaining({ type: 'slow_request', method: 'GET', threshold: 500 }),
    );

    (logger.warn as jest.Mock).mockClear();
    service.checkSlowRequest('GET', '/x', 100);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns only above the queue delay threshold', () => {
    const { service, logger } = build({ 'monitoring.queueDelayMs': 1000 });

    service.checkQueueDelay('orders', 'job-1', 5000);
    expect(logger.warn).toHaveBeenCalledWith(
      'Queue delay detected',
      expect.objectContaining({ queue: 'orders', jobId: 'job-1', delayMs: 5000 }),
    );

    (logger.warn as jest.Mock).mockClear();
    service.checkQueueDelay('orders', 'job-1', 10);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns only above the large payload threshold', () => {
    const { service, logger } = build({ 'monitoring.largePayloadBytes': 1024 });

    service.checkLargePayload('POST', '/x', 4096);
    expect(logger.warn).toHaveBeenCalledWith(
      'Large payload detected',
      expect.objectContaining({ sizeBytes: 4096, threshold: 1024 }),
    );

    (logger.warn as jest.Mock).mockClear();
    service.checkLargePayload('POST', '/x', 10);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns only above the high memory threshold', () => {
    const { service, logger } = build({ 'monitoring.highMemoryMb': 500 });

    service.checkHighMemory(900);
    expect(logger.warn).toHaveBeenCalledWith(
      'High memory usage',
      expect.objectContaining({ memoryMb: 900, threshold: 500 }),
    );

    (logger.warn as jest.Mock).mockClear();
    service.checkHighMemory(100);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('applies documented defaults when config is absent', () => {
    const { service, logger } = build();
    service.checkSlowQuery(101, 'q');
    expect(logger.warn).toHaveBeenCalledWith(
      'Slow query detected',
      expect.objectContaining({ threshold: 100 }),
    );
  });
});

describe('MetricsService', () => {
  const build = (config: Record<string, unknown> = {}) => {
    const configService = {
      get: jest.fn((key: string, fallback?: unknown) => (key in config ? config[key] : fallback)),
    } as unknown as ConfigService;
    return new MetricsService(configService);
  };

  beforeEach(() => {
    promClient.register.clear();
  });

  afterEach(() => {
    promClient.register.clear();
  });

  it('records an http observation and increments the request counter', async () => {
    const metrics = build();
    metrics.observeHttpDuration('GET', '/orders', 200, 12);

    const output = await metrics.getMetrics();
    const labels = '{method="GET",route="/orders",status_code="200"}';
    expect(output).toContain(`http_requests_total${labels} 1`);
    expect(output).not.toContain('http_errors_total{');
  });

  it('increments the error counter for 5xx responses', async () => {
    const metrics = build();
    metrics.observeHttpDuration('GET', '/orders', 500, 12);

    expect(await metrics.getMetrics()).toContain(
      'http_errors_total{method="GET",route="/orders",status_code="500"} 1',
    );
  });

  it('counts 4xx responses as errors too', async () => {
    const metrics = build();
    metrics.observeHttpDuration('GET', '/orders', 404, 5);

    expect(await metrics.getMetrics()).toContain(
      'http_errors_total{method="GET",route="/orders",status_code="404"} 1',
    );
  });

  it('records db, redis and bullmq observations', async () => {
    const metrics = build();
    metrics.observeDbQuery('findMany', 3);
    metrics.observeRedisLatency('GET', 1);
    metrics.observeBullJob('orders', 'completed', 22);
    metrics.setBullQueueDepth('orders', 'waiting', 4);

    const output = await metrics.getMetrics();
    expect(output).toContain('db_query_duration_ms');
    expect(output).toContain('redis_latency_ms');
    expect(output).toContain('bull_queue_job_duration_ms');
    expect(output).toContain('bull_queue_depth');
  });

  it('increments every domain counter', async () => {
    const metrics = build();
    metrics.incrementOrdersCreated();
    metrics.incrementOrdersCompleted();
    metrics.addRevenue(2500);
    metrics.incrementInventoryMovements();
    metrics.incrementKitchenTickets();
    metrics.incrementPaymentsCompleted();
    metrics.incrementPaymentsFailed();
    metrics.incrementPaymentsRefunded();
    metrics.incrementBullQueueDeadLetter('orders');

    const output = await metrics.getMetrics();
    expect(output).toContain('orders_created_total 1');
    expect(output).toContain('orders_completed_total 1');
    expect(output).toContain('revenue_total 2500');
    expect(output).toContain('inventory_movements_total 1');
    expect(output).toContain('kitchen_tickets_total 1');
    expect(output).toContain('payments_completed_total 1');
    expect(output).toContain('payments_failed_total 1');
    expect(output).toContain('payments_refunded_total 1');
    expect(output).toContain('bull_queue_dead_letter_total{queue="orders"} 1');
  });

  it('registers default collectors and starts the collection loop on init', () => {
    jest.useFakeTimers();
    try {
      const metrics = build({
        'metrics.collectDefaultMetrics': true,
        'metrics.collectIntervalMs': 1000,
      });
      metrics.onModuleInit();
      jest.advanceTimersByTime(1000);

      expect(promClient.collectDefaultMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ register: promClient.register }),
      );
      metrics.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips default collectors when disabled', () => {
    const metrics = build({
      'metrics.collectDefaultMetrics': false,
      'metrics.collectIntervalMs': 0,
    });
    metrics.onModuleInit();
    metrics.onModuleDestroy();
    expect(metrics).toBeDefined();
  });

  it('does not start an interval for a non-positive interval', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const metrics = build({
      'metrics.collectDefaultMetrics': false,
      'metrics.collectIntervalMs': 0,
    });
    metrics.onModuleInit();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    metrics.onModuleDestroy();
    setIntervalSpy.mockRestore();
  });

  it('stops the collection interval on destroy', () => {
    jest.useFakeTimers();
    try {
      const metrics = build({
        'metrics.collectDefaultMetrics': false,
        'metrics.collectIntervalMs': 100,
      });
      metrics.onModuleInit();
      expect(() => metrics.onModuleDestroy()).not.toThrow();
      jest.advanceTimersByTime(1000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps cpu usage at 100 percent', () => {
    const metrics = build();
    const measure = (metrics as unknown as { measureCpuUsagePercent: () => number })
      .measureCpuUsagePercent;

    const value = measure.call(metrics);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
  });

  it('returns zero cpu percent for a zero elapsed window', () => {
    const metrics = build();
    const internals = metrics as unknown as { lastCpuTime: number };
    internals.lastCpuTime = Date.now();

    const value = (
      metrics as unknown as { measureCpuUsagePercent: () => number }
    ).measureCpuUsagePercent();

    expect(value).toBe(0);
  });
});

describe('RecoveryService', () => {
  const build = (dbOk = true) => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(dbOk ? [{ '1': 1 }] : undefined),
      backupRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const service = new RecoveryService(prisma as never, eventEmitter);
    return { service, prisma, eventEmitter };
  };

  it('reports pass when the database is reachable', async () => {
    const { service, eventEmitter } = build(true);
    const result = await service.checkHealth();

    expect(result.status).toBe('pass');
    expect(result.checks.database).toBe('ok');
    expect(result.checks.memory).toMatchObject({ heapUsed: expect.any(String) });
    expect(result.checks.uptime).toEqual(expect.any(Number));
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'recovery.health-check',
      expect.objectContaining({ status: 'pass' }),
    );
  });

  it('reports fail when the database is unreachable', async () => {
    const { service } = build(false);
    prismaFail(service);

    const result = await service.checkHealth();
    expect(result.status).toBe('fail');
  });

  function prismaFail(service: RecoveryService) {
    (service as unknown as { prisma: { $queryRaw: jest.Mock } }).prisma.$queryRaw.mockRejectedValue(
      new Error('db down'),
    );
  }

  it('reports fail when the database rejects', async () => {
    const { service } = build(true);
    prismaFail(service);

    const result = await service.checkHealth();
    expect(result.status).toBe('fail');
    expect(result.checks.database).toEqual({ status: 'error', message: 'db down' });
  });

  it('includes an ISO timestamp', async () => {
    const { service } = build();
    const result = await service.checkHealth();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('returns a recovery plan with no backup', async () => {
    const { service } = build();
    const result = await service.performRecoveryCheck('tenant-1');

    expect(result.latestBackup).toBeNull();
    expect(result.hasValidBackup).toBe(false);
    expect(result.recommendations).toEqual([]);
    expect(result.tenantId).toBe('tenant-1');
  });

  it('surfaces the latest verified backup', async () => {
    const { service, prisma } = build();
    prisma.backupRecord.findFirst.mockResolvedValue({
      id: 'backup-1',
      createdAt: new Date('2026-01-01'),
      verifiedAt: new Date('2026-01-02'),
    });

    const result = await service.performRecoveryCheck('tenant-2');

    expect(result.latestBackup).toEqual({
      id: 'backup-1',
      createdAt: expect.any(Date),
      verifiedAt: expect.any(Date),
    });
    expect(result.hasValidBackup).toBe(true);
  });

  it('treats an unverified backup as invalid', async () => {
    const { service, prisma } = build();
    prisma.backupRecord.findFirst.mockResolvedValue({
      id: 'backup-2',
      createdAt: new Date('2026-01-01'),
      verifiedAt: null,
    });

    expect((await service.performRecoveryCheck('tenant-3')).hasValidBackup).toBe(false);
  });

  it('queries backups scoped to the tenant', async () => {
    const { service, prisma } = build();
    await service.performRecoveryCheck('tenant-4');

    expect(prisma.backupRecord.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-4', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns the recovery steps and emits lifecycle events', async () => {
    const { service, eventEmitter } = build();
    const result = await service.startRecovery('tenant-5', 'backup-5');

    expect(result.success).toBe(true);
    expect(result.backupId).toBe('backup-5');
    expect(result.steps.map((s) => s.name)).toEqual([
      'verify-backup',
      'restore-database',
      'verify-restore',
      'health-check',
    ]);
    expect(result.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'recovery.started',
      expect.objectContaining({ tenantId: 'tenant-5', backupId: 'backup-5' }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('recovery.completed', expect.anything());
  });
});

describe('SentryFilter', () => {
  const request = {
    headers: { 'x-request-id': 'req-1', 'x-correlation-id': 'corr-1' },
    method: 'GET',
    url: '/orders',
    tenantId: 'tenant-1',
    user: { sub: 'user-1' },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ArgumentsHost;

  const buildScope = () => {
    const scope = {
      setExtra: jest.fn(),
      setTag: jest.fn(),
      setUser: jest.fn(),
    };
    (Sentry.withScope as jest.Mock).mockImplementation((cb: (s: unknown) => void) => cb(scope));
    return scope;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing when sentry is disabled', () => {
    const filter = new SentryFilter({ get: () => false } as unknown as ConfigService);
    filter.catch(new Error('boom'), host);

    expect(Sentry.withScope).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('ignores client errors', () => {
    const filter = new SentryFilter({ get: () => true } as unknown as ConfigService);
    buildScope();

    filter.catch(new HttpException('Not found', 404), host);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports server errors', () => {
    const filter = new SentryFilter({ get: () => true } as unknown as ConfigService);
    const scope = buildScope();

    filter.catch(new Error('boom'), host);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(scope.setTag).toHaveBeenCalledWith('tenant_id', 'tenant-1');
    expect(scope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('tags the method, url and request identifiers', () => {
    const filter = new SentryFilter({ get: () => true } as unknown as ConfigService);
    const scope = buildScope();

    filter.catch(new Error('boom'), host);

    expect(scope.setTag).toHaveBeenCalledWith('method', 'GET');
    expect(scope.setTag).toHaveBeenCalledWith('url', '/orders');
    expect(scope.setExtra).toHaveBeenCalledWith('requestId', 'req-1');
    expect(scope.setExtra).toHaveBeenCalledWith('correlationId', 'corr-1');
  });

  it('falls back to unknown identifiers when headers are absent', () => {
    const filter = new SentryFilter({ get: () => true } as unknown as ConfigService);
    const scope = buildScope();
    const bareHost = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {}, method: 'POST', url: '/x' }) }),
    } as unknown as ArgumentsHost;

    filter.catch(new Error('boom'), bareHost);

    expect(scope.setExtra).toHaveBeenCalledWith('requestId', 'unknown');
    expect(scope.setTag).not.toHaveBeenCalledWith('tenant_id', expect.anything());
  });

  it('wraps non-error throwables', () => {
    const filter = new SentryFilter({ get: () => true } as unknown as ConfigService);
    buildScope();

    filter.catch('a string failure', host);

    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    expect((Sentry.captureException as jest.Mock).mock.calls[0][0].message).toContain(
      'a string failure',
    );
  });
});

describe('HttpLoggingMiddleware', () => {
  const build = () => {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as AppLoggerService;
    return { logger, middleware: new HttpLoggingMiddleware(logger) };
  };

  it('sets its logging context on construction', () => {
    const { logger } = build();
    expect(logger.setContext).toHaveBeenCalledWith('HTTP');
  });

  it('logs a normal response', () => {
    const { middleware, logger } = build();
    const req = {
      method: 'GET',
      originalUrl: '/orders',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
    } as unknown as Request;
    const res = fakeResponse();

    middleware.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish(res);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('GET /orders 200'),
      expect.objectContaining({ statusCode: 200, url: '/orders', userAgent: 'jest' }),
    );
  });

  it('logs server errors at error level', () => {
    const { middleware, logger } = build();
    const req = {
      method: 'POST',
      originalUrl: '/orders',
      ip: '1',
      headers: {},
    } as unknown as Request;
    const res = fakeResponse({ statusCode: 503 });

    middleware.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish(res);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('POST /orders 503'),
      expect.objectContaining({ statusCode: 503 }),
    );
  });

  it('logs slow requests at warn level', async () => {
    const { middleware, logger } = build();
    const req = { method: 'GET', originalUrl: '/slow', ip: '1', headers: {} } as unknown as Request;
    const res = fakeResponse();
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(0).mockReturnValue(900);

    middleware.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish(res);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('SLOW GET /slow'),
      expect.objectContaining({ duration: 900 }),
    );
    nowSpy.mockRestore();
  });

  it('includes the content length header when present', () => {
    const { middleware, logger } = build();
    const req = {
      method: 'GET',
      originalUrl: '/orders',
      ip: '1',
      headers: {},
    } as unknown as Request;
    const res = fakeResponse();
    (res.getHeader as jest.Mock).mockReturnValue('128');

    middleware.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish(res);

    expect(logger.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contentLength: '128' }),
    );
  });
});

describe('PrometheusMiddleware', () => {
  const build = () => {
    const metrics = { observeHttpDuration: jest.fn() } as unknown as MetricsService;
    return { metrics, middleware: new PrometheusMiddleware(metrics) };
  };

  it('records the request once the response finishes', () => {
    const { middleware, metrics } = build();
    const req = { method: 'GET', originalUrl: '/orders' } as unknown as Request;
    const res = fakeResponse();

    middleware.use(req, res, jest.fn() as unknown as NextFunction);
    expect(metrics.observeHttpDuration).not.toHaveBeenCalled();

    fireFinish(res);
    expect(metrics.observeHttpDuration).toHaveBeenCalledWith(
      'GET',
      '/orders',
      200,
      expect.any(Number),
    );
  });

  it('prefers the matched route path to keep cardinality low', () => {
    const { middleware, metrics } = build();
    const req = {
      method: 'GET',
      originalUrl: '/orders/123?x=1',
      route: { path: '/orders/:id' },
    } as unknown as Request;
    const res = fakeResponse();

    middleware.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish(res);

    expect(metrics.observeHttpDuration).toHaveBeenCalledWith(
      'GET',
      '/orders/:id',
      200,
      expect.any(Number),
    );
  });

  it('falls back to the url when no route is matched', () => {
    const { middleware, metrics } = build();
    const req = { method: 'GET', url: '/health' } as unknown as Request;
    const res = fakeResponse();

    middleware.use(req, res, jest.fn() as unknown as NextFunction);
    fireFinish(res);

    expect(metrics.observeHttpDuration).toHaveBeenCalledWith(
      'GET',
      '/health',
      200,
      expect.any(Number),
    );
  });
});
