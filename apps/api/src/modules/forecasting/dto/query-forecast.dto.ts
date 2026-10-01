import { IsOptional, IsString, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { PAGINATION_DEFAULTS } from '@tablofy/shared/constants';
import { Type } from 'class-transformer';
import { ConsumptionPeriodDto } from './generate-forecast.dto';

export class QueryForecastDto {
  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsEnum(ConsumptionPeriodDto)
  period?: ConsumptionPeriodDto;

  @IsOptional()
  @Type(() => Date)
  fromDate?: Date;

  @IsOptional()
  @Type(() => Date)
  toDate?: Date;
}
