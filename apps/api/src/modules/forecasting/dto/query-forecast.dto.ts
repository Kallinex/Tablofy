import { IsOptional, IsString, IsEnum, IsNumber, Min } from 'class-validator';
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
