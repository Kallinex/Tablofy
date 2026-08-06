import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get(Reflector) as jest.Mocked<Reflector>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockMetadata(roles?: string[] | null, permissions?: string[] | null) {
    reflector.getAllAndOverride
      .mockReturnValueOnce(roles ?? null)
      .mockReturnValueOnce(permissions ?? null);
  }

  function createMockContext(role?: string) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: role ? { id: 'user-1', role } : undefined,
        }),
      }),
    } as unknown as Parameters<typeof guard.canActivate>[0];
  }

  it('should allow access when no roles or permissions are required', () => {
    mockMetadata(null, null);
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow access when user has required role', () => {
    mockMetadata(['OWNER', 'MANAGER'], null);
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow access when user has any of the required roles', () => {
    mockMetadata(['OWNER', 'MANAGER'], null);
    const context = createMockContext('MANAGER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny access when user does not have required role', () => {
    mockMetadata(['OWNER'], null);
    const context = createMockContext('CASHIER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when no user on request', () => {
    mockMetadata(['OWNER'], null);
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should return true for empty roles list', () => {
    mockMetadata([], []);
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow access when permissions are granted', () => {
    mockMetadata(['OWNER'], ['orders:delete']);
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny access when permissions are not granted even if role matches', () => {
    mockMetadata(['OWNER'], ['orders:delete']);
    const context = createMockContext('CASHIER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when a required permission is missing from the role', () => {
    mockMetadata(null, ['users:manage']);
    const context = createMockContext('VIEWER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
