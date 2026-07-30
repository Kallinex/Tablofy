import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { ForecastingDashboardQueryDto } from './dto/forecasting-dashboard-query.dto';

@Injectable()
export class ForecastingDashboardService {
  private readonly logger = new Logger(ForecastingDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private buildDateFilter(query: ForecastingDashboardQueryDto): { gte?: Date; lte?: Date } {
    const filter: { gte?: Date; lte?: Date } = {};
    if (query.startDate) filter.gte = new Date(query.startDate);
    if (query.endDate) filter.lte = new Date(query.endDate);
    return filter;
  }

  private getOrderWhere(tenantId: string, query: ForecastingDashboardQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    const dateFilter = this.buildDateFilter(query);
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
    if (query.branchId) where.branchId = query.branchId;
    return where;
  }

  private periodsToDays(period?: string): number {
    switch (period) {
      case 'WEEKLY':
        return 7;
      case 'MONTHLY':
        return 30;
      default:
        return 1;
    }
  }

  async getSalesForecast(tenantId: string, query: ForecastingDashboardQueryDto) {
    const cacheKey = `forecasting-dashboard:sales:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const periods = query.periods ?? 30;
    const period = query.period ?? 'DAILY';
    const lookbackDays = periods * 2;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const orderWhere = this.getOrderWhere(tenantId, query);
    orderWhere.createdAt = { ...(orderWhere.createdAt || {}), gte: startDate };
    orderWhere.status = 'COMPLETED';

    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      select: { createdAt: true, id: true },
      orderBy: { createdAt: 'asc' },
    });

    const grouped = new Map<string, number>();
    for (const o of orders) {
      let key: string;
      if (period === 'WEEKLY') {
        const d = new Date(o.createdAt);
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        key = startOfWeek.toISOString().split('T')[0];
      } else if (period === 'MONTHLY') {
        key = o.createdAt.toISOString().slice(0, 7);
      } else {
        key = o.createdAt.toISOString().split('T')[0];
      }
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }

    const values = Array.from(grouped.values());
    const n = values.length;
    const avgPerPeriod = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;

    let slope = 0;
    if (n >= 2) {
      const xMean = (n - 1) / 2;
      const yMean = values.reduce((a, b) => a + b, 0) / n;
      let num = 0,
        den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (values[i] - yMean);
        den += (i - xMean) ** 2;
      }
      slope = den > 0 ? num / den : 0;
    }

    const growthFactor = avgPerPeriod > 0 ? 1 + slope / avgPerPeriod : 1;
    const forecast: Array<{
      period: string;
      forecastedValue: number;
      lowerBound: number;
      upperBound: number;
    }> = [];
    const lastDate = orders.length > 0 ? orders[orders.length - 1].createdAt : new Date();
    const stdDev =
      values.length > 0
        ? Math.sqrt(values.reduce((s, v) => s + (v - avgPerPeriod) ** 2, 0) / values.length)
        : avgPerPeriod * 0.3;

    for (let i = 1; i <= periods; i++) {
      const nextDate = new Date(lastDate);
      if (period === 'WEEKLY') nextDate.setDate(nextDate.getDate() + i * 7);
      else if (period === 'MONTHLY') nextDate.setMonth(nextDate.getMonth() + i);
      else nextDate.setDate(nextDate.getDate() + i);

      const projected = avgPerPeriod * Math.pow(growthFactor, i);
      const key =
        period === 'MONTHLY'
          ? nextDate.toISOString().slice(0, 7)
          : nextDate.toISOString().split('T')[0];
      forecast.push({
        period: key,
        forecastedValue: Math.round(projected * 100) / 100,
        lowerBound: Math.max(0, Math.round((projected - 1.96 * stdDev) * 100) / 100),
        upperBound: Math.round((projected + 1.96 * stdDev) * 100) / 100,
      });
    }

    const result = {
      historical: Array.from(grouped.entries()).map(([k, v]) => ({ period: k, value: v })),
      forecast,
      metadata: {
        avgPerPeriod: Math.round(avgPerPeriod * 100) / 100,
        growthFactor: Math.round(growthFactor * 10000) / 100,
        trend: slope > 0 ? 'upward' : slope < 0 ? 'downward' : 'stable',
        confidence: n >= 10 ? 'high' : n >= 5 ? 'medium' : 'low',
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRevenueForecast(tenantId: string, query: ForecastingDashboardQueryDto) {
    const cacheKey = `forecasting-dashboard:revenue:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const periods = query.periods ?? 30;
    const period = query.period ?? 'DAILY';
    const lookbackDays = periods * 2;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const orderWhere = this.getOrderWhere(tenantId, query);
    orderWhere.createdAt = { ...(orderWhere.createdAt || {}), gte: startDate };
    orderWhere.status = 'COMPLETED';

    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      select: { createdAt: true, total: true },
      orderBy: { createdAt: 'asc' },
    });

    const grouped = new Map<string, number>();
    for (const o of orders) {
      let key: string;
      if (period === 'WEEKLY') {
        const d = new Date(o.createdAt);
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - d.getDay());
        key = startOfWeek.toISOString().split('T')[0];
      } else if (period === 'MONTHLY') {
        key = o.createdAt.toISOString().slice(0, 7);
      } else {
        key = o.createdAt.toISOString().split('T')[0];
      }
      grouped.set(key, (grouped.get(key) ?? 0) + Number(o.total));
    }

    const values = Array.from(grouped.values());
    const n = values.length;
    const avgPerPeriod = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;

    let slope = 0;
    if (n >= 2) {
      const xMean = (n - 1) / 2;
      const yMean = values.reduce((a, b) => a + b, 0) / n;
      let num = 0,
        den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (values[i] - yMean);
        den += (i - xMean) ** 2;
      }
      slope = den > 0 ? num / den : 0;
    }

    const growthFactor = avgPerPeriod > 0 ? 1 + slope / avgPerPeriod : 1;
    const stdDev =
      values.length > 0
        ? Math.sqrt(values.reduce((s, v) => s + (v - avgPerPeriod) ** 2, 0) / values.length)
        : avgPerPeriod * 0.3;
    const lastDate = orders.length > 0 ? orders[orders.length - 1].createdAt : new Date();

    const forecast: Array<{
      period: string;
      forecastedValue: number;
      lowerBound: number;
      upperBound: number;
    }> = [];
    for (let i = 1; i <= periods; i++) {
      const nextDate = new Date(lastDate);
      if (period === 'WEEKLY') nextDate.setDate(nextDate.getDate() + i * 7);
      else if (period === 'MONTHLY') nextDate.setMonth(nextDate.getMonth() + i);
      else nextDate.setDate(nextDate.getDate() + i);

      const projected = avgPerPeriod * Math.pow(growthFactor, i);
      const key =
        period === 'MONTHLY'
          ? nextDate.toISOString().slice(0, 7)
          : nextDate.toISOString().split('T')[0];
      forecast.push({
        period: key,
        forecastedValue: Math.round(projected * 100) / 100,
        lowerBound: Math.max(0, Math.round((projected - 1.96 * stdDev) * 100) / 100),
        upperBound: Math.round((projected + 1.96 * stdDev) * 100) / 100,
      });
    }

    const result = {
      historical: Array.from(grouped.entries()).map(([k, v]) => ({
        period: k,
        value: Math.round(v * 100) / 100,
      })),
      forecast,
      metadata: {
        avgPerPeriod: Math.round(avgPerPeriod * 100) / 100,
        growthFactor: Math.round(growthFactor * 10000) / 100,
        trend: slope > 0 ? 'upward' : slope < 0 ? 'downward' : 'stable',
        confidence: n >= 10 ? 'high' : n >= 5 ? 'medium' : 'low',
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getDemandForecast(tenantId: string, query: ForecastingDashboardQueryDto) {
    const cacheKey = `forecasting-dashboard:demand:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);

    const inventoryForecasts = await this.prisma.inventoryForecast.findMany({
      where: {
        tenantId,
        ...(Object.keys(dateFilter).length > 0 ? { forecastDate: dateFilter } : {}),
      },
      orderBy: { forecastDate: 'asc' },
    });

    const grouped = new Map<
      string,
      { date: string; totalQuantity: number; avgConfidence: number; count: number }
    >();
    for (const f of inventoryForecasts) {
      const d = f.forecastDate.toISOString().split('T')[0];
      if (!grouped.has(d))
        grouped.set(d, { date: d, totalQuantity: 0, avgConfidence: 0, count: 0 });
      const g = grouped.get(d)!;
      g.totalQuantity += Number(f.quantity);
      g.avgConfidence += Number(f.confidence ?? 0);
      g.count++;
    }

    const predictions = Array.from(grouped.values()).map((g) => ({
      date: g.date,
      totalDemand: Math.round(g.totalQuantity * 100) / 100,
      avgConfidence: g.count > 0 ? Math.round((g.avgConfidence / g.count) * 10000) / 100 : 0,
      itemCount: g.count,
    }));

    const result = {
      predictions,
      summary: {
        totalItems: inventoryForecasts.length,
        dateRange:
          predictions.length > 0
            ? { from: predictions[0].date, to: predictions[predictions.length - 1].date }
            : null,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getInventoryForecast(tenantId: string, query: ForecastingDashboardQueryDto) {
    const cacheKey = `forecasting-dashboard:inventory:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);
    const periods = query.periods ?? 30;

    const [inventoryItems, forecasts, records] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { tenantId, isActive: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          sku: true,
          currentQuantity: true,
          unitCost: true,
          averageCost: true,
        },
      }),
      this.prisma.inventoryForecast.findMany({
        where: {
          tenantId,
          ...(Object.keys(dateFilter).length > 0 ? { forecastDate: dateFilter } : {}),
        },
        orderBy: { forecastDate: 'asc' },
      }),
      this.prisma.consumptionRecord.findMany({
        where: {
          tenantId,
          ...(Object.keys(dateFilter).length > 0
            ? { date: dateFilter }
            : { date: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }),
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    const consumptionByItem = new Map<string, number[]>();
    for (const r of records) {
      if (!consumptionByItem.has(r.inventoryItemId)) consumptionByItem.set(r.inventoryItemId, []);
      consumptionByItem.get(r.inventoryItemId)!.push(Number(r.quantity));
    }

    const forecastByItem = new Map<string, number>();
    for (const f of forecasts) {
      if (!forecastByItem.has(f.inventoryItemId)) forecastByItem.set(f.inventoryItemId, 0);
      forecastByItem.set(
        f.inventoryItemId,
        forecastByItem.get(f.inventoryItemId)! + Number(f.quantity),
      );
    }

    const projections = inventoryItems.map((item) => {
      const currentStock = Number(item.currentQuantity);
      const consumption = consumptionByItem.get(item.id) ?? [];
      const avgConsumption =
        consumption.length > 0 ? consumption.reduce((a, b) => a + b, 0) / consumption.length : 0;
      const forecastedConsumption = forecastByItem.get(item.id) ?? avgConsumption * periods;
      const projectedStock = currentStock - forecastedConsumption;
      const daysUntilEmpty = avgConsumption > 0 ? currentStock / avgConsumption : 999;
      const status =
        projectedStock <= 0
          ? 'OUT_OF_STOCK'
          : projectedStock <= currentStock * 0.2
            ? 'CRITICAL'
            : projectedStock <= currentStock * 0.5
              ? 'LOW'
              : 'HEALTHY';

      return {
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        currentStock,
        avgDailyConsumption: Math.round(avgConsumption * 100) / 100,
        forecastedConsumption: Math.round(forecastedConsumption * 100) / 100,
        projectedStock: Math.round(Math.max(0, projectedStock) * 100) / 100,
        daysUntilEmpty: Math.round(daysUntilEmpty * 100) / 100,
        status,
        unitCost: Number(item.unitCost ?? item.averageCost ?? 0),
      };
    });

    const result = {
      projections,
      summary: {
        totalItems: projections.length,
        healthy: projections.filter((p) => p.status === 'HEALTHY').length,
        low: projections.filter((p) => p.status === 'LOW').length,
        critical: projections.filter((p) => p.status === 'CRITICAL').length,
        outOfStock: projections.filter((p) => p.status === 'OUT_OF_STOCK').length,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getCustomerForecast(tenantId: string, query: ForecastingDashboardQueryDto) {
    const cacheKey = `forecasting-dashboard:customers:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const periods = query.periods ?? 12;
    const lookbackDays = periods * 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const customers = await this.prisma.customer.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const grouped = new Map<string, number>();
    for (const c of customers) {
      const d = c.createdAt.toISOString().slice(0, 7);
      grouped.set(d, (grouped.get(d) ?? 0) + 1);
    }

    const values = Array.from(grouped.values());
    const n = values.length;
    const monthlyAvg = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;

    let slope = 0;
    if (n >= 2) {
      const xMean = (n - 1) / 2;
      const yMean = values.reduce((a, b) => a + b, 0) / n;
      let num = 0,
        den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (values[i] - yMean);
        den += (i - xMean) ** 2;
      }
      slope = den > 0 ? num / den : 0;
    }

    const totalCustomers = await this.prisma.customer.count({ where: { tenantId } });
    const growthRate = monthlyAvg > 0 ? slope / monthlyAvg : 0;

    const forecast: Array<{ month: string; projectedCustomers: number; cumulative: number }> = [];
    const lastMonth = customers.length > 0 ? customers[customers.length - 1].createdAt : new Date();

    let cumulative = totalCustomers;
    for (let i = 1; i <= periods; i++) {
      const nextMonth = new Date(lastMonth);
      nextMonth.setMonth(nextMonth.getMonth() + i);
      const projected = Math.max(0, monthlyAvg * (1 + growthRate * i));
      cumulative += projected;
      forecast.push({
        month: nextMonth.toISOString().slice(0, 7),
        projectedCustomers: Math.round(projected),
        cumulative: Math.round(cumulative),
      });
    }

    const result = {
      historical: Array.from(grouped.entries()).map(([k, v]) => ({ month: k, newCustomers: v })),
      forecast,
      summary: {
        totalCustomers,
        monthlyAvgNew: Math.round(monthlyAvg),
        monthlyGrowthRate: Math.round(growthRate * 10000) / 100,
        trend: slope > 0 ? 'growing' : slope < 0 ? 'declining' : 'stable',
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getTrendAnalysis(tenantId: string, query: ForecastingDashboardQueryDto) {
    const cacheKey = `forecasting-dashboard:trends:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);
    const where: Record<string, unknown> = { tenantId, status: 'COMPLETED' };
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;

    const orders = await this.prisma.order.findMany({
      where,
      select: { createdAt: true, total: true, id: true },
      orderBy: { createdAt: 'asc' },
    });

    const dailySales = new Map<string, { date: string; orderCount: number; revenue: number }>();
    for (const o of orders) {
      const d = o.createdAt.toISOString().split('T')[0];
      if (!dailySales.has(d)) dailySales.set(d, { date: d, orderCount: 0, revenue: 0 });
      dailySales.get(d)!.orderCount++;
      dailySales.get(d)!.revenue += Number(o.total);
    }

    const salesValues = Array.from(dailySales.values());
    const revenues = salesValues.map((s) => s.revenue);
    const counts = salesValues.map((s) => s.orderCount);

    const calculateTrend = (
      data: number[],
    ): { direction: string; strength: number; slope: number } => {
      const len = data.length;
      if (len < 3) return { direction: 'stable', strength: 0, slope: 0 };
      const xMean = (len - 1) / 2;
      const yMean = data.reduce((a, b) => a + b, 0) / len;
      let num = 0,
        den = 0;
      for (let i = 0; i < len; i++) {
        num += (i - xMean) * (data[i] - yMean);
        den += (i - xMean) ** 2;
      }
      const slope = den > 0 ? num / den : 0;
      const direction = slope > 0.01 ? 'upward' : slope < -0.01 ? 'downward' : 'stable';
      const ssRes = data.reduce((sum, v, i) => {
        const predicted = yMean + slope * (i - xMean);
        return sum + (v - predicted) ** 2;
      }, 0);
      const ssTot = data.reduce((sum, v) => sum + (v - yMean) ** 2, 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
      const strength = rSquared;
      return { direction, strength: Math.round(strength * 10000) / 100, slope };
    };

    const customerCount = await this.prisma.customer.count({
      where: { tenantId, ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}) },
    });

    const result = {
      sales: {
        ...calculateTrend(salesValues.map((s) => s.revenue)),
        label: 'Sales Revenue',
        description: `Revenue trending ${calculateTrend(revenues).direction} with ${Math.round(calculateTrend(revenues).strength * 100)}% confidence`,
        data: salesValues,
      },
      orderVolume: {
        ...calculateTrend(counts),
        label: 'Order Volume',
        description: `Order count trending ${calculateTrend(counts).direction} with ${Math.round(calculateTrend(counts).strength * 100)}% confidence`,
        data: salesValues.map((s) => ({ date: s.date, count: s.orderCount })),
      },
      customerGrowth: {
        direction: customerCount > 0 ? 'upward' : 'stable',
        strength: customerCount > 0 ? 0.5 : 0,
        label: 'Customer Growth',
        description: `Total customers: ${customerCount}`,
        totalCustomers: customerCount,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getSeasonality(tenantId: string, query: ForecastingDashboardQueryDto) {
    const cacheKey = `forecasting-dashboard:seasonality:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);
    const where: Record<string, unknown> = { tenantId, status: 'COMPLETED' };
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;

    const orders = await this.prisma.order.findMany({
      where,
      select: { createdAt: true, total: true },
      orderBy: { createdAt: 'asc' },
    });

    const dayOfWeek = new Map<
      number,
      { day: number; dayName: string; totalRevenue: number; orderCount: number }
    >();
    const monthOfYear = new Map<
      number,
      { month: number; monthName: string; totalRevenue: number; orderCount: number }
    >();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    for (const o of orders) {
      const d = new Date(o.createdAt);
      const dow = d.getDay();
      const mo = d.getMonth();

      if (!dayOfWeek.has(dow))
        dayOfWeek.set(dow, { day: dow, dayName: dayNames[dow], totalRevenue: 0, orderCount: 0 });
      dayOfWeek.get(dow)!.totalRevenue += Number(o.total);
      dayOfWeek.get(dow)!.orderCount++;

      if (!monthOfYear.has(mo))
        monthOfYear.set(mo, {
          month: mo + 1,
          monthName: monthNames[mo],
          totalRevenue: 0,
          orderCount: 0,
        });
      monthOfYear.get(mo)!.totalRevenue += Number(o.total);
      monthOfYear.get(mo)!.orderCount++;
    }

    const totalRevenue = orders.reduce((s, o) => s + Number(o.total), 0);
    const totalOrders = orders.length;

    const dayOfWeekPattern = Array.from(dayOfWeek.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, v]) => ({
        ...v,
        revenuePercent:
          totalRevenue > 0 ? Math.round((v.totalRevenue / totalRevenue) * 10000) / 100 : 0,
        orderPercent: totalOrders > 0 ? Math.round((v.orderCount / totalOrders) * 10000) / 100 : 0,
      }));

    const monthOfYearPattern = Array.from(monthOfYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, v]) => ({
        ...v,
        revenuePercent:
          totalRevenue > 0 ? Math.round((v.totalRevenue / totalRevenue) * 10000) / 100 : 0,
        orderPercent: totalOrders > 0 ? Math.round((v.orderCount / totalOrders) * 10000) / 100 : 0,
      }));

    const peakDay = dayOfWeekPattern.reduce(
      (max, d) => (d.orderCount > max.orderCount ? d : max),
      dayOfWeekPattern[0],
    );
    const peakMonth = monthOfYearPattern.reduce(
      (max, m) => (m.orderCount > max.orderCount ? m : max),
      monthOfYearPattern[0],
    );

    const result = {
      dayOfWeek: dayOfWeekPattern,
      monthOfYear: monthOfYearPattern,
      insights: {
        busiestDay: peakDay?.dayName ?? 'N/A',
        busiestMonth: peakMonth?.monthName ?? 'N/A',
        weekdayVsWeekend: {
          weekday: dayOfWeekPattern
            .filter((d) => d.day >= 1 && d.day <= 5)
            .reduce((s, d) => s + d.orderCount, 0),
          weekend: dayOfWeekPattern
            .filter((d) => d.day === 0 || d.day === 6)
            .reduce((s, d) => s + d.orderCount, 0),
        },
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getGrowthProjection(tenantId: string, query: ForecastingDashboardQueryDto) {
    const cacheKey = `forecasting-dashboard:growth:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const periods = query.periods ?? 12;

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const [orders, customersThen, customersNow] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          tenantId,
          status: 'COMPLETED',
          createdAt: { gte: twelveMonthsAgo },
        },
        select: { createdAt: true, total: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.customer.count({ where: { tenantId, createdAt: { lte: twelveMonthsAgo } } }),
      this.prisma.customer.count({ where: { tenantId } }),
    ]);

    const monthlyData = new Map<string, { month: string; revenue: number; orderCount: number }>();
    for (const o of orders) {
      const d = o.createdAt.toISOString().slice(0, 7);
      if (!monthlyData.has(d)) monthlyData.set(d, { month: d, revenue: 0, orderCount: 0 });
      monthlyData.get(d)!.revenue += Number(o.total);
      monthlyData.get(d)!.orderCount++;
    }

    const monthlyValues = Array.from(monthlyData.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    );
    const revenues = monthlyValues.map((m) => m.revenue);
    const n = revenues.length;

    const firstRevenue = revenues.length > 0 ? revenues[0] : 0;
    const lastRevenue = revenues.length > 0 ? revenues[revenues.length - 1] : 0;
    const monthsDiff = n > 1 ? n - 1 : 1;
    const cagr = firstRevenue > 0 ? Math.pow(lastRevenue / firstRevenue, 1 / monthsDiff) - 1 : 0;

    const project: Array<{
      month: string;
      projectedRevenue: number;
      projectedOrders: number;
      projectedCustomers: number;
    }> = [];
    const lastMonth =
      monthlyValues.length > 0
        ? monthlyValues[monthlyValues.length - 1].month
        : new Date().toISOString().slice(0, 7);
    const lastDate = new Date(lastMonth + '-01');
    const avgOrders =
      monthlyValues.length > 0
        ? monthlyValues.reduce((s, m) => s + m.orderCount, 0) / monthlyValues.length
        : 0;

    let cumulativeCustomers = customersNow;
    for (let i = 1; i <= periods; i++) {
      const nextDate = new Date(lastDate);
      nextDate.setMonth(nextDate.getMonth() + i);
      const monthKey = nextDate.toISOString().slice(0, 7);
      const projectedRevenue = lastRevenue * Math.pow(1 + cagr, i);
      const projectedOrders = avgOrders * Math.pow(1 + cagr, i);
      const newCustomers = Math.max(
        0,
        Math.round(((customersNow - customersThen) / Math.max(1, n)) * (1 + cagr * i)),
      );
      cumulativeCustomers += newCustomers;
      project.push({
        month: monthKey,
        projectedRevenue: Math.round(projectedRevenue * 100) / 100,
        projectedOrders: Math.round(projectedOrders),
        projectedCustomers: cumulativeCustomers,
      });
    }

    const result = {
      historical: monthlyValues.map((m) => ({ ...m, revenue: Math.round(m.revenue * 100) / 100 })),
      projection: project,
      metrics: {
        cagr: Math.round(cagr * 10000) / 100,
        monthsOfData: n,
        customerGrowth:
          Math.round(((customersNow - customersThen) / Math.max(1, customersThen)) * 10000) / 100,
        totalCustomers: customersNow,
      },
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
