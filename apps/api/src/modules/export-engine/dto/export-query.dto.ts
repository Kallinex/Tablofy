import { IsOptional, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { PAGINATION_DEFAULTS } from '@tablofy/shared/constants';
import { Type } from 'class-transformer';
import { ReportType, ReportExportStatus } from '@prisma/client';
import { ExportType } from './generate-export.dto';

export class ExportQueryDto {
  @IsOptional()
  @IsEnum(ExportType)
  type?: ExportType;

  // These are Prisma enums; validating them rejects unknown filter values at the boundary
  // instead of letting them reach Prisma and fail with HTTP 500.
  @IsOptional()
  @IsEnum(ReportType)
  reportType?: ReportType;

  @IsOptional()
  @IsEnum(ReportExportStatus)
  status?: ReportExportStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT)
  limit?: number;
}
