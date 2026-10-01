import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PLAN_THROTTLE_KEY, PlanThrottleGuard, SkipPlanThrottle } from '../plan-throttle.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockRedis, MockRedis } from '../../../test/mocks/redis.mock';

describe('PlanThrottleGuard', () => {
  let guard: PlanThrottleGuard;
  let prisma: MockPrisma;
  let redis: MockRedis;
  let reflector: jest.Mocked<Reflector>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanThrottleGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: RedisService, useValue: createMockRedis() },
      ],
    }).compile();

    guard = module.get<PlanThrottleGuard>(PlanThrottleGuard);
    prisma = module.get(PrismaService) as MockPrisma;
    redis = module.get(RedisService) as MockRedis;
    reflector = module.get(Reflector) as jest.Mocked<Reflector>;
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
    jest.clearAllMocks();
  });

  function createMockContext(
    user?: { id: string; tenantId: string | null; role: string },
    url = '/api/v1/test',
    ip = '127.0.0.1',
  ) {
    const responseMock = { setHeader: jest.fn() };
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user, url, ip }),
        getResponse: () => responseMock,
      }),
    } as unknown as Parameters<typeof guard.canActivate>[0];
  }

  it('should allow request under unauthenticated limit', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    redis.incrementCounter.mockResolvedValue(1);
    const context = createMockContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should block request exceeding unauthenticated limit', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    redis.incrementCounter.mockResolvedValue(101);
    const context = createMockContext();

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    await expect(guard.canActivate(context)).rejects.toThrow(
      expect.objectContaining({ status: HttpStatus.TOO_MANY_REQUESTS }),
    );
  });

  it('should use plan-specific limits for authenticated users', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    redis.incrementCounter.mockResolvedValue(1);
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'ENTERPRISE' });

    const context = createMockContext({
      id: 'user-1',
      tenantId: 'tenant-1',
      role: 'OWNER',
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
    );
  });

  it('should set rate limit headers on response', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    redis.incrementCounter.mockResolvedValue(5);
    const context = createMockContext();

    await guard.canActivate(context);

    const response = context.switchToHttp().getResponse() as jest.Mocked<{ setHeader: jest.Mock }>;
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '95');
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
  });
});

describe('SkipPlanThrottle', () => {
  it('sets the plan throttle metadata so the guard can honour it', () => {
    class Exempt {
      @SkipPlanThrottle()
      handler(): number {
        return 1;
      }
    }

    expect(Reflect.getMetadata(PLAN_THROTTLE_KEY, Exempt.prototype.handler)).toBe(true);
  });

  it('leaves undecorated handlers without the exemption metadata', () => {
    class Throttled {
      handler(): number {
        return 1;
      }
    }

    expect(Reflect.getMetadata(PLAN_THROTTLE_KEY, Throttled.prototype.handler)).toBeUndefined();
  });
});

describe('PlanThrottleGuard exemptions and plan fallbacks', () => {
  let guard: PlanThrottleGuard;
  let prisma: MockPrisma;
  let redis: MockRedis;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanThrottleGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: RedisService, useValue: createMockRedis() },
      ],
    }).compile();

    guard = module.get<PlanThrottleGuard>(PlanThrottleGuard);
    prisma = module.get(PrismaService) as MockPrisma;
    redis = module.get(RedisService) as MockRedis;
    reflector = module.get(Reflector) as jest.Mocked<Reflector>;
    prisma.reset();
    redis.reset();
    reflector.getAllAndOverride.mockReturnValue(false);
  });

  function contextWith(user?: { id: string; tenantId: string | null; role: string }) {
    const responseMock = { setHeader: jest.fn() };
    return {
      getHandler: () =>
        function handler() {
          return undefined;
        },
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => ({ user, url: '/api/v1/test', ip: '10.0.0.1' }),
        getResponse: () => responseMock,
      }),
    } as unknown as Parameters<typeof guard.canActivate>[0];
  }

  it('lets an annotated handler through without touching redis or prisma', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(contextWith())).resolves.toBe(true);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(PLAN_THROTTLE_KEY, expect.any(Array));
    expect(redis.incrementCounter).not.toHaveBeenCalled();
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the FREE limit when the tenant has no subscription', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    redis.incrementCounter.mockResolvedValue(31);

    await expect(
      guard.canActivate(contextWith({ id: 'u', tenantId: 'tenant-1', role: 'OWNER' })),
    ).rejects.toThrow(HttpException);
  });

  it('falls back to the FREE limit for an unknown plan value', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'NOT_A_PLAN' });
    redis.incrementCounter.mockResolvedValue(30);

    const response = { setHeader: jest.fn() };
    const context = {
      getHandler: () =>
        function handler() {
          return undefined;
        },
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'u', tenantId: 'tenant-1', role: 'OWNER' },
          url: '/api/v1/test',
          ip: '10.0.0.1',
        }),
        getResponse: () => response,
      }),
    } as unknown as Parameters<typeof guard.canActivate>[0];

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '30');
  });

  it('keys unauthenticated traffic by IP address', async () => {
    redis.incrementCounter.mockResolvedValue(1);

    await guard.canActivate(contextWith());

    expect(redis.incrementCounter).toHaveBeenCalledWith('ratelimit:ip:10.0.0.1:/api/v1/test', 60);
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('keys tenant traffic by tenant id and reports a zero remaining budget at the limit', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    redis.incrementCounter.mockResolvedValue(30);

    const response = { setHeader: jest.fn() };
    const context = {
      getHandler: () =>
        function handler() {
          return undefined;
        },
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'u', tenantId: 'tenant-1', role: 'OWNER' },
          url: '/api/v1/test',
          ip: '10.0.0.1',
        }),
        getResponse: () => response,
      }),
    } as unknown as Parameters<typeof guard.canActivate>[0];

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.incrementCounter).toHaveBeenCalledWith(
      'ratelimit:tenant:tenant-1:/api/v1/test',
      60,
    );
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('ignores an authenticated user without a tenant and keys by IP', async () => {
    redis.incrementCounter.mockResolvedValue(1);

    await guard.canActivate(contextWith({ id: 'u', tenantId: null, role: 'STAFF' }));

    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(redis.incrementCounter).toHaveBeenCalledWith('ratelimit:ip:10.0.0.1:/api/v1/test', 60);
  });
});
