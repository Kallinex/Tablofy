import { IsObject, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBranchSettingsDto {
  @ApiPropertyOptional({ description: 'Branch-specific tax overrides', example: { taxRate: 9.0 } })
  @IsOptional()
  @IsObject()
  tax?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Branch-specific receipt settings',
    example: { footer: 'Welcome to our branch!' },
  })
  @IsOptional()
  @IsObject()
  receipt?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Branch-specific order settings',
    example: { maxOrders: 50 },
  })
  @IsOptional()
  @IsObject()
  orders?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Branch-specific settings', example: { key: 'value' } })
  @IsOptional()
  @IsObject()
  custom?: Record<string, unknown>;
}
