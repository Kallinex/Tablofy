import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantBodyGuard } from '../tenant-body.guard';

describe('TenantBodyGuard', () => {
  let guard: TenantBodyGuard;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantBodyGuard],
    }).compile();

    guard = module.get<TenantBodyGuard>(TenantBodyGuard);
  });

  function mockContext(user?: { tenantId?: string }, body?: unknown, query?: unknown) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          body,
          query,
        }),
      }),
    } as never;
  }

  it('should allow when there is no authenticated user', () => {
    const result = guard.canActivate(mockContext(undefined));
    expect(result).toBe(true);
  });

  it('should allow when body tenantId matches the JWT tenantId', () => {
    const result = guard.canActivate(
      mockContext({ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', name: 'x' }),
    );
    expect(result).toBe(true);
  });

  it('should reject when body tenantId differs from the JWT tenantId', () => {
    expect(() =>
      guard.canActivate(mockContext({ tenantId: 'tenant-1' }, { tenantId: 'tenant-2' })),
    ).toThrow(ForbiddenException);
  });

  it('should allow when query tenantId matches the JWT tenantId', () => {
    const result = guard.canActivate(
      mockContext({ tenantId: 'tenant-1' }, {}, { tenantId: 'tenant-1' }),
    );
    expect(result).toBe(true);
  });

  it('should reject when query tenantId differs from the JWT tenantId', () => {
    expect(() =>
      guard.canActivate(mockContext({ tenantId: 'tenant-1' }, {}, { tenantId: 'tenant-2' })),
    ).toThrow(ForbiddenException);
  });

  it('should allow when no tenantId is present in body or query', () => {
    const result = guard.canActivate(mockContext({ tenantId: 'tenant-1' }, { name: 'x' }, {}));
    expect(result).toBe(true);
  });
});
