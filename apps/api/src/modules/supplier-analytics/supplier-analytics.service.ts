import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';
import { SupplierAnalyticsQueryDto } from './dto/supplier-analytics-query.dto';

@Injectable()
export class SupplierAnalyticsService {
  private readonly logger = new Logger(SupplierAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private buildDateFilter(query: SupplierAnalyticsQueryDto): { gte?: Date; lte?: Date } {
    const filter: { gte?: Date; lte?: Date } = {};
    if (query.startDate) filter.gte = new Date(query.startDate);
    if (query.endDate) filter.lte = new Date(query.endDate);
    return filter;
  }

  private getMetricWhere(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const where: Prisma.SupplierPerformanceMetricWhereInput = { tenantId };
    const dateFilter = this.buildDateFilter(query);
    if (Object.keys(dateFilter).length > 0) where.periodStart = dateFilter;
    if (query.supplierId) where.supplierId = query.supplierId;
    return where;
  }

  async getOverview(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:overview:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const metricWhere = this.getMetricWhere(tenantId, query);

    const [suppliers, activeSuppliers, metrics] = await Promise.all([
      this.prisma.supplier.findMany({ where: { tenantId } }),
      this.prisma.supplier.count({ where: { tenantId, isActive: true } }),
      this.prisma.supplierPerformanceMetric.findMany({
        where: metricWhere,
        include: { supplier: true },
        orderBy: { periodStart: 'desc' },
      }),
    ]);

    const supplierIds = [...new Set(metrics.filter((m) => m.supplierId).map((m) => m.supplierId))];
    const latestPerSupplier = new Map<string, (typeof metrics)[number]>();
    for (const m of metrics) {
      if (m.supplierId && !latestPerSupplier.has(m.supplierId)) {
        latestPerSupplier.set(m.supplierId, m);
      }
    }

    const scores = Array.from(latestPerSupplier.values()).map((m: (typeof metrics)[number]) =>
      Number(m.overallScore ?? 0),
    );
    const avgOverallScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const topPerformers = Array.from(latestPerSupplier.values())
      .sort(
        (a: (typeof metrics)[number], b: (typeof metrics)[number]) =>
          Number(b.overallScore ?? 0) - Number(a.overallScore ?? 0),
      )
      .slice(0, 5)
      .map((m: (typeof metrics)[number]) => ({
        supplierId: m.supplierId,
        supplierName: m.supplier?.name ?? 'Unknown',
        overallScore: Number(m.overallScore ?? 0),
      }));
    const bottomPerformers = Array.from(latestPerSupplier.values())
      .sort(
        (a: (typeof metrics)[number], b: (typeof metrics)[number]) =>
          Number(a.overallScore ?? 0) - Number(b.overallScore ?? 0),
      )
      .slice(0, 5)
      .map((m: (typeof metrics)[number]) => ({
        supplierId: m.supplierId,
        supplierName: m.supplier?.name ?? 'Unknown',
        overallScore: Number(m.overallScore ?? 0),
      }));

    const result = {
      totalSuppliers: suppliers.length,
      activeSuppliers,
      suppliersWithMetrics: supplierIds.length,
      avgOverallScore: Math.round(avgOverallScore * 100) / 100,
      topPerformers,
      bottomPerformers,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getScorecards(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:scorecards:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getMetricWhere(tenantId, query);
    const metrics = await this.prisma.supplierPerformanceMetric.findMany({
      where,
      include: { supplier: true },
      orderBy: { overallScore: 'desc' },
    });

    const result = metrics.map((m) => ({
      id: m.id,
      supplierId: m.supplierId,
      supplierName: m.supplier?.name ?? 'Unknown',
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
      leadTimeAvg: Number(m.leadTimeAvg ?? 0),
      fillRate: Number(m.fillRate ?? 0),
      deliveryAccuracy: Number(m.deliveryAccuracy ?? 0),
      rejectedItems: m.rejectedItems,
      averageDelay: Number(m.averageDelay ?? 0),
      totalOrders: m.totalOrders,
      onTimeDeliveries: m.onTimeDeliveries,
      qualityScore: Number(m.qualityScore ?? 0),
      costScore: Number(m.costScore ?? 0),
      overallScore: Number(m.overallScore ?? 0),
      rank: m.rank,
    }));

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getDeliveryPerformance(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:delivery:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getMetricWhere(tenantId, query);
    const metrics = await this.prisma.supplierPerformanceMetric.findMany({
      where,
      include: { supplier: true },
      orderBy: { periodStart: 'asc' },
    });

    const trends = metrics.map((m) => ({
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
      supplierId: m.supplierId,
      supplierName: m.supplier?.name ?? 'Unknown',
      onTimeDeliveries: m.onTimeDeliveries,
      totalOrders: m.totalOrders,
      fillRate: Number(
        m.fillRate ?? (m.totalOrders > 0 ? (m.onTimeDeliveries / m.totalOrders) * 100 : 0),
      ),
      deliveryAccuracy: Number(m.deliveryAccuracy ?? 0),
    }));

    const avgFillRate =
      trends.length > 0 ? trends.reduce((s, t) => s + t.fillRate, 0) / trends.length : 0;
    const avgDeliveryAccuracy =
      trends.length > 0 ? trends.reduce((s, t) => s + t.deliveryAccuracy, 0) / trends.length : 0;

    const result = {
      trends,
      averages: {
        fillRate: Math.round(avgFillRate * 100) / 100,
        deliveryAccuracy: Math.round(avgDeliveryAccuracy * 100) / 100,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getLeadTime(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:lead-time:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getMetricWhere(tenantId, query);
    const metrics = await this.prisma.supplierPerformanceMetric.findMany({
      where,
      include: { supplier: true },
      orderBy: { periodStart: 'asc' },
    });

    const perSupplier = new Map<
      string,
      { supplierId: string; supplierName: string; leadTimeAvgs: number[] }
    >();
    const allLeadTimes: number[] = [];

    for (const m of metrics) {
      const sid = m.supplierId ?? 'unknown';
      if (!perSupplier.has(sid)) {
        perSupplier.set(sid, {
          supplierId: sid,
          supplierName: m.supplier?.name ?? 'Unknown',
          leadTimeAvgs: [],
        });
      }
      if (m.leadTimeAvg != null) {
        perSupplier.get(sid)!.leadTimeAvgs.push(Number(m.leadTimeAvg));
        allLeadTimes.push(Number(m.leadTimeAvg));
      }
    }

    const suppliers = Array.from(perSupplier.values()).map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      avgLeadTime:
        s.leadTimeAvgs.length > 0
          ? Math.round((s.leadTimeAvgs.reduce((a, b) => a + b, 0) / s.leadTimeAvgs.length) * 100) /
            100
          : 0,
      dataPoints: s.leadTimeAvgs.length,
    }));

    const overallAvg =
      allLeadTimes.length > 0
        ? Math.round((allLeadTimes.reduce((a, b) => a + b, 0) / allLeadTimes.length) * 100) / 100
        : 0;

    const suppliersWithLeadTime = await this.prisma.supplier.findMany({
      where: { tenantId },
      select: { id: true, name: true, leadTime: true },
    });

    const result = {
      overallAverage: overallAvg,
      suppliers,
      supplierDefaults: suppliersWithLeadTime.map((s) => ({
        id: s.id,
        name: s.name,
        defaultLeadTime: s.leadTime,
      })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getFillRate(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:fill-rate:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getMetricWhere(tenantId, query);
    const metrics = await this.prisma.supplierPerformanceMetric.findMany({
      where,
      include: { supplier: true },
      orderBy: { periodStart: 'asc' },
    });

    const perSupplier = new Map<
      string,
      { supplierId: string; supplierName: string; fillRates: number[]; fillRateCount: number }
    >();
    const allFillRates: number[] = [];

    for (const m of metrics) {
      const sid = m.supplierId ?? 'unknown';
      if (!perSupplier.has(sid)) {
        perSupplier.set(sid, {
          supplierId: sid,
          supplierName: m.supplier?.name ?? 'Unknown',
          fillRates: [],
          fillRateCount: 0,
        });
      }
      const g = perSupplier.get(sid)!;
      const fr =
        m.fillRate != null
          ? Number(m.fillRate)
          : m.totalOrders > 0
            ? (m.onTimeDeliveries / m.totalOrders) * 100
            : 0;
      g.fillRates.push(fr);
      g.fillRateCount++;
      allFillRates.push(fr);
    }

    const suppliers = Array.from(perSupplier.values()).map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      avgFillRate:
        s.fillRates.length > 0
          ? Math.round((s.fillRates.reduce((a, b) => a + b, 0) / s.fillRates.length) * 100) / 100
          : 0,
      dataPoints: s.fillRateCount,
    }));

    const overallAvg =
      allFillRates.length > 0
        ? Math.round((allFillRates.reduce((a, b) => a + b, 0) / allFillRates.length) * 100) / 100
        : 0;

    const result = { overallAverage: overallAvg, suppliers };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getPriceVariance(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:price-variance:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const result = await this.prisma.$queryRawUnsafe<
      Array<{
        inventoryItemId: string;
        itemName: string;
        supplierDetailId: string;
        supplierName: string;
        unitPrice: number;
      }>
    >(
      `SELECT poi.inventory_item_id as "inventoryItemId", ii.name as "itemName",
              po.supplier_detail_id as "supplierDetailId", COALESCE(sd.company_name, sd.name, 'Unknown') as "supplierName",
              poi.unit_price as "unitPrice"
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.purchase_order_id
       LEFT JOIN supplier_details sd ON sd.id = po.supplier_detail_id
       LEFT JOIN inventory_items ii ON ii.id = poi.inventory_item_id
       WHERE po.tenant_id = $1 AND poi.inventory_item_id IS NOT NULL
       ${query.startDate ? `AND po.created_at >= $2` : ''}
       ${query.endDate ? `AND po.created_at <= $3` : ''}
       ${query.supplierId ? `AND po.supplier_detail_id = $4` : ''}
       ORDER BY ii.name`,
      tenantId,
      ...(query.startDate ? [new Date(query.startDate)] : []),
      ...(query.endDate ? [new Date(query.endDate)] : []),
      ...(query.supplierId ? [query.supplierId] : []),
    );

    const itemMap = new Map<
      string,
      {
        itemId: string;
        itemName: string;
        suppliers: Map<string, { name: string; prices: number[] }>;
      }
    >();
    for (const row of result) {
      if (!itemMap.has(row.inventoryItemId)) {
        itemMap.set(row.inventoryItemId, {
          itemId: row.inventoryItemId,
          itemName: row.itemName || 'Unknown',
          suppliers: new Map(),
        });
      }
      const entry = itemMap.get(row.inventoryItemId)!;
      if (!entry.suppliers.has(row.supplierDetailId)) {
        entry.suppliers.set(row.supplierDetailId, { name: row.supplierName, prices: [] });
      }
      entry.suppliers.get(row.supplierDetailId)!.prices.push(Number(row.unitPrice));
    }

    const items = Array.from(itemMap.values()).map((entry) => {
      const supplierList = Array.from(entry.suppliers.entries()).map(([sid, data]) => ({
        supplierId: sid,
        supplierName: data.name,
        avgPrice:
          data.prices.length > 0
            ? Math.round((data.prices.reduce((a, b) => a + b, 0) / data.prices.length) * 100) / 100
            : 0,
        priceCount: data.prices.length,
      }));
      const allPrices = supplierList.flatMap((s) => s.avgPrice);
      return {
        itemId: entry.itemId,
        itemName: entry.itemName,
        supplierCount: supplierList.length,
        minPrice: allPrices.length > 0 ? Math.min(...allPrices) : 0,
        maxPrice: allPrices.length > 0 ? Math.max(...allPrices) : 0,
        priceSpread: allPrices.length > 0 ? Math.max(...allPrices) - Math.min(...allPrices) : 0,
        suppliers: supplierList,
      };
    });

    const result2 = {
      items: items.filter((i) => i.supplierCount > 1),
      totalItemsWithMultipleSuppliers: items.filter((i) => i.supplierCount > 1).length,
    };
    await this.cacheService.set(tenantId, cacheKey, result2, 300);
    return result2;
  }

  async getQualityScores(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:quality:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getMetricWhere(tenantId, query);
    const metrics = await this.prisma.supplierPerformanceMetric.findMany({
      where,
      include: { supplier: true },
      orderBy: { periodStart: 'asc' },
    });

    const perSupplier = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        qualityScores: number[];
        rejectedItems: number;
        totalRejected: number;
        periodCount: number;
      }
    >();

    for (const m of metrics) {
      const sid = m.supplierId ?? 'unknown';
      if (!perSupplier.has(sid)) {
        perSupplier.set(sid, {
          supplierId: sid,
          supplierName: m.supplier?.name ?? 'Unknown',
          qualityScores: [],
          rejectedItems: 0,
          totalRejected: 0,
          periodCount: 0,
        });
      }
      const g = perSupplier.get(sid)!;
      if (m.qualityScore != null) g.qualityScores.push(Number(m.qualityScore));
      g.rejectedItems += m.rejectedItems ?? 0;
      g.totalRejected += m.rejectedItems ?? 0;
      g.periodCount++;
    }

    const suppliers = Array.from(perSupplier.values()).map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      avgQualityScore:
        s.qualityScores.length > 0
          ? Math.round(
              (s.qualityScores.reduce((a, b) => a + b, 0) / s.qualityScores.length) * 100,
            ) / 100
          : 0,
      totalRejectedItems: s.totalRejected,
      periodsWithData: s.periodCount,
    }));

    const allScores = suppliers.filter((s) => s.avgQualityScore > 0).map((s) => s.avgQualityScore);
    const overallAvgQuality =
      allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

    const result = { overallAvgQuality: Math.round(overallAvgQuality * 100) / 100, suppliers };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getPurchaseTrends(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:purchase-trends:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const result = await this.prisma.$queryRawUnsafe<
      Array<{
        period: string;
        totalSpend: number;
        orderCount: bigint;
      }>
    >(
      `SELECT TO_CHAR("createdAt", 'YYYY-MM') as period, SUM(total) as "totalSpend", COUNT(*) as "orderCount"
       FROM purchase_orders WHERE "tenantId" = $1
       ${query.startDate ? `AND "createdAt" >= $2` : ''}
       ${query.endDate ? `AND "createdAt" <= $3` : ''}
       ${query.supplierId ? `AND "supplierDetailId" = $4` : ''}
       GROUP BY TO_CHAR("createdAt", 'YYYY-MM') ORDER BY period ASC`,
      tenantId,
      ...(query.startDate ? [new Date(query.startDate)] : []),
      ...(query.endDate ? [new Date(query.endDate)] : []),
      ...(query.supplierId ? [query.supplierId] : []),
    );

    const supplierData = await this.prisma.$queryRawUnsafe<
      Array<{
        supplierDetailId: string;
        supplierName: string;
        totalSpend: number;
        orderCount: bigint;
      }>
    >(
      `SELECT po."supplierDetailId" as "supplierDetailId", COALESCE(s.name, 'Unknown') as "supplierName",
              SUM(po.total) as "totalSpend", COUNT(*) as "orderCount"
       FROM purchase_orders po
       LEFT JOIN supplier_details sd ON sd.id = po."supplierDetailId"
       LEFT JOIN suppliers s ON s.id = sd."supplierId"
       WHERE po."tenantId" = $1
       ${query.startDate ? `AND po."createdAt" >= $2` : ''}
       ${query.endDate ? `AND po."createdAt" <= $3` : ''}
       ${query.supplierId ? `AND po."supplierDetailId" = $4` : ''}
       GROUP BY po."supplierDetailId", s.name ORDER BY "totalSpend" DESC`,
      tenantId,
      ...(query.startDate ? [new Date(query.startDate)] : []),
      ...(query.endDate ? [new Date(query.endDate)] : []),
      ...(query.supplierId ? [query.supplierId] : []),
    );

    const result2 = {
      trends: result.map((r) => ({
        period: r.period,
        totalSpend: Number(r.totalSpend),
        orderCount: Number(r.orderCount),
      })),
      bySupplier: supplierData.map((s) => ({
        supplierId: s.supplierDetailId,
        supplierName: s.supplierName,
        totalSpend: Number(s.totalSpend),
        orderCount: Number(s.orderCount),
      })),
      totalSpend: result.reduce((s, r) => s + Number(r.totalSpend), 0),
      totalOrders: result.reduce((s, r) => s + Number(r.orderCount), 0),
    };

    await this.cacheService.set(tenantId, cacheKey, result2, 300);
    return result2;
  }

  async getVendorRanking(tenantId: string, query: SupplierAnalyticsQueryDto) {
    const cacheKey = `supplier-analytics:ranking:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getMetricWhere(tenantId, query);
    const metrics = await this.prisma.supplierPerformanceMetric.findMany({
      where,
      include: { supplier: true },
      orderBy: { overallScore: 'desc' },
    });

    const latestPerSupplier = new Map<string, (typeof metrics)[number]>();
    for (const m of metrics) {
      if (m.supplierId && !latestPerSupplier.has(m.supplierId)) {
        latestPerSupplier.set(m.supplierId, m);
      }
    }

    const rankings = Array.from(latestPerSupplier.values())
      .sort(
        (a: (typeof metrics)[number], b: (typeof metrics)[number]) =>
          Number(b.overallScore ?? 0) - Number(a.overallScore ?? 0),
      )
      .map((m: (typeof metrics)[number], idx) => ({
        rank: idx + 1,
        supplierId: m.supplierId,
        supplierName: m.supplier?.name ?? 'Unknown',
        overallScore: Number(m.overallScore ?? 0),
        qualityScore: Number(m.qualityScore ?? 0),
        costScore: Number(m.costScore ?? 0),
        fillRate: Number(m.fillRate ?? 0),
        deliveryAccuracy: Number(m.deliveryAccuracy ?? 0),
        leadTimeAvg: Number(m.leadTimeAvg ?? 0),
        totalOrders: m.totalOrders,
        periodEnd: m.periodEnd,
      }));

    const result = { rankings, lastUpdated: metrics.length > 0 ? metrics[0].periodEnd : null };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
