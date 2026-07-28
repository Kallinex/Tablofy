import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

const FEATURE_FLAGS_CACHE_TTL = 3600;

interface FeatureFlags {
  [key: string]: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  'restaurant.crud': true,
  'branch.crud': true,
  'menu.management': false,
  'order.management': false,
  'payment.processing': false,
  'inventory.management': false,
  'reporting.advanced': false,
  'loyalty.program': false,
  'multi-branch': false,
  'kitchen.display': false,
  'table.reservation': false,
  'staff.scheduling': false,
  'supplier.management': false,
  'customer.feedback': false,
  'campaign.management': false,
};

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly cachePrefix = 'feature_flags:';

  constructor(private readonly redisService: RedisService) {}

  async isEnabled(tenantId: string, flag: string): Promise<boolean> {
    const flags = await this.getFlags(tenantId);
    return flags[flag] ?? DEFAULT_FLAGS[flag] ?? false;
  }

  async getFlags(tenantId: string): Promise<FeatureFlags> {
    const cacheKey = `${this.cachePrefix}${tenantId}`;
    const cached = await this.redisService.get(cacheKey);

    if (cached) {
      return JSON.parse(cached) as FeatureFlags;
    }

    const flags = { ...DEFAULT_FLAGS };
    await this.redisService.set(cacheKey, JSON.stringify(flags), FEATURE_FLAGS_CACHE_TTL);
    return flags;
  }

  async setFlag(tenantId: string, flag: string, enabled: boolean): Promise<void> {
    const flags = await this.getFlags(tenantId);
    flags[flag] = enabled;

    const cacheKey = `${this.cachePrefix}${tenantId}`;
    await this.redisService.set(cacheKey, JSON.stringify(flags), FEATURE_FLAGS_CACHE_TTL);

    this.logger.log(`Feature flag ${flag} set to ${enabled} for tenant ${tenantId}`);
  }

  async resetFlags(tenantId: string): Promise<void> {
    const cacheKey = `${this.cachePrefix}${tenantId}`;
    await this.redisService.del(cacheKey);
  }

  async getAllFlags(): Promise<FeatureFlags> {
    return { ...DEFAULT_FLAGS };
  }
}
