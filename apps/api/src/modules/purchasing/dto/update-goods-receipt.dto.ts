import { IsString, IsOptional, IsArray, IsNumber, Min, MaxLength, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { GoodsReceiptItemDto } from './create-goods-receipt.dto';

export class UpdateGoodsReceiptDto {
  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptItemDto)
  items?: GoodsReceiptItemDto[];
}
