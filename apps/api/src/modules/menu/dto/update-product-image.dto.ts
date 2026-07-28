import { IsString, IsOptional, IsBoolean, IsInt, IsUrl, MaxLength, Min } from 'class-validator';

export class UpdateProductImageDto {
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
