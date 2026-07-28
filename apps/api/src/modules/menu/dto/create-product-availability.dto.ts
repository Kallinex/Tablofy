import { IsEnum, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export class CreateProductAvailabilityDto {
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  endTime!: string;
}
