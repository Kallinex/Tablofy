import { IsOptional, IsString, IsBoolean, IsInt, IsUUID, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ToBoolean } from '../../../common/transform/boolean.transform';

export class QueryProductDto {
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
  @IsString()
  search?: string;

  @ToBoolean()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ToBoolean()
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsUUID()
  menuCategoryId?: string;
}
