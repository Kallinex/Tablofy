import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { RedisHealthIndicator } from './redis-health.indicator';
import { BullHealthIndicator } from './bull-health.indicator';
import { DiskHealthIndicator } from './disk-health.indicator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenantCheck } from '../common/decorators/skip-tenant.decorator';

@Controller('health')
@SkipTenantCheck()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    private memory: MemoryHealthIndicator,
    private bullHealth: BullHealthIndicator,
    private diskHealth: DiskHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      () => this.bullHealth.isHealthy('bullmq'),
      () => this.diskHealth.isHealthy('disk'),
    ]);
  }

  @Get('live')
  @Public()
  @HealthCheck()
  live() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }

  @Get('ready')
  @Public()
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
      () => this.bullHealth.isHealthy('bullmq'),
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      () => this.diskHealth.isHealthy('disk'),
    ]);
  }
}
