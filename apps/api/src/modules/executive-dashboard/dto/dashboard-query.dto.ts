import { IsOptional, IsString, IsDateString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DashboardQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}
