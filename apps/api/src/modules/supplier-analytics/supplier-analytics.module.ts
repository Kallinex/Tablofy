import { Module } from '@nestjs/common';
import { SupplierAnalyticsService } from './supplier-analytics.service';
import { SupplierAnalyticsController } from './supplier-analytics.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [SupplierAnalyticsController],
  providers: [SupplierAnalyticsService],
  exports: [SupplierAnalyticsService],
})
export class SupplierAnalyticsModule {}
