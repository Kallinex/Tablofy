import { Module } from '@nestjs/common';
import { ForecastingDashboardService } from './forecasting-dashboard.service';
import { ForecastingDashboardController } from './forecasting-dashboard.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [ForecastingDashboardController],
  providers: [ForecastingDashboardService],
  exports: [ForecastingDashboardService],
})
export class ForecastingDashboardModule {}
