import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CustomersGateway } from './customers.gateway';
import { CustomersProcessor } from './customers.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersGateway, CustomersProcessor],
  exports: [CustomersService, CustomersGateway],
})
export class CustomersModule {}
