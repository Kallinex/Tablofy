import { IsString, IsOptional, IsInt, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateDiningAreaDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsUUID()
  floorId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  section?: string;
}
