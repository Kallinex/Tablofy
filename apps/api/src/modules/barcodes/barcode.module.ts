import { Module } from '@nestjs/common';
import { BarcodeService } from './barcode.service';
import { BarcodeController } from './barcode.controller';
import { BarcodeGateway } from './barcode.gateway';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [BarcodeController],
  providers: [BarcodeService, BarcodeGateway],
  exports: [BarcodeService],
})
export class BarcodeModule {}
