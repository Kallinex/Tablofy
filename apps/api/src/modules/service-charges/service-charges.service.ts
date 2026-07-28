import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateServiceChargeDto, UpdateServiceChargeDto } from './dto/service-charge.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ServiceCharge, Prisma } from '@prisma/client';

@Injectable()
export class ServiceChargesService {
  private readonly logger = new Logger(ServiceChargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateServiceChargeDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ServiceCharge> {
    await this.ensureRestaurant(restaurantId, tenantId);

    const existing = await this.prisma.serviceCharge.findFirst({
      where: { restaurantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A service charge with this name already exists');
    }

    const sc = await this.prisma.serviceCharge.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        rate: dto.rate,
        isPercentage: dto.isPercentage ?? true,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      action: 'SERVICE_CHARGE_CREATED',
      resource: 'ServiceCharge',
      resourceId: sc.id,
      userId,
      tenantId,
      newValues: { name: sc.name, rate: sc.rate, isPercentage: sc.isPercentage },
      ...meta,
    });

    return sc;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    isActive?: boolean;
  }): Promise<{
    data: ServiceCharge[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, page = 1, limit = 20, isActive } = params;
    await this.ensureRestaurant(restaurantId, tenantId);

    const where: Prisma.ServiceChargeWhereInput = { restaurantId, tenantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.serviceCharge.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.serviceCharge.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, restaurantId: string, tenantId: string): Promise<ServiceCharge> {
    const sc = await this.prisma.serviceCharge.findFirst({
      where: { id, restaurantId, tenantId, deletedAt: null },
    });
    if (!sc) throw new NotFoundException('Service charge not found');
    return sc;
  }

  async update(
    id: string,
    dto: UpdateServiceChargeDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ServiceCharge> {
    const existing = await this.findOne(id, restaurantId, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.serviceCharge.findFirst({
        where: { restaurantId, name: dto.name, deletedAt: null, id: { not: id } },
      });
      if (nameTaken) throw new ConflictException('A service charge with this name already exists');
    }

    const updated = await this.prisma.serviceCharge.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.rate !== undefined && { rate: dto.rate }),
        ...(dto.isPercentage !== undefined && { isPercentage: dto.isPercentage }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'SERVICE_CHARGE_UPDATED',
      resource: 'ServiceCharge',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: existing.name, rate: existing.rate, isPercentage: existing.isPercentage },
      newValues: { name: updated.name, rate: updated.rate, isPercentage: updated.isPercentage },
      ...meta,
    });

    return updated;
  }

  async softDelete(
    id: string,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.findOne(id, restaurantId, tenantId);

    await this.prisma.serviceCharge.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'SERVICE_CHARGE_DELETED',
      resource: 'ServiceCharge',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });
  }

  async restore(
    id: string,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ServiceCharge> {
    const sc = await this.prisma.serviceCharge.findFirst({
      where: { id, restaurantId, tenantId, deletedAt: { not: null } },
    });
    if (!sc) throw new NotFoundException('Service charge not found');

    const restored = await this.prisma.serviceCharge.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'SERVICE_CHARGE_RESTORED',
      resource: 'ServiceCharge',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }

  private async ensureRestaurant(restaurantId: string, tenantId: string): Promise<void> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
  }
}
