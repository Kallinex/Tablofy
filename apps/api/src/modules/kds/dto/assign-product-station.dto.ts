import { IsString, IsUUID } from 'class-validator';

export class AssignProductStationDto {
  @IsString()
  @IsUUID()
  productId!: string;

  @IsString()
  @IsUUID()
  stationId!: string;
}
