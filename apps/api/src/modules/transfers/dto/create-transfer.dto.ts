import { IsString, IsOptional, IsArray, IsNumber, ValidateNested, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class TransferItemDto {
  @IsString()
  inventoryItemId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateTransferDto {
  @IsString()
  fromBranchId!: string;

  @IsString()
  toBranchId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items!: TransferItemDto[];
}
