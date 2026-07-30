import {
  IsString,
  IsArray,
  IsOptional,
  IsInt,
  MaxLength,
  Min,
  Max,
  IsDateString,
  IsObject,
} from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  rateLimitPerMin?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
