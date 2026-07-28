import { IsObject, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRestaurantSettingsDto {
  @ApiPropertyOptional({
    description: 'Tax rate percentage',
    example: { taxRate: 8.5, taxInclusive: false },
  })
  @IsOptional()
  @IsObject()
  tax?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Receipt settings',
    example: { footer: 'Thank you!', printAuto: true },
  })
  @IsOptional()
  @IsObject()
  receipt?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Order settings',
    example: { autoAccept: false, prepTimeMinutes: 15 },
  })
  @IsOptional()
  @IsObject()
  orders?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Notification preferences',
    example: { sms: true, email: false },
  })
  @IsOptional()
  @IsObject()
  notifications?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Custom settings', example: { key: 'value' } })
  @IsOptional()
  @IsObject()
  custom?: Record<string, unknown>;
}
