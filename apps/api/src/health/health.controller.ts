import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
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
    private readonly configService: ConfigService,
  ) {}

  // An absolute RSS ceiling hardcoded at 300MB makes a healthy instance report
  // itself unhealthy during normal traffic peaks, which takes it out of the load
  // balancer. Size this to the container limit (HEALTH_MEMORY_RSS_LIMIT_MB).
  private memoryRssLimitBytes(): number {
    const limitMb = this.configService.get<number>('app.healthMemoryRssLimitMb') ?? 300;
    return limitMb * 1024 * 1024;
  }

  @Get()
  @Public()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
      () => this.memory.checkRSS('memory_rss', this.memoryRssLimitBytes()),
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
      () => this.memory.checkRSS('memory_rss', this.memoryRssLimitBytes()),
      () => this.diskHealth.isHealthy('disk'),
    ]);
  }
}
