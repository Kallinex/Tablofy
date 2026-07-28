import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVariantGroupDto } from './dto/create-variant-group.dto';
import { UpdateVariantGroupDto } from './dto/update-variant-group.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, VariantGroup } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class VariantGroupsService {
  private readonly logger = new Logger(VariantGroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateVariantGroupDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<VariantGroup> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const existingName = await this.prisma.variantGroup.findFirst({
      where: { restaurantId, name: dto.name, deletedAt: null },
    });
    if (existingName) {
      throw new ConflictException('A variant group with this name already exists');
    }

    const variantGroup = await this.prisma.variantGroup.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        description: dto.description,
        type: dto.type ?? 'SINGLE',
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLogsService.log({
      action: 'VARIANT_GROUP_CREATED',
      resource: 'VariantGroup',
      resourceId: variantGroup.id,
      userId,
      tenantId,
      newValues: {
        name: variantGroup.name,
        type: variantGroup.type,
        sortOrder: variantGroup.sortOrder,
        restaurantId,
      },
      ...meta,
    });

    this.eventEmitter.emit('variantGroup.created', {
      tenantId,
      restaurantId,
      variantGroupId: variantGroup.id,
    });

    return variantGroup;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: VariantGroup[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.VariantGroupWhereInput = { tenantId, restaurantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.variantGroup.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.variantGroup.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<VariantGroup> {
    const variantGroup = await this.prisma.variantGroup.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!variantGroup) {
      throw new NotFoundException('Variant group not found');
    }

    return variantGroup;
  }

  async update(
    id: string,
    dto: UpdateVariantGroupDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<VariantGroup> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.variantGroup.findFirst({
        where: {
          restaurantId: existing.restaurantId,
          name: dto.name,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (nameTaken) {
        throw new ConflictException('A variant group with this name already exists');
      }
    }

    const variantGroup = await this.prisma.variantGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'VARIANT_GROUP_UPDATED',
      resource: 'VariantGroup',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('variantGroup.updated', {
      tenantId,
      restaurantId: existing.restaurantId,
      variantGroupId: id,
    });

    return variantGroup;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    const variantCount = await this.prisma.productVariant.count({
      where: { variantGroupId: id, deletedAt: null },
    });
    if (variantCount > 0) {
      throw new ConflictException(
        'Cannot delete variant group with active variants. Remove variants first.',
      );
    }

    await this.prisma.variantGroup.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'VARIANT_GROUP_DELETED',
      resource: 'VariantGroup',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('variantGroup.deleted', {
      tenantId,
      restaurantId: existing.restaurantId,
      variantGroupId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<VariantGroup> {
    const variantGroup = await this.prisma.variantGroup.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!variantGroup) {
      throw new NotFoundException('Variant group not found');
    }

    const restored = await this.prisma.variantGroup.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'VARIANT_GROUP_RESTORED',
      resource: 'VariantGroup',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
