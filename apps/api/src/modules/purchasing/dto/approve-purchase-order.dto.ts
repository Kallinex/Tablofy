import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApprovePurchaseOrderDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
