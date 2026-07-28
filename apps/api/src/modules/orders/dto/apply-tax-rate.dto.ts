import { IsString, IsUUID } from 'class-validator';

export class ApplyTaxRateDto {
  @IsString()
  @IsUUID()
  taxRateId!: string;
}
