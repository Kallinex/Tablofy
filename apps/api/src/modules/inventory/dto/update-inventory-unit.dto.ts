import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { InventoryUnitType } from '@prisma/client';

export class UpdateInventoryUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  abbreviation?: string;

  @IsOptional()
  @IsEnum(InventoryUnitType)
  type?: InventoryUnitType;
}
