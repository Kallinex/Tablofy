import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { InventoryLocationType } from '@prisma/client';

export class UpdateInventoryLocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsEnum(InventoryLocationType)
  type?: InventoryLocationType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
