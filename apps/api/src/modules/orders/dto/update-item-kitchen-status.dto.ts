import { IsEnum } from 'class-validator';
import { KitchenStatus } from '@prisma/client';

export class UpdateItemKitchenStatusDto {
  @IsEnum(KitchenStatus)
  kitchenStatus!: KitchenStatus;
}
