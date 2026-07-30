import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { RedisHealthIndicator } from './redis-health.indicator';
import { BullHealthIndicator } from './bull-health.indicator';
import { DiskHealthIndicator } from './disk-health.indicator';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from '../modules/queues/queue.module';

@Module({
  imports: [TerminusModule, RedisModule, QueueModule],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    RedisHealthIndicator,
    BullHealthIndicator,
    DiskHealthIndicator,
  ],
})
export class HealthModule {}
