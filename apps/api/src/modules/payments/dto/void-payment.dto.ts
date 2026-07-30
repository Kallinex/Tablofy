import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class VoidPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
