import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefundPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
