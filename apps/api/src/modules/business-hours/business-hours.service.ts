import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBusinessHoursDto, UpdateBusinessHoursDto } from './dto/business-hours.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BusinessHours } from '@prisma/client';

@Injectable()
export class BusinessHoursService {
  private readonly logger = new Logger(BusinessHoursService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async setHours(
    dto: CreateBusinessHoursDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<BusinessHours> {
    await this.ensureRestaurant(restaurantId, tenantId);

    const existing = await this.prisma.businessHours.findUnique({
      where: { restaurantId_dayOfWeek: { restaurantId, dayOfWeek: dto.dayOfWeek } },
    });

    if (existing) {
      const updated = await this.prisma.businessHours.update({
        where: { id: existing.id },
        data: {
          openTime: dto.openTime,
          closeTime: dto.closeTime,
          isClosed: dto.isClosed ?? false,
        },
      });

      await this.auditLogsService.log({
        action: 'BUSINESS_HOURS_UPDATED',
        resource: 'BusinessHours',
        resourceId: updated.id,
        userId,
        tenantId,
        oldValues: {
          openTime: existing.openTime,
          closeTime: existing.closeTime,
          isClosed: existing.isClosed,
        },
        newValues: {
          openTime: updated.openTime,
          closeTime: updated.closeTime,
          isClosed: updated.isClosed,
        },
        ...meta,
      });

      return updated;
    }

    const created = await this.prisma.businessHours.create({
      data: {
        restaurantId,
        tenantId,
        dayOfWeek: dto.dayOfWeek,
        openTime: dto.openTime,
        closeTime: dto.closeTime,
        isClosed: dto.isClosed ?? false,
      },
    });

    await this.auditLogsService.log({
      action: 'BUSINESS_HOURS_CREATED',
      resource: 'BusinessHours',
      resourceId: created.id,
      userId,
      tenantId,
      newValues: { dayOfWeek: dto.dayOfWeek, openTime: dto.openTime, closeTime: dto.closeTime },
      ...meta,
    });

    return created;
  }

  async findAll(restaurantId: string, tenantId: string): Promise<BusinessHours[]> {
    await this.ensureRestaurant(restaurantId, tenantId);

    return this.prisma.businessHours.findMany({
      where: { restaurantId, tenantId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async findOne(id: string, restaurantId: string, tenantId: string): Promise<BusinessHours> {
    const hours = await this.prisma.businessHours.findFirst({
      where: { id, restaurantId, tenantId },
    });
    if (!hours) {
      throw new NotFoundException('Business hours not found');
    }
    return hours;
  }

  async update(
    id: string,
    dto: UpdateBusinessHoursDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<BusinessHours> {
    const existing = await this.findOne(id, restaurantId, tenantId);

    const updated = await this.prisma.businessHours.update({
      where: { id },
      data: {
        ...(dto.openTime !== undefined && { openTime: dto.openTime }),
        ...(dto.closeTime !== undefined && { closeTime: dto.closeTime }),
        ...(dto.isClosed !== undefined && { isClosed: dto.isClosed }),
      },
    });

    await this.auditLogsService.log({
      action: 'BUSINESS_HOURS_UPDATED',
      resource: 'BusinessHours',
      resourceId: id,
      userId,
      tenantId,
      oldValues: {
        openTime: existing.openTime,
        closeTime: existing.closeTime,
        isClosed: existing.isClosed,
      },
      newValues: {
        openTime: updated.openTime,
        closeTime: updated.closeTime,
        isClosed: updated.isClosed,
      },
      ...meta,
    });

    return updated;
  }

  async remove(
    id: string,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.findOne(id, restaurantId, tenantId);

    await this.prisma.businessHours.delete({ where: { id } });

    await this.auditLogsService.log({
      action: 'BUSINESS_HOURS_DELETED',
      resource: 'BusinessHours',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });
  }

  private async ensureRestaurant(restaurantId: string, tenantId: string): Promise<void> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
  }
}
