import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, IsObject, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CampaignType, CampaignStatus } from '@prisma/client';

class CampaignTemplateDto {
  @IsEnum(CampaignType)
  channel!: CampaignType;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsArray()
  variables?: string[];
}

class CampaignTargetDto {
  @IsOptional()
  @IsArray()
  segmentIds?: string[];

  @IsOptional()
  @IsArray()
  customerIds?: string[];

  @IsOptional()
  @IsArray()
  tags?: string[];
}

export class CreateCampaignDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CampaignType)
  type?: CampaignType;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsNumber()
  budget?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignTemplateDto)
  template?: CampaignTemplateDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignTargetDto)
  targeting?: CampaignTargetDto;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
