import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { CycleCountStatus } from '@prisma/client';

export class QueryCycleCountDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(CycleCountStatus)
  status?: CycleCountStatus;

  @IsOptional()
  @IsString()
  countType?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}
