import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsageTrackingService, OrderCreatedEvent } from '../usage-tracking.service';
import { RedisService } from '../../../redis/redis.service';
import { createMockRedis, MockRedis } from '../../../test/mocks/redis.mock';

describe('UsageTrackingService', () => {
  let service: UsageTrackingService;
  let redis: MockRedis;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageTrackingService,
        { provide: RedisService, useValue: createMockRedis() },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsageTrackingService>(UsageTrackingService);
    redis = module.get(RedisService) as MockRedis;
  });

  beforeEach(() => {
    redis.reset();
    jest.clearAllMocks();
  });

  describe('getTopProducts', () => {
    it('should use SCAN to find product keys', async () => {
      const mockClient = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'usage:t1:r1:products:p1:count') return Promise.resolve('5');
          if (key === 'usage:t1:r1:products:p2:count') return Promise.resolve('3');
          return Promise.resolve(null);
        }),
      };
      redis.getClient.mockResolvedValue(mockClient);
      redis.scanKeys.mockResolvedValue([
        'usage:t1:r1:products:p1:count',
        'usage:t1:r1:products:p2:count',
      ]);

      const result = await service.getTopProducts('t1', 'r1');

      expect(redis.scanKeys).toHaveBeenCalledWith('usage:t1:r1:products:*:count');
      expect(result).toEqual([
        { productId: 'p1', count: 5 },
        { productId: 'p2', count: 3 },
      ]);
    });

    it('should not use blocking KEYS', async () => {
      const mockClient = {
        get: jest.fn().mockResolvedValue(null),
        keys: jest.fn().mockResolvedValue([]),
      };
      redis.getClient.mockResolvedValue(mockClient);
      redis.scanKeys.mockResolvedValue([]);

      await service.getTopProducts('t1', 'r1');

      expect(redis.scanKeys).toHaveBeenCalledWith('usage:t1:r1:products:*:count');
      expect(mockClient.keys).not.toHaveBeenCalled();
    });
  });

  describe('resetUsage', () => {
    it('should use SCAN and delete matched keys in batches', async () => {
      const mockClient = { del: jest.fn().mockResolvedValue(1) };
      redis.getClient.mockResolvedValue(mockClient);
      const keys = Array.from({ length: 120 }, (_, i) => `usage:t1:r1:key${i}`);
      redis.scanKeys.mockResolvedValue(keys);

      await service.resetUsage('t1', 'r1');

      expect(redis.scanKeys).toHaveBeenCalledWith('usage:t1:r1:*');
      expect(mockClient.del).toHaveBeenCalledTimes(2);
      expect(mockClient.del).toHaveBeenNthCalledWith(1, ...keys.slice(0, 100));
      expect(mockClient.del).toHaveBeenNthCalledWith(2, ...keys.slice(100, 120));
    });

    it('should not call del when no keys match', async () => {
      const mockClient = { del: jest.fn().mockResolvedValue(1) };
      redis.getClient.mockResolvedValue(mockClient);
      redis.scanKeys.mockResolvedValue([]);

      await service.resetUsage('t1', 'r1');

      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });

  describe('trackOrderCreated', () => {
    function mockRedisClient() {
      const store: Record<string, number> = {};
      return {
        store,
        incrby: jest.fn((key: string, by: number) => {
          store[key] = (store[key] ?? 0) + by;
          return Promise.resolve(store[key]);
        }),
        expire: jest.fn().mockResolvedValue(1),
        get: jest.fn((key: string) => Promise.resolve(key in store ? String(store[key]) : null)),
      };
    }

    const today = () => new Date().toISOString().split('T')[0];

    it('should increment order, per-product and daily counters for the corrected payload', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        tenantId: 't1',
        restaurantId: 'r1',
        orderId: 'o1',
        orderNumber: 'ORD-000001',
        items: [
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 3 },
        ],
      });

      expect(client.incrby).toHaveBeenCalledWith('usage:t1:r1:orders:count', 5);
      expect(client.incrby).toHaveBeenCalledWith('usage:t1:r1:products:p1:count', 2);
      expect(client.incrby).toHaveBeenCalledWith('usage:t1:r1:products:p2:count', 3);
      expect(client.incrby).toHaveBeenCalledWith(`usage:t1:r1:orders:daily:${today()}`, 5);
      expect(client.expire).toHaveBeenCalledWith(
        `usage:t1:r1:orders:daily:${today()}`,
        45 * 24 * 60 * 60,
      );
    });

    it('should keep all counters scoped to the tenant and restaurant', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        tenantId: 'tenant-a',
        restaurantId: 'restaurant-a',
        items: [{ productId: 'p1', quantity: 1 }],
      });

      expect(client.incrby).toHaveBeenCalledWith('usage:tenant-a:restaurant-a:orders:count', 1);
      expect(client.incrby).toHaveBeenCalledWith(
        'usage:tenant-a:restaurant-a:products:p1:count',
        1,
      );
      expect(client.incrby).not.toHaveBeenCalledWith(
        expect.stringContaining('tenant-b'),
        expect.anything(),
      );
      expect(client.incrby).not.toHaveBeenCalledWith(
        expect.stringContaining('restaurant-b'),
        expect.anything(),
      );
    });

    it('should support the legacy single-item payload shape', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        tenantId: 't1',
        restaurantId: 'r1',
        productId: 'p1',
        quantity: 4,
      } as unknown as OrderCreatedEvent);

      expect(client.incrby).toHaveBeenCalledWith('usage:t1:r1:orders:count', 4);
      expect(client.incrby).toHaveBeenCalledWith('usage:t1:r1:products:p1:count', 4);
    });

    it('should not write anything when the payload lacks a tenant', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        restaurantId: 'r1',
        items: [{ productId: 'p1', quantity: 1 }],
      } as unknown as OrderCreatedEvent);

      expect(client.incrby).not.toHaveBeenCalled();
      expect(client.expire).not.toHaveBeenCalled();
    });

    it('should not write anything when the payload lacks a restaurant', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        tenantId: 't1',
        items: [{ productId: 'p1', quantity: 1 }],
      } as unknown as OrderCreatedEvent);

      expect(client.incrby).not.toHaveBeenCalled();
      expect(client.expire).not.toHaveBeenCalled();
    });

    it('should not write anything when items are absent', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        tenantId: 't1',
        restaurantId: 'r1',
        items: [],
      } as unknown as OrderCreatedEvent);

      expect(client.incrby).not.toHaveBeenCalled();
      expect(client.expire).not.toHaveBeenCalled();
    });

    it('should not write anything for non-positive quantities', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        tenantId: 't1',
        restaurantId: 'r1',
        items: [{ productId: 'p1', quantity: 0 }],
      } as unknown as OrderCreatedEvent);

      expect(client.incrby).not.toHaveBeenCalled();
      expect(client.expire).not.toHaveBeenCalled();
    });

    it('should not create duplicate records for a single order emission', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        tenantId: 't1',
        restaurantId: 'r1',
        orderId: 'o1',
        orderNumber: 'ORD-000001',
        items: [{ productId: 'p1', quantity: 1 }],
      });

      expect(client.incrby).toHaveBeenCalledTimes(3);
      expect(client.store['usage:t1:r1:orders:count']).toBe(1);
      expect(client.store['usage:t1:r1:products:p1:count']).toBe(1);
      expect(client.store[`usage:t1:r1:orders:daily:${today()}`]).toBe(1);
    });

    it('should keep Redis INCRBY atomic under concurrent order emissions', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await Promise.all([
        service.trackOrderCreated({
          tenantId: 't1',
          restaurantId: 'r1',
          items: [{ productId: 'p1', quantity: 2 }],
        }),
        service.trackOrderCreated({
          tenantId: 't1',
          restaurantId: 'r1',
          items: [{ productId: 'p1', quantity: 3 }],
        }),
      ]);

      expect(client.store['usage:t1:r1:orders:count']).toBe(5);
      expect(client.store['usage:t1:r1:products:p1:count']).toBe(5);
    });

    it('should skip per-product keys when productId is absent but keep totals', async () => {
      const client = mockRedisClient();
      redis.getClient.mockResolvedValue(client);

      await service.trackOrderCreated({
        tenantId: 't1',
        restaurantId: 'r1',
        items: [{ quantity: 2 }],
      } as unknown as OrderCreatedEvent);

      expect(client.incrby).toHaveBeenCalledWith('usage:t1:r1:orders:count', 2);
      expect(client.incrby).not.toHaveBeenCalledWith(
        expect.stringContaining(':products:'),
        expect.anything(),
      );
    });
  });
});
