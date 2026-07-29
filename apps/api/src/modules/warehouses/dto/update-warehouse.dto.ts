import { IsString, IsOptional, IsEnum, IsBoolean, MaxLength } from 'class-validator';
import { WarehouseType, WarehouseStatus } from '@prisma/client';

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsEnum(WarehouseType)
  type?: WarehouseType;

  @IsOptional()
  @IsEnum(WarehouseStatus)
  status?: WarehouseStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  capacity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  capacityUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  managerName?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
