import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { StorageBinType } from '@prisma/client';

export class CreateBinDto {
  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(50)
  code!: string;

  @IsOptional()
  @IsEnum(StorageBinType)
  type?: StorageBinType;

  @IsOptional()
  @IsString()
  capacity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  capacityUnit?: string;

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
}
