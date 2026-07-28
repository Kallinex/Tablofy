import { IsString, IsUUID } from 'class-validator';

export class ApplyServiceChargeDto {
  @IsString()
  @IsUUID()
  serviceChargeId!: string;
}
