import { IsString, MinLength } from 'class-validator';

export class SsoExchangeDto {
  @IsString()
  @MinLength(16)
  code!: string;
}
