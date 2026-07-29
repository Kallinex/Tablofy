import { IsString, IsEnum, IsNumber, IsOptional, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { CountType } from '@prisma/client';

export class CreateInventoryCountDto {
  @IsString()
  inventoryItemId!: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsEnum(CountType)
  countType!: CountType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedQuantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualQuantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
