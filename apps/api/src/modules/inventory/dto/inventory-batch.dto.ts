import { IsString, IsOptional, IsNumber, IsDateString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInventoryBatchDto {
  @IsString()
  inventoryItemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lotNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;
}
