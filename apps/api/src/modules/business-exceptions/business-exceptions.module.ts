import { Module } from '@nestjs/common';
import { BusinessExceptionsService } from './business-exceptions.service';
import { BusinessExceptionsController } from './business-exceptions.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [BusinessExceptionsController],
  providers: [BusinessExceptionsService],
  exports: [BusinessExceptionsService],
})
export class BusinessExceptionsModule {}
