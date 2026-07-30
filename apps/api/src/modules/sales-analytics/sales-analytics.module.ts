import { Module } from '@nestjs/common';
import { SalesAnalyticsService } from './sales-analytics.service';
import { SalesAnalyticsController } from './sales-analytics.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [SalesAnalyticsController],
  providers: [SalesAnalyticsService],
  exports: [SalesAnalyticsService],
})
export class SalesAnalyticsModule {}
