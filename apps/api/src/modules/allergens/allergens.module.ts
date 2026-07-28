import { Module } from '@nestjs/common';
import { AllergensService } from './allergens.service';
import { AllergensController } from './allergens.controller';
import { ProductAllergenAssignmentsController } from './allergen-assignments.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [AuditLogsModule],
  controllers: [AllergensController, ProductAllergenAssignmentsController],
  providers: [AllergensService],
  exports: [AllergensService],
})
export class AllergensModule {}
