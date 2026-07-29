import { IsString, IsOptional, IsNumber, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePerformanceDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  supplierDetailId?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  leadTimeAvg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  fillRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  deliveryAccuracy?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rejectedItems?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  averageDelay?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalOrders?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  onTimeDeliveries?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  qualityScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  costScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  overallScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rank?: number;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
