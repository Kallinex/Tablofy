import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { TenantGuard } from '../tenant.guard';

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get<TenantGuard>(TenantGuard);
    reflector = module.get(Reflector) as jest.Mocked<Reflector>;
  });

  function createMockContext(user?: Record<string, unknown>, params?: Record<string, unknown>) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params: params ?? {},
        }),
      }),
    } as unknown as Parameters<typeof guard.canActivate>[0];
  }

  it('should skip tenant check when decorator is set', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = createMockContext();

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow SUPER_ADMIN without tenantId', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext({ id: 'admin-1', role: 'SUPER_ADMIN' });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow user with valid tenantId', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext({
      id: 'user-1',
      role: 'OWNER',
      tenantId: 'tenant-1',
    });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny when no user on request', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny when user has no tenantId and is not SUPER_ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext({ id: 'user-1', role: 'STAFF', tenantId: null });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny when tenantId in params does not match user tenantId', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext(
      { id: 'user-1', role: 'OWNER', tenantId: 'tenant-1' },
      { tenantId: 'tenant-2' },
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
