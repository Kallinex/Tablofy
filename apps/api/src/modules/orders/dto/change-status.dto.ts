import { IsString, IsOptional, IsEnum, IsNumber, Min, MaxLength, IsUUID, IsBoolean } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class ChangeStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
