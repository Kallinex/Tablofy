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

  // getAllAndOverride is keyed by metadata key, so an implementation lookup
  // is immune to early-return branches that skip some lookups.
  function mockMetadata(opts: {
    isPublic?: boolean;
    roles?: string[] | null;
    permissions?: string[] | null;
    anyAuthenticated?: boolean;
  }) {
    const map: Record<string, unknown> = {
      isPublic: opts.isPublic ?? false,
      roles: opts.roles ?? null,
      permissions: opts.permissions ?? null,
      anyAuthenticated: opts.anyAuthenticated ?? false,
    };
    reflector.getAllAndOverride.mockImplementation((key: string) => map[key]);
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

  it('should deny access by default when no auth metadata is present (fail-closed)', () => {
    mockMetadata({});
    const context = createMockContext('OWNER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when no auth metadata and no user (fail-closed)', () => {
    mockMetadata({});
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access for an empty roles list without other auth metadata (fail-closed)', () => {
    mockMetadata({ roles: [], permissions: [] });
    const context = createMockContext('OWNER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow access when handler is marked @Public()', () => {
    mockMetadata({ isPublic: true });
    const context = createMockContext();

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow authenticated user through @Authenticated()', () => {
    mockMetadata({ anyAuthenticated: true });
    const context = createMockContext('CASHIER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny @Authenticated() route when no user is present', () => {
    mockMetadata({ anyAuthenticated: true });
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow access when user has required role', () => {
    mockMetadata({ roles: ['OWNER', 'MANAGER'] });
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow access when user has any of the required roles', () => {
    mockMetadata({ roles: ['OWNER', 'MANAGER'] });
    const context = createMockContext('MANAGER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny access when user does not have required role', () => {
    mockMetadata({ roles: ['OWNER'] });
    const context = createMockContext('CASHIER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when no user on request', () => {
    mockMetadata({ roles: ['OWNER'] });
    const context = createMockContext();

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow access when permissions are granted', () => {
    mockMetadata({ roles: ['OWNER'], permissions: ['orders:delete'] });
    const context = createMockContext('OWNER');

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should deny access when permissions are not granted even if role matches', () => {
    mockMetadata({ roles: ['OWNER'], permissions: ['orders:delete'] });
    const context = createMockContext('CASHIER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should deny access when a required permission is missing from the role', () => {
    mockMetadata({ permissions: ['users:manage'] });
    const context = createMockContext('VIEWER');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
