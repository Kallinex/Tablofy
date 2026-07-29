import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ValuationMethod } from '@prisma/client';

export class QueryValuationDto {
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
  @IsEnum(ValuationMethod)
  method?: ValuationMethod;

  @IsOptional()
  @IsString()
  inventoryItemId?: string;
}

export class BatchValuationDto {
  @IsOptional()
  @IsEnum(ValuationMethod)
  method?: ValuationMethod;

  @IsOptional()
  @IsString({ each: true })
  inventoryItemIds?: string[];
}
