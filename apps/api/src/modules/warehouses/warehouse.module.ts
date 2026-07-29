import { Module } from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { WarehousesController } from './warehouses.controller';
import { WarehousesGateway } from './warehouses.gateway';
import { WarehousesProcessor } from './warehouses.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [WarehousesController],
  providers: [WarehousesService, WarehousesGateway, WarehousesProcessor],
  exports: [WarehousesService, WarehousesGateway],
})
export class WarehousesModule {}
