import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Min } from 'class-validator';

export class RedeemGiftCardDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
