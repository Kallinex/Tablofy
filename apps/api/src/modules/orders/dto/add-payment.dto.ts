import { IsString, IsNumber, Min, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class AddPaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tip?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  gatewayRef?: string;
}
