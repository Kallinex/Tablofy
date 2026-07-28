import { Module } from '@nestjs/common';
import { ServiceChargesService } from './service-charges.service';
import { ServiceChargesController } from './service-charges.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [ServiceChargesController],
  providers: [ServiceChargesService],
  exports: [ServiceChargesService],
})
export class ServiceChargesModule {}
