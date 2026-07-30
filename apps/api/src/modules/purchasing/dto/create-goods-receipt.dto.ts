import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
  MaxLength,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GoodsReceiptItemDto {
  @IsString()
  purchaseOrderItemId!: string;

  @IsString()
  inventoryItemId!: string;

  @IsNumber()
  @Min(0.01)
  quantityReceived!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateGoodsReceiptDto {
  @IsString()
  purchaseOrderId!: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptItemDto)
  items!: GoodsReceiptItemDto[];
}
