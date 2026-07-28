import { Module } from '@nestjs/common';
import { UsageTrackingService } from './usage-tracking.service';
import { UsageController } from './usage.controller';

@Module({
  controllers: [UsageController],
  providers: [UsageTrackingService],
  exports: [UsageTrackingService],
})
export class UsageModule {}
