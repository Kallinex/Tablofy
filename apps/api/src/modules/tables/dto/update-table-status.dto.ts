import { IsEnum } from 'class-validator';
import { TableStatus } from '@prisma/client';

export class UpdateTableStatusDto {
  @IsEnum(TableStatus)
  status!: TableStatus;
}
