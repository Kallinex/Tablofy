import { Module } from '@nestjs/common';
import { CustomerAnalyticsService } from './customer-analytics.service';
import { CustomerAnalyticsController } from './customer-analytics.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [CustomerAnalyticsController],
  providers: [CustomerAnalyticsService],
  exports: [CustomerAnalyticsService],
})
export class CustomerAnalyticsModule {}
