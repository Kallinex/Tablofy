import { IsString, IsEnum, IsNumber, IsOptional, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { AdjustmentType, AdjustmentReason } from '@prisma/client';

export class CreateStockAdjustmentDto {
  @IsString()
  inventoryItemId!: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsEnum(AdjustmentType)
  type!: AdjustmentType;

  @IsEnum(AdjustmentReason)
  reason!: AdjustmentReason;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
