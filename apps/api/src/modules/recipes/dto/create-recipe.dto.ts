import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  IsArray,
  ValidateNested,
  IsInt,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RecipeItemDto {
  @IsString()
  inventoryItemId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wastePercentage?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateRecipeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  yield?: number;

  @IsOptional()
  @IsString()
  servingUnit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  preparationTime?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cookingTime?: number;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeItemDto)
  items?: RecipeItemDto[];
}
