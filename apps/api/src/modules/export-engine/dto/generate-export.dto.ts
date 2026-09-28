import { IsEnum, IsOptional, IsDateString, IsObject } from 'class-validator';
import { ReportType } from '@prisma/client';

export enum ExportType {
  CSV = 'CSV',
  EXCEL = 'EXCEL',
  PDF = 'PDF',
}

export class GenerateExportDto {
  @IsEnum(ExportType)
  type!: ExportType;

  // reportType is persisted as the ReportType enum. Validating it here (like `type`) rejects
  // unknown values at the boundary instead of failing later with a Prisma validation error
  // (HTTP 500). Values must match the enum exactly (uppercase).
  @IsEnum(ReportType)
  reportType!: ReportType;

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
