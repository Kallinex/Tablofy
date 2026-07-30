import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthController } from '../health.controller';
import { PrismaHealthIndicator } from '../prisma-health.indicator';
import { RedisHealthIndicator } from '../redis-health.indicator';
import { BullHealthIndicator } from '../bull-health.indicator';
import { DiskHealthIndicator } from '../disk-health.indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;

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
});
