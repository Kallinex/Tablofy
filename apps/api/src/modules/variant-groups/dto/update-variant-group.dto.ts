import { IsString, IsOptional, IsInt, IsEnum, IsBoolean, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVariantGroupDto {
  @ApiPropertyOptional({ example: 'Size' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: ['SINGLE', 'MULTIPLE'] })
  @IsOptional()
  @IsEnum(['SINGLE', 'MULTIPLE'] as const)
  type?: 'SINGLE' | 'MULTIPLE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
