import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';

jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => {
    return class MockBaseGuard {
      canActivate() {
        return true;
      }
      handleRequest<TUser>(err: Error | null, user: TUser | null): TUser {
        if (err || !user) {
          throw err ?? new UnauthorizedException('Invalid or expired token');
        }
        return user;
      }
    };
  },
  PassportStrategy: jest.fn(),
}));

import { JwtAuthGuard } from '../jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get(Reflector) as jest.Mocked<Reflector>;
  });

  function createMockContext(overrides: Record<string, unknown> = {}) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: overrides.user ?? { id: 'user-1' },
          ...overrides,
        }),
        getResponse: () => ({
          setHeader: jest.fn(),
          getHeaders: jest.fn(() => ({})),
          header: jest.fn(),
        }),
      }),
    } as unknown as Parameters<typeof guard.canActivate>[0];
  }

  it('should allow access when route is public', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = createMockContext();

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should delegate to Passport strategy when not public', () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    const context = createMockContext();
    const result = guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('should check IS_PUBLIC_KEY on handler and class', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = createMockContext();

    guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
  });

  it('should throw UnauthorizedException when no user in handleRequest', () => {
    expect(() => {
      guard.handleRequest(null, null, {} as never, {} as never);
    }).toThrow(UnauthorizedException);
  });

  it('should throw error from Passport in handleRequest', () => {
    expect(() => {
      guard.handleRequest(new Error('Token expired'), null, {} as never, {} as never);
    }).toThrow('Token expired');
  });

  it('should return user when valid in handleRequest', () => {
    const user = { id: 'user-1', role: 'OWNER' };
    const result = guard.handleRequest(null, user, {} as never, {} as never);

    expect(result).toBe(user);
  });
});
