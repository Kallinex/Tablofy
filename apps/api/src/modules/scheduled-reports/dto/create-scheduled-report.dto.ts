import { IsString, IsEnum, IsOptional, IsObject, IsArray, IsBoolean } from 'class-validator';

export enum ReportType {
  SALES = 'SALES',
  INVENTORY = 'INVENTORY',
  KITCHEN = 'KITCHEN',
  FINANCIAL = 'FINANCIAL',
  CUSTOM = 'CUSTOM',
}

export enum ReportFormat {
  CSV = 'CSV',
  EXCEL = 'EXCEL',
  PDF = 'PDF',
}

export class CreateScheduledReportDto {
  @IsString()
  name!: string;

  @IsEnum(ReportType)
  type!: ReportType;

  @IsEnum(ReportFormat)
  format!: ReportFormat;

  @IsString()
  schedule!: string;

  @IsArray()
  recipients!: string[];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
