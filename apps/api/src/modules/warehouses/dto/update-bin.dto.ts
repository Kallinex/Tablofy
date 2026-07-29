import { IsString, IsOptional, IsEnum, IsBoolean, MaxLength } from 'class-validator';
import { StorageBinType, StorageBinStatus } from '@prisma/client';

export class UpdateBinDto {
  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsEnum(StorageBinType)
  type?: StorageBinType;

  @IsOptional()
  @IsEnum(StorageBinStatus)
  status?: StorageBinStatus;

  @IsOptional()
  @IsString()
  capacity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  capacityUnit?: string;

  @IsOptional()
  @IsString()
  currentLoad?: string;

  @IsOptional()
  @IsString()
  maxWeight?: string;

  @IsOptional()
  @IsString()
  length?: string;

  @IsOptional()
  @IsString()
  width?: string;

  @IsOptional()
  @IsString()
  height?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
