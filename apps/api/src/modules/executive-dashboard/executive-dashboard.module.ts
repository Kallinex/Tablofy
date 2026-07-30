import { Module } from '@nestjs/common';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { ExecutiveDashboardController } from './executive-dashboard.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [ExecutiveDashboardController],
  providers: [ExecutiveDashboardService],
  exports: [ExecutiveDashboardService],
})
export class ExecutiveDashboardModule {}
