import { IsUUID, IsString } from 'class-validator';

export class MergeOrdersDto {
  @IsString()
  @IsUUID()
  sourceOrderId!: string;
}
