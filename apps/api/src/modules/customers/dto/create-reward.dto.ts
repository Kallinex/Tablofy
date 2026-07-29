import { IsString, IsOptional, IsEnum, IsNumber, IsDateString, MaxLength, Min } from 'class-validator';
import { RewardType } from '@prisma/client';

export class CreateRewardDto {
  @IsEnum(RewardType)
  type!: RewardType;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsString()
  freeProductId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  freeProductName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsDateString()
  expiredAt?: string;

  @IsOptional()
  @IsString()
  restaurantId?: string;
}
