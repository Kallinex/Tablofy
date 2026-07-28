import { IsString, IsOptional, IsEnum, IsNumber, Min, MaxLength } from 'class-validator';
import { DiscountType } from '@prisma/client';

export class ApplyDiscountDto {
  @IsEnum(DiscountType)
  discountType!: DiscountType;

  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
