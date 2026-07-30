import { IsNumber, Min, IsOptional, IsString, MaxLength } from 'class-validator';

export class PartialRefundDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
