import { IsString, IsOptional, IsInt, IsEnum, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVariantGroupDto {
  @ApiProperty({ example: 'Size' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Choose your size' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: ['SINGLE', 'MULTIPLE'], default: 'SINGLE' })
  @IsOptional()
  @IsEnum(['SINGLE', 'MULTIPLE'] as const)
  type?: 'SINGLE' | 'MULTIPLE';

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
