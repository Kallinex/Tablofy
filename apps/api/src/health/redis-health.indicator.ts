import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const result = await this.redisService.ping();
      if (result === 'PONG') {
        return this.getStatus(key, true);
      }
      throw new Error(`Unexpected Redis response: ${result}`);
    } catch (error) {
      throw new HealthCheckError(
        'Redis connection failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
