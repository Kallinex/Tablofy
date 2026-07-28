import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFloorDto } from './dto/create-floor.dto';
import { UpdateFloorDto } from './dto/update-floor.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Prisma, Floor } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class FloorsService {
  private readonly logger = new Logger(FloorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateFloorDto,
    restaurantId: string,
    branchId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Floor> {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId, deletedAt: null },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, restaurantId, tenantId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    const existingName = await this.prisma.floor.findFirst({
      where: { branchId, name: dto.name, deletedAt: null },
    });
    if (existingName) {
      throw new ConflictException('A floor with this name already exists in this branch');
    }

    const floor = await this.prisma.floor.create({
      data: {
        restaurantId,
        branchId,
        tenantId,
        name: dto.name,
        level: dto.level ?? 1,
        description: dto.description,
      },
    });

    await this.auditLogsService.log({
      action: 'FLOOR_CREATED',
      resource: 'Floor',
      resourceId: floor.id,
      userId,
      tenantId,
      newValues: { name: floor.name, level: floor.level, restaurantId, branchId },
      ...meta,
    });

    this.eventEmitter.emit('floor.created', {
      tenantId,
      restaurantId,
      branchId,
      floorId: floor.id,
    });

    return floor;
  }

  async findAll(params: {
    tenantId: string;
    restaurantId: string;
    branchId?: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
  }): Promise<{
    data: Floor[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, restaurantId, branchId, page = 1, limit = 20, search, isActive } = params;

    const where: Prisma.FloorWhereInput = { tenantId, restaurantId, deletedAt: null };
    if (branchId) where.branchId = branchId;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.floor.findMany({
        where,
        orderBy: [{ level: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.floor.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<Floor> {
    const floor = await this.prisma.floor.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!floor) {
      throw new NotFoundException('Floor not found');
    }

    return floor;
  }

  async update(
    id: string,
    dto: UpdateFloorDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Floor> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.floor.findFirst({
        where: {
          branchId: existing.branchId,
          name: dto.name,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (nameTaken) {
        throw new ConflictException('A floor with this name already exists in this branch');
      }
    }

    const floor = await this.prisma.floor.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.level !== undefined && { level: dto.level }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'FLOOR_UPDATED',
      resource: 'Floor',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('floor.updated', {
      tenantId,
      restaurantId: existing.restaurantId,
      branchId: existing.branchId,
      floorId: id,
    });

    return floor;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    const areaCount = await this.prisma.diningArea.count({
      where: { floorId: id, deletedAt: null },
    });
    if (areaCount > 0) {
      throw new ConflictException(
        'Cannot delete floor with active dining areas. Remove areas first.',
      );
    }

    await this.prisma.floor.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'FLOOR_DELETED',
      resource: 'Floor',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('floor.deleted', {
      tenantId,
      restaurantId: existing.restaurantId,
      branchId: existing.branchId,
      floorId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Floor> {
    const floor = await this.prisma.floor.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!floor) {
      throw new NotFoundException('Floor not found');
    }

    const restored = await this.prisma.floor.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'FLOOR_RESTORED',
      resource: 'Floor',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
