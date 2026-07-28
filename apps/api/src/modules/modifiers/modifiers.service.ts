import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateModifierDto } from './dto/create-modifier.dto';
import { UpdateModifierDto } from './dto/update-modifier.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, Modifier } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ModifiersService {
  private readonly logger = new Logger(ModifiersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateModifierDto,
    modifierGroupId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Modifier> {
    const group = await this.prisma.modifierGroup.findFirst({
      where: { id: modifierGroupId, tenantId, deletedAt: null },
    });
    if (!group) {
      throw new NotFoundException('Modifier group not found');
    }

    const existingName = await this.prisma.modifier.findFirst({
      where: { modifierGroupId, name: dto.name, deletedAt: null },
    });
    if (existingName) {
      throw new ConflictException('A modifier with this name already exists in this group');
    }

    const modifier = await this.prisma.modifier.create({
      data: {
        modifierGroupId,
        tenantId,
        name: dto.name,
        price: dto.price,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLogsService.log({
      action: 'MODIFIER_CREATED',
      resource: 'Modifier',
      resourceId: modifier.id,
      userId,
      tenantId,
      newValues: {
        name: modifier.name,
        price: modifier.price,
        modifierGroupId,
      },
      ...meta,
    });

    this.eventEmitter.emit('modifier.created', {
      tenantId,
      modifierGroupId,
      modifierId: modifier.id,
    });

    return modifier;
  }

  async findAll(params: {
    tenantId: string;
    modifierGroupId: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: Modifier[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, modifierGroupId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.ModifierWhereInput = { tenantId, modifierGroupId, deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
    }

    const [data, total] = await Promise.all([
      this.prisma.modifier.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.modifier.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<Modifier> {
    const modifier = await this.prisma.modifier.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!modifier) {
      throw new NotFoundException('Modifier not found');
    }

    return modifier;
  }

  async update(
    id: string,
    dto: UpdateModifierDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Modifier> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.modifier.findFirst({
        where: {
          modifierGroupId: existing.modifierGroupId,
          name: dto.name,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (nameTaken) {
        throw new ConflictException('A modifier with this name already exists in this group');
      }
    }

    const modifier = await this.prisma.modifier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'MODIFIER_UPDATED',
      resource: 'Modifier',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('modifier.updated', {
      tenantId,
      modifierGroupId: existing.modifierGroupId,
      modifierId: id,
    });

    return modifier;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.modifier.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'MODIFIER_DELETED',
      resource: 'Modifier',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('modifier.deleted', {
      tenantId,
      modifierGroupId: existing.modifierGroupId,
      modifierId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Modifier> {
    const modifier = await this.prisma.modifier.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!modifier) {
      throw new NotFoundException('Modifier not found');
    }

    const restored = await this.prisma.modifier.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'MODIFIER_RESTORED',
      resource: 'Modifier',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
