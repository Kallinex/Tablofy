import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { PAGINATION_DEFAULTS } from '@tablofy/shared/constants';
import { Type } from 'class-transformer';
import { PromotionType, PromotionStatus } from '@prisma/client';

export class PromotionQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsEnum(PromotionType)
  type?: PromotionType;

  @IsOptional()
  @IsEnum(PromotionStatus)
  status?: PromotionStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  code?: string;
}
