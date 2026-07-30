import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@Injectable()
export class ExecutiveDashboardService {
  private readonly logger = new Logger(ExecutiveDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private buildDateFilter(query: DashboardQueryDto): { gte?: Date; lte?: Date } {
    const filter: { gte?: Date; lte?: Date } = {};
    if (query.startDate) filter.gte = new Date(query.startDate);
    if (query.endDate) filter.lte = new Date(query.endDate);
    return filter;
  }

  private getOrderWhere(tenantId: string, query: DashboardQueryDto): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = { tenantId };
    const dateFilter = this.buildDateFilter(query);
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
    if (query.branchId) where.branchId = query.branchId;
    return where;
  }

  async getKpi(tenantId: string, query: DashboardQueryDto) {
    const cacheKey = `exec-dashboard:kpi:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getOrderWhere(tenantId, query);

    const [
      orders,
      completedOrders,
      cancelledOrders,
      refundedOrders,
      customerCount,
      existingCustomers,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          subtotal: true,
          discount: true,
          discountAmount: true,
          serviceCharge: true,
          taxAmount: true,
          total: true,
          paidAmount: true,
          status: true,
          completedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.order.count({ where: { ...where, status: 'COMPLETED' } }),
      this.prisma.order.count({ where: { ...where, status: 'CANCELLED' } }),
      this.prisma.order.count({ where: { ...where, status: 'REFUNDED' } }),
      this.prisma.customer.count({ where: { tenantId, createdAt: this.buildDateFilter(query) } }),
      this.prisma.customer.count({ where: { tenantId } }),
    ]);

    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total), 0);
    const netRevenue = orders
      .filter((o) => o.status === 'COMPLETED')
      .reduce((sum, o) => sum + Number(o.paidAmount ?? o.total), 0);
    const grossProfit = orders
      .filter((o) => o.status === 'COMPLETED')
      .reduce((sum, o) => {
        const subtotal = Number(o.subtotal ?? 0);
        const discount = Number(o.discountAmount ?? 0);
        return sum + subtotal - discount;
      }, 0);
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const operatingMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

    const customerGrowth = existingCustomers > 0 ? (customerCount / existingCustomers) * 100 : 0;

    const completedWithTime = orders.filter((o) => o.status === 'COMPLETED' && o.completedAt);
    const avgPreparationTime =
      completedWithTime.length > 0
        ? completedWithTime.reduce(
            (sum, o) => sum + (o.completedAt!.getTime() - o.createdAt.getTime()),
            0,
          ) / completedWithTime.length
        : 0;

    const result = {
      totalRevenue,
      netRevenue,
      grossProfit,
      grossMargin,
      operatingMargin,
      totalOrders: orders.length,
      completedOrders,
      cancelledOrders,
      refundedOrders,
      avgOrderValue,
      customerGrowth,
      avgPreparationTime,
      avgServiceTime: avgPreparationTime,
      avgTicket: avgOrderValue,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTopProducts(tenantId: string, query: DashboardQueryDto) {
    const cacheKey = `exec-dashboard:top-products:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const limit = query.limit ?? 10;
    const dateFilter = this.buildDateFilter(query);

    const orderWhere: Prisma.OrderWhereInput = { tenantId };
    if (Object.keys(dateFilter).length > 0) orderWhere.createdAt = dateFilter;
    if (query.branchId) orderWhere.branchId = query.branchId;

    const items = await this.prisma.orderItem.findMany({
      where: { order: orderWhere },
      select: { productId: true, productName: true, quantity: true, total: true },
    });

    const grouped = new Map<
      string,
      { productId: string; productName: string; totalQuantity: number; totalRevenue: number }
    >();
    for (const item of items) {
      const key = item.productId;
      if (!grouped.has(key)) {
        grouped.set(key, {
          productId: item.productId,
          productName: item.productName,
          totalQuantity: 0,
          totalRevenue: 0,
        });
      }
      const g = grouped.get(key)!;
      g.totalQuantity += Number(item.quantity);
      g.totalRevenue += Number(item.total);
    }

    const result = Array.from(grouped.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTopCategories(tenantId: string, query: DashboardQueryDto) {
    const cacheKey = `exec-dashboard:top-categories:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const limit = query.limit ?? 10;
    const dateFilter = this.buildDateFilter(query);

    const orderWhere: Prisma.OrderWhereInput = { tenantId };
    if (Object.keys(dateFilter).length > 0) orderWhere.createdAt = dateFilter;
    if (query.branchId) orderWhere.branchId = query.branchId;

    const items = await this.prisma.orderItem.findMany({
      where: { order: orderWhere },
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
      if (!grouped.has(catId)) {
        grouped.set(catId, {
          categoryId: catId,
          categoryName: categoryMap.get(catId) ?? 'Uncategorized',
          totalQuantity: 0,
          totalRevenue: 0,
        });
      }
      const g = grouped.get(catId)!;
      g.totalQuantity += Number(item.quantity);
      g.totalRevenue += Number(item.total);
    }

    const result = Array.from(grouped.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTopBranches(tenantId: string, query: DashboardQueryDto) {
    const cacheKey = `exec-dashboard:top-branches:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const limit = query.limit ?? 10;
    const dateFilter = this.buildDateFilter(query);

    const orders = await this.prisma.order.findMany({
      where: { tenantId, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) },
      select: { branchId: true, total: true },
    });

    const grouped = new Map<
      string,
      { branchId: string; totalRevenue: number; orderCount: number }
    >();
    for (const o of orders) {
      const bid = o.branchId ?? 'unknown';
      if (!grouped.has(bid)) grouped.set(bid, { branchId: bid, totalRevenue: 0, orderCount: 0 });
      const g = grouped.get(bid)!;
      g.totalRevenue += Number(o.total);
      g.orderCount++;
    }

    const result = Array.from(grouped.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTopEmployees(tenantId: string, query: DashboardQueryDto) {
    const cacheKey = `exec-dashboard:top-employees:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const limit = query.limit ?? 10;
    const dateFilter = this.buildDateFilter(query);

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        userId: { not: null },
        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
      },
      select: { userId: true, total: true },
    });

    const grouped = new Map<string, { userId: string; totalRevenue: number; orderCount: number }>();
    for (const o of orders) {
      const uid = o.userId!;
      if (!grouped.has(uid)) grouped.set(uid, { userId: uid, totalRevenue: 0, orderCount: 0 });
      const g = grouped.get(uid)!;
      g.totalRevenue += Number(o.total);
      g.orderCount++;
    }

    const result = Array.from(grouped.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTopCustomers(tenantId: string, query: DashboardQueryDto) {
    const cacheKey = `exec-dashboard:top-customers:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const limit = query.limit ?? 10;
    const dateFilter = this.buildDateFilter(query);

    const orders = await this.prisma.order.findMany({
      where: { tenantId, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) },
      select: { customerPhone: true, customerEmail: true, total: true },
    });

    const grouped = new Map<
      string,
      { identifier: string; totalRevenue: number; orderCount: number }
    >();
    for (const o of orders) {
      const identifier = o.customerPhone || o.customerEmail || 'anonymous';
      if (!grouped.has(identifier))
        grouped.set(identifier, { identifier, totalRevenue: 0, orderCount: 0 });
      const g = grouped.get(identifier)!;
      g.totalRevenue += Number(o.total);
      g.orderCount++;
    }

    const result = Array.from(grouped.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getSalesTrend(tenantId: string, query: DashboardQueryDto) {
    const cacheKey = `exec-dashboard:sales-trend:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);

    const orders = await this.prisma.order.findMany({
      where: { tenantId, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) },
      select: { createdAt: true, total: true, id: true },
      orderBy: { createdAt: 'asc' },
    });

    const grouped = new Map<string, { date: string; revenue: number; orderCount: number }>();
    for (const o of orders) {
      const d = o.createdAt.toISOString().split('T')[0];
      if (!grouped.has(d)) grouped.set(d, { date: d, revenue: 0, orderCount: 0 });
      const g = grouped.get(d)!;
      g.revenue += Number(o.total);
      g.orderCount++;
    }

    const result = Array.from(grouped.values());

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
