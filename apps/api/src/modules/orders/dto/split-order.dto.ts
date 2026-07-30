import {
  IsUUID,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class SplitOrderItemDto {
  @IsString()
  @IsUUID()
  id!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class SplitOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  newOrderNotes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitOrderItemDto)
  items!: SplitOrderItemDto[];
}
