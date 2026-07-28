import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, ModifierGroup } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ModifierGroupsService {
  private readonly logger = new Logger(ModifierGroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateModifierGroupDto,
    restaurantId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ModifierGroup> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const existingName = await this.prisma.modifierGroup.findFirst({
      where: { restaurantId, name: dto.name, deletedAt: null },
    });
    if (existingName) {
      throw new ConflictException('A modifier group with this name already exists');
    }

    const modifierGroup = await this.prisma.modifierGroup.create({
      data: {
        restaurantId,
        tenantId,
        name: dto.name,
        description: dto.description,
        minSelection: dto.minSelection ?? 0,
        maxSelection: dto.maxSelection,
        isRequired: dto.isRequired ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLogsService.log({
      action: 'MODIFIER_GROUP_CREATED',
      resource: 'ModifierGroup',
      resourceId: modifierGroup.id,
      userId,
      tenantId,
      newValues: {
        name: modifierGroup.name,
        isRequired: modifierGroup.isRequired,
        restaurantId,
      },
      ...meta,
    });

    this.eventEmitter.emit('modifierGroup.created', {
      tenantId,
      restaurantId,
      modifierGroupId: modifierGroup.id,
    });

    return modifierGroup;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: ModifierGroup[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.ModifierGroupWhereInput = { tenantId, restaurantId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.modifierGroup.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.modifierGroup.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<ModifierGroup> {
    const modifierGroup = await this.prisma.modifierGroup.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!modifierGroup) {
      throw new NotFoundException('Modifier group not found');
    }

    return modifierGroup;
  }

  async update(
    id: string,
    dto: UpdateModifierGroupDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ModifierGroup> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.modifierGroup.findFirst({
        where: {
          restaurantId: existing.restaurantId,
          name: dto.name,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (nameTaken) {
        throw new ConflictException('A modifier group with this name already exists');
      }
    }

    const modifierGroup = await this.prisma.modifierGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.minSelection !== undefined && { minSelection: dto.minSelection }),
        ...(dto.maxSelection !== undefined && { maxSelection: dto.maxSelection }),
        ...(dto.isRequired !== undefined && { isRequired: dto.isRequired }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'MODIFIER_GROUP_UPDATED',
      resource: 'ModifierGroup',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('modifierGroup.updated', {
      tenantId,
      restaurantId: existing.restaurantId,
      modifierGroupId: id,
    });

    return modifierGroup;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    const modifierCount = await this.prisma.modifier.count({
      where: { modifierGroupId: id, deletedAt: null },
    });
    if (modifierCount > 0) {
      throw new ConflictException(
        'Cannot delete modifier group with active modifiers. Remove modifiers first.',
      );
    }

    await this.prisma.modifierGroup.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'MODIFIER_GROUP_DELETED',
      resource: 'ModifierGroup',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('modifierGroup.deleted', {
      tenantId,
      restaurantId: existing.restaurantId,
      modifierGroupId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<ModifierGroup> {
    const modifierGroup = await this.prisma.modifierGroup.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!modifierGroup) {
      throw new NotFoundException('Modifier group not found');
    }

    const restored = await this.prisma.modifierGroup.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'MODIFIER_GROUP_RESTORED',
      resource: 'ModifierGroup',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
