import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';
import { SalesAnalyticsQueryDto, GroupByPeriod } from './dto/sales-analytics-query.dto';

@Injectable()
export class SalesAnalyticsService {
  private readonly logger = new Logger(SalesAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private buildDateFilter(query: SalesAnalyticsQueryDto): { gte?: Date; lte?: Date } {
    const filter: { gte?: Date; lte?: Date } = {};
    if (query.startDate) filter.gte = new Date(query.startDate);
    if (query.endDate) filter.lte = new Date(query.endDate);
    return filter;
  }

  private getOrderWhere(tenantId: string, query: SalesAnalyticsQueryDto): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = { tenantId };
    const dateFilter = this.buildDateFilter(query);
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
    if (query.branchId) where.branchId = query.branchId;
    return where;
  }

  async getOverview(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:overview:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { createdAt: true, total: true, id: true },
      orderBy: { createdAt: 'asc' },
    });

    const groupBy = query.groupBy ?? GroupByPeriod.DAILY;
    const grouped = new Map<string, { period: string; revenue: number; orderCount: number }>();

    for (const o of orders) {
      const d = o.createdAt;
      let period: string;
      switch (groupBy) {
        case GroupByPeriod.HOURLY:
          period = `${d.toISOString().split('T')[0]}-${d.getHours()}`;
          break;
        case GroupByPeriod.WEEKLY: {
          const start = new Date(d);
          start.setDate(start.getDate() - start.getDay());
          period = start.toISOString().split('T')[0];
          break;
        }
        case GroupByPeriod.MONTHLY:
          period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          break;
        case GroupByPeriod.QUARTERLY: {
          const q = Math.floor(d.getMonth() / 3) + 1;
          period = `${d.getFullYear()}-Q${q}`;
          break;
        }
        case GroupByPeriod.YEARLY:
          period = `${d.getFullYear()}`;
          break;
        default:
          period = d.toISOString().split('T')[0];
      }
      if (!grouped.has(period)) grouped.set(period, { period, revenue: 0, orderCount: 0 });
      const g = grouped.get(period)!;
      g.revenue += Number(o.total);
      g.orderCount++;
    }

    const result = Array.from(grouped.values());
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRevenueComparison(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:revenue-comparison:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const p1Where: Prisma.OrderWhereInput = { tenantId };
    const p2Where: Prisma.OrderWhereInput = { tenantId };

    if (query.period1Start)
      p1Where.createdAt = {
        ...((p1Where.createdAt as object) || {}),
        gte: new Date(query.period1Start),
      };
    if (query.period1End)
      p1Where.createdAt = {
        ...((p1Where.createdAt as object) || {}),
        lte: new Date(query.period1End),
      };
    if (query.period2Start)
      p2Where.createdAt = {
        ...((p2Where.createdAt as object) || {}),
        gte: new Date(query.period2Start),
      };
    if (query.period2End)
      p2Where.createdAt = {
        ...((p2Where.createdAt as object) || {}),
        lte: new Date(query.period2End),
      };

    const [period1Orders, period2Orders] = await Promise.all([
      this.prisma.order.findMany({ where: p1Where, select: { total: true } }),
      this.prisma.order.findMany({ where: p2Where, select: { total: true } }),
    ]);

    const period1Revenue = period1Orders.reduce((s, o) => s + Number(o.total), 0);
    const period2Revenue = period2Orders.reduce((s, o) => s + Number(o.total), 0);
    const growth =
      period1Revenue > 0 ? ((period2Revenue - period1Revenue) / period1Revenue) * 100 : 0;

    const result = {
      period1: { revenue: period1Revenue, orderCount: period1Orders.length },
      period2: { revenue: period2Revenue, orderCount: period2Orders.length },
      growth,
      percentageChange: growth,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getByBranch(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:by-branch:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { branchId: true, total: true },
    });

    const grouped = new Map<string, { branchId: string; revenue: number; orderCount: number }>();
    for (const o of orders) {
      const bid = o.branchId ?? 'unknown';
      if (!grouped.has(bid)) grouped.set(bid, { branchId: bid, revenue: 0, orderCount: 0 });
      const g = grouped.get(bid)!;
      g.revenue += Number(o.total);
      g.orderCount++;
    }

    const result = Array.from(grouped.values());
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getByProduct(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:by-product:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const items = await this.prisma.orderItem.findMany({
      where: { order: where },
      select: { productId: true, productName: true, quantity: true, total: true },
    });

    const grouped = new Map<
      string,
      { productId: string; productName: string; totalQuantity: number; totalRevenue: number }
    >();
    for (const item of items) {
      const key = item.productId;
      if (!grouped.has(key))
        grouped.set(key, {
          productId: item.productId,
          productName: item.productName,
          totalQuantity: 0,
          totalRevenue: 0,
        });
      const g = grouped.get(key)!;
      g.totalQuantity += Number(item.quantity);
      g.totalRevenue += Number(item.total);
    }

    const result = Array.from(grouped.values());
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getByCategory(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:by-category:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const items = await this.prisma.orderItem.findMany({
      where: { order: where },
      select: { productId: true, quantity: true, total: true },
    });

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, menuCategoryId: true },
    });

    const categoryIds = [
      ...new Set(products.map((p) => p.menuCategoryId).filter((id): id is string => id !== null)),
    ];
    const categories =
      categoryIds.length > 0
        ? await this.prisma.menuCategory.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : [];

    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
    const productCategoryMap = new Map(products.map((p) => [p.id, p.menuCategoryId]));

    const grouped = new Map<
      string,
      { categoryId: string; categoryName: string; totalQuantity: number; totalRevenue: number }
    >();
    for (const item of items) {
      const catId = productCategoryMap.get(item.productId) ?? 'uncategorized';
      if (!grouped.has(catId))
        grouped.set(catId, {
          categoryId: catId,
          categoryName: categoryMap.get(catId) ?? 'Uncategorized',
          totalQuantity: 0,
          totalRevenue: 0,
        });
      const g = grouped.get(catId)!;
      g.totalQuantity += Number(item.quantity);
      g.totalRevenue += Number(item.total);
    }

    const result = Array.from(grouped.values());
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getEmployeePerformance(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:employee-performance:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where: { ...where, userId: { not: null } },
      select: { userId: true, total: true, paidAmount: true },
    });

    const grouped = new Map<
      string,
      { userId: string; totalRevenue: number; totalSales: number; orderCount: number }
    >();
    for (const o of orders) {
      const uid = o.userId!;
      if (!grouped.has(uid))
        grouped.set(uid, { userId: uid, totalRevenue: 0, totalSales: 0, orderCount: 0 });
      const g = grouped.get(uid)!;
      g.totalRevenue += Number(o.total);
      g.totalSales += Number(o.paidAmount ?? 0);
      g.orderCount++;
    }

    const result = Array.from(grouped.values());
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getPaymentMethods(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:payment-methods:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);
    const paymentWhere: Prisma.PaymentWhereInput = { tenantId };
    if (Object.keys(dateFilter).length > 0) paymentWhere.createdAt = dateFilter;

    const payments = await this.prisma.payment.findMany({
      where: paymentWhere,
      select: { method: true, amount: true },
    });

    const grouped = new Map<
      string,
      { method: string; totalAmount: number; paymentCount: number }
    >();
    for (const p of payments) {
      if (!grouped.has(p.method))
        grouped.set(p.method, { method: p.method, totalAmount: 0, paymentCount: 0 });
      const g = grouped.get(p.method)!;
      g.totalAmount += Number(p.amount);
      g.paymentCount++;
    }

    const result = Array.from(grouped.values());
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getOrderChannels(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:order-channels:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { source: true, total: true },
    });

    const grouped = new Map<string, { source: string; orderCount: number; totalRevenue: number }>();
    for (const o of orders) {
      const src = o.source ?? 'unknown';
      if (!grouped.has(src)) grouped.set(src, { source: src, orderCount: 0, totalRevenue: 0 });
      const g = grouped.get(src)!;
      g.orderCount++;
      g.totalRevenue += Number(o.total);
    }

    const result = Array.from(grouped.values());
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getDiscountAnalysis(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:discounts:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { discount: true, discountAmount: true },
    });

    const totalDiscounts = orders.reduce((s, o) => s + Number(o.discountAmount ?? 0), 0);
    const ordersWithDiscounts = orders.filter((o) => Number(o.discountAmount ?? 0) > 0).length;
    const avgDiscount = ordersWithDiscounts > 0 ? totalDiscounts / ordersWithDiscounts : 0;

    const result = { totalDiscounts, ordersWithDiscounts, averageDiscount: avgDiscount };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getServiceChargeAnalysis(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:service-charges:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { serviceCharge: true },
    });

    const totalServiceCharge = orders.reduce((s, o) => s + Number(o.serviceCharge ?? 0), 0);
    const ordersWithCharge = orders.filter((o) => Number(o.serviceCharge ?? 0) > 0).length;

    const result = {
      totalServiceCharge,
      ordersWithCharge,
      averageServiceCharge: ordersWithCharge > 0 ? totalServiceCharge / ordersWithCharge : 0,
    };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTaxAnalysis(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:taxes:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { taxAmount: true },
    });

    const totalTax = orders.reduce((s, o) => s + Number(o.taxAmount ?? 0), 0);
    const avgTaxPerOrder = orders.length > 0 ? totalTax / orders.length : 0;

    const result = {
      totalTax,
      averageTaxPerOrder: avgTaxPerOrder,
      taxedOrderCount: orders.filter((o) => Number(o.taxAmount ?? 0) > 0).length,
    };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getPeakHours(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:peak-hours:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { createdAt: true },
    });

    const grouped = new Map<number, { hour: number; orderCount: number }>();
    for (const o of orders) {
      const h = o.createdAt.getHours();
      if (!grouped.has(h)) grouped.set(h, { hour: h, orderCount: 0 });
      grouped.get(h)!.orderCount++;
    }

    const result = Array.from(grouped.values()).sort((a, b) => a.hour - b.hour);
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getPeakDays(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:peak-days:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { createdAt: true },
    });

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const grouped = new Map<number, { dayOfWeek: number; dayName: string; orderCount: number }>();
    for (const o of orders) {
      const d = o.createdAt.getDay();
      if (!grouped.has(d)) grouped.set(d, { dayOfWeek: d, dayName: dayNames[d], orderCount: 0 });
      grouped.get(d)!.orderCount++;
    }

    const result = Array.from(grouped.values()).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getConversionMetrics(tenantId: string, query: SalesAnalyticsQueryDto) {
    const cacheKey = `sales:conversion:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);
    const orders = await this.prisma.order.findMany({
      where,
      select: { status: true },
    });

    const total = orders.length;
    const statusCounts = new Map<string, number>();
    for (const o of orders) {
      statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
    }

    const statusBreakdown = Array.from(statusCounts.entries()).map(([status, count]) => ({
      status,
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    }));

    const completed = statusCounts.get('COMPLETED') ?? 0;
    const cancelled = statusCounts.get('CANCELLED') ?? 0;
    const refunded = statusCounts.get('REFUNDED') ?? 0;

    const result = {
      totalOrders: total,
      statusBreakdown,
      completionRate: total > 0 ? (completed / total) * 100 : 0,
      cancellationRate: total > 0 ? (cancelled / total) * 100 : 0,
      refundRate: total > 0 ? (refunded / total) * 100 : 0,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
