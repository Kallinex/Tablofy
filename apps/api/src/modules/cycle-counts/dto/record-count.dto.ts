import { IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class RecordCountDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualQuantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
