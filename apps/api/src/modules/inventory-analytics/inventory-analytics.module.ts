import { Module } from '@nestjs/common';
import { InventoryAnalyticsService } from './inventory-analytics.service';
import { InventoryAnalyticsController } from './inventory-analytics.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [InventoryAnalyticsController],
  providers: [InventoryAnalyticsService],
  exports: [InventoryAnalyticsService],
})
export class InventoryAnalyticsModule {}
