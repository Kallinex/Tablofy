import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmGateway } from './crm.gateway';
import { CrmProcessor } from './crm.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [CrmController],
  providers: [CrmService, CrmGateway, CrmProcessor],
  exports: [CrmService, CrmGateway],
})
export class CrmModule {}
