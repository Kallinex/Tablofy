import { Module } from '@nestjs/common';
import { ExportEngineService } from './export-engine.service';
import { ExportEngineController } from './export-engine.controller';
import { ExportEngineProcessor } from './export-engine.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [ExportEngineController],
  providers: [ExportEngineService, ExportEngineProcessor],
  exports: [ExportEngineService],
})
export class ExportEngineModule {}
