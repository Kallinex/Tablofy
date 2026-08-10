import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError, Observable } from 'rxjs';
import { AuditLogInterceptor } from '../audit-log.interceptor';
import { AppLoggerService } from '../../logger/logger.service';
import { AuditLogsService } from '../../../modules/audit-logs/audit-logs.service';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let logger: { setContext: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let auditLogsService: { log: jest.Mock };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogInterceptor,
        {
          provide: AppLoggerService,
          useValue: { setContext: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        {
          provide: AuditLogsService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    interceptor = module.get<AuditLogInterceptor>(AuditLogInterceptor);
    logger = module.get(AppLoggerService);
    auditLogsService = module.get(AuditLogsService);
  });

  function mockContext(overrides: {
    method?: string;
    url?: string;
    route?: unknown;
    user?: { id?: string; tenantId?: string } | null;
    headers?: Record<string, string>;
    statusCode?: number;
    ip?: string;
  }) {
    const request = {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? '/api/v1/test',
      route: overrides.route ?? { path: '/api/v1/test' },
      user: overrides.user ?? undefined,
      headers: overrides.headers ?? {},
      ip: overrides.ip ?? '127.0.0.1',
    };
    const response = { statusCode: overrides.statusCode ?? 200 };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as ExecutionContext;
  }

  function callHandlerWith(value: unknown): CallHandler {
    return { handle: () => of(value) as Observable<unknown> };
  }

  function callHandlerWithError(): CallHandler {
    return { handle: () => throwError(() => new Error('boom')) as Observable<unknown> };
  }

  it('should log an audit entry for a non-GET success request with user context', async () => {
    const ctx = mockContext({
      method: 'POST',
      user: { id: 'user-1', tenantId: 'tenant-1' },
      headers: { 'x-request-id': 'req-1', 'x-correlation-id': 'corr-1' },
      ip: '10.0.0.5',
    });

    await interceptor.intercept(ctx, callHandlerWith({ ok: true })).toPromise();

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    const entry = auditLogsService.log.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'POST /api/v1/test',
      resource: '/api/v1/test',
      userId: 'user-1',
      tenantId: 'tenant-1',
      ipAddress: '10.0.0.5',
      requestId: 'req-1',
      correlationId: 'corr-1',
    });
  });

  it('should not write an audit entry for a GET request', async () => {
    const ctx = mockContext({ method: 'GET' });

    await interceptor.intercept(ctx, callHandlerWith({})).toPromise();

    expect(auditLogsService.log).not.toHaveBeenCalled();
  });

  it('should warn on slow requests', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(3000);
    const ctx = mockContext({ method: 'GET' });

    await interceptor.intercept(ctx, callHandlerWith({})).toPromise();

    expect(logger.warn).toHaveBeenCalledWith(
      'Slow request',
      expect.objectContaining({ duration: 2000 }),
    );
    nowSpy.mockRestore();
  });

  it('should detect browsers from the user-agent', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1500);
    const ctx = mockContext({
      method: 'DELETE',
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile' },
    });

    await interceptor.intercept(ctx, callHandlerWith({})).toPromise();

    const entry = auditLogsService.log.mock.calls[0][0];
    expect(entry.browser).toBe('Chrome');
    expect(entry.device).toBe('mobile');
    nowSpy.mockRestore();
  });

  it('should default unknown user-agents to curl/desktop', async () => {
    const ctx = mockContext({
      method: 'PUT',
      headers: { 'user-agent': 'curl/8.0' },
    });

    await interceptor.intercept(ctx, callHandlerWith({})).toPromise();

    const entry = auditLogsService.log.mock.calls[0][0];
    expect(entry.browser).toBe('curl');
    expect(entry.device).toBe('desktop');
  });

  it('should handle tablet devices and fallback route path', async () => {
    const ctx = mockContext({
      method: 'PATCH',
      route: undefined,
      headers: { 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 16_0) AppleWebKit Safari' },
    });

    await interceptor.intercept(ctx, callHandlerWith({})).toPromise();

    const entry = auditLogsService.log.mock.calls[0][0];
    expect(entry.resource).toBe(ctx.switchToHttp().getRequest().url);
    expect(entry.browser).toBe('Safari');
    expect(entry.device).toBe('tablet');
  });

  it('should detect Edge and Firefox browsers from the user-agent', async () => {
    const edgeCtx = mockContext({
      method: 'DELETE',
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120.0' },
    });
    await interceptor.intercept(edgeCtx, callHandlerWith({})).toPromise();
    expect(auditLogsService.log.mock.calls[0][0].browser).toBe('Edge');

    const firefoxCtx = mockContext({
      method: 'DELETE',
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
      },
    });
    await interceptor.intercept(firefoxCtx, callHandlerWith({})).toPromise();
    expect(auditLogsService.log.mock.calls[1][0].browser).toBe('Firefox');
  });

  it('should log errors, write an audit entry, and rethrow', async () => {
    const ctx = mockContext({ method: 'POST', user: { id: 'user-1' } });

    await expect(interceptor.intercept(ctx, callHandlerWithError()).toPromise()).rejects.toThrow(
      'boom',
    );

    expect(logger.error).toHaveBeenCalledWith(
      'Request failed',
      expect.objectContaining({ error: 'boom' }),
    );
    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
  });

  it('should stringify non-Error thrown values', async () => {
    const handler: CallHandler = {
      handle: () => throwError(() => 'plain string error') as Observable<unknown>,
    };
    const ctx = mockContext({ method: 'POST' });

    await expect(interceptor.intercept(ctx, handler).toPromise()).rejects.toBe(
      'plain string error',
    );

    expect(logger.error).toHaveBeenCalledWith(
      'Request failed',
      expect.objectContaining({ error: 'plain string error' }),
    );
  });

  it('should swallow audit log write failures', async () => {
    auditLogsService.log.mockRejectedValueOnce(new Error('db down'));
    const ctx = mockContext({ method: 'POST' });

    await expect(interceptor.intercept(ctx, callHandlerWith({})).toPromise()).resolves.toEqual({});

    auditLogsService.log.mockResolvedValue(undefined);
  });

  it('should swallow audit log write failures in the error path', async () => {
    auditLogsService.log.mockRejectedValueOnce(new Error('db down'));
    const ctx = mockContext({ method: 'POST' });

    await expect(interceptor.intercept(ctx, callHandlerWithError()).toPromise()).rejects.toThrow(
      'boom',
    );

    auditLogsService.log.mockResolvedValue(undefined);
  });
});
