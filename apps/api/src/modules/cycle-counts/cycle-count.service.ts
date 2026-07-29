import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { CycleCountGateway } from './cycle-count.gateway';
import { CycleCountStatus, CycleCountItemStatus, Prisma } from '@prisma/client';
import { CreateCycleCountDto } from './dto/create-cycle-count.dto';
import { UpdateCycleCountDto } from './dto/update-cycle-count.dto';
import { QueryCycleCountDto } from './dto/query-cycle-count.dto';
import { RecordCountDto } from './dto/record-count.dto';

@Injectable()
export class CycleCountService {
  private readonly logger = new Logger(CycleCountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: CycleCountGateway,
  ) {}

  async create(dto: CreateCycleCountDto, tenantId: string, userId: string) {
    const count = await this.prisma.cycleCount.create({
      data: {
        tenantId,
        warehouseId: dto.warehouseId,
        countDate: new Date(dto.countDate),
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        status: dto.status ?? CycleCountStatus.SCHEDULED,
        countType: dto.countType ?? 'FULL',
        notes: dto.notes,
        metadata: dto.metadata as Prisma.InputJsonValue ?? Prisma.DbNull,
      },
    });

    if (dto.countType === 'FULL' || dto.countType === 'CYCLE') {
      await this.generateItems(count.id, tenantId);
    }

    await this.auditLogsService.log({
      action: 'CYCLE_COUNT_CREATED',
      resource: 'CycleCount',
      resourceId: count.id,
      userId,
      tenantId,
      newValues: { countDate: dto.countDate, countType: dto.countType, status: count.status },
    });

    await this.invalidateListCache(tenantId);
    this.gateway.broadcastCycleCountUpdate(tenantId, 'cycle-count.created', count);

    return this.findOne(count.id, tenantId);
  }

  async findAll(tenantId: string, query: QueryCycleCountDto) {
    const cacheKey = `cycle-counts:list:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CycleCountWhereInput = { tenantId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.countType) where.countType = query.countType;
    if (query.warehouseId) where.warehouseId = query.warehouseId;

    const [data, total] = await Promise.all([
      this.prisma.cycleCount.findMany({
        where,
        skip,
        take: limit,
        orderBy: { countDate: 'desc' },
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.cycleCount.count({ where }),
    ]);

    const result = {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrevious: page > 1,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 120);
    return result;
  }

  async findOne(id: string, tenantId: string) {
    const cacheKey = `cycle-count:${id}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const count = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        items: {
          include: { inventoryItem: { select: { id: true, name: true, sku: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!count) throw new NotFoundException('Cycle count not found');
    await this.cacheService.set(tenantId, cacheKey, count, 300);
    return count;
  }

  async update(id: string, dto: UpdateCycleCountDto, tenantId: string, userId: string) {
    const existing = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Cycle count not found');

    const updated = await this.prisma.cycleCount.update({
      where: { id },
      data: {
        countDate: dto.countDate ? new Date(dto.countDate) : undefined,
        scheduledDate: dto.scheduledDate !== undefined ? (dto.scheduledDate ? new Date(dto.scheduledDate) : null) : undefined,
        status: dto.status,
        countType: dto.countType,
        notes: dto.notes,
        metadata: dto.metadata !== undefined ? dto.metadata as Prisma.InputJsonValue : undefined,
      },
    });

    await this.auditLogsService.log({
      action: 'CYCLE_COUNT_UPDATED',
      resource: 'CycleCount',
      resourceId: id,
      userId,
      tenantId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: dto as unknown as Record<string, unknown>,
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastCycleCountUpdate(tenantId, 'cycle-count.updated', updated);

    return updated;
  }

  async remove(id: string, tenantId: string, userId: string) {
    const existing = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Cycle count not found');

    await this.prisma.cycleCount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'CYCLE_COUNT_DELETED',
      resource: 'CycleCount',
      resourceId: id,
      userId,
      tenantId,
      oldValues: { countDate: existing.countDate, status: existing.status },
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastCycleCountUpdate(tenantId, 'cycle-count.deleted', { id });
  }

  async startCount(id: string, tenantId: string, userId: string) {
    const existing = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Cycle count not found');
    if (existing.status !== CycleCountStatus.SCHEDULED) {
      throw new BadRequestException('Only SCHEDULED cycle counts can be started');
    }

    const updated = await this.prisma.cycleCount.update({
      where: { id },
      data: { status: CycleCountStatus.IN_PROGRESS },
    });

    await this.auditLogsService.log({
      action: 'CYCLE_COUNT_STARTED',
      resource: 'CycleCount',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: CycleCountStatus.IN_PROGRESS },
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastCycleCountUpdate(tenantId, 'cycle-count.started', updated);

    return updated;
  }

  async completeCount(id: string, tenantId: string, userId: string) {
    const existing = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Cycle count not found');
    if (existing.status !== CycleCountStatus.IN_PROGRESS) {
      throw new BadRequestException('Only IN_PROGRESS cycle counts can be completed');
    }

    const updated = await this.prisma.cycleCount.update({
      where: { id },
      data: { status: CycleCountStatus.COMPLETED, finalizedById: userId, finalizedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'CYCLE_COUNT_COMPLETED',
      resource: 'CycleCount',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: CycleCountStatus.COMPLETED },
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastCycleCountUpdate(tenantId, 'cycle-count.completed', updated);

    return updated;
  }

  async reconcile(id: string, tenantId: string, userId: string) {
    const existing = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Cycle count not found');
    if (existing.status !== CycleCountStatus.COMPLETED && existing.status !== CycleCountStatus.APPROVED) {
      throw new BadRequestException('Only COMPLETED or APPROVED cycle counts can be reconciled');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of existing.items) {
        if (item.actualQuantity == null) continue;

        const variance = Number(item.actualQuantity) - Number(item.expectedQuantity);
        if (variance === 0) continue;

        const inventoryItem = await tx.inventoryItem.findFirst({
          where: { id: item.inventoryItemId, tenantId, deletedAt: null },
        });
        if (!inventoryItem) continue;

        const newCurrent = Number(inventoryItem.currentQuantity) + variance;
        const newAvailable = newCurrent - Number(inventoryItem.reservedQuantity);

        await tx.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentQuantity: newCurrent,
            availableQuantity: newAvailable < 0 ? 0 : newAvailable,
            version: { increment: 1 },
          },
        });
      }
    });

    const updated = await this.prisma.cycleCount.update({
      where: { id },
      data: { status: CycleCountStatus.RECONCILED, approvedById: userId, approvedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'CYCLE_COUNT_RECONCILED',
      resource: 'CycleCount',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: CycleCountStatus.RECONCILED },
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastCycleCountUpdate(tenantId, 'cycle-count.reconciled', updated);

    return updated;
  }

  async recordItemCount(id: string, itemId: string, dto: RecordCountDto, tenantId: string, userId: string) {
    const count = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!count) throw new NotFoundException('Cycle count not found');
    if (count.status !== CycleCountStatus.IN_PROGRESS) {
      throw new BadRequestException('Can only record counts on IN_PROGRESS cycle counts');
    }

    const item = await this.prisma.cycleCountItem.findFirst({
      where: { id: itemId, cycleCountId: id },
    });
    if (!item) throw new NotFoundException('Cycle count item not found');

    const expectedQty = Number(item.expectedQuantity);
    const actualQty = dto.actualQuantity;
    const variance = actualQty - expectedQty;
    const variancePercent = expectedQty > 0 ? (variance / expectedQty) * 100 : 0;

    const updated = await this.prisma.cycleCountItem.update({
      where: { id: itemId },
      data: {
        actualQuantity: actualQty,
        variance,
        variancePercent,
        status: CycleCountItemStatus.COUNTED,
        notes: dto.notes,
        countedById: userId,
        countedAt: new Date(),
      },
    });

    await this.auditLogsService.log({
      action: 'CYCLE_COUNT_ITEM_COUNTED',
      resource: 'CycleCountItem',
      resourceId: itemId,
      userId,
      tenantId,
      newValues: { actualQuantity: actualQty, variance },
    });

    await this.cacheService.delete(tenantId, `cycle-count:${id}`);
    this.gateway.broadcastItemUpdate(tenantId, 'cycle-count.item.counted', updated);

    return updated;
  }

  async getItems(id: string, tenantId: string) {
    const count = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!count) throw new NotFoundException('Cycle count not found');

    return this.prisma.cycleCountItem.findMany({
      where: { cycleCountId: id },
      include: { inventoryItem: { select: { id: true, name: true, sku: true, unit: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async cancel(id: string, tenantId: string, userId: string) {
    const existing = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Cycle count not found');
    if (existing.status !== CycleCountStatus.SCHEDULED && existing.status !== CycleCountStatus.IN_PROGRESS) {
      throw new BadRequestException('Only SCHEDULED or IN_PROGRESS cycle counts can be cancelled');
    }

    await this.prisma.cycleCount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.auditLogsService.log({
      action: 'CYCLE_COUNT_CANCELLED',
      resource: 'CycleCount',
      resourceId: id,
      userId,
      tenantId,
    });

    await this.invalidateCache(id, tenantId);
    this.gateway.broadcastCycleCountUpdate(tenantId, 'cycle-count.cancelled', { id });
  }

  private async generateItems(cycleCountId: string, tenantId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, currentQuantity: true, name: true },
    });

    if (items.length === 0) return;

    await this.prisma.cycleCountItem.createMany({
      data: items.map((item) => ({
        cycleCountId,
        inventoryItemId: item.id,
        expectedQuantity: Number(item.currentQuantity),
      })),
      skipDuplicates: true,
    });
  }

  private async invalidateCache(id: string, tenantId: string) {
    await this.cacheService.delete(tenantId, `cycle-count:${id}`);
    await this.invalidateListCache(tenantId);
  }

  private async invalidateListCache(tenantId: string) {
    await this.cacheService.deletePattern(tenantId, 'cycle-counts:*');
  }
}
