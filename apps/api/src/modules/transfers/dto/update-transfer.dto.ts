import { IsString, IsOptional, IsArray, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { TransferItemDto } from './create-transfer.dto';

export class UpdateTransferDto {
  @IsOptional()
  @IsString()
  fromBranchId?: string;

  @IsOptional()
  @IsString()
  toBranchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items?: TransferItemDto[];
}
