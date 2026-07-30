import { IsString, IsEnum, IsOptional, IsDateString, IsObject } from 'class-validator';

export enum ExportType {
  CSV = 'CSV',
  EXCEL = 'EXCEL',
  PDF = 'PDF',
}

export class GenerateExportDto {
  @IsEnum(ExportType)
  type!: ExportType;

  @IsString()
  reportType!: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
