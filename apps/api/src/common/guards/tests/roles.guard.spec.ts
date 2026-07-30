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

  it('should allow access when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow access when user has required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['OWNER', 'MANAGER']);
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow access when user has any of the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue(['OWNER', 'MANAGER']);
    const context = createMockContext('MANAGER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny access when user does not have required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['OWNER']);
    const context = createMockContext('CASHIER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when no user on request', () => {
    reflector.getAllAndOverride.mockReturnValue(['OWNER']);
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should return empty array for empty roles list', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });
});
