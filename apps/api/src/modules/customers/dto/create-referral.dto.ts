import { IsString, IsOptional, IsEmail, MaxLength } from 'class-validator';

export class CreateReferralDto {
  @IsOptional()
  @IsString()
  referredId?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  referredEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  referredPhone?: string;

  @IsString()
  @MaxLength(50)
  code!: string;
}
