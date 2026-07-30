import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';
import { InventoryAnalyticsQueryDto } from './dto/inventory-analytics-query.dto';

@Injectable()
export class InventoryAnalyticsService {
  private readonly logger = new Logger(InventoryAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getValuation(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:valuation:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.InventoryValuationWhereInput = { tenantId };
    if (query.startDate)
      where.valuationDate = {
        ...((where.valuationDate as Prisma.DateTimeFilter) || {}),
        gte: new Date(query.startDate),
      };
    if (query.endDate)
      where.valuationDate = {
        ...((where.valuationDate as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };
    if (query.inventoryItemId) where.inventoryItemId = query.inventoryItemId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (query.method) where.method = query.method as any;

    const valuations = await this.prisma.inventoryValuation.groupBy({
      by: ['method'],
      where,
      _sum: { totalValue: true, quantity: true },
      _count: true,
    });

    const result = valuations.map((v) => ({
      method: v.method,
      totalValue: Number(v._sum.totalValue ?? 0),
      totalQuantity: Number(v._sum.quantity ?? 0),
      count: v._count,
    }));

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTurnover(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:turnover:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const consumptionWhere: Prisma.ConsumptionRecordWhereInput = { tenantId };
    if (query.startDate)
      consumptionWhere.date = {
        ...((consumptionWhere.date as Prisma.DateTimeFilter) || {}),
        gte: new Date(query.startDate),
      };
    if (query.endDate)
      consumptionWhere.date = {
        ...((consumptionWhere.date as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };
    // branchId filter not available on ConsumptionRecord

    const cogsAgg = await this.prisma.consumptionRecord.aggregate({
      where: consumptionWhere,
      _sum: { totalCost: true },
    });

    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { currentQuantity: true, averageCost: true, unitCost: true },
    });

    const avgInventoryValue =
      items.length > 0
        ? items.reduce(
            (sum, item) =>
              sum + Number(item.currentQuantity) * Number(item.averageCost ?? item.unitCost ?? 0),
            0,
          ) / items.length
        : 0;

    const cogs = Number(cogsAgg._sum.totalCost ?? 0);
    const turnoverRatio = avgInventoryValue > 0 ? cogs / avgInventoryValue : 0;

    const result = {
      cogs,
      averageInventoryValue: avgInventoryValue,
      turnoverRatio,
      itemCount: items.length,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getDeadStock(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:dead-stock:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const days = query.days ?? 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        currentQuantity: true,
        unitCost: true,
        updatedAt: true,
      },
    });

    const deadStockItems = [];

    for (const item of items) {
      const lastMovement = await this.prisma.stockMovement.findFirst({
        where: { inventoryItemId: item.id, tenantId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      const lastMovementDate = lastMovement?.createdAt ?? item.updatedAt;
      const daysSinceMovement = Math.floor(
        (Date.now() - lastMovementDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysSinceMovement >= days) {
        deadStockItems.push({
          id: item.id,
          name: item.name,
          sku: item.sku,
          currentQuantity: Number(item.currentQuantity),
          unitCost: Number(item.unitCost ?? 0),
          daysSinceLastMovement: daysSinceMovement,
          lastMovementDate,
        });
      }
    }

    deadStockItems.sort((a, b) => b.daysSinceLastMovement - a.daysSinceLastMovement);

    const result = {
      totalDeadStockItems: deadStockItems.length,
      daysThreshold: days,
      items: deadStockItems,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getClassification(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:classification:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, name: true, sku: true },
    });

    const fastMoving = [];
    const slowMoving = [];

    for (const item of items) {
      const consumptionCount = await this.prisma.consumptionRecord.count({
        where: {
          inventoryItemId: item.id,
          tenantId,
          date: { gte: startDate, lte: endDate },
        },
      });

      const entry = {
        id: item.id,
        name: item.name,
        sku: item.sku,
        consumptionCount,
      };

      if (consumptionCount >= 10) {
        fastMoving.push(entry);
      } else {
        slowMoving.push(entry);
      }
    }

    const result = {
      fastMoving: { count: fastMoving.length, items: fastMoving },
      slowMoving: { count: slowMoving.length, items: slowMoving },
      period: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getWasteAnalysis(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:waste:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.WasteEntryWhereInput = { tenantId };
    if (query.startDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        gte: new Date(query.startDate),
      };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };
    if (query.inventoryItemId) where.inventoryItemId = query.inventoryItemId;

    const wasteByType = await this.prisma.$queryRawUnsafe<
      Array<{ wasteType: string; totalQuantity: number; totalCost: number; count: bigint }>
    >(
      `SELECT type as "wasteType", SUM(quantity) as "totalQuantity", SUM("totalCost") as "totalCost", COUNT(*) as count
       FROM waste_entries WHERE "tenantId" = $1
       ${query.startDate ? `AND "createdAt" >= $2` : ''}
       ${query.endDate ? `AND "createdAt" <= $3` : ''}
       ${query.inventoryItemId ? `AND "inventoryItemId" = $4` : ''}
       GROUP BY type ORDER BY "totalQuantity" DESC`,
      tenantId,
      ...(query.startDate ? [new Date(query.startDate)] : []),
      ...(query.endDate ? [new Date(query.endDate)] : []),
      ...(query.inventoryItemId ? [query.inventoryItemId] : []),
    );

    const dailyTrend = await this.prisma.$queryRawUnsafe<
      Array<{ date: string; quantity: number; cost: number }>
    >(
      `SELECT DATE("createdAt") as date, SUM(quantity) as quantity, SUM("totalCost") as cost
       FROM waste_entries WHERE "tenantId" = $1
       ${query.startDate ? `AND "createdAt" >= $2` : ''}
       ${query.endDate ? `AND "createdAt" <= $3` : ''}
       ${query.inventoryItemId ? `AND "inventoryItemId" = $4` : ''}
       GROUP BY DATE("createdAt") ORDER BY date ASC`,
      tenantId,
      ...(query.startDate ? [new Date(query.startDate)] : []),
      ...(query.endDate ? [new Date(query.endDate)] : []),
      ...(query.inventoryItemId ? [query.inventoryItemId] : []),
    );

    const result = {
      byType: wasteByType.map((w) => ({
        wasteType: w.wasteType,
        totalQuantity: Number(w.totalQuantity),
        totalCost: Number(w.totalCost),
        count: Number(w.count),
      })),
      trend: dailyTrend,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getShrinkage(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:shrinkage:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const adjustments = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        quantity: number;
        type: string;
        reason: string | null;
        createdAt: Date;
        inventoryItemId: string | null;
      }>
    >(
      `SELECT id, quantity, type, reason, created_at as "createdAt", inventory_item_id as "inventoryItemId"
       FROM stock_adjustments WHERE "tenantId" = $1 AND type IN ('REMOVAL', 'CORRECTION')
       ${query.startDate ? `AND created_at >= $2` : ''}
       ${query.endDate ? `AND created_at <= $3` : ''}
       ${query.inventoryItemId ? `AND inventory_item_id = $4` : ''}`,
      tenantId,
      ...(query.startDate ? [new Date(query.startDate)] : []),
      ...(query.endDate ? [new Date(query.endDate)] : []),
      ...(query.inventoryItemId ? [query.inventoryItemId] : []),
    );

    const totalRemovalQuantity = adjustments
      .filter((a) => a.type === 'REMOVAL')
      .reduce((sum, a) => sum + Number(a.quantity), 0);

    const totalCorrectionQuantity = adjustments
      .filter((a) => a.type === 'CORRECTION')
      .reduce((sum, a) => sum + Number(a.quantity), 0);

    const totalStockAgg = await this.prisma.inventoryItem.aggregate({
      where: { tenantId, deletedAt: null },
      _sum: { currentQuantity: true },
    });
    const totalStock = Number(totalStockAgg._sum.currentQuantity ?? 0);

    const result = {
      totalShrinkageQuantity: totalRemovalQuantity + totalCorrectionQuantity,
      removalQuantity: totalRemovalQuantity,
      correctionQuantity: totalCorrectionQuantity,
      totalStock,
      shrinkageRate:
        totalStock > 0 ? (totalRemovalQuantity + totalCorrectionQuantity) / totalStock : 0,
      adjustments,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getConsumptionTrends(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:consumption:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.ConsumptionRecordWhereInput = { tenantId };
    if (query.startDate) where.date = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.date = { ...((where.date as object) || {}), lte: new Date(query.endDate) };
    if (query.inventoryItemId) where.inventoryItemId = query.inventoryItemId;

    const byDate = await this.prisma.$queryRawUnsafe<
      Array<{ date: string; quantity: number; totalCost: number }>
    >(
      `SELECT DATE(date) as date, SUM(quantity) as quantity, SUM("totalCost") as "totalCost"
       FROM consumption_records WHERE "tenantId" = $1
       ${query.startDate ? `AND date >= $2` : ''}
       ${query.endDate ? `AND date <= $3` : ''}
       ${query.inventoryItemId ? `AND "inventoryItemId" = $4` : ''}
       GROUP BY DATE(date) ORDER BY date ASC`,
      tenantId,
      ...(query.startDate ? [new Date(query.startDate)] : []),
      ...(query.endDate ? [new Date(query.endDate)] : []),
      ...(query.inventoryItemId ? [query.inventoryItemId] : []),
    );

    const byPeriod = await this.prisma.consumptionRecord.groupBy({
      by: ['period'],
      where,
      _sum: { quantity: true, totalCost: true },
      _count: true,
    });

    const result = {
      daily: byDate,
      byPeriod: byPeriod.map((p) => ({
        period: p.period,
        totalQuantity: Number(p._sum.quantity ?? 0),
        totalCost: Number(p._sum.totalCost ?? 0),
        count: p._count,
      })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRecipeUsage(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:recipe-usage:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const recipes = await this.prisma.recipe.findMany({
      where: { tenantId, isActive: true },
      include: {
        items: {
          where: { tenantId },
          include: {
            inventoryItem: { select: { id: true, name: true, sku: true, unitCost: true } },
          },
        },
      },
    });

    const result = recipes.map((recipe) => {
      const totalCost = recipe.items.reduce((sum, item) => {
        const itemCost = Number(item.inventoryItem?.unitCost ?? 0);
        return sum + Number(item.quantity) * itemCost;
      }, 0);

      return {
        id: recipe.id,
        name: recipe.name,
        productId: recipe.productId,
        yield: recipe.yield,
        cost: Number(recipe.cost ?? totalCost),
        foodCostPercentage: recipe.foodCostPercentage,
        ingredientCount: recipe.items.length,
        ingredients: recipe.items.map((item) => ({
          inventoryItemId: item.inventoryItemId,
          name: item.inventoryItem?.name ?? 'Unknown',
          sku: item.inventoryItem?.sku ?? '',
          quantity: Number(item.quantity),
          unit: item.unit,
          unitCost: Number(item.inventoryItem?.unitCost ?? 0),
          lineCost: Number(item.quantity) * Number(item.inventoryItem?.unitCost ?? 0),
        })),
        totalIngredientCost: totalCost,
      };
    });

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getForecastAccuracy(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:forecast-accuracy:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    const forecasts = await this.prisma.inventoryForecast.findMany({
      where: {
        tenantId,
        forecastDate: { gte: startDate, lte: endDate },
      },
      select: { id: true, inventoryItemId: true, forecastDate: true, quantity: true, method: true },
      orderBy: { forecastDate: 'asc' },
    });

    const accuracyResults = [];

    for (const forecast of forecasts) {
      const consumptionAgg = await this.prisma.consumptionRecord.aggregate({
        where: {
          inventoryItemId: forecast.inventoryItemId,
          tenantId,
          date: forecast.forecastDate,
        },
        _sum: { quantity: true },
      });

      const actualQuantity = Number(consumptionAgg._sum.quantity ?? 0);
      const forecastQuantity = Number(forecast.quantity);
      const error = actualQuantity - forecastQuantity;
      const absoluteError = Math.abs(error);
      const accuracy =
        forecastQuantity > 0
          ? Math.max(0, 1 - absoluteError / forecastQuantity) * 100
          : actualQuantity === 0
            ? 100
            : 0;

      accuracyResults.push({
        id: forecast.id,
        inventoryItemId: forecast.inventoryItemId,
        forecastDate: forecast.forecastDate,
        forecastQuantity,
        actualQuantity,
        error,
        absoluteError,
        accuracyPercentage: Math.round(accuracy * 100) / 100,
        method: forecast.method,
      });
    }

    const avgAccuracy =
      accuracyResults.length > 0
        ? accuracyResults.reduce((sum, r) => sum + r.accuracyPercentage, 0) / accuracyResults.length
        : 0;

    const result = {
      averageAccuracy: Math.round(avgAccuracy * 100) / 100,
      totalForecasts: accuracyResults.length,
      byMethod: await this.getAccuracyByMethod(accuracyResults),
      forecasts: accuracyResults,
      period: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  private async getAccuracyByMethod(
    results: Array<{ method: string; accuracyPercentage: number }>,
  ) {
    const grouped: Record<string, number[]> = {};
    for (const r of results) {
      if (!grouped[r.method]) grouped[r.method] = [];
      grouped[r.method].push(r.accuracyPercentage);
    }
    return Object.entries(grouped).map(([method, accuracies]) => ({
      method,
      averageAccuracy:
        Math.round((accuracies.reduce((s, a) => s + a, 0) / accuracies.length) * 100) / 100,
      count: accuracies.length,
    }));
  }

  async getStockAging(tenantId: string, query: InventoryAnalyticsQueryDto) {
    const cacheKey = `inventory-analytics:stock-aging:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, name: true, sku: true, currentQuantity: true, unitCost: true },
    });

    const buckets = {
      '0-30': { label: '0-30 days', min: 0, max: 30, items: [] as Array<Record<string, unknown>> },
      '31-60': {
        label: '31-60 days',
        min: 31,
        max: 60,
        items: [] as Array<Record<string, unknown>>,
      },
      '61-90': {
        label: '61-90 days',
        min: 61,
        max: 90,
        items: [] as Array<Record<string, unknown>>,
      },
      '91-180': {
        label: '91-180 days',
        min: 91,
        max: 180,
        items: [] as Array<Record<string, unknown>>,
      },
      '180+': {
        label: '180+ days',
        min: 181,
        max: Infinity,
        items: [] as Array<Record<string, unknown>>,
      },
    };

    for (const item of items) {
      const lastMovement = await this.prisma.stockMovement.findFirst({
        where: { inventoryItemId: item.id, tenantId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      const lastDate = lastMovement?.createdAt ?? new Date(0);
      const daysSinceMovement = Math.floor(
        (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      for (const bucket of Object.values(buckets)) {
        if (daysSinceMovement >= bucket.min && daysSinceMovement <= bucket.max) {
          bucket.items.push({
            id: item.id,
            name: item.name,
            sku: item.sku,
            currentQuantity: Number(item.currentQuantity),
            unitCost: Number(item.unitCost ?? 0),
            daysSinceLastMovement: daysSinceMovement,
          });
          break;
        }
      }
    }

    const result = Object.entries(buckets).map(([_key, bucket]) => ({
      range: bucket.label,
      count: bucket.items.length,
      totalQuantity: bucket.items.reduce(
        (s, i: Record<string, unknown>) =>
          s + Number((i as { currentQuantity: number }).currentQuantity),
        0,
      ),
      totalValue: bucket.items.reduce(
        (s, i: Record<string, unknown>) =>
          s +
          Number((i as { currentQuantity: number; unitCost: number }).currentQuantity) *
            Number((i as { currentQuantity: number; unitCost: number }).unitCost),
        0,
      ),
      items: bucket.items,
    }));

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
