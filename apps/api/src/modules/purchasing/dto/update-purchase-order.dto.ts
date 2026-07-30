import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseOrderItemDto } from './create-purchase-order.dto';

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsString()
  supplierDetailId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplierReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items?: PurchaseOrderItemDto[];
}
