import { Module } from '@nestjs/common';
import { CostingService } from './costing.service';
import { CostingController } from './costing.controller';
import { CostingProcessor } from './costing.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [CostingController],
  providers: [CostingService, CostingProcessor],
  exports: [CostingService],
})
export class CostingModule {}
