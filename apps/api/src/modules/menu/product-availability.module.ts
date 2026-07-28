import { Module } from '@nestjs/common';
import { ProductAvailabilityService } from './product-availability.service';
import { ProductAvailabilityController } from './product-availability.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [ProductAvailabilityController],
  providers: [ProductAvailabilityService],
  exports: [ProductAvailabilityService],
})
export class ProductAvailabilityModule {}
