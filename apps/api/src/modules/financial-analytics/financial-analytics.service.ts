import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { FinancialAnalyticsQueryDto } from './dto/financial-analytics-query.dto';

@Injectable()
export class FinancialAnalyticsService {
  private readonly logger = new Logger(FinancialAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private buildDateFilter(query: FinancialAnalyticsQueryDto): { gte?: Date; lte?: Date } {
    const filter: { gte?: Date; lte?: Date } = {};
    if (query.startDate) filter.gte = new Date(query.startDate);
    if (query.endDate) filter.lte = new Date(query.endDate);
    return filter;
  }

  private getOrderWhere(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    const dateFilter = this.buildDateFilter(query);
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
    if (query.branchId) where.branchId = query.branchId;
    return where;
  }

  async getOverview(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:overview:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);

    const [orders, purchaseOrders, consumptionRecords] = await Promise.all([
      this.prisma.order.findMany({
        where: orderWhere,
        select: {
          total: true,
          subtotal: true,
          discountAmount: true,
          taxAmount: true,
          serviceCharge: true,
          status: true,
        },
      }),
      this.prisma.purchaseOrder.findMany({
        where: {
          tenantId,
          ...(query.startDate || query.endDate ? { createdAt: this.buildDateFilter(query) } : {}),
        },
        select: { total: true },
      }),
      this.prisma.consumptionRecord.findMany({
        where: {
          tenantId,
          ...(query.startDate || query.endDate ? { date: this.buildDateFilter(query) } : {}),
        },
        select: { totalCost: true },
      }),
    ]);

    const completedOrders = orders.filter((o) => o.status === 'COMPLETED');
    const revenue = completedOrders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
    const subtotals = completedOrders.reduce((sum, o) => sum + Number(o.subtotal ?? 0), 0);
    const expenses = purchaseOrders.reduce((sum, po) => sum + Number(po.total ?? 0), 0);
    const cogs = consumptionRecords.reduce((sum, r) => sum + Number(r.totalCost ?? 0), 0);
    const grossProfit = subtotals - cogs;
    const totalTaxes = orders.reduce((sum, o) => sum + Number(o.taxAmount ?? 0), 0);
    const totalDiscounts = orders.reduce((sum, o) => sum + Number(o.discountAmount ?? 0), 0);
    const totalServiceCharges = orders.reduce((sum, o) => sum + Number(o.serviceCharge ?? 0), 0);
    const refundedOrders = orders.filter((o) => o.status === 'REFUNDED' || o.status === 'VOIDED');
    const totalRefunds = refundedOrders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
    const netProfit = grossProfit - expenses + totalServiceCharges - totalDiscounts;

    const result = {
      revenue: Math.round(revenue * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      cogs: Math.round(cogs * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      grossMargin: revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0,
      netMargin: revenue > 0 ? Math.round((netProfit / revenue) * 10000) / 100 : 0,
      totalTaxes: Math.round(totalTaxes * 100) / 100,
      totalDiscounts: Math.round(totalDiscounts * 100) / 100,
      totalRefunds: Math.round(totalRefunds * 100) / 100,
      totalServiceCharges: Math.round(totalServiceCharges * 100) / 100,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRevenueBreakdown(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:revenue:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where: { ...orderWhere, status: 'COMPLETED' },
      select: { total: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const daily = new Map<string, { date: string; revenue: number; orderCount: number }>();
    for (const o of orders) {
      const d = o.createdAt.toISOString().split('T')[0];
      if (!daily.has(d)) daily.set(d, { date: d, revenue: 0, orderCount: 0 });
      daily.get(d)!.revenue += Number(o.total);
      daily.get(d)!.orderCount++;
    }

    const dailyData = Array.from(daily.values());
    const totalRevenue = dailyData.reduce((s, d) => s + d.revenue, 0);
    const avgDaily = dailyData.length > 0 ? totalRevenue / dailyData.length : 0;
    const minDaily = dailyData.length > 0 ? Math.min(...dailyData.map((d) => d.revenue)) : 0;
    const maxDaily = dailyData.length > 0 ? Math.max(...dailyData.map((d) => d.revenue)) : 0;

    const result = {
      daily: dailyData,
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        avgDaily: Math.round(avgDaily * 100) / 100,
        minDaily: Math.round(minDaily * 100) / 100,
        maxDaily: Math.round(maxDaily * 100) / 100,
        totalDays: dailyData.length,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getCogsBreakdown(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:cogs:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);
    const consumptionWhere: Record<string, unknown> = { tenantId };
    if (Object.keys(dateFilter).length > 0) consumptionWhere.date = dateFilter;

    const records = await this.prisma.consumptionRecord.findMany({
      where: consumptionWhere,
      select: { inventoryItemId: true, totalCost: true, quantity: true, date: true },
    });

    const inventoryIds = [...new Set(records.map((r) => r.inventoryItemId))];
    const items =
      inventoryIds.length > 0
        ? await this.prisma.inventoryItem.findMany({
            where: { id: { in: inventoryIds }, tenantId },
            select: { id: true, name: true, categoryId: true },
          })
        : [];
    const itemMap = new Map(items.map((i) => [i.id, { name: i.name, categoryId: i.categoryId }]));

    const catIds = [...new Set(items.map((i) => i.categoryId).filter(Boolean))];
    const categories =
      catIds.length > 0
        ? await this.prisma.menuCategory.findMany({
            where: { id: { in: catIds as string[] } },
            select: { id: true, name: true },
          })
        : [];
    const catNameMap = new Map(categories.map((c) => [c.id, c.name]));

    const byCategory = new Map<
      string,
      { categoryId: string; categoryName: string; totalCost: number; totalQuantity: number }
    >();
    const byPeriod = new Map<string, { period: string; totalCost: number }>();

    for (const r of records) {
      const info = itemMap.get(r.inventoryItemId);
      const catId = info?.categoryId ?? 'uncategorized';
      if (!byCategory.has(catId)) {
        byCategory.set(catId, {
          categoryId: catId,
          categoryName: catNameMap.get(catId) ?? 'Uncategorized',
          totalCost: 0,
          totalQuantity: 0,
        });
      }
      byCategory.get(catId)!.totalCost += Number(r.totalCost ?? 0);
      byCategory.get(catId)!.totalQuantity += Number(r.quantity ?? 0);

      const p = r.date.toISOString().slice(0, 7);
      if (!byPeriod.has(p)) byPeriod.set(p, { period: p, totalCost: 0 });
      byPeriod.get(p)!.totalCost += Number(r.totalCost ?? 0);
    }

    const totalCogs = records.reduce((s, r) => s + Number(r.totalCost ?? 0), 0);

    const result = {
      totalCogs: Math.round(totalCogs * 100) / 100,
      byCategory: Array.from(byCategory.values()).map((c) => ({
        ...c,
        totalCost: Math.round(c.totalCost * 100) / 100,
      })),
      byPeriod: Array.from(byPeriod.values()).map((p) => ({
        ...p,
        totalCost: Math.round(p.totalCost * 100) / 100,
      })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getProfitabilityByBranch(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:profitability:branches:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where: { ...orderWhere, status: 'COMPLETED' },
      select: { branchId: true, subtotal: true, total: true, discountAmount: true },
    });

    const byBranch = new Map<
      string,
      { branchId: string; revenue: number; subtotal: number; discounts: number; orderCount: number }
    >();
    for (const o of orders) {
      const bid = o.branchId ?? 'unknown';
      if (!byBranch.has(bid))
        byBranch.set(bid, { branchId: bid, revenue: 0, subtotal: 0, discounts: 0, orderCount: 0 });
      const g = byBranch.get(bid)!;
      g.revenue += Number(o.total ?? 0);
      g.subtotal += Number(o.subtotal ?? 0);
      g.discounts += Number(o.discountAmount ?? 0);
      g.orderCount++;
    }

    const dateFilter = this.buildDateFilter(query);
    const consumptionWhere: Record<string, unknown> = { tenantId };
    if (Object.keys(dateFilter).length > 0) consumptionWhere.date = dateFilter;
    const consumptionTotal = await this.prisma.consumptionRecord.aggregate({
      where: consumptionWhere,
      _sum: { totalCost: true },
    });
    const totalCogs = Number(consumptionTotal._sum.totalCost ?? 0);

    const totalRevenue = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);

    const branches = Array.from(byBranch.values())
      .map((b) => {
        const revenueRatio = totalRevenue > 0 ? b.revenue / totalRevenue : 0;
        const allocatedCogs = totalCogs * revenueRatio;
        const grossProfit = b.subtotal - allocatedCogs - b.discounts;
        const margin = b.revenue > 0 ? (grossProfit / b.revenue) * 100 : 0;
        return {
          branchId: b.branchId,
          revenue: Math.round(b.revenue * 100) / 100,
          subtotal: Math.round(b.subtotal * 100) / 100,
          allocatedCogs: Math.round(allocatedCogs * 100) / 100,
          discounts: Math.round(b.discounts * 100) / 100,
          grossProfit: Math.round(grossProfit * 100) / 100,
          margin: Math.round(margin * 100) / 100,
          orderCount: b.orderCount,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const result = {
      branches,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCogs: Math.round(totalCogs * 100) / 100,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getProfitabilityByCategory(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:profitability:categories:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);
    const items = await this.prisma.orderItem.findMany({
      where: { order: orderWhere },
      select: { productId: true, quantity: true, unitPrice: true, total: true },
    });

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products =
      productIds.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: productIds }, tenantId },
            select: { id: true, name: true, categoryId: true, cost: true },
          })
        : [];
    const productMap = new Map(
      products.map((p) => [
        p.id,
        { name: p.name, categoryId: p.categoryId, cost: Number(p.cost ?? 0) },
      ]),
    );

    const catIds = [...new Set(products.map((p) => p.categoryId).filter(Boolean))];
    const categories =
      catIds.length > 0
        ? await this.prisma.menuCategory.findMany({
            where: { id: { in: catIds as string[] } },
            select: { id: true, name: true },
          })
        : [];
    const catNameMap = new Map(categories.map((c) => [c.id, c.name]));

    const byCategory = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        revenue: number;
        estimatedCost: number;
        quantity: number;
      }
    >();
    for (const item of items) {
      const prod = productMap.get(item.productId);
      const catId = prod?.categoryId ?? 'uncategorized';
      if (!byCategory.has(catId)) {
        byCategory.set(catId, {
          categoryId: catId,
          categoryName: catNameMap.get(catId) ?? 'Uncategorized',
          revenue: 0,
          estimatedCost: 0,
          quantity: 0,
        });
      }
      const g = byCategory.get(catId)!;
      g.revenue += Number(item.total ?? 0);
      g.estimatedCost += (prod?.cost ?? 0) * Number(item.quantity ?? 0);
      g.quantity += Number(item.quantity ?? 0);
    }

    const categoriesResult = Array.from(byCategory.values())
      .map((c) => {
        const profit = c.revenue - c.estimatedCost;
        const margin = c.revenue > 0 ? (profit / c.revenue) * 100 : 0;
        return {
          categoryId: c.categoryId,
          categoryName: c.categoryName,
          revenue: Math.round(c.revenue * 100) / 100,
          estimatedCost: Math.round(c.estimatedCost * 100) / 100,
          grossProfit: Math.round(profit * 100) / 100,
          margin: Math.round(margin * 100) / 100,
          quantity: c.quantity,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const result = { categories: categoriesResult };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getProfitabilityByProduct(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:profitability:products:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);
    const items = await this.prisma.orderItem.findMany({
      where: { order: orderWhere },
      select: { productId: true, productName: true, quantity: true, unitPrice: true, total: true },
    });

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products =
      productIds.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: productIds }, tenantId },
            select: { id: true, cost: true },
          })
        : [];
    const costMap = new Map(products.map((p) => [p.id, Number(p.cost ?? 0)]));

    const byProduct = new Map<
      string,
      {
        productId: string;
        productName: string;
        revenue: number;
        estimatedCost: number;
        quantity: number;
      }
    >();
    for (const item of items) {
      if (!byProduct.has(item.productId)) {
        byProduct.set(item.productId, {
          productId: item.productId,
          productName: item.productName,
          revenue: 0,
          estimatedCost: 0,
          quantity: 0,
        });
      }
      const g = byProduct.get(item.productId)!;
      g.revenue += Number(item.total ?? 0);
      g.estimatedCost += (costMap.get(item.productId) ?? 0) * Number(item.quantity ?? 0);
      g.quantity += Number(item.quantity ?? 0);
    }

    const productsResult = Array.from(byProduct.values())
      .map((p) => {
        const profit = p.revenue - p.estimatedCost;
        const margin = p.revenue > 0 ? (profit / p.revenue) * 100 : 0;
        return {
          productId: p.productId,
          productName: p.productName,
          revenue: Math.round(p.revenue * 100) / 100,
          estimatedCost: Math.round(p.estimatedCost * 100) / 100,
          grossProfit: Math.round(profit * 100) / 100,
          margin: Math.round(margin * 100) / 100,
          quantity: p.quantity,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const result = { products: productsResult };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTaxAnalysis(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:taxes:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where: { ...orderWhere, status: 'COMPLETED' },
      select: { taxAmount: true, subtotal: true, total: true },
    });

    const totalTax = orders.reduce((s, o) => s + Number(o.taxAmount ?? 0), 0);
    const totalRevenue = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);
    const avgTaxRate = totalRevenue > 0 ? (totalTax / totalRevenue) * 100 : 0;
    const ordersWithTax = orders.filter((o) => Number(o.taxAmount) > 0);

    const result = {
      totalTaxCollected: Math.round(totalTax * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgTaxRate: Math.round(avgTaxRate * 10000) / 100,
      ordersWithTax: ordersWithTax.length,
      ordersWithoutTax: orders.length - ordersWithTax.length,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getDiscountAnalysis(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:discounts:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      select: { discountAmount: true, subtotal: true, total: true, discount: true },
    });

    const totalDiscounts = orders.reduce((s, o) => s + Number(o.discountAmount ?? 0), 0);
    const totalRevenue = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);
    const totalSubtotal = orders.reduce((s, o) => s + Number(o.subtotal ?? 0), 0);
    const ordersWithDiscounts = orders.filter((o) => Number(o.discountAmount) > 0);
    const avgDiscountPercent =
      ordersWithDiscounts.length > 0
        ? ordersWithDiscounts.reduce((s, o) => {
            const sub = Number(o.subtotal ?? 0);
            return s + (sub > 0 ? (Number(o.discountAmount) / sub) * 100 : 0);
          }, 0) / ordersWithDiscounts.length
        : 0;
    const discountImpact = totalSubtotal > 0 ? (totalDiscounts / totalSubtotal) * 100 : 0;

    const result = {
      totalDiscountsGiven: Math.round(totalDiscounts * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      ordersWithDiscounts: ordersWithDiscounts.length,
      totalOrders: orders.length,
      avgDiscountPercent: Math.round(avgDiscountPercent * 100) / 100,
      discountImpact: Math.round(discountImpact * 100) / 100,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRefundAnalysis(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:refunds:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where: { ...orderWhere, status: 'REFUNDED' },
      select: { total: true, completedAt: true, createdAt: true },
    });

    const totalRefunded = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);

    const allOrders = await this.prisma.order.count({
      where: { ...orderWhere, status: { in: ['COMPLETED', 'REFUNDED'] } },
    });

    const refundRate = allOrders > 0 ? (orders.length / allOrders) * 100 : 0;

    const byPeriod = new Map<
      string,
      { period: string; refundAmount: number; refundCount: number }
    >();
    for (const o of orders) {
      const d = (o.completedAt ?? o.createdAt).toISOString().slice(0, 7);
      if (!byPeriod.has(d)) byPeriod.set(d, { period: d, refundAmount: 0, refundCount: 0 });
      byPeriod.get(d)!.refundAmount += Number(o.total ?? 0);
      byPeriod.get(d)!.refundCount++;
    }

    const result = {
      totalRefunded: Math.round(totalRefunded * 100) / 100,
      refundCount: orders.length,
      totalCompletedOrRefunded: allOrders,
      refundRate: Math.round(refundRate * 10000) / 100,
      byPeriod: Array.from(byPeriod.values()),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getServiceChargeAnalysis(tenantId: string, query: FinancialAnalyticsQueryDto) {
    const cacheKey = `financial-analytics:service-charges:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const orderWhere = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where: { ...orderWhere, status: 'COMPLETED' },
      select: { serviceCharge: true, subtotal: true, total: true },
    });

    const totalServiceCharges = orders.reduce((s, o) => s + Number(o.serviceCharge ?? 0), 0);
    const totalRevenue = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);
    const ordersWithCharges = orders.filter((o) => Number(o.serviceCharge) > 0);
    const avgCharge =
      ordersWithCharges.length > 0 ? totalServiceCharges / ordersWithCharges.length : 0;
    const chargeImpact = totalRevenue > 0 ? (totalServiceCharges / totalRevenue) * 100 : 0;

    const result = {
      totalServiceCharges: Math.round(totalServiceCharges * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      ordersWithCharges: ordersWithCharges.length,
      totalOrders: orders.length,
      avgChargePerOrder: Math.round(avgCharge * 100) / 100,
      chargeImpact: Math.round(chargeImpact * 100) / 100,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
