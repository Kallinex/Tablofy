import { IsUUID, IsString } from 'class-validator';

export class MoveTableDto {
  @IsString()
  @IsUUID()
  newTableId!: string;
}
