import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { QueueService } from '../queues/queue.service';
import { ForecastingGateway } from './forecasting.gateway';
import { Prisma, StockMovementType, ForecastMethod, ConsumptionPeriod } from '@prisma/client';
import { GenerateForecastDto, ForecastMethodDto, ConsumptionPeriodDto } from './dto/generate-forecast.dto';
import { QueryForecastDto } from './dto/query-forecast.dto';
import { ApproveReorderSuggestionDto, CompleteReorderSuggestionDto } from './dto/reorder-suggestion.dto';

@Injectable()
export class ForecastingService {
  private readonly logger = new Logger(ForecastingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: ForecastingGateway,
  ) {}

  async generateForecast(dto: GenerateForecastDto, tenantId: string, userId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const period = (dto.period ?? 'DAILY') as ConsumptionPeriod;
    const method = (dto.method ?? 'MOVING_AVERAGE') as ForecastMethod;
    const days = dto.days ?? 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const consumptionData = await this.prisma.consumptionRecord.findMany({
      where: {
        inventoryItemId: dto.inventoryItemId,
        tenantId,
        date: { gte: startDate },
      },
      orderBy: { date: 'asc' },
    });

    const aggregated = this.aggregateConsumption(consumptionData, period);
    const forecast = this.calculateMovingAverage(aggregated, period, method);

    const forecastEntry = await this.prisma.inventoryForecast.create({
      data: {
        inventoryItemId: dto.inventoryItemId,
        tenantId,
        forecastDate: forecast.forecastDate,
        quantity: new Prisma.Decimal(forecast.quantity),
        confidence: forecast.confidence !== null ? new Prisma.Decimal(forecast.confidence) : undefined,
        method,
        period,
        factors: {
          dataPoints: consumptionData.length,
          aggregationPeriod: period,
          rawData: aggregated,
        } as Prisma.InputJsonValue,
      },
    });

    await this.auditLogsService.log({
      action: 'FORECAST_GENERATED',
      resource: 'InventoryForecast',
      resourceId: forecastEntry.id,
      userId,
      tenantId,
      newValues: {
        inventoryItemId: dto.inventoryItemId,
        method,
        period,
        forecastDate: forecast.forecastDate,
        quantity: forecast.quantity,
      },
    });

    await this.cacheService.delete(tenantId, `forecasts:item:${dto.inventoryItemId}`);
    this.gateway.broadcastForecastUpdate(tenantId, 'forecast.created', forecastEntry);

    return forecastEntry;
  }

  async getForecastsForItem(itemId: string, tenantId: string, query?: QueryForecastDto) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    const cacheKey = `forecasts:item:${itemId}:${JSON.stringify(query ?? {})}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryForecastWhereInput = {
      inventoryItemId: itemId,
      tenantId,
    };

    if (query?.period) where.period = query.period as ConsumptionPeriod;
    if (query?.fromDate || query?.toDate) {
      where.forecastDate = {};
      if (query?.fromDate) where.forecastDate.gte = query.fromDate;
      if (query?.toDate) where.forecastDate.lte = query.toDate;
    }

    const [data, total] = await Promise.all([
      this.prisma.inventoryForecast.findMany({
        where,
        skip,
        take: limit,
        orderBy: { forecastDate: 'desc' },
      }),
      this.prisma.inventoryForecast.count({ where }),
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

  async getReorderRecommendations(tenantId: string) {
    const cacheKey = 'reorder:recommendations';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const items = await this.prisma.inventoryItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
      },
      include: {
        unit: true,
        category: true,
      },
      orderBy: { currentQuantity: 'asc' },
    });

    const recommendations = await Promise.all(
      items.map(async (item) => {
        const currentStock = Number(item.currentQuantity);
        const minStock = item.minStock ? Number(item.minStock) : null;
        const maxStock = item.maxStock ? Number(item.maxStock) : null;
        const reorderLevel = item.reorderLevel ? Number(item.reorderLevel) : null;

        const avgConsumption = await this.getAverageDailyConsumption(item.id, tenantId);

        let suggestedQuantity = 0;
        if (maxStock && minStock) {
          suggestedQuantity = maxStock - currentStock;
        } else if (reorderLevel && avgConsumption > 0) {
          suggestedQuantity = Math.ceil(avgConsumption * 7);
        }

        const needsReorder = reorderLevel !== null && currentStock <= reorderLevel;
        const status = currentStock <= 0 ? 'OUT_OF_STOCK' : needsReorder ? 'NEEDS_REORDER' : 'OK';

        return {
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          currentStock,
          minStock,
          maxStock,
          reorderLevel,
          averageDailyConsumption: avgConsumption,
          suggestedQuantity: Math.max(0, suggestedQuantity),
          status,
        };
      }),
    );

    const result = {
      data: recommendations,
      summary: {
        total: recommendations.length,
        needsReorder: recommendations.filter((r) => r.status === 'NEEDS_REORDER').length,
        outOfStock: recommendations.filter((r) => r.status === 'OUT_OF_STOCK').length,
        ok: recommendations.filter((r) => r.status === 'OK').length,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 60);
    return result;
  }

  async generateReorderSuggestions(tenantId: string, userId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
      },
    });

    const suggestions: Prisma.ReorderSuggestionCreateManyInput[] = [];

    for (const item of items) {
      const currentStock = Number(item.currentQuantity);
      const minStock = item.minStock ? Number(item.minStock) : null;
      const maxStock = item.maxStock ? Number(item.maxStock) : null;
      const reorderLevel = item.reorderLevel ? Number(item.reorderLevel) : null;

      const avgConsumption = await this.getAverageDailyConsumption(item.id, tenantId);
      const leadTimeDays = 1;

      if (reorderLevel !== null && currentStock <= reorderLevel) {
        let suggestedQty = 0;
        if (maxStock) {
          suggestedQty = maxStock - currentStock;
        } else {
          suggestedQty = Math.ceil(avgConsumption * leadTimeDays * 1.5);
        }

        const safetyStock = Math.ceil(avgConsumption * leadTimeDays * 0.5);
        const eoq = avgConsumption > 0
          ? Math.sqrt(2 * avgConsumption * 365 * 10 / 5)
          : 0;

        const priority = currentStock <= 0 ? 'CRITICAL' : currentStock <= (reorderLevel * 0.5) ? 'HIGH' : 'MEDIUM';

        suggestions.push({
          inventoryItemId: item.id,
          tenantId,
          suggestedQuantity: new Prisma.Decimal(Math.max(0, suggestedQty)),
          suggestedDate: new Date(),
          currentStock: new Prisma.Decimal(currentStock),
          minStock: minStock !== null ? new Prisma.Decimal(minStock) : undefined,
          maxStock: maxStock !== null ? new Prisma.Decimal(maxStock) : undefined,
          safetyStock: new Prisma.Decimal(safetyStock),
          leadTimeDays,
          eoq: eoq > 0 ? new Prisma.Decimal(eoq) : undefined,
          priority,
          status: 'PENDING',
        } as Prisma.ReorderSuggestionCreateManyInput);
      }
    }

    if (suggestions.length > 0) {
      await this.prisma.reorderSuggestion.createMany({
        data: suggestions,
      });
    }

    await this.auditLogsService.log({
      action: 'REORDER_SUGGESTIONS_GENERATED',
      resource: 'ReorderSuggestion',
      userId,
      tenantId,
      newValues: { count: suggestions.length },
    });

    await this.invalidateReorderCache(tenantId);
    this.gateway.broadcastReorderUpdate(tenantId, 'reorder.suggestions_generated', { count: suggestions.length });

    return { count: suggestions.length };
  }

  async getReorderSuggestions(tenantId: string, page = 1, limit = 20) {
    const cacheKey = `reorder:suggestions:${page}:${limit}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const skip = (page - 1) * limit;

    const where: Prisma.ReorderSuggestionWhereInput = { tenantId };

    const [data, total] = await Promise.all([
      this.prisma.reorderSuggestion.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { status: 'asc' },
          { suggestedDate: 'desc' },
        ],
        include: {
          inventoryItem: { select: { id: true, name: true, sku: true, unit: true } },
        },
      }),
      this.prisma.reorderSuggestion.count({ where }),
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

    await this.cacheService.set(tenantId, cacheKey, result, 60);
    return result;
  }

  async getReorderSuggestion(id: string, tenantId: string) {
    const cacheKey = `reorder:suggestion:${id}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const suggestion = await this.prisma.reorderSuggestion.findFirst({
      where: { id, tenantId },
      include: {
        inventoryItem: { include: { category: true, unit: true } },
      },
    });

    if (!suggestion) throw new NotFoundException('Reorder suggestion not found');

    await this.cacheService.set(tenantId, cacheKey, suggestion, 120);
    return suggestion;
  }

  async approveSuggestion(id: string, userId: string, tenantId: string, dto?: ApproveReorderSuggestionDto) {
    const suggestion = await this.prisma.reorderSuggestion.findFirst({
      where: { id, tenantId },
    });
    if (!suggestion) throw new NotFoundException('Reorder suggestion not found');
    if (suggestion.status !== 'PENDING') throw new BadRequestException('Suggestion is not PENDING');

    const updated = await this.prisma.reorderSuggestion.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
        notes: dto?.notes ?? suggestion.notes,
      },
    });

    await this.auditLogsService.log({
      action: 'REORDER_SUGGESTION_APPROVED',
      resource: 'ReorderSuggestion',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: 'APPROVED' },
    });

    await this.invalidateReorderCache(tenantId);
    this.gateway.broadcastReorderUpdate(tenantId, 'reorder.suggestion_approved', updated);

    return updated;
  }

  async completeSuggestion(id: string, userId: string, tenantId: string, dto?: CompleteReorderSuggestionDto) {
    const suggestion = await this.prisma.reorderSuggestion.findFirst({
      where: { id, tenantId },
    });
    if (!suggestion) throw new NotFoundException('Reorder suggestion not found');
    if (suggestion.status !== 'APPROVED') throw new BadRequestException('Suggestion must be APPROVED first');

    const updated = await this.prisma.reorderSuggestion.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        notes: dto?.notes ?? suggestion.notes,
      },
    });

    await this.auditLogsService.log({
      action: 'REORDER_SUGGESTION_COMPLETED',
      resource: 'ReorderSuggestion',
      resourceId: id,
      userId,
      tenantId,
      newValues: { status: 'COMPLETED' },
    });

    await this.invalidateReorderCache(tenantId);
    this.gateway.broadcastReorderUpdate(tenantId, 'reorder.suggestion_completed', updated);

    return updated;
  }

  private async getAverageDailyConsumption(itemId: string, tenantId: string): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const records = await this.prisma.consumptionRecord.findMany({
      where: {
        inventoryItemId: itemId,
        tenantId,
        date: { gte: thirtyDaysAgo },
      },
    });

    if (records.length === 0) return 0;

    const totalConsumption = records.reduce((sum, r) => sum + Number(r.quantity), 0);
    return totalConsumption / 30;
  }

  private aggregateConsumption(
    records: Array<{ date: Date; quantity: any }>,
    period: ConsumptionPeriod,
  ): Array<{ period: string; total: number }> {
    const grouped = new Map<string, number>();

    for (const record of records) {
      const d = new Date(record.date);
      let key: string;

      if (period === 'DAILY') {
        key = d.toISOString().slice(0, 10);
      } else if (period === 'WEEKLY') {
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        key = startOfWeek.toISOString().slice(0, 10);
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }

      grouped.set(key, (grouped.get(key) ?? 0) + Number(record.quantity));
    }

    return Array.from(grouped.entries())
      .map(([periodKey, total]) => ({ period: periodKey, total }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  private calculateMovingAverage(
    aggregated: Array<{ period: string; total: number }>,
    period: ConsumptionPeriod,
    method: string,
  ): { forecastDate: Date; quantity: number; confidence: number | null } {
    const values = aggregated.map((a) => a.total);
    const n = values.length;

    let forecastQuantity = 0;
    let confidence: number | null = null;

    if (method === 'MOVING_AVERAGE' || method === 'EXPONENTIAL_SMOOTHING') {
      const windowSize = period === 'DAILY' ? 7 : period === 'WEEKLY' ? 4 : 3;

      if (n >= windowSize) {
        const recent = values.slice(-windowSize);
        forecastQuantity = recent.reduce((sum, v) => sum + v, 0) / windowSize;

        const variance = recent.reduce((sum, v) => sum + Math.pow(v - forecastQuantity, 2), 0) / windowSize;
        const stdDev = Math.sqrt(variance);
        confidence = forecastQuantity > 0 ? Math.max(0, 1 - stdDev / forecastQuantity) : 0;
      } else if (n > 0) {
        forecastQuantity = values.reduce((sum, v) => sum + v, 0) / n;
        confidence = 0.3;
      }
    } else if (method === 'LINEAR_REGRESSION' && n >= 2) {
      const xMean = (n - 1) / 2;
      const yMean = values.reduce((sum, v) => sum + v, 0) / n;

      let numerator = 0;
      let denominator = 0;
      for (let i = 0; i < n; i++) {
        numerator += (i - xMean) * (values[i] - yMean);
        denominator += Math.pow(i - xMean, 2);
      }

      const slope = denominator !== 0 ? numerator / denominator : 0;
      const intercept = yMean - slope * xMean;
      forecastQuantity = slope * n + intercept;
      forecastQuantity = Math.max(0, forecastQuantity);

      const ssRes = values.reduce((sum, v, i) => {
        const predicted = slope * i + intercept;
        return sum + Math.pow(v - predicted, 2);
      }, 0);
      const ssTot = values.reduce((sum, v) => sum + Math.pow(v - yMean, 2), 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
      confidence = Math.max(0, rSquared);
    } else if (method === 'SEASONAL' && n >= 14) {
      const half = Math.floor(n / 2);
      const firstHalf = values.slice(0, half).reduce((sum, v) => sum + v, 0) / half;
      const secondHalf = values.slice(-half).reduce((sum, v) => sum + v, 0) / half;
      const trend = half > 0 ? (secondHalf - firstHalf) / half : 0;
      forecastQuantity = secondHalf + trend * half;
      forecastQuantity = Math.max(0, forecastQuantity);
      confidence = 0.5;
    } else {
      forecastQuantity = n > 0 ? values.reduce((sum, v) => sum + v, 0) / n : 0;
      confidence = n > 0 ? 0.2 : null;
    }

    const forecastDate = new Date();
    if (period === 'DAILY') forecastDate.setDate(forecastDate.getDate() + 1);
    else if (period === 'WEEKLY') forecastDate.setDate(forecastDate.getDate() + 7);
    else forecastDate.setMonth(forecastDate.getMonth() + 1);

    return {
      forecastDate,
      quantity: Math.round(forecastQuantity * 100) / 100,
      confidence: confidence !== null ? Math.round(confidence * 10000) / 10000 : null,
    };
  }

  private async invalidateReorderCache(tenantId: string) {
    await this.cacheService.deletePattern(tenantId, 'reorder:*');
    await this.cacheService.deletePattern(tenantId, 'forecasts:*');
  }
}
