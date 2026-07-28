import { Module } from '@nestjs/common';
import { ModifierGroupsService } from './modifier-groups.service';
import { ModifierGroupsController } from './modifier-groups.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [ModifierGroupsController],
  providers: [ModifierGroupsService],
  exports: [ModifierGroupsService],
})
export class ModifierGroupsModule {}
