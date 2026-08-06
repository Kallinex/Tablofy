import { IsString, Matches } from 'class-validator';

export class TwoFactorCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be a 6-digit number' })
  code!: string;
}

export class EnableTwoFactorDto extends TwoFactorCodeDto {}

export class DisableTwoFactorDto extends TwoFactorCodeDto {}
