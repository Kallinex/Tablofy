import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getInventorySummary(tenantId: string) {
    const cacheKey = 'dashboard:inventory-summary';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, currentQuantity: true, unitCost: true, minStock: true },
    });

    const totalItems = items.length;
    const totalValue = items.reduce((sum, item) => {
      return sum + Number(item.currentQuantity) * Number(item.unitCost ?? 0);
    }, 0);
    const lowStockCount = items.filter((item) => {
      return item.minStock != null && Number(item.currentQuantity) <= Number(item.minStock);
    }).length;
    const outOfStockCount = items.filter((item) => Number(item.currentQuantity) <= 0).length;

    const result = { totalItems, totalValue, lowStockCount, outOfStockCount };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getWarehouseSummary(tenantId: string) {
    const cacheKey = 'dashboard:warehouse-summary';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const warehouses = await this.prisma.warehouse.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        _count: { select: { zones: true, bins: true } },
      },
    });

    const result = warehouses.map((w) => ({
      id: w.id,
      name: w.name,
      code: w.code,
      totalZones: w._count.zones,
      totalBins: w._count.bins,
      capacity: Number(w.capacity ?? 0),
      capacityUnit: w.capacityUnit,
    }));

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getMovementSummary(tenantId: string) {
    const cacheKey = 'dashboard:movement-summary';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const movements = await this.prisma.stockMovement.findMany({
      where: { tenantId, createdAt: { gte: thirtyDaysAgo } },
      select: { type: true, quantity: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const inboundCount = movements.filter((m) => Number(m.quantity) > 0).length;
    const outboundCount = movements.filter((m) => Number(m.quantity) < 0).length;
    const totalMovements = movements.length;

    const result = {
      totalMovements,
      inboundCount,
      outboundCount,
      periodDays: 30,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTurnoverRate(tenantId: string) {
    const cacheKey = 'dashboard:turnover-rate';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const consumptionRecords = await this.prisma.consumptionRecord.findMany({
      where: { tenantId, createdAt: { gte: threeMonthsAgo } },
      select: { totalCost: true, createdAt: true },
    });

    const cogs = consumptionRecords.reduce((sum, r) => sum + Number(r.totalCost ?? 0), 0);

    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { currentQuantity: true, unitCost: true },
    });

    const totalInventoryValue = items.reduce(
      (sum, item) => sum + Number(item.currentQuantity) * Number(item.unitCost ?? 0),
      0,
    );

    const avgInventory = items.length > 0 ? totalInventoryValue / items.length : 1;
    const turnoverRate = avgInventory > 0 ? cogs / avgInventory : 0;

    const result = { cogs, averageInventoryValue: avgInventory, turnoverRate, periodMonths: 3 };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getSupplierPerformanceSummary(tenantId: string) {
    const cacheKey = 'dashboard:supplier-performance';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const metrics = await this.prisma.supplierPerformanceMetric.findMany({
      where: { tenantId, overallScore: { not: null } },
      orderBy: { overallScore: 'desc' },
      include: { supplier: { select: { id: true, name: true } } },
      take: 10,
    });

    const topPerformers = metrics.slice(0, 5).map((m) => ({
      supplierId: m.supplierId,
      supplierName: m.supplier?.name ?? 'Unknown',
      overallScore: Number(m.overallScore),
      qualityScore: Number(m.qualityScore ?? 0),
      costScore: Number(m.costScore ?? 0),
    }));

    const bottomPerformers = [...metrics].reverse().slice(0, 5).map((m) => ({
      supplierId: m.supplierId,
      supplierName: m.supplier?.name ?? 'Unknown',
      overallScore: Number(m.overallScore),
      qualityScore: Number(m.qualityScore ?? 0),
      costScore: Number(m.costScore ?? 0),
    }));

    const result = { topPerformers, bottomPerformers };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getReorderAlert(tenantId: string) {
    const cacheKey = 'dashboard:reorder-alert';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const items = await this.prisma.inventoryItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        reorderLevel: { not: null },
      },
      select: { id: true, name: true, sku: true, currentQuantity: true, reorderLevel: true, unit: true },
      orderBy: { currentQuantity: 'asc' },
    });

    const reorderItems = items
      .filter((item) => Number(item.currentQuantity) <= Number(item.reorderLevel!))
      .slice(0, 20);

    const result = {
      totalNeedingReorder: reorderItems.length,
      items: reorderItems.map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        currentQuantity: Number(item.currentQuantity),
        reorderLevel: Number(item.reorderLevel!),
        unit: item.unit?.abbreviation ?? '',
      })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getValuationSummary(tenantId: string) {
    const cacheKey = 'dashboard:valuation-summary';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const fifoValuations = await this.prisma.inventoryValuation.aggregate({
      where: { tenantId, method: 'FIFO' },
      _sum: { totalValue: true, quantity: true },
    });

    const weightedAvgValuations = await this.prisma.inventoryValuation.aggregate({
      where: { tenantId, method: 'WEIGHTED_AVERAGE' },
      _sum: { totalValue: true, quantity: true },
    });

    const result = {
      fifo: {
        totalValue: Number(fifoValuations._sum.totalValue ?? 0),
        totalQuantity: Number(fifoValuations._sum.quantity ?? 0),
      },
      weightedAverage: {
        totalValue: Number(weightedAvgValuations._sum.totalValue ?? 0),
        totalQuantity: Number(weightedAvgValuations._sum.quantity ?? 0),
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
