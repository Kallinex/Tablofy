import { IsString, IsOptional, IsNumber, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum ReorderPriorityDto {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export class CreateReorderSuggestionDto {
  @IsString()
  inventoryItemId!: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  suggestedQuantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  currentStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  safetyStock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  eoq?: number;

  @IsOptional()
  @IsEnum(ReorderPriorityDto)
  priority?: ReorderPriorityDto;

  @IsOptional()
  @IsString()
  notes?: string;
}
