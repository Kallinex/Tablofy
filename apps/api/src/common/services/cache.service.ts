import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { CACHE_TTL } from '@tablofy/shared/constants';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly tenantPrefix = 'cache:';

  constructor(private readonly redisService: RedisService) {}

  private buildKey(tenantId: string, key: string): string {
    return `${this.tenantPrefix}${tenantId}:${key}`;
  }

  async get<T>(tenantId: string, key: string): Promise<T | null> {
    const fullKey = this.buildKey(tenantId, key);
    const data = await this.redisService.get(fullKey);
    return data ? (JSON.parse(data) as T) : null;
  }

  async set<T>(
    tenantId: string,
    key: string,
    value: T,
    ttlSeconds: number = CACHE_TTL.MEDIUM,
  ): Promise<void> {
    const fullKey = this.buildKey(tenantId, key);
    await this.redisService.set(fullKey, JSON.stringify(value), ttlSeconds);
  }

  async delete(tenantId: string, key: string): Promise<void> {
    const fullKey = this.buildKey(tenantId, key);
    await this.redisService.del(fullKey);
  }

  async deletePattern(tenantId: string, pattern: string): Promise<void> {
    const fullPattern = this.buildKey(tenantId, pattern);
    const client = await this.redisService.getClient();
    const keys = await client.keys(fullPattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
  }

  async invalidateTenantCache(tenantId: string): Promise<void> {
    const pattern = `${this.tenantPrefix}${tenantId}:*`;
    const client = await this.redisService.getClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
      this.logger.log(`Invalidated ${keys.length} cache entries for tenant ${tenantId}`);
    }
  }

  async getOrSet<T>(
    tenantId: string,
    key: string,
    factory: () => Promise<T>,
    ttlSeconds: number = CACHE_TTL.MEDIUM,
  ): Promise<T> {
    const cached = await this.get<T>(tenantId, key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(tenantId, key, value, ttlSeconds);
    return value;
  }
}
