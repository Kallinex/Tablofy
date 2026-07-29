import { Module } from '@nestjs/common';
import { SupplierPerformanceService } from './supplier-performance.service';
import { SupplierPerformanceController } from './supplier-performance.controller';
import { SupplierPerformanceProcessor } from './supplier-performance.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [SupplierPerformanceController],
  providers: [SupplierPerformanceService, SupplierPerformanceProcessor],
  exports: [SupplierPerformanceService],
})
export class SupplierPerformanceModule {}
