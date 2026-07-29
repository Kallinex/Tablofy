import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsGateway } from './campaigns.gateway';
import { CampaignsProcessor } from './campaigns.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignsGateway, CampaignsProcessor],
  exports: [CampaignsService, CampaignsGateway],
})
export class CampaignsModule {}
