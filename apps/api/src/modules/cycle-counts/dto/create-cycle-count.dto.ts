import { IsString, IsOptional, IsEnum, IsDateString, MaxLength } from 'class-validator';
import { CycleCountStatus } from '@prisma/client';

export class CreateCycleCountDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsDateString()
  countDate!: string;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsEnum(CycleCountStatus)
  status?: CycleCountStatus;

  @IsOptional()
  @IsString()
  countType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
