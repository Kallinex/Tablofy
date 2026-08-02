import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';
import { Currency, GiftCardIssueType } from '@prisma/client';

export class CreateGiftCardDto {
  @IsNumber()
  @Min(0)
  initialBalance!: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  recipientName?: string;

  @IsOptional()
  @IsString()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsEnum(GiftCardIssueType)
  issueType?: GiftCardIssueType;
}
