import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AuditLogInterceptor } from '../audit-log.interceptor';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogInterceptor],
    }).compile();

    interceptor = module.get<AuditLogInterceptor>(AuditLogInterceptor);
  });

  function createMockContext(
    user?: { id: string; role: string; tenantId?: string },
    method = 'GET',
    url = '/api/v1/test',
  ) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url,
          user,
          ip: '127.0.0.1',
          headers: { 'user-agent': 'test-agent' },
        }),
        getResponse: () => ({
          statusCode: 200,
          setHeader: jest.fn(),
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  }

  it('should log request with user info', (done) => {
    const context = createMockContext(
      { id: 'user-1', role: 'OWNER', tenantId: 'tenant-1' },
      'POST',
      '/api/v1/orders',
    );
    const next: CallHandler = { handle: () => of('response') };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        done();
      },
    });
  });

  it('should handle request without user', (done) => {
    const context = createMockContext(undefined, 'GET', '/api/v1/health');
    const next: CallHandler = { handle: () => of('ok') };

    interceptor.intercept(context, next).subscribe({
      next: (value) => {
        expect(value).toBe('ok');
        done();
      },
    });
  });

  it('should log errors', (done) => {
    const context = createMockContext(
      { id: 'user-1', role: 'OWNER', tenantId: 'tenant-1' },
      'POST',
      '/api/v1/orders',
    );
    const testError = new Error('Something failed');
    const next: CallHandler = { handle: () => throwError(() => testError) };

    interceptor.intercept(context, next).subscribe({
      error: (error) => {
        expect(error).toBe(testError);
        done();
      },
    });
  });

  it('should handle response from handler', (done) => {
    const context = createMockContext(
      { id: 'user-1', role: 'MANAGER', tenantId: 'tenant-1' },
      'PUT',
      '/api/v1/orders/1',
    );
    const expectedResponse = { id: 'order-1', status: 'updated' };
    const next: CallHandler = { handle: () => of(expectedResponse) };

    interceptor.intercept(context, next).subscribe({
      next: (value) => {
        expect(value).toEqual(expectedResponse);
        done();
      },
    });
  });
});
