import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiveItemDto {
  @IsString()
  inventoryItemId!: string;

  @IsNumber()
  @Min(0)
  quantityReceived!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReceiveTransferDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items!: ReceiveItemDto[];
}
