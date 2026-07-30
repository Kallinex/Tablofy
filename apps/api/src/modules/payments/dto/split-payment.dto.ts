import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsEnum,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export class SplitItemDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tip?: number;
}

export class SplitPaymentDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ValidateNested({ each: true })
  @Type(() => SplitItemDto)
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  splits!: SplitItemDto[];
}
