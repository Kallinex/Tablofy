import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ValuationMethod } from '@prisma/client';

export class CreateValuationDto {
  @IsString()
  inventoryItemId!: string;

  @IsDateString()
  valuationDate!: string;

  @IsOptional()
  @IsEnum(ValuationMethod)
  method?: ValuationMethod;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
