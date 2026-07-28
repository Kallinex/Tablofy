import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export class UpdateProductAvailabilityDto {
  @IsOptional()
  @IsEnum(DayOfWeek)
  dayOfWeek?: DayOfWeek;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  startTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  endTime?: string;
}
