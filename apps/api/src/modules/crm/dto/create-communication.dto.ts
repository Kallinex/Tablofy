import { IsString, IsOptional, IsEnum, IsObject, IsUUID } from 'class-validator';
import { CommunicationChannel } from '@prisma/client';

export class CreateCommunicationDto {
  @IsEnum(CommunicationChannel)
  channel!: CommunicationChannel;

  @IsString()
  recipient!: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
