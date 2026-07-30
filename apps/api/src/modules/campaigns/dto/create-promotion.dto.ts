import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsBoolean,
  IsArray,
  Min,
} from 'class-validator';
import { PromotionType, PromotionStatus } from '@prisma/client';

export class CreatePromotionDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PromotionType)
  type?: PromotionType;

  @IsOptional()
  @IsEnum(PromotionStatus)
  status?: PromotionStatus;

  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  buyQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  getQuantity?: number;

  @IsOptional()
  @IsString()
  freeProductId?: string;

  @IsOptional()
  @IsString()
  freeProductName?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  usagePerCustomer?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  usagePerTenant?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  isStackable?: boolean;

  @IsOptional()
  @IsArray()
  branchIds?: string[];

  @IsOptional()
  @IsArray()
  productIds?: string[];

  @IsOptional()
  @IsArray()
  categoryIds?: string[];
}
