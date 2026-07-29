import { Module } from '@nestjs/common';
import { KdsService } from './kds.service';
import { KdsController } from './kds.controller';
import { KdsGateway } from './kds.gateway';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [KdsController],
  providers: [KdsService, KdsGateway],
  exports: [KdsService, KdsGateway],
})
export class KdsModule {}
