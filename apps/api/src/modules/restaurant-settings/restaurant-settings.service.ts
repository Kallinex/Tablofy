import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateRestaurantSettingsDto } from './dto/update-restaurant-settings.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, Restaurant } from '@prisma/client';

@Injectable()
export class RestaurantSettingsService {
  private readonly logger = new Logger(RestaurantSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getSettings(restaurantId: string, tenantId: string): Promise<Restaurant> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    return restaurant;
  }

  async updateSettings(
    restaurantId: string,
    dto: UpdateRestaurantSettingsDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Restaurant> {
    const existing = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Restaurant not found');
    }

    const currentMetadata = (existing.metadata as Record<string, unknown>) ?? {};

    const mergedMetadata: Record<string, unknown> = { ...currentMetadata };
    if (dto.tax !== undefined) mergedMetadata.tax = dto.tax;
    if (dto.receipt !== undefined) mergedMetadata.receipt = dto.receipt;
    if (dto.orders !== undefined) mergedMetadata.orders = dto.orders;
    if (dto.notifications !== undefined) mergedMetadata.notifications = dto.notifications;
    if (dto.custom !== undefined) mergedMetadata.custom = dto.custom;

    const updated = await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: { metadata: mergedMetadata as Prisma.InputJsonValue },
    });

    await this.auditLogsService.log({
      action: 'RESTAURANT_SETTINGS_UPDATED',
      resource: 'Restaurant',
      resourceId: restaurantId,
      userId,
      tenantId,
      oldValues: { metadata: currentMetadata },
      newValues: { metadata: mergedMetadata },
      ...meta,
    });

    return updated;
  }
}
