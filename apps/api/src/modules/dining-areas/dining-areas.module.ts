import { Module } from '@nestjs/common';
import { DiningAreasService } from './dining-areas.service';
import { DiningAreasController } from './dining-areas.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [DiningAreasController],
  providers: [DiningAreasService],
  exports: [DiningAreasService],
})
export class DiningAreasModule {}
