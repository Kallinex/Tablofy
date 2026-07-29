import { Module } from '@nestjs/common';
import { RecipesService } from './recipes.service';
import { RecipesController } from './recipes.controller';
import { RecipesGateway } from './recipes.gateway';
import { RecipesProcessor } from './recipes.processor';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuditLogsModule, CommonModule],
  controllers: [RecipesController],
  providers: [RecipesService, RecipesGateway, RecipesProcessor],
  exports: [RecipesService, RecipesGateway],
})
export class RecipesModule {}
