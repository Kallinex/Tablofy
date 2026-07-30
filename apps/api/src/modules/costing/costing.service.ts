import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { ValuationMethod, Prisma } from '@prisma/client';
import { CreateValuationDto } from './dto/create-valuation.dto';
import { BatchValuationDto } from './dto/query-valuation.dto';

@Injectable()
export class CostingService {
  private readonly logger = new Logger(CostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createValuation(dto: CreateValuationDto, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const method = dto.method ?? ValuationMethod.WEIGHTED_AVERAGE;
    const quantity = Number(item.currentQuantity);
    const unitCost =
      method === ValuationMethod.FIFO
        ? await this.calculateFifoCost(item.id, tenantId)
        : await this.calculateWeightedAverageCost(item.id, tenantId);
    const totalValue = quantity * unitCost;

    const valuation = await this.prisma.inventoryValuation.create({
      data: {
        inventoryItemId: dto.inventoryItemId,
        tenantId,
        valuationDate: new Date(dto.valuationDate),
        method,
        unitCost,
        totalValue,
        quantity,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
    });

    await this.auditLogsService.log({
      action: 'INVENTORY_VALUATION_CREATED',
      resource: 'InventoryValuation',
      resourceId: valuation.id,
      userId,
      tenantId,
      newValues: {
        inventoryItemId: dto.inventoryItemId,
        method,
        unitCost,
        totalValue,
        quantity,
      },
    });

    await this.invalidateItemCache(dto.inventoryItemId, tenantId);
    return valuation;
  }

  async getValuationsForItem(itemId: string, tenantId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    return this.prisma.inventoryValuation.findMany({
      where: { inventoryItemId: itemId, tenantId },
      orderBy: { valuationDate: 'desc' },
    });
  }

  async getValuation(id: string, tenantId: string) {
    const valuation = await this.prisma.inventoryValuation.findFirst({
      where: { id, tenantId },
      include: { inventoryItem: { select: { id: true, name: true, sku: true, unit: true } } },
    });
    if (!valuation) throw new NotFoundException('Valuation not found');
    return valuation;
  }

  async batchValuation(dto: BatchValuationDto, tenantId: string, userId: string) {
    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
    };
    if (dto.inventoryItemIds && dto.inventoryItemIds.length > 0) {
      where.id = { in: dto.inventoryItemIds };
    }

    const items = await this.prisma.inventoryItem.findMany({ where, select: { id: true } });
    if (items.length === 0) throw new BadRequestException('No inventory items found');

    const method = dto.method ?? ValuationMethod.WEIGHTED_AVERAGE;
    const valuationDate = new Date();
    const results = [];

    for (const item of items) {
      const valuation = await this.createValuation(
        { inventoryItemId: item.id, valuationDate: valuationDate.toISOString(), method },
        tenantId,
        userId,
      );
      results.push(valuation);
    }

    this.logger.log(`Batch valuation: ${results.length} items valued using ${method}`);
    return { total: results.length, method, valuationDate };
  }

  private async calculateFifoCost(inventoryItemId: string, tenantId: string): Promise<number> {
    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        inventoryItemId,
        tenantId,
        isActive: true,
        quantity: { gt: 0 },
      },
      orderBy: { receivedAt: 'asc' },
      take: 1,
    });

    if (batches.length > 0) {
      return Number(batches[0].unitCost ?? 0);
    }

    const goodsReceipts = await this.prisma.goodsReceiptItem.findMany({
      where: { inventoryItemId },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });

    if (goodsReceipts.length > 0) {
      return Number(goodsReceipts[0].unitPrice ?? 0);
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId },
    });
    return Number(item?.unitCost ?? 0);
  }

  private async calculateWeightedAverageCost(
    inventoryItemId: string,
    tenantId: string,
  ): Promise<number> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId },
    });
    if (!item) return 0;

    const avgCost = Number(item.averageCost ?? item.unitCost ?? 0);
    if (avgCost > 0) return avgCost;

    const batches = await this.prisma.inventoryBatch.aggregate({
      where: { inventoryItemId, tenantId, isActive: true, quantity: { gt: 0 } },
      _sum: { quantity: true, unitCost: true },
    });

    const totalQty = Number(batches._sum.quantity ?? 0);
    const totalCost = Number(batches._sum.unitCost ?? 0);

    if (totalQty > 0 && totalCost > 0) {
      return totalCost / totalQty;
    }

    return Number(item.unitCost ?? 0);
  }

  private async invalidateItemCache(itemId: string, tenantId: string) {
    await this.cacheService.deletePattern(tenantId, `valuations:*`);
    await this.cacheService.deletePattern(tenantId, `valuation:*`);
  }
}
