import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PlanLimitsService } from '../../common/services/plan-limits.service';
import { Prisma, Table, TableStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';

@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly planLimitsService: PlanLimitsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    dto: CreateTableDto,
    branchId: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Table> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    const diningArea = await this.prisma.diningArea.findFirst({
      where: { id: dto.diningAreaId, branchId, tenantId, deletedAt: null },
    });
    if (!diningArea) {
      throw new NotFoundException('Dining area not found in this branch');
    }

    const existingNumber = await this.prisma.table.findFirst({
      where: { branchId, number: dto.number, deletedAt: null },
    });
    if (existingNumber) {
      throw new ConflictException('A table with this number already exists in this branch');
    }

    const limitCheck = await this.planLimitsService.checkLimit(tenantId, 'tables');
    if (!limitCheck.allowed) {
      throw new BadRequestException(
        `Table limit reached. Current: ${limitCheck.current}, Limit: ${limitCheck.limit}. Please upgrade your plan.`,
      );
    }

    const qrCode = dto.qrCode ?? `tbl-${randomUUID()}`;

    const table = await this.prisma.table.create({
      data: {
        branchId,
        diningAreaId: dto.diningAreaId,
        tenantId,
        number: dto.number,
        seats: dto.seats ?? 4,
        qrCode,
        metadata: (dto.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await this.auditLogsService.log({
      action: 'TABLE_CREATED',
      resource: 'Table',
      resourceId: table.id,
      userId,
      tenantId,
      newValues: {
        number: table.number,
        seats: table.seats,
        branchId,
        diningAreaId: dto.diningAreaId,
      },
      ...meta,
    });

    this.eventEmitter.emit('table.created', {
      tenantId,
      branchId,
      tableId: table.id,
    });

    return table;
  }

  async findAll(params: {
    tenantId: string;
    branchId?: string;
    diningAreaId?: string;
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
    status?: TableStatus;
  }): Promise<{
    data: Table[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const {
      tenantId,
      branchId,
      diningAreaId,
      page = 1,
      limit = 20,
      search,
      isActive,
      status,
    } = params;

    const where: Prisma.TableWhereInput = { tenantId, deletedAt: null };
    if (branchId) where.branchId = branchId;
    if (diningAreaId) where.diningAreaId = diningAreaId;
    if (isActive !== undefined) where.isActive = isActive;
    if (status) where.status = status;
    if (search) {
      where.OR = [{ number: { contains: search, mode: 'insensitive' } }];
    }

    const [data, total] = await Promise.all([
      this.prisma.table.findMany({
        where,
        orderBy: { number: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.table.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, tenantId: string): Promise<Table> {
    const table = await this.prisma.table.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    return table;
  }

  async update(
    id: string,
    dto: UpdateTableDto,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Table> {
    const existing = await this.findOne(id, tenantId);

    if (dto.number && dto.number !== existing.number) {
      const numberTaken = await this.prisma.table.findFirst({
        where: {
          branchId: existing.branchId,
          number: dto.number,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (numberTaken) {
        throw new ConflictException('A table with this number already exists in this branch');
      }
    }

    const table = await this.prisma.table.update({
      where: { id },
      data: {
        ...(dto.number !== undefined && { number: dto.number }),
        ...(dto.seats !== undefined && { seats: dto.seats }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.metadata !== undefined && {
          metadata: dto.metadata as Prisma.InputJsonValue,
        }),
      },
    });

    await this.auditLogsService.log({
      action: 'TABLE_UPDATED',
      resource: 'Table',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
      ...meta,
    });

    this.eventEmitter.emit('table.updated', {
      tenantId,
      branchId: existing.branchId,
      tableId: id,
    });

    return table;
  }

  async updateStatus(
    id: string,
    status: TableStatus,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Table> {
    const existing = await this.findOne(id, tenantId);

    if (existing.status === status) {
      return existing;
    }

    const table = await this.prisma.table.update({
      where: { id },
      data: { status },
    });

    await this.auditLogsService.log({
      action: 'TABLE_STATUS_CHANGED',
      resource: 'Table',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { status: existing.status },
      newValues: { status },
      ...meta,
    });

    this.eventEmitter.emit('table.statusChanged', {
      tenantId,
      branchId: existing.branchId,
      tableId: id,
      oldStatus: existing.status,
      newStatus: status,
    });

    return table;
  }

  async regenerateQrCode(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Table> {
    const existing = await this.findOne(id, tenantId);

    const qrCode = `tbl-${randomUUID()}`;

    const table = await this.prisma.table.update({
      where: { id },
      data: { qrCode },
    });

    await this.auditLogsService.log({
      action: 'TABLE_QR_REGENERATED',
      resource: 'Table',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { qrCode: existing.qrCode },
      newValues: { qrCode },
      ...meta,
    });

    return table;
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.prisma.table.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, status: 'OUT_OF_SERVICE' },
    });

    await this.auditLogsService.log({
      action: 'TABLE_DELETED',
      resource: 'Table',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    this.eventEmitter.emit('table.deleted', {
      tenantId,
      branchId: existing.branchId,
      tableId: id,
    });
  }

  async restore(
    id: string,
    tenantId: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<Table> {
    const table = await this.prisma.table.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    const restored = await this.prisma.table.update({
      where: { id },
      data: { deletedAt: null, isActive: true, status: 'AVAILABLE' },
    });

    await this.auditLogsService.log({
      action: 'TABLE_RESTORED',
      resource: 'Table',
      resourceId: id,
      userId,
      tenantId,
      ...meta,
    });

    return restored;
  }
}
