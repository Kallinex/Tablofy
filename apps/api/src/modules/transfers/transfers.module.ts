import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { TransfersGateway } from './transfers.gateway';
import { TransfersProcessor } from './transfers.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [TransfersController],
  providers: [TransfersService, TransfersGateway, TransfersProcessor],
  exports: [TransfersService, TransfersGateway],
})
export class TransfersModule {}
