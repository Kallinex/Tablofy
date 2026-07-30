import { Module } from '@nestjs/common';
import { FinancialAnalyticsService } from './financial-analytics.service';
import { FinancialAnalyticsController } from './financial-analytics.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [FinancialAnalyticsController],
  providers: [FinancialAnalyticsService],
  exports: [FinancialAnalyticsService],
})
export class FinancialAnalyticsModule {}
