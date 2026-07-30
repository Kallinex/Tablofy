import { Module } from '@nestjs/common';
import { KitchenAnalyticsService } from './kitchen-analytics.service';
import { KitchenAnalyticsController } from './kitchen-analytics.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [KitchenAnalyticsController],
  providers: [KitchenAnalyticsService],
  exports: [KitchenAnalyticsService],
})
export class KitchenAnalyticsModule {}
