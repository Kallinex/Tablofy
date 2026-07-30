import { Module } from '@nestjs/common';
import { LiveAnalyticsService } from './live-analytics.service';
import { LiveAnalyticsController } from './live-analytics.controller';
import { LiveAnalyticsGateway } from './live-analytics.gateway';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [LiveAnalyticsController],
  providers: [LiveAnalyticsService, LiveAnalyticsGateway],
  exports: [LiveAnalyticsService],
})
export class LiveAnalyticsModule {}
