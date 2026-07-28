import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDiningAreaDto } from './dto/create-dining-area.dto';
import { UpdateDiningAreaDto } from './dto/update-dining-area.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, DiningArea } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class DiningAreasService {
  private readonly logger = new Logger(DiningAreasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateDiningAreaDto,
    branchId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<DiningArea> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    const floor = await this.prisma.floor.findFirst({
      where: { id: dto.floorId, branchId, tenantId, deletedAt: null },
    });
    if (!floor) {
      throw new NotFoundException('Floor not found in this branch');
    }

    const existingName = await this.prisma.diningArea.findFirst({
      where: { branchId, name: dto.name, deletedAt: null },
    });
    if (existingName) {
      throw new ConflictException('A dining area with this name already exists in this branch');
    }

    const area = await this.prisma.diningArea.create({
      data: {
        branchId,
        floorId: dto.floorId,
        tenantId,
        name: dto.name,
        capacity: dto.capacity ?? 20,
        section: dto.section,
      },
    });

    await this.auditLogsService.log({
      action: 'DINING_AREA_CREATED',
      resource: 'DiningArea',
      resourceId: area.id,
      userId,
      tenantId,
      newValues: { name: area.name, capacity: area.capacity, branchId, floorId: dto.floorId },
      ...meta,
    });

    this.eventEmitter.emit('diningArea.created', {
      tenantId,
      branchId,
      floorId: dto.floorId,
      areaId: area.id,
    });

    return area;
  }

  async findAll(params: {
    tenantId: string;
    branchId?: string;
    floorId?: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: DiningArea[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, branchId, floorId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.DiningAreaWhereInput = { tenantId, deletedAt: null };
    if (branchId) where.branchId = branchId;
    if (floorId) where.floorId = floorId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { section: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.diningArea.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.diningArea.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<DiningArea> {
    const area = await this.prisma.diningArea.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!area) {
      throw new NotFoundException('Dining area not found');
    }

    return area;
  }

  async update(
    id: string,
    dto: UpdateDiningAreaDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<DiningArea> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.diningArea.findFirst({
        where: {
          branchId: existing.branchId,
          name: dto.name,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (nameTaken) {
        throw new ConflictException('A dining area with this name already exists in this branch');
      }
    }

    const area = await this.prisma.diningArea.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.section !== undefined && { section: dto.section }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'DINING_AREA_UPDATED',
      resource: 'DiningArea',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('diningArea.updated', {
      tenantId,
      branchId: existing.branchId,
      areaId: id,
    });

    return area;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    const tableCount = await this.prisma.table.count({
      where: { diningAreaId: id, deletedAt: null },
    });
    if (tableCount > 0) {
      throw new ConflictException(
        'Cannot delete dining area with active tables. Remove tables first.',
      );
    }

    await this.prisma.diningArea.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'DINING_AREA_DELETED',
      resource: 'DiningArea',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('diningArea.deleted', {
      tenantId,
      branchId: existing.branchId,
      areaId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<DiningArea> {
    const area = await this.prisma.diningArea.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!area) {
      throw new NotFoundException('Dining area not found');
    }

    const restored = await this.prisma.diningArea.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'DINING_AREA_RESTORED',
      resource: 'DiningArea',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
