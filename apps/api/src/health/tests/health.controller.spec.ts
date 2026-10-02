import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthController } from '../health.controller';
import { PrismaHealthIndicator } from '../prisma-health.indicator';
import { RedisHealthIndicator } from '../redis-health.indicator';
import { BullHealthIndicator } from '../bull-health.indicator';
import { DiskHealthIndicator } from '../disk-health.indicator';
import { SmtpHealthIndicator } from '../smtp-health.indicator';
import { SmsHealthIndicator } from '../sms-health.indicator';
import { PaymentHealthIndicator } from '../payment-health.indicator';

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
      { isHealthy: jest.fn() } as unknown as SmtpHealthIndicator,
      { isHealthy: jest.fn() } as unknown as SmsHealthIndicator,
      { isHealthy: jest.fn() } as unknown as PaymentHealthIndicator,
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
          provide: SmtpHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: SmsHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
        {
          provide: PaymentHealthIndicator,
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

describe('HealthController aggregate handlers', () => {
  function buildDetailedController() {
    const prismaHealth = { isHealthy: jest.fn().mockResolvedValue({ database: { status: 'up' } }) };
    const redisHealth = { isHealthy: jest.fn().mockResolvedValue({ redis: { status: 'up' } }) };
    const bullHealth = { isHealthy: jest.fn().mockResolvedValue({ bullmq: { status: 'up' } }) };
    const diskHealth = { isHealthy: jest.fn().mockResolvedValue({ disk: { status: 'up' } }) };
    const checkRSS = jest.fn().mockResolvedValue({ memory_rss: { status: 'up' } });
    const check = jest.fn().mockResolvedValue({ status: 'ok' });
    const smtpHealth = { isHealthy: jest.fn().mockResolvedValue({ email: { status: 'up' } }) };
    const smsHealth = { isHealthy: jest.fn().mockResolvedValue({ sms: { status: 'up' } }) };
    const paymentHealth = { isHealthy: jest.fn().mockResolvedValue({ payment: { status: 'up' } }) };
    const controller = new HealthController(
      { check } as unknown as HealthCheckService,
      prismaHealth as unknown as PrismaHealthIndicator,
      redisHealth as unknown as RedisHealthIndicator,
      { checkRSS } as unknown as MemoryHealthIndicator,
      bullHealth as unknown as BullHealthIndicator,
      diskHealth as unknown as DiskHealthIndicator,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      smtpHealth as unknown as SmtpHealthIndicator,
      smsHealth as unknown as SmsHealthIndicator,
      paymentHealth as unknown as PaymentHealthIndicator,
    );
    return {
      controller,
      check,
      prismaHealth,
      redisHealth,
      bullHealth,
      diskHealth,
      checkRSS,
      smtpHealth,
      smsHealth,
      paymentHealth,
    };
  }

  it('runs exactly five indicators for the aggregate check and invokes each one', async () => {
    const ctx = buildDetailedController();

    await expect(ctx.controller.check()).resolves.toEqual({ status: 'ok' });

    const indicators = ctx.check.mock.calls[0][0] as (() => Promise<unknown>)[];
    expect(indicators).toHaveLength(5);
    for (const indicator of indicators) await expect(indicator()).resolves.toBeDefined();

    expect(ctx.prismaHealth.isHealthy).toHaveBeenCalledWith('database');
    expect(ctx.redisHealth.isHealthy).toHaveBeenCalledWith('redis');
    expect(ctx.bullHealth.isHealthy).toHaveBeenCalledWith('bullmq');
    expect(ctx.diskHealth.isHealthy).toHaveBeenCalledWith('disk');
    expect(ctx.checkRSS).toHaveBeenCalledWith('memory_rss', 300 * 1024 * 1024);
  });

  it('runs only the database and redis indicators for the liveness probe', async () => {
    const ctx = buildDetailedController();

    await expect(ctx.controller.live()).resolves.toEqual({ status: 'ok' });

    const indicators = ctx.check.mock.calls[0][0] as (() => Promise<unknown>)[];
    expect(indicators).toHaveLength(2);
    for (const indicator of indicators) await indicator();

    expect(ctx.prismaHealth.isHealthy).toHaveBeenCalledWith('database');
    expect(ctx.redisHealth.isHealthy).toHaveBeenCalledWith('redis');
    expect(ctx.bullHealth.isHealthy).not.toHaveBeenCalled();
    expect(ctx.diskHealth.isHealthy).not.toHaveBeenCalled();
    expect(ctx.checkRSS).not.toHaveBeenCalled();
  });

  it('runs every indicator for the readiness probe', async () => {
    const ctx = buildDetailedController();

    await expect(ctx.controller.ready()).resolves.toEqual({ status: 'ok' });

    const indicators = ctx.check.mock.calls[0][0] as (() => Promise<unknown>)[];
    expect(indicators).toHaveLength(5);
    for (const indicator of indicators) await indicator();

    expect(ctx.prismaHealth.isHealthy).toHaveBeenCalledWith('database');
    expect(ctx.redisHealth.isHealthy).toHaveBeenCalledWith('redis');
    expect(ctx.bullHealth.isHealthy).toHaveBeenCalledWith('bullmq');
    expect(ctx.diskHealth.isHealthy).toHaveBeenCalledWith('disk');
  });

  it('runs the email, SMS and payment dependency probes for the dependencies endpoint', async () => {
    const ctx = buildDetailedController();

    await expect(ctx.controller.dependencies()).resolves.toEqual({ status: 'ok' });

    const indicators = ctx.check.mock.calls[0][0] as (() => Promise<unknown>)[];
    expect(indicators).toHaveLength(3);
    for (const indicator of indicators) await indicator();

    expect(ctx.smtpHealth.isHealthy).toHaveBeenCalledWith('email');
    expect(ctx.smsHealth.isHealthy).toHaveBeenCalledWith('sms');
    expect(ctx.paymentHealth.isHealthy).toHaveBeenCalledWith('payment');
    expect(ctx.prismaHealth.isHealthy).not.toHaveBeenCalled();
  });

  it('surfaces an unhealthy result from the aggregate check unchanged', async () => {
    const ctx = buildDetailedController();
    ctx.check.mockResolvedValue({ status: 'error', error: { database: { status: 'down' } } });

    await expect(ctx.controller.check()).resolves.toEqual({
      status: 'error',
      error: { database: { status: 'down' } },
    });
  });
});
