import { Module } from '@nestjs/common';
import { CrmAnalyticsService } from './crm-analytics.service';
import { CrmAnalyticsController } from './crm-analytics.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [CrmAnalyticsController],
  providers: [CrmAnalyticsService],
  exports: [CrmAnalyticsService],
})
export class CrmAnalyticsModule {}
