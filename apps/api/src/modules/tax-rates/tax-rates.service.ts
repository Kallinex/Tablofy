import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaxRateDto, UpdateTaxRateDto } from './dto/tax-rate.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { TaxRate, Prisma } from '@prisma/client';

@Injectable()
export class TaxRatesService {
  private readonly logger = new Logger(TaxRatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateTaxRateDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<TaxRate> {
    await this.ensureRestaurant(restaurantId, tenantId);

    const existing = await this.prisma.taxRate.findFirst({
      where: { restaurantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A tax rate with this name already exists');
    }

    const taxRate = await this.prisma.taxRate.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        rate: dto.rate,
        isCompound: dto.isCompound ?? false,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      action: 'TAX_RATE_CREATED',
      resource: 'TaxRate',
      resourceId: taxRate.id,
      userId,
      tenantId,
      newValues: { name: taxRate.name, rate: taxRate.rate, isCompound: taxRate.isCompound },
      ...meta,
    });

    return taxRate;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    isActive?: boolean;
  }): Promise<{
    data: TaxRate[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, page = 1, limit = 20, isActive } = params;
    await this.ensureRestaurant(restaurantId, tenantId);

    const where: Prisma.TaxRateWhereInput = { restaurantId, tenantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.taxRate.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.taxRate.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, restaurantId: string, tenantId: string): Promise<TaxRate> {
    const taxRate = await this.prisma.taxRate.findFirst({
      where: { id, restaurantId, tenantId, deletedAt: null },
    });
    if (!taxRate) throw new NotFoundException('Tax rate not found');
    return taxRate;
  }

  async update(
    id: string,
    dto: UpdateTaxRateDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<TaxRate> {
    const existing = await this.findOne(id, restaurantId, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.taxRate.findFirst({
        where: { restaurantId, name: dto.name, deletedAt: null, id: { not: id } },
      });
      if (nameTaken) throw new ConflictException('A tax rate with this name already exists');
    }

    const updated = await this.prisma.taxRate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.rate !== undefined && { rate: dto.rate }),
        ...(dto.isCompound !== undefined && { isCompound: dto.isCompound }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'TAX_RATE_UPDATED',
      resource: 'TaxRate',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: existing.name, rate: existing.rate, isCompound: existing.isCompound },
      newValues: { name: updated.name, rate: updated.rate, isCompound: updated.isCompound },
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

    await this.prisma.taxRate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'TAX_RATE_DELETED',
      resource: 'TaxRate',
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
  ): Promise<TaxRate> {
    const taxRate = await this.prisma.taxRate.findFirst({
      where: { id, restaurantId, tenantId, deletedAt: { not: null } },
    });
    if (!taxRate) throw new NotFoundException('Tax rate not found');

    const restored = await this.prisma.taxRate.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'TAX_RATE_RESTORED',
      resource: 'TaxRate',
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
