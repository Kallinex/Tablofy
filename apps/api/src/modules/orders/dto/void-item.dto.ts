import { IsOptional, IsString, MaxLength } from 'class-validator';

export class VoidItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
