import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RedisService } from '../../redis/redis.service';

export interface UsageItem {
  productId?: string;
  quantity: number;
}

export interface OrderCreatedEvent {
  tenantId: string;
  restaurantId: string;
  items: UsageItem[];
  orderId?: string;
  orderNumber?: number;
  productId?: string;
  quantity?: number;
}

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
  async trackOrderCreated(payload: OrderCreatedEvent) {
    const { tenantId, restaurantId } = payload;

    if (!tenantId || !restaurantId) {
      this.logger.warn('Ignoring order.created event without tenant/restaurant for usage tracking');
      return;
    }

    const items = this.resolveUsageItems(payload);
    if (items.length === 0) {
      this.logger.warn('Ignoring order.created event without usage items');
      return;
    }

    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalQuantity <= 0) {
      this.logger.warn('Ignoring order.created event with non-positive quantity');
      return;
    }

    const client = await this.redisService.getClient();

    // Track total orders per restaurant
    await client.incrby(`usage:${tenantId}:${restaurantId}:orders:count`, totalQuantity);

    // Track orders per product if productId provided
    for (const item of items) {
      if (item.productId) {
        await client.incrby(
          `usage:${tenantId}:${restaurantId}:products:${item.productId}:count`,
          item.quantity,
        );
      }
    }

    // Track daily orders (TTL 45 days)
    const dateKey = new Date().toISOString().split('T')[0];
    const dailyKey = `usage:${tenantId}:${restaurantId}:orders:daily:${dateKey}`;
    await client.incrby(dailyKey, totalQuantity);
    await client.expire(dailyKey, 45 * 24 * 60 * 60);
  }

  private resolveUsageItems(payload: OrderCreatedEvent): UsageItem[] {
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      return payload.items.filter(
        (item) =>
          item &&
          (item.productId === undefined || typeof item.productId === 'string') &&
          typeof item.quantity === 'number' &&
          Number.isFinite(item.quantity) &&
          item.quantity > 0,
      );
    }
    if (
      typeof payload.quantity === 'number' &&
      Number.isFinite(payload.quantity) &&
      payload.quantity > 0
    ) {
      return [{ productId: payload.productId, quantity: payload.quantity }];
    }
    return [];
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
    const keys = await this.redisService.scanKeys(pattern);

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
    const keys = await this.redisService.scanKeys(pattern);
    if (keys.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await client.del(...batch);
      }
    }
    this.logger.log(`Reset usage counters for restaurant ${restaurantId}`);
  }
}
