import {
  IsString,
  IsArray,
  IsOptional,
  IsInt,
  IsUrl,
  MaxLength,
  Min,
  Max,
  IsObject,
  IsBoolean,
} from 'class-validator';

export class CreateWebhookDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  events!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  retryCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
