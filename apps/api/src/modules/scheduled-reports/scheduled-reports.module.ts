import { Module } from '@nestjs/common';
import { ScheduledReportsService } from './scheduled-reports.service';
import { ScheduledReportsController } from './scheduled-reports.controller';
import { ScheduledReportsProcessor } from './scheduled-reports.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [ScheduledReportsController],
  providers: [ScheduledReportsService, ScheduledReportsProcessor],
  exports: [ScheduledReportsService],
})
export class ScheduledReportsModule {}
