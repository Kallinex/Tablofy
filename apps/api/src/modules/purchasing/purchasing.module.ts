import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
import { PurchasingGateway } from './purchasing.gateway';
import { PurchasingProcessor } from './purchasing.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [PurchasingController],
  providers: [PurchasingService, PurchasingGateway, PurchasingProcessor],
  exports: [PurchasingService, PurchasingGateway],
})
export class PurchasingModule {}
