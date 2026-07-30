import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsNumber,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderType } from '@prisma/client';

class CreateOrderItemModifierDto {
  @IsOptional()
  @IsString()
  modifierId?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @IsNumber()
  @Min(0)
  price!: number;
}

class CreateOrderItemDto {
  @IsString()
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
  productName!: string;

  @IsOptional()
  @IsString()
  variantName?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  preparationNotes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemModifierDto)
  modifiers?: CreateOrderItemModifierDto[];
}

export class CreateOrderDto {
  @IsString()
  @IsUUID()
  restaurantId!: string;

  @IsString()
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  tableId?: string;

  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  @IsOptional()
  @IsString()
  source?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
