import { IsString, IsOptional, IsInt, IsUUID, IsObject, MaxLength, Min } from 'class-validator';

export class CreateTableDto {
  @IsString()
  @MaxLength(50)
  number!: string;

  @IsUUID()
  diningAreaId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  seats?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  qrCode?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
