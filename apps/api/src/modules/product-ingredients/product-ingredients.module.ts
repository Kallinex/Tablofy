import { Module } from '@nestjs/common';
import { ProductIngredientsService } from './product-ingredients.service';
import { ProductIngredientsController } from './product-ingredients.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [ProductIngredientsController],
  providers: [ProductIngredientsService],
  exports: [ProductIngredientsService],
})
export class ProductIngredientsModule {}
