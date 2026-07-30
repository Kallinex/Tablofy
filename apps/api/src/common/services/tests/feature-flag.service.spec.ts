import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagService } from '../feature-flag.service';
import { RedisService } from '../../../redis/redis.service';
import { createMockRedis, MockRedis } from '../../../test/mocks/redis.mock';

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let redis: MockRedis;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeatureFlagService, { provide: RedisService, useValue: createMockRedis() }],
    }).compile();

    service = module.get<FeatureFlagService>(FeatureFlagService);
    redis = module.get(RedisService) as MockRedis;
  });

  beforeEach(() => {
    redis.reset();
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('should return true for enabled flag', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ 'restaurant.crud': true }));

      const result = await service.isEnabled('tenant-1', 'restaurant.crud');

      expect(result).toBe(true);
    });

    it('should return false for disabled flag', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ 'menu.management': false }));

      const result = await service.isEnabled('tenant-1', 'menu.management');

      expect(result).toBe(false);
    });

    it('should return default value when flag not in cache', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.isEnabled('tenant-1', 'restaurant.crud');

      expect(result).toBe(true);
    });

    it('should return false for unknown flag', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.isEnabled('tenant-1', 'nonexistent.flag');

      expect(result).toBe(false);
    });
  });

  describe('getFlags', () => {
    it('should return cached flags', async () => {
      const flags = { 'order.management': true };
      redis.get.mockResolvedValue(JSON.stringify(flags));

      const result = await service.getFlags('tenant-1');

      expect(result).toEqual(flags);
    });

    it('should return default flags on cache miss and cache them', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.getFlags('tenant-1');

      expect(result).toHaveProperty(['restaurant.crud']);
      expect(result).toHaveProperty(['menu.management']);
      expect(redis.set).toHaveBeenCalledWith('feature_flags:tenant-1', expect.any(String), 3600);
    });
  });

  describe('setFlag', () => {
    it('should update flag and cache', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ 'order.management': false }));
      redis.set.mockResolvedValue(undefined);

      await service.setFlag('tenant-1', 'order.management', true);

      expect(redis.set).toHaveBeenCalledWith(
        'feature_flags:tenant-1',
        expect.stringContaining('true'),
        expect.any(Number),
      );
    });
  });

  describe('resetFlags', () => {
    it('should delete cached flags', async () => {
      await service.resetFlags('tenant-1');

      expect(redis.del).toHaveBeenCalledWith('feature_flags:tenant-1');
    });
  });

  describe('getAllFlags', () => {
    it('should return all default flags', async () => {
      const result = await service.getAllFlags();

      expect(result).toHaveProperty(['restaurant.crud']);
      expect(result).toHaveProperty(['menu.management']);
      expect(result).toHaveProperty(['order.management']);
      expect(result).toHaveProperty(['payment.processing']);
    });
  });
});
