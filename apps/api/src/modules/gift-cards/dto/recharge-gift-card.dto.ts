import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Min } from 'class-validator';

export class RechargeGiftCardDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;
}
