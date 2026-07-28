import { Module } from '@nestjs/common';
import { PlanLimitsService } from './services/plan-limits.service';
import { FeatureFlagService } from './services/feature-flag.service';
import { CacheService } from './services/cache.service';

const services = [PlanLimitsService, FeatureFlagService, CacheService];

@Module({
  providers: services,
  exports: services,
})
export class CommonModule {}
