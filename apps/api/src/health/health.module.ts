import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { RedisHealthIndicator } from './redis-health.indicator';
import { BullHealthIndicator } from './bull-health.indicator';
import { DiskHealthIndicator } from './disk-health.indicator';
import { SmtpHealthIndicator } from './smtp-health.indicator';
import { SmsHealthIndicator } from './sms-health.indicator';
import { PaymentHealthIndicator } from './payment-health.indicator';
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
    SmtpHealthIndicator,
    SmsHealthIndicator,
    PaymentHealthIndicator,
  ],
})
export class HealthModule {}
