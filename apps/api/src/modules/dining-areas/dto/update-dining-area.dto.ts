import { IsString, IsOptional, IsBoolean, IsInt, MaxLength, Min } from 'class-validator';

export class UpdateDiningAreaDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  section?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
