import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  PLAN_THROTTLE_KEY,
  PlanThrottleGuard,
  SkipPlanThrottle,
  apiKeyBucketId,
} from '../plan-throttle.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockRedis, MockRedis } from '../../../test/mocks/redis.mock';

/** Returns the caller-supplied default, which keeps the guard on its built-in limits. */
const passthroughConfig: ConfigService = {
  get: (key: string, defaultValue?: unknown) => defaultValue,
} as unknown as ConfigService;

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) => (key in values ? values[key] : defaultValue),
  } as unknown as ConfigService;
}

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
        { provide: ConfigService, useValue: passthroughConfig },
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
    headers?: Record<string, unknown>,
  ) {
    const responseMock = { setHeader: jest.fn() };
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user, url, ip, headers }),
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
        { provide: ConfigService, useValue: passthroughConfig },
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

describe('PlanThrottleGuard configurable limits', () => {
  let guard: PlanThrottleGuard;
  let prisma: MockPrisma;
  let redis: MockRedis;
  let reflector: jest.Mocked<Reflector>;

  async function buildGuard(config: ConfigService): Promise<void> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanThrottleGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn(() => false) } },
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: RedisService, useValue: createMockRedis() },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    guard = module.get<PlanThrottleGuard>(PlanThrottleGuard);
    prisma = module.get(PrismaService) as MockPrisma;
    redis = module.get(RedisService) as MockRedis;
    reflector = module.get(Reflector) as jest.Mocked<Reflector>;
    prisma.reset();
    redis.reset();
    reflector.getAllAndOverride.mockReturnValue(false);
  }

  function context(headers?: Record<string, unknown>, tenantId: string | null = 'tenant-1') {
    const response = { setHeader: jest.fn() };
    return {
      response,
      ctx: {
        getHandler: () =>
          function handler() {
            return undefined;
          },
        getClass: () => class Controller {},
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 'u', tenantId, role: 'OWNER' },
            url: '/api/v1/test',
            ip: '10.0.0.1',
            headers,
          }),
          getResponse: () => response,
        }),
      } as unknown as Parameters<typeof guard.canActivate>[0],
    };
  }

  it('uses the configured per-plan limit instead of the built-in default', async () => {
    await buildGuard(configWith({ 'throttle.planLimits': { FREE: 5, ENTERPRISE: 900 } }));
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    redis.incrementCounter.mockResolvedValue(5);

    const { ctx, response } = context();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('blocks once the configured per-plan limit is exceeded', async () => {
    await buildGuard(configWith({ 'throttle.planLimits': { FREE: 5 } }));
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    redis.incrementCounter.mockResolvedValue(6);

    await expect(guard.canActivate(context().ctx)).rejects.toThrow(HttpException);
  });

  it('uses the configured unauthenticated limit', async () => {
    await buildGuard(configWith({ 'throttle.unauthenticatedLimit': 7 }));
    redis.incrementCounter.mockResolvedValue(8);

    await expect(guard.canActivate(context(undefined, null).ctx)).rejects.toThrow(HttpException);
  });

  it('uses the configured plan window for the redis TTL', async () => {
    await buildGuard(configWith({ 'throttle.planWindowSeconds': 15 }));
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    redis.incrementCounter.mockResolvedValue(1);

    await guard.canActivate(context().ctx);

    expect(redis.incrementCounter).toHaveBeenCalledWith(
      'ratelimit:tenant:tenant-1:/api/v1/test',
      15,
    );
  });
});

describe('PlanThrottleGuard per-API-key limiting', () => {
  const rawKey = 'tab_averysecretapikeyvalue000000000000';
  const keyId = createHash('sha256').update(rawKey).digest('hex').slice(0, 32);

  let guard: PlanThrottleGuard;
  let prisma: MockPrisma;
  let redis: MockRedis;

  async function buildGuard(config: ConfigService = passthroughConfig): Promise<void> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanThrottleGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn(() => false) } },
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: RedisService, useValue: createMockRedis() },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    guard = module.get<PlanThrottleGuard>(PlanThrottleGuard);
    prisma = module.get(PrismaService) as MockPrisma;
    redis = module.get(RedisService) as MockRedis;
    prisma.reset();
    redis.reset();
  }

  function context(headers: Record<string, unknown> | undefined) {
    const response = { setHeader: jest.fn() };
    return {
      response,
      ctx: {
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
            headers,
          }),
          getResponse: () => response,
        }),
      } as unknown as Parameters<typeof guard.canActivate>[0],
    };
  }

  it('adds a per-key bucket on top of the tenant bucket', async () => {
    await buildGuard();
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'ENTERPRISE' });
    redis.incrementCounter.mockResolvedValue(1);

    await expect(
      guard.canActivate(context({ authorization: `ApiKey ${rawKey}` }).ctx),
    ).resolves.toBe(true);

    expect(redis.incrementCounter).toHaveBeenCalledWith(
      `ratelimit:apikey:${keyId}:/api/v1/test`,
      60,
    );
    expect(redis.incrementCounter).toHaveBeenCalledWith(
      'ratelimit:tenant:tenant-1:/api/v1/test',
      60,
    );
  });

  it('never writes the raw API key into the redis key', async () => {
    await buildGuard();
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    redis.incrementCounter.mockResolvedValue(1);

    await guard.canActivate(context({ authorization: `ApiKey ${rawKey}` }).ctx);

    const usedKeys = redis.incrementCounter.mock.calls.map((call) => call[0] as string);
    expect(usedKeys).not.toContainEqual(expect.stringContaining(rawKey));
  });

  it('blocks a key that exceeds its own budget before the tenant budget is charged', async () => {
    await buildGuard(configWith({ 'throttle.apiKeyLimit': 3 }));
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'ENTERPRISE' });
    redis.incrementCounter.mockResolvedValue(4);

    await expect(
      guard.canActivate(context({ authorization: `ApiKey ${rawKey}` }).ctx),
    ).rejects.toThrow(HttpException);

    const usedKeys = redis.incrementCounter.mock.calls.map((call) => call[0] as string);
    expect(usedKeys.some((key) => key.startsWith('ratelimit:tenant:'))).toBe(false);
  });

  it('uses the configured per-key window', async () => {
    await buildGuard(configWith({ 'throttle.apiKeyWindowSeconds': 30 }));
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    redis.incrementCounter.mockResolvedValue(1);

    await guard.canActivate(context({ authorization: `ApiKey ${rawKey}` }).ctx);

    expect(redis.incrementCounter).toHaveBeenCalledWith(
      `ratelimit:apikey:${keyId}:/api/v1/test`,
      30,
    );
  });

  it('skips the per-key bucket when per-key limiting is disabled', async () => {
    await buildGuard(configWith({ 'throttle.apiKeyEnabled': false }));
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    redis.incrementCounter.mockResolvedValue(1);

    await guard.canActivate(context({ authorization: `ApiKey ${rawKey}` }).ctx);

    const usedKeys = redis.incrementCounter.mock.calls.map((call) => call[0] as string);
    expect(usedKeys.some((key) => key.startsWith('ratelimit:apikey:'))).toBe(false);
  });

  it('does not add a per-key bucket for bearer-authenticated requests', async () => {
    await buildGuard();
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    redis.incrementCounter.mockResolvedValue(1);

    await guard.canActivate(context({ authorization: 'Bearer some-jwt' }).ctx);

    const usedKeys = redis.incrementCounter.mock.calls.map((call) => call[0] as string);
    expect(usedKeys.some((key) => key.startsWith('ratelimit:apikey:'))).toBe(false);
  });
});

describe('apiKeyBucketId', () => {
  it('returns a stable digest for an ApiKey authorization header', () => {
    const digest = apiKeyBucketId({ authorization: 'ApiKey tab_abc123' });

    expect(digest).toHaveLength(32);
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    expect(apiKeyBucketId({ authorization: 'ApiKey tab_abc123' })).toBe(digest);
  });

  it('produces different buckets for different keys', () => {
    expect(apiKeyBucketId({ authorization: 'ApiKey tab_one' })).not.toBe(
      apiKeyBucketId({ authorization: 'ApiKey tab_two' }),
    );
  });

  it('ignores other schemes, missing headers and malformed values', () => {
    expect(apiKeyBucketId(undefined)).toBeNull();
    expect(apiKeyBucketId({})).toBeNull();
    expect(apiKeyBucketId({ authorization: 'Bearer tab_abc' })).toBeNull();
    expect(apiKeyBucketId({ authorization: 'ApiKey' })).toBeNull();
    expect(apiKeyBucketId({ authorization: 'ApiKey   ' })).toBeNull();
    expect(apiKeyBucketId({ authorization: 12345 })).toBeNull();
  });
});
