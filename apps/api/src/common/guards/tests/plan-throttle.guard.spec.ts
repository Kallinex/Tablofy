import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PlanThrottleGuard } from '../plan-throttle.guard';
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
