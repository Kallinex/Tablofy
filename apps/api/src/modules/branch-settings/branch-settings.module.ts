import { Module } from '@nestjs/common';
import { BranchSettingsService } from './branch-settings.service';
import { BranchSettingsController } from './branch-settings.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [BranchSettingsController],
  providers: [BranchSettingsService],
  exports: [BranchSettingsService],
})
export class BranchSettingsModule {}
