import { IsString, IsOptional, IsEnum, IsBoolean, IsArray } from 'class-validator';
import { CommunicationChannel } from '@prisma/client';

export class CreateCommunicationTemplateDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(CommunicationChannel)
  channel?: CommunicationChannel;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
