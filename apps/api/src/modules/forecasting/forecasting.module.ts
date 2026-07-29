import { Module } from '@nestjs/common';
import { ForecastingService } from './forecasting.service';
import { ForecastingController } from './forecasting.controller';
import { ForecastingProcessor } from './forecasting.processor';
import { ForecastingGateway } from './forecasting.gateway';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [ForecastingController],
  providers: [ForecastingService, ForecastingProcessor, ForecastingGateway],
  exports: [ForecastingService],
})
export class ForecastingModule {}
