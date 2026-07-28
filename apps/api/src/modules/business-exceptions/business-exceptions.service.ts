import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateBusinessExceptionDto,
  UpdateBusinessExceptionDto,
} from './dto/business-exceptions.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BusinessException, Prisma } from '@prisma/client';

@Injectable()
export class BusinessExceptionsService {
  private readonly logger = new Logger(BusinessExceptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateBusinessExceptionDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<BusinessException> {
    await this.ensureRestaurant(restaurantId, tenantId);

    const created = await this.prisma.businessException.create({
      data: {
        restaurantId,
        tenantId,
        date: new Date(dto.date),
        openTime: dto.openTime,
        closeTime: dto.closeTime,
        isClosed: dto.isClosed ?? true,
        reason: dto.reason,
      },
    });

    await this.auditLogsService.log({
      action: 'BUSINESS_EXCEPTION_CREATED',
      resource: 'BusinessException',
      resourceId: created.id,
      userId,
      tenantId,
      newValues: { date: dto.date, reason: dto.reason, isClosed: created.isClosed },
      ...meta,
    });

    return created;
  }

  async findAll(
    restaurantId: string,
    tenantId: string,
    params?: { from?: string; to?: string },
  ): Promise<BusinessException[]> {
    await this.ensureRestaurant(restaurantId, tenantId);

    const where: Prisma.BusinessExceptionWhereInput = { restaurantId, tenantId };
    if (params?.from || params?.to) {
      where.date = {};
      if (params.from) where.date.gte = new Date(params.from);
      if (params.to) where.date.lte = new Date(params.to);
    }

    return this.prisma.businessException.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  async findOne(id: string, restaurantId: string, tenantId: string): Promise<BusinessException> {
    const exception = await this.prisma.businessException.findFirst({
      where: { id, restaurantId, tenantId },
    });
    if (!exception) {
      throw new NotFoundException('Business exception not found');
    }
    return exception;
  }

  async update(
    id: string,
    dto: UpdateBusinessExceptionDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<BusinessException> {
    const existing = await this.findOne(id, restaurantId, tenantId);

    const updated = await this.prisma.businessException.update({
      where: { id },
      data: {
        ...(dto.openTime !== undefined && { openTime: dto.openTime }),
        ...(dto.closeTime !== undefined && { closeTime: dto.closeTime }),
        ...(dto.isClosed !== undefined && { isClosed: dto.isClosed }),
        ...(dto.reason !== undefined && { reason: dto.reason }),
      },
    });

    await this.auditLogsService.log({
      action: 'BUSINESS_EXCEPTION_UPDATED',
      resource: 'BusinessException',
      resourceId: id,
      userId,
      tenantId,
      oldValues: {
        openTime: existing.openTime,
        closeTime: existing.closeTime,
        isClosed: existing.isClosed,
        reason: existing.reason,
      },
      newValues: {
        openTime: updated.openTime,
        closeTime: updated.closeTime,
        isClosed: updated.isClosed,
        reason: updated.reason,
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

    await this.prisma.businessException.delete({ where: { id } });

    await this.auditLogsService.log({
      action: 'BUSINESS_EXCEPTION_DELETED',
      resource: 'BusinessException',
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
