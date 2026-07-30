import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '../cache.service';
import { RedisService } from '../../../redis/redis.service';
import { createMockRedis, MockRedis } from '../../../test/mocks/redis.mock';

describe('CacheService', () => {
  let service: CacheService;
  let redis: MockRedis;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheService, { provide: RedisService, useValue: createMockRedis() }],
    }).compile();

    service = module.get<CacheService>(CacheService);
    redis = module.get(RedisService) as MockRedis;
  });

  beforeEach(() => {
    redis.reset();
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('should return parsed value when key exists', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ id: '1', name: 'test' }));

      const result = await service.get('tenant-1', 'test-key');

      expect(result).toEqual({ id: '1', name: 'test' });
      expect(redis.get).toHaveBeenCalledWith('cache:tenant-1:test-key');
    });

    it('should return null when key does not exist', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.get('tenant-1', 'missing-key');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should store JSON stringified value with tenant prefix', async () => {
      redis.set.mockResolvedValue(undefined);

      await service.set('tenant-1', 'test-key', { foo: 'bar' }, 300);

      expect(redis.set).toHaveBeenCalledWith(
        'cache:tenant-1:test-key',
        JSON.stringify({ foo: 'bar' }),
        300,
      );
    });

    it('should use default TTL when not provided', async () => {
      redis.set.mockResolvedValue(undefined);

      await service.set('tenant-1', 'test-key', 'value');

      expect(redis.set).toHaveBeenCalledWith(
        'cache:tenant-1:test-key',
        JSON.stringify('value'),
        expect.any(Number),
      );
    });
  });

  describe('delete', () => {
    it('should delete key with tenant prefix', async () => {
      await service.delete('tenant-1', 'test-key');

      expect(redis.del).toHaveBeenCalledWith('cache:tenant-1:test-key');
    });
  });

  describe('deletePattern', () => {
    it('should delete keys matching pattern', async () => {
      const mockClient = { keys: jest.fn().mockResolvedValue(['k1', 'k2']), del: jest.fn() };
      redis.getClient.mockResolvedValue(mockClient);

      await service.deletePattern('tenant-1', 'test:*');

      expect(mockClient.keys).toHaveBeenCalledWith('cache:tenant-1:test:*');
      expect(mockClient.del).toHaveBeenCalledWith('k1', 'k2');
    });
  });

  describe('invalidateTenantCache', () => {
    it('should delete all keys for a tenant', async () => {
      const mockClient = {
        keys: jest.fn().mockResolvedValue(['cache:tenant-1:k1', 'cache:tenant-1:k2']),
        del: jest.fn(),
      };
      redis.getClient.mockResolvedValue(mockClient);

      await service.invalidateTenantCache('tenant-1');

      expect(mockClient.keys).toHaveBeenCalledWith('cache:tenant-1:*');
      expect(mockClient.del).toHaveBeenCalledWith('cache:tenant-1:k1', 'cache:tenant-1:k2');
    });
  });

  describe('getOrSet', () => {
    it('should return cached value when available', async () => {
      redis.get.mockResolvedValue(JSON.stringify('cached-value'));

      const result = await service.getOrSet('tenant-1', 'key', async () => 'fresh-value');

      expect(result).toBe('cached-value');
    });

    it('should call factory and cache result when cache misses', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValue(undefined);
      const factory = jest.fn().mockResolvedValue('fresh-value');

      const result = await service.getOrSet('tenant-1', 'key', factory, 120);

      expect(result).toBe('fresh-value');
      expect(factory).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        'cache:tenant-1:key',
        JSON.stringify('fresh-value'),
        120,
      );
    });
  });
});
