import { IsString, IsOptional, IsInt, MaxLength } from 'class-validator';

export class CreateFloorDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsInt()
  level?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
