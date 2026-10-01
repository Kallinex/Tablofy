import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsageTrackingService } from '../usage-tracking.service';
import { RedisService } from '../../../redis/redis.service';
import { createMockRedis, MockRedis } from '../../../test/mocks/redis.mock';

describe('UsageTrackingService counters and daily history', () => {
  let service: UsageTrackingService;
  let redis: MockRedis;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageTrackingService,
        { provide: RedisService, useValue: createMockRedis() },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsageTrackingService>(UsageTrackingService);
    redis = module.get(RedisService) as MockRedis;

    redis.reset();
    jest.clearAllMocks();
  });

  it('logs when the module is initialised', () => {
    expect(() => service.onModuleInit()).not.toThrow();
  });

  describe('getOrderCount', () => {
    it('reads the tenant and restaurant scoped counter', async () => {
      const get = jest.fn().mockResolvedValue('7');
      redis.getClient.mockResolvedValue({ get } as never);

      await expect(service.getOrderCount('t1', 'r1')).resolves.toBe(7);
      expect(get).toHaveBeenCalledWith('usage:t1:r1:orders:count');
    });

    it('returns zero when the counter is absent', async () => {
      redis.getClient.mockResolvedValue({ get: jest.fn().mockResolvedValue(null) } as never);

      await expect(service.getOrderCount('t1', 'r1')).resolves.toBe(0);
    });

    it('returns zero when the counter is an empty string', async () => {
      redis.getClient.mockResolvedValue({ get: jest.fn().mockResolvedValue('') } as never);

      await expect(service.getOrderCount('t1', 'r1')).resolves.toBe(0);
    });

    it('does not leak counters across tenants', async () => {
      const get = jest.fn().mockResolvedValue('4');
      redis.getClient.mockResolvedValue({ get } as never);

      await service.getOrderCount('t2', 'r1');

      expect(get).toHaveBeenCalledWith('usage:t2:r1:orders:count');
      expect(get).not.toHaveBeenCalledWith('usage:t1:r1:orders:count');
    });
  });

  describe('getProductOrderCount', () => {
    it('reads the product scoped counter', async () => {
      const get = jest.fn().mockResolvedValue('12');
      redis.getClient.mockResolvedValue({ get } as never);

      await expect(service.getProductOrderCount('t1', 'r1', 'p9')).resolves.toBe(12);
      expect(get).toHaveBeenCalledWith('usage:t1:r1:products:p9:count');
    });

    it('returns zero when the product counter is absent', async () => {
      redis.getClient.mockResolvedValue({ get: jest.fn().mockResolvedValue(null) } as never);

      await expect(service.getProductOrderCount('t1', 'r1', 'p9')).resolves.toBe(0);
    });
  });

  describe('getDailyOrders', () => {
    it('returns one entry per day oldest first', async () => {
      const get = jest.fn().mockResolvedValue('2');
      redis.getClient.mockResolvedValue({ get } as never);

      const result = await service.getDailyOrders('t1', 'r1', 3);

      expect(get).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
      for (const entry of result) {
        expect(entry.count).toBe(2);
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      const dates = result.map((r) => r.date);
      expect([...dates].sort()).toEqual(dates);
    });

    it('defaults to thirty days', async () => {
      const get = jest.fn().mockResolvedValue(null);
      redis.getClient.mockResolvedValue({ get } as never);

      const result = await service.getDailyOrders('t1', 'r1');

      expect(get).toHaveBeenCalledTimes(30);
      expect(result).toHaveLength(30);
      expect(result.every((entry) => entry.count === 0)).toBe(true);
    });

    it('reads the tenant, restaurant and date scoped keys', async () => {
      const get = jest.fn().mockResolvedValue(null);
      redis.getClient.mockResolvedValue({ get } as never);

      const [today] = await service.getDailyOrders('t1', 'r1', 1);

      expect(get).toHaveBeenCalledWith(`usage:t1:r1:orders:daily:${today.date}`);
    });

    it('treats a zero counter as zero rather than a missing key', async () => {
      redis.getClient.mockResolvedValue({ get: jest.fn().mockResolvedValue('0') } as never);

      const result = await service.getDailyOrders('t1', 'r1', 1);

      expect(result[0].count).toBe(0);
    });
  });
});
