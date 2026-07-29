import { Module } from '@nestjs/common';
import { CycleCountService } from './cycle-count.service';
import { CycleCountController } from './cycle-count.controller';
import { CycleCountGateway } from './cycle-count.gateway';
import { CycleCountProcessor } from './cycle-count.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [CycleCountController],
  providers: [CycleCountService, CycleCountGateway, CycleCountProcessor],
  exports: [CycleCountService],
})
export class CycleCountModule {}
