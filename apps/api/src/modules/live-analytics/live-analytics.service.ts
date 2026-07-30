import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { LiveAnalyticsGateway } from './live-analytics.gateway';

@Injectable()
export class LiveAnalyticsService {
  private readonly logger = new Logger(LiveAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
    private readonly gateway: LiveAnalyticsGateway,
  ) {}

  async getLiveKpi(tenantId: string) {
    const cacheKey = 'live:kpi';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [ordersToday, revenueToday, avgPrepTime, activeOrders] = await Promise.all([
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: todayStart } },
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, processedAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      this.getAveragePrepTime(tenantId, todayStart),
      this.prisma.order.count({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] } as any },
      }),
    ]);

    const result = {
      revenueToday: revenueToday._sum.amount ?? 0,
      ordersToday,
      avgPrepTime,
      activeOrders,
      updatedAt: now.toISOString(),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 30);
    return result;
  }

  async getSalesUpdate(tenantId: string) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentOrders = await this.prisma.order.findMany({
      where: { tenantId, createdAt: { gte: oneHourAgo } },
      include: { items: true, payments: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const totalRevenue = recentOrders.reduce((sum, o) => sum + Number(o.total), 0);
    const orderCount = recentOrders.length;

    return {
      totalRevenue,
      orderCount,
      averageOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
      orders: recentOrders,
      updatedAt: new Date().toISOString(),
    };
  }

  async getInventoryAlerts(tenantId: string) {
    const cacheKey = 'live:inventory-alerts';
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const [lowStock, outOfStock] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { tenantId, deletedAt: null, currentQuantity: { gt: 0, lte: 5 } },
        orderBy: { currentQuantity: 'asc' },
        take: 20,
      }),
      this.prisma.inventoryItem.count({
        where: { tenantId, deletedAt: null, currentQuantity: { lte: 0 } },
      }),
    ]);

    const result = {
      lowStock: lowStock.map((item) => ({
        id: item.id,
        name: item.name,
        currentQuantity: Number(item.currentQuantity),
      })),
      outOfStock,
      total: lowStock.length + outOfStock,
      updatedAt: new Date().toISOString(),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 30);
    return result;
  }

  async getKitchenAlerts(tenantId: string) {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);

    const delayedTickets = await this.prisma.kitchenTicket.findMany({
      where: {
        tenantId,
        status: { in: ['PENDING', 'PREPARING'] },
        createdAt: { lt: fifteenMinAgo },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const queueDepth = await this.prisma.kitchenTicket.count({
      where: { tenantId, status: 'PENDING' },
    });

    return {
      delayedTickets: delayedTickets.map((t) => ({
        id: t.id,
        orderId: t.orderId,
        status: t.status,
        waitTime: Math.round((Date.now() - t.createdAt.getTime()) / 60000),
        createdAt: t.createdAt,
      })),
      queueDepth,
      alertCount: delayedTickets.length,
      updatedAt: new Date().toISOString(),
    };
  }

  async getCustomerActivity(tenantId: string) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [recentSignups, recentOrders] = await Promise.all([
      this.prisma.customer.findMany({
        where: { tenantId, createdAt: { gte: oneHourAgo } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: oneHourAgo }, userId: { not: null } },
      }),
    ]);

    return {
      newSignups: recentSignups.length,
      recentSignups: recentSignups.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        createdAt: c.createdAt,
      })),
      returningOrders: recentOrders,
      updatedAt: new Date().toISOString(),
    };
  }

  async getDashboardRefresh(tenantId: string) {
    const [kpi, sales, inventory, kitchen, customer] = await Promise.all([
      this.getLiveKpi(tenantId),
      this.getSalesUpdate(tenantId),
      this.getInventoryAlerts(tenantId),
      this.getKitchenAlerts(tenantId),
      this.getCustomerActivity(tenantId),
    ]);

    return {
      kpi,
      sales,
      inventoryAlerts: inventory,
      kitchenAlerts: kitchen,
      customerActivity: customer,
      refreshedAt: new Date().toISOString(),
    };
  }

  async triggerKpiUpdate(tenantId: string, data: Record<string, unknown>) {
    await this.cacheService.delete(tenantId, 'live:kpi');
    this.gateway.broadcast(tenantId, 'kpi-update', data);
  }

  private async getAveragePrepTime(tenantId: string, since: Date): Promise<number> {
    const tickets = await this.prisma.kitchenTicket.findMany({
      where: {
        tenantId,
        completedAt: { not: null },
        createdAt: { gte: since },
      },
      select: { createdAt: true, completedAt: true },
      take: 100,
    });

    if (tickets.length === 0) return 0;

    const totalMinutes = tickets.reduce((sum, t) => {
      const diff = (t.completedAt!.getTime() - t.createdAt.getTime()) / 60000;
      return sum + diff;
    }, 0);

    return Math.round((totalMinutes / tickets.length) * 10) / 10;
  }
}
