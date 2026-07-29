import { IsString, IsOptional, IsEnum, IsBoolean, MaxLength } from 'class-validator';
import { SegmentType } from '@prisma/client';

export class UpdateSegmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(SegmentType)
  type?: SegmentType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  rules?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDynamic?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
