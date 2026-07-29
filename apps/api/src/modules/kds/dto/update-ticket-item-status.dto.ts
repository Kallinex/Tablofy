import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TicketItemStatus } from '@prisma/client';

export class UpdateTicketItemStatusDto {
  @IsEnum(TicketItemStatus)
  status!: TicketItemStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
