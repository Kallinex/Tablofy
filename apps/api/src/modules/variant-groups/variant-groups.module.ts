import { Module } from '@nestjs/common';
import { VariantGroupsService } from './variant-groups.service';
import { VariantGroupsController } from './variant-groups.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [VariantGroupsController],
  providers: [VariantGroupsService],
  exports: [VariantGroupsService],
})
export class VariantGroupsModule {}
