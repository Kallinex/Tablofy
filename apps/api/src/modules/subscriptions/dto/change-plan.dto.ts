import { IsEnum } from 'class-validator';
import { PlanType } from '@prisma/client';

export class ChangePlanDto {
  @IsEnum(PlanType)
  plan!: PlanType;
}
