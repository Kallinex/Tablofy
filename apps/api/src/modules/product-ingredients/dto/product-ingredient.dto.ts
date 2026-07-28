import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductIngredientDto {
  @ApiProperty({ description: 'Product ID' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Ingredient ID' })
  @IsUUID()
  ingredientId!: string;

  @ApiPropertyOptional({ description: 'Supplier ID' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({ example: 0.5, description: 'Quantity of ingredient per product' })
  @IsNumber()
  @Min(0)
  quantity!: number;
}

export class UpdateProductIngredientDto {
  @ApiPropertyOptional({ description: 'Supplier ID' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ example: 0.75 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;
}
