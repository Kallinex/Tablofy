import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class EarnPointsDto {
  @IsInt()
  @Min(1)
  points!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  restaurantId?: string;
}
