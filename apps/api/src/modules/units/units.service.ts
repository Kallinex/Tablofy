import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Unit, Prisma, UnitType } from '@prisma/client';

@Injectable()
export class UnitsService {
  private readonly logger = new Logger(UnitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    dto: CreateUnitDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Unit> {
    const existing = await this.prisma.unit.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A unit with this name already exists');
    }

    const unit = await this.prisma.unit.create({
      data: {
        tenantId,
        name: dto.name,
        abbreviation: dto.abbreviation,
        type: dto.type,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogsService.log({
      action: 'UNIT_CREATED',
      resource: 'Unit',
      resourceId: unit.id,
      userId,
      tenantId,
      newValues: { name: unit.name, abbreviation: unit.abbreviation, type: unit.type },
      ...meta,
    });

    return unit;
  }

  async findAll(params: {
    tenantId: string;
    page?: number;
    limit?: number;
    type?: string;
    isActive?: boolean;
  }): Promise<{
    data: Unit[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const { tenantId, page = 1, limit = 20, type, isActive } = params;

    const where: Prisma.UnitWhereInput = { tenantId, deletedAt: null };
    if (type) where.type = type as UnitType;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.unit.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.unit.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, tenantId: string): Promise<Unit> {
    const unit = await this.prisma.unit.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  async update(
    id: string,
    dto: UpdateUnitDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Unit> {
    const existing = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.unit.findFirst({
        where: { tenantId, name: dto.name, deletedAt: null, id: { not: id } },
      });
      if (nameTaken) throw new ConflictException('A unit with this name already exists');
    }

    const updated = await this.prisma.unit.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.abbreviation !== undefined && { abbreviation: dto.abbreviation }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.auditLogsService.log({
      action: 'UNIT_UPDATED',
      resource: 'Unit',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { name: existing.name, abbreviation: existing.abbreviation, type: existing.type },
      newValues: { name: updated.name, abbreviation: updated.abbreviation, type: updated.type },
      ...meta,
    });

    return updated;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.findOne(id, tenantId);

    await this.prisma.unit.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogsService.log({
      action: 'UNIT_DELETED',
      resource: 'Unit',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Unit> {
    const unit = await this.prisma.unit.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!unit) throw new NotFoundException('Unit not found');

    const restored = await this.prisma.unit.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });

    await this.auditLogsService.log({
      action: 'UNIT_RESTORED',
      resource: 'Unit',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
