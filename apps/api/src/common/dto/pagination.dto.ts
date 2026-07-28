import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { PAGINATION_DEFAULTS } from '@tablofy/shared/constants';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = PAGINATION_DEFAULTS.PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT)
  limit?: number = PAGINATION_DEFAULTS.LIMIT;

  @IsOptional()
  @IsString()
  sortBy?: string = PAGINATION_DEFAULTS.SORT_BY;

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = PAGINATION_DEFAULTS.SORT_ORDER;

  @IsOptional()
  @IsString()
  search?: string;
}
