import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class CreateEventRuleDto {
  @IsString()
  name!: string;

  @IsString()
  event!: string;

  @IsOptional()
  @IsObject()
  condition?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  action?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}
