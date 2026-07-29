import { IsString, IsOptional, IsBoolean, IsEnum, MaxLength } from 'class-validator';

export enum BarcodeTypeDto {
  EAN13 = 'EAN13',
  UPC = 'UPC',
  CODE128 = 'CODE128',
  QR = 'QR',
  DATAMATRIX = 'DATAMATRIX',
}

export class GenerateBarcodeDto {
  @IsString()
  inventoryItemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  qrCode?: string;

  @IsOptional()
  @IsEnum(BarcodeTypeDto)
  type?: BarcodeTypeDto;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  labelTemplate?: string;
}
