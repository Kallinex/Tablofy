import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { TimelineEventType } from '@prisma/client';

export class CreateTimelineEntryDto {
  @IsEnum(TimelineEventType)
  type!: TimelineEventType;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;
}
