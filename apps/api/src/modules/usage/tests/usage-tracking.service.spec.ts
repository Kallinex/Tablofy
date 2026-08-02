import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsageTrackingService } from '../usage-tracking.service';
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
});
