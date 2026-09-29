import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthController } from '../health.controller';
import { PrismaHealthIndicator } from '../prisma-health.indicator';
import { RedisHealthIndicator } from '../redis-health.indicator';
import { BullHealthIndicator } from '../bull-health.indicator';
import { DiskHealthIndicator } from '../disk-health.indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;

  const buildController = (
    checkRSS: jest.Mock,
    rssLimitMb: number | undefined,
  ): HealthController => {
    const runIndicators = jest.fn(async (indicators: (() => Promise<unknown>)[]) => {
      for (const indicator of indicators) await indicator();
      return { status: 'ok' };
    });
    return new HealthController(
      { check: runIndicators } as unknown as HealthCheckService,
      { isHealthy: jest.fn() } as unknown as PrismaHealthIndicator,
      { isHealthy: jest.fn() } as unknown as RedisHealthIndicator,
      { checkRSS } as unknown as MemoryHealthIndicator,
      { isHealthy: jest.fn() } as unknown as BullHealthIndicator,
      { isHealthy: jest.fn() } as unknown as DiskHealthIndicator,
      { get: jest.fn().mockReturnValue(rssLimitMb) } as unknown as ConfigService,
    );
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn().mockResolvedValue({
              status: 'ok',
              info: {
                database: { status: 'up' },
                redis: { status: 'up' },
                memory: { status: 'up' },
                bullmq: { status: 'up' },
                disk: { status: 'up' },
              },
            }),
          },
        },
        {
          provide: PrismaHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: RedisHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: MemoryHealthIndicator,
          useValue: { checkRSS: jest.fn() },
        },
        {
          provide: BullHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: DiskHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get(HealthCheckService) as jest.Mocked<HealthCheckService>;
  });

  it('should return health check result', async () => {
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(healthCheckService.check).toHaveBeenCalled();
    expect(healthCheckService.check).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Function), expect.any(Function), expect.any(Function)]),
    );
  });

  it('should include database, redis, memory, bullmq and disk checks', async () => {
    await controller.check();

    const checkCall = healthCheckService.check.mock.calls[0][0];
    expect(checkCall).toHaveLength(5);
  });

  it('should fall back to a 300MB RSS limit when the config value is missing', async () => {
    const checkRSS = jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } });
    const ctrl = buildController(checkRSS, undefined);

    await ctrl.ready();

    expect(checkRSS).toHaveBeenCalledWith('memory_rss', 300 * 1024 * 1024);
  });

  it('should size the RSS limit from HEALTH_MEMORY_RSS_LIMIT_MB', async () => {
    const checkRSS = jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } });
    const ctrl = buildController(checkRSS, 1024);

    await ctrl.ready();

    expect(checkRSS).toHaveBeenCalledWith('memory_rss', 1024 * 1024 * 1024);
  });
});
