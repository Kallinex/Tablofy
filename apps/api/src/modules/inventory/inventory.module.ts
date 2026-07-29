import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryGateway } from './inventory.gateway';
import { InventoryProcessor } from './inventory.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryGateway, InventoryProcessor],
  exports: [InventoryService, InventoryGateway],
})
export class InventoryModule {}
