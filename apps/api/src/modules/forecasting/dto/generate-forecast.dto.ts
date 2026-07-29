import { IsString, IsOptional, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum ForecastMethodDto {
  MOVING_AVERAGE = 'MOVING_AVERAGE',
  LINEAR_REGRESSION = 'LINEAR_REGRESSION',
  SEASONAL = 'SEASONAL',
  EXPONENTIAL_SMOOTHING = 'EXPONENTIAL_SMOOTHING',
}

export enum ConsumptionPeriodDto {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export class GenerateForecastDto {
  @IsString()
  inventoryItemId!: string;

  @IsOptional()
  @IsEnum(ConsumptionPeriodDto)
  period?: ConsumptionPeriodDto;

  @IsOptional()
  @IsEnum(ForecastMethodDto)
  method?: ForecastMethodDto;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  days?: number;
}
