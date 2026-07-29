import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class AdjustPointsDto {
  @IsInt()
  @Min(1)
  points!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;
}
