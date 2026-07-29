import { IsString, IsOptional, IsEnum, IsBoolean, IsInt, Min, MaxLength } from 'class-validator';
import { WarehouseZoneType } from '@prisma/client';

export class CreateZoneDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(50)
  code!: string;

  @IsOptional()
  @IsEnum(WarehouseZoneType)
  type?: WarehouseZoneType;

  @IsOptional()
  @IsString()
  capacity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  capacityUnit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
