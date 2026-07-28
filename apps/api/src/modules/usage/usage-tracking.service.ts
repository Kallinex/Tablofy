import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class UsageTrackingService implements OnModuleInit {
  private readonly logger = new Logger(UsageTrackingService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.logger.log('UsageTrackingService initialized');
  }

  @OnEvent('order.created')
  async trackOrderCreated(payload: {
    tenantId: string;
    restaurantId: string;
    productId?: string;
    quantity: number;
  }) {
    const { tenantId, restaurantId, productId, quantity } = payload;

    const client = await this.redisService.getClient();

    // Track total orders per restaurant
    await client.incrby(`usage:${tenantId}:${restaurantId}:orders:count`, quantity);

    // Track orders per product if productId provided
    if (productId) {
      await client.incrby(
        `usage:${tenantId}:${restaurantId}:products:${productId}:count`,
        quantity,
      );
    }

    // Track daily orders (TTL 45 days)
    const dateKey = new Date().toISOString().split('T')[0];
    const dailyKey = `usage:${tenantId}:${restaurantId}:orders:daily:${dateKey}`;
    await client.incrby(dailyKey, quantity);
    await client.expire(dailyKey, 45 * 24 * 60 * 60);
  }

  async getOrderCount(tenantId: string, restaurantId: string): Promise<number> {
    const client = await this.redisService.getClient();
    const count = await client.get(`usage:${tenantId}:${restaurantId}:orders:count`);
    return count ? parseInt(count, 10) : 0;
  }

  async getProductOrderCount(
    tenantId: string,
    restaurantId: string,
    productId: string,
  ): Promise<number> {
    const client = await this.redisService.getClient();
    const count = await client.get(`usage:${tenantId}:${restaurantId}:products:${productId}:count`);
    return count ? parseInt(count, 10) : 0;
  }

  async getTopProducts(
    tenantId: string,
    restaurantId: string,
    limit = 10,
  ): Promise<Array<{ productId: string; count: number }>> {
    const client = await this.redisService.getClient();
    const pattern = `usage:${tenantId}:${restaurantId}:products:*:count`;
    const keys = await client.keys(pattern);

    const results: Array<{ productId: string; count: number }> = [];
    for (const key of keys) {
      const productId = key.split(':')[4];
      const count = await client.get(key);
      if (productId && count) {
        results.push({ productId, count: parseInt(count, 10) });
      }
    }

    return results.sort((a, b) => b.count - a.count).slice(0, limit);
  }

  async getDailyOrders(
    tenantId: string,
    restaurantId: string,
    days = 30,
  ): Promise<Array<{ date: string; count: number }>> {
    const client = await this.redisService.getClient();
    const results: Array<{ date: string; count: number }> = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const key = `usage:${tenantId}:${restaurantId}:orders:daily:${dateKey}`;
      const count = await client.get(key);
      results.push({ date: dateKey, count: count ? parseInt(count, 10) : 0 });
    }

    return results.reverse();
  }

  async resetUsage(tenantId: string, restaurantId: string): Promise<void> {
    const client = await this.redisService.getClient();
    const pattern = `usage:${tenantId}:${restaurantId}:*`;
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
    this.logger.log(`Reset usage counters for restaurant ${restaurantId}`);
  }
}
