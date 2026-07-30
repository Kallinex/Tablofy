import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';

export enum GroupByPeriod {
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

export class SalesAnalyticsQueryDto {
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
  @IsEnum(GroupByPeriod)
  groupBy?: GroupByPeriod;

  @IsOptional()
  @IsDateString()
  period1Start?: string;

  @IsOptional()
  @IsDateString()
  period1End?: string;

  @IsOptional()
  @IsDateString()
  period2Start?: string;

  @IsOptional()
  @IsDateString()
  period2End?: string;
}
