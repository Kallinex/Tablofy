import { IsEnum, IsString, IsOptional, MaxLength } from 'class-validator';
import { MembershipTier } from '@prisma/client';

export class MembershipUpgradeDto {
  @IsEnum(MembershipTier)
  tier!: MembershipTier;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
