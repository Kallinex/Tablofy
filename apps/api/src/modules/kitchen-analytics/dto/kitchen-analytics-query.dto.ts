import { IsOptional, IsString, IsDateString, IsNumber, Min, Max } from 'class-validator';
import { PAGINATION_DEFAULTS } from '@tablofy/shared/constants';
import { Type } from 'class-transformer';

export class KitchenAnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT)
  limit?: number;
}
