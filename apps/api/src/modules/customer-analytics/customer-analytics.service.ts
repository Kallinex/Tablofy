import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';
import { CustomerAnalyticsQueryDto } from './dto/customer-analytics-query.dto';

@Injectable()
export class CustomerAnalyticsService {
  private readonly logger = new Logger(CustomerAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getOverview(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:overview:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.CustomerWhereInput = { tenantId, deletedAt: null };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };

    const [totalCustomers, newCustomers, statusCounts] = await Promise.all([
      this.prisma.customer.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.customer.count({ where }),
      this.prisma.customer.groupBy({
        by: ['status'],
        where: { tenantId, deletedAt: null },
        _count: true,
      }),
    ]);

    const activeCount = statusCounts.find((s) => s.status === 'ACTIVE')?._count ?? 0;
    const inactiveCount = statusCounts.find((s) => s.status === 'INACTIVE')?._count ?? 0;

    const periodStart = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const previousPeriodStart = new Date(
      periodStart.getTime() -
        (periodStart.getTime() -
          (query.startDate
            ? new Date(query.startDate).getTime()
            : Date.now() - 60 * 24 * 60 * 60 * 1000)),
    );

    const previousNewCustomers = await this.prisma.customer.count({
      where: {
        tenantId,
        deletedAt: null,
        createdAt: {
          gte: previousPeriodStart,
          lt: periodStart,
        },
      },
    });

    const growthRate =
      previousNewCustomers > 0
        ? ((newCustomers - previousNewCustomers) / previousNewCustomers) * 100
        : newCustomers > 0
          ? 100
          : 0;

    const result = {
      totalCustomers,
      newCustomers,
      activeCustomers: activeCount,
      inactiveCustomers: inactiveCount,
      blockedCustomers: statusCounts.find((s) => s.status === 'BLOCKED')?._count ?? 0,
      growthRate: Math.round(growthRate * 100) / 100,
      statusBreakdown: statusCounts.map((s) => ({ status: s.status, count: s._count })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRetention(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:retention:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    const totalCustomers = await this.prisma.customer.count({
      where: { tenantId, deletedAt: null, createdAt: { lte: endDate } },
    });

    const orders = await this.prisma.order.groupBy({
      by: ['customerPhone'],
      where: {
        tenantId,
        customerPhone: { not: null },
        createdAt: { gte: startDate, lte: endDate },
      },
      _count: { id: true },
    });

    const returningCustomers = orders.filter((o) => o._count.id > 1).length;
    const activeCustomers = orders.length;

    const monthlyCohorts = await this.prisma.$queryRawUnsafe<
      Array<{
        cohortMonth: string;
        totalCustomers: number;
        retainedCustomers: number;
      }>
    >(
      `WITH customer_first_order AS (
         SELECT "customerPhone", DATE_TRUNC('month', MIN("createdAt")) as "cohortMonth"
       FROM orders WHERE "tenantId" = $1 AND "customerPhone" IS NOT NULL
         GROUP BY "customerPhone"
       ),
       customer_orders AS (
         SELECT o."customerPhone", cfo."cohortMonth",
                DATE_TRUNC('month', o."createdAt") as "orderMonth"
         FROM "Order" o
         JOIN customer_first_order cfo ON o."customerPhone" = cfo."customerPhone"
         WHERE o."tenantId" = $1 AND o."customerPhone" IS NOT NULL
       )
       SELECT "cohortMonth", COUNT(DISTINCT "customerPhone") as "totalCustomers",
              COUNT(DISTINCT CASE WHEN "orderMonth" > "cohortMonth" THEN "customerPhone" END) as "retainedCustomers"
       FROM customer_orders
       WHERE "cohortMonth" >= $2 AND "cohortMonth" <= $3
       GROUP BY "cohortMonth" ORDER BY "cohortMonth"`,
      tenantId,
      startDate,
      endDate,
    );

    const result = {
      totalCustomers,
      activeCustomersInPeriod: activeCustomers,
      returningCustomers,
      retentionRate: activeCustomers > 0 ? (returningCustomers / activeCustomers) * 100 : 0,
      cohortAnalysis: monthlyCohorts.map((c) => ({
        cohortMonth: c.cohortMonth,
        totalCustomers: Number(c.totalCustomers),
        retainedCustomers: Number(c.retainedCustomers),
        retentionRate:
          Number(c.totalCustomers) > 0
            ? (Number(c.retainedCustomers) / Number(c.totalCustomers)) * 100
            : 0,
      })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getChurn(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:churn:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    const totalAtStart = await this.prisma.customer.count({
      where: { tenantId, deletedAt: null, createdAt: { lte: startDate } },
    });

    const churnedByStatus = await this.prisma.customer.count({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: ['INACTIVE', 'BLOCKED'] },
        updatedAt: { gte: startDate, lte: endDate },
      },
    });

    const churnedByInactivity = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*) as count FROM customers c
       WHERE c."tenantId" = $1 AND c."deletedAt" IS NULL
       AND c.status = 'ACTIVE'
       AND NOT EXISTS (
          SELECT 1 FROM orders o
         WHERE o."customerPhone" = c."phone" AND o."tenantId" = c."tenantId"
         AND o."createdAt" >= $2
       )`,
      tenantId,
      query.startDate ? new Date(query.startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    );

    const totalChurned = churnedByStatus + Number(churnedByInactivity[0]?.count ?? 0);

    const result = {
      totalCustomersAtPeriodStart: totalAtStart,
      churnedByStatus: churnedByStatus,
      churnedByInactivity: Number(churnedByInactivity[0]?.count ?? 0),
      totalChurned,
      churnRate: totalAtStart > 0 ? (totalChurned / totalAtStart) * 100 : 0,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getLifetimeValue(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:ltv:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const customers = await this.prisma.customer.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        analytics: {
          select: {
            lifetimeValue: true,
            totalOrders: true,
            totalSpent: true,
            averageOrderValue: true,
          },
        },
        memberships: { select: { tier: true }, take: 1, orderBy: { createdAt: 'desc' } },
      },
    });

    const ltvValues = customers.map((c) => Number(c.analytics?.lifetimeValue ?? 0));
    const avgLtv =
      ltvValues.length > 0 ? ltvValues.reduce((s, v) => s + v, 0) / ltvValues.length : 0;

    const byTier: Record<string, number[]> = {};
    for (const c of customers) {
      const tier = c.memberships?.[0]?.tier ?? 'NONE';
      const ltv = Number(c.analytics?.lifetimeValue ?? 0);
      if (!byTier[tier]) byTier[tier] = [];
      byTier[tier].push(ltv);
    }

    const tierDistribution = Object.entries(byTier).map(([tier, values]) => ({
      tier,
      customerCount: values.length,
      averageLtv: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100,
    }));

    const topCustomers = customers
      .map((c) => ({
        id: c.id,
        name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim(),
        email: c.email,
        phone: c.phone,
        lifetimeValue: Number(c.analytics?.lifetimeValue ?? 0),
        totalOrders: c.analytics?.totalOrders ?? 0,
        totalSpent: Number(c.analytics?.totalSpent ?? 0),
        averageOrderValue: Number(c.analytics?.averageOrderValue ?? 0),
        tier: c.memberships?.[0]?.tier ?? 'NONE',
      }))
      .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
      .slice(0, query.limit ?? 20);

    const ltvRanges = [
      { range: '0-100', min: 0, max: 100, count: 0 },
      { range: '101-500', min: 101, max: 500, count: 0 },
      { range: '501-2000', min: 501, max: 2000, count: 0 },
      { range: '2001-10000', min: 2001, max: 10000, count: 0 },
      { range: '10000+', min: 10001, max: Infinity, count: 0 },
    ];

    for (const ltv of ltvValues) {
      const bucket = ltvRanges.find((r) => ltv >= r.min && ltv <= r.max);
      if (bucket) bucket.count++;
    }

    const result = {
      averageLifetimeValue: Math.round(avgLtv * 100) / 100,
      medianLifetimeValue: this.median(ltvValues),
      totalCustomers: customers.length,
      byTier: tierDistribution,
      topCustomers,
      distribution: ltvRanges,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getAverageSpend(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:average-spend:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    const orderAgg = await this.prisma.order.aggregate({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate }, status: { not: 'VOIDED' } },
      _avg: { total: true },
      _count: { id: true },
      _sum: { total: true },
    });

    const customers = await this.prisma.customer.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        analytics: { select: { averageOrderValue: true, totalSpent: true, totalOrders: true } },
        memberships: { select: { tier: true }, take: 1, orderBy: { createdAt: 'desc' } },
      },
    });

    const byTier: Record<string, { totalSpent: number; totalOrders: number; count: number }> = {};
    for (const c of customers) {
      const tier = c.memberships?.[0]?.tier ?? 'NONE';
      if (!byTier[tier]) byTier[tier] = { totalSpent: 0, totalOrders: 0, count: 0 };
      byTier[tier].totalSpent += Number(c.analytics?.totalSpent ?? 0);
      byTier[tier].totalOrders += c.analytics?.totalOrders ?? 0;
      byTier[tier].count++;
    }

    const avgByTier = Object.entries(byTier).map(([tier, data]) => ({
      tier,
      customerCount: data.count,
      averageOrderValue: data.totalOrders > 0 ? data.totalSpent / data.totalOrders : 0,
      averageTotalSpent: data.count > 0 ? data.totalSpent / data.count : 0,
    }));

    const result = {
      averageOrderValue: Number(orderAgg._avg.total ?? 0),
      totalOrders: orderAgg._count.id,
      totalRevenue: Number(orderAgg._sum.total ?? 0),
      averageByTier: avgByTier,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getVisitFrequency(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:visit-frequency:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    const monthsDiff = Math.max(
      1,
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
        endDate.getMonth() -
        startDate.getMonth(),
    );

    const ordersByCustomer = await this.prisma.$queryRawUnsafe<
      Array<{ customerPhone: string; orderCount: number }>
    >(
      `SELECT "customerPhone", COUNT(*) as "orderCount"
       FROM orders WHERE "tenantId" = $1 AND "customerPhone" IS NOT NULL
       AND "createdAt" >= $2 AND "createdAt" <= $3
       AND "status" != 'VOIDED'
       GROUP BY "customerPhone"`,
      tenantId,
      startDate,
      endDate,
    );

    const frequencies = ordersByCustomer.map((o) => Number(o.orderCount) / monthsDiff);
    const avgFrequency =
      frequencies.length > 0 ? frequencies.reduce((s, f) => s + f, 0) / frequencies.length : 0;

    const distribution = [
      { range: '0-1 visits/month', min: 0, max: 1, count: 0 },
      { range: '1-3 visits/month', min: 1, max: 3, count: 0 },
      { range: '3-5 visits/month', min: 3, max: 5, count: 0 },
      { range: '5-10 visits/month', min: 5, max: 10, count: 0 },
      { range: '10+ visits/month', min: 10, max: Infinity, count: 0 },
    ];

    for (const f of frequencies) {
      const bucket = distribution.find((r) => f > r.min && f <= r.max);
      if (bucket) bucket.count++;
    }

    const result = {
      averageVisitsPerMonth: Math.round(avgFrequency * 100) / 100,
      totalActiveCustomers: ordersByCustomer.length,
      periodMonths: monthsDiff,
      distribution,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRfmSegmentation(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:rfm:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const rfmData = await this.prisma.$queryRawUnsafe<
      Array<{
        customerPhone: string;
        recency: number;
        frequency: number;
        monetary: number;
      }>
    >(
      `SELECT "customerPhone",
              EXTRACT(DAY FROM NOW() - MAX("createdAt")) as recency,
              COUNT(*) as frequency,
              COALESCE(SUM("total"), 0) as monetary
       FROM orders WHERE "tenantId" = $1 AND "customerPhone" IS NOT NULL
       AND "status" != 'VOIDED'
       GROUP BY "customerPhone"`,
      tenantId,
    );

    if (rfmData.length === 0) return { segments: [], customers: [] };

    const recencyValues = rfmData.map((r) => Number(r.recency));
    const frequencyValues = rfmData.map((r) => Number(r.frequency));
    const monetaryValues = rfmData.map((r) => Number(r.monetary));

    const rMax = Math.max(...recencyValues);
    const rMin = Math.min(...recencyValues);
    const fMax = Math.max(...frequencyValues);
    const fMin = Math.min(...frequencyValues);
    const mMax = Math.max(...monetaryValues);
    const mMin = Math.min(...monetaryValues);

    const score = (val: number, min: number, max: number, reverse: boolean): number => {
      if (max === min) return 3;
      const normalized = ((val - min) / (max - min)) * 4 + 1;
      return Math.round(reverse ? 5 - normalized + 1 : normalized);
    };

    const segments: Record<string, Array<Record<string, unknown>>> = {
      Champions: [],
      Loyal: [],
      'Potential Loyalists': [],
      'At Risk': [],
      'Need Attention': [],
      'About to Sleep': [],
      Lost: [],
      Hibernating: [],
      "Can't Lose Them": [],
      Promising: [],
    };

    for (const row of rfmData) {
      const r = score(Number(row.recency), rMin, rMax, true);
      const f = score(Number(row.frequency), fMin, fMax, false);
      const m = score(Number(row.monetary), mMin, mMax, false);

      let segment: string;
      if (r >= 4 && f >= 4 && m >= 4) segment = 'Champions';
      else if (r >= 3 && f >= 3 && m >= 3) segment = 'Loyal';
      else if (r >= 4 && f >= 1 && m >= 1) segment = 'Potential Loyalists';
      else if (r >= 2 && f >= 2 && m >= 2) segment = 'At Risk';
      else if (r >= 3 && f >= 1 && m >= 1) segment = 'Need Attention';
      else if (r >= 1 && f >= 2 && m >= 1) segment = 'About to Sleep';
      else if (r >= 1 && f >= 1 && m >= 1) segment = 'Hibernating';
      else if (r >= 4 && f >= 1 && m <= 2) segment = 'Promising';
      else if (r >= 1 && f <= 2 && m >= 4) segment = "Can't Lose Them";
      else segment = 'Lost';

      if (!segments[segment]) segments[segment] = [];
      segments[segment].push({
        customerPhone: row.customerPhone,
        recency: Number(row.recency),
        frequency: Number(row.frequency),
        monetary: Number(row.monetary),
        rScore: r,
        fScore: f,
        mScore: m,
      });
    }

    const result = {
      segments: Object.entries(segments)
        .filter(([, customers]) => customers.length > 0)
        .map(([name, customers]) => ({
          name,
          count: customers.length,
          percentage: (customers.length / rfmData.length) * 100,
          avgRecency: Math.round(
            customers.reduce((s, c: Record<string, unknown>) => s + Number(c.recency), 0) /
              customers.length,
          ),
          avgFrequency:
            Math.round(
              (customers.reduce((s, c: Record<string, unknown>) => s + Number(c.frequency), 0) /
                customers.length) *
                100,
            ) / 100,
          avgMonetary:
            Math.round(
              (customers.reduce((s, c: Record<string, unknown>) => s + Number(c.monetary), 0) /
                customers.length) *
                100,
            ) / 100,
        }))
        .sort((a, b) => b.count - a.count),
      totalCustomers: rfmData.length,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRewardsUsage(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:rewards:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.RewardWhereInput = { tenantId };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };

    const [totalRewards, claimedRewards, byType] = await Promise.all([
      this.prisma.reward.count({ where }),
      this.prisma.reward.count({ where: { ...where, status: 'REDEEMED' } }),
      this.prisma.reward.groupBy({
        by: ['type'],
        where,
        _count: true,
      }),
    ]);

    const byStatus = await this.prisma.reward.groupBy({
      by: ['status'],
      where,
      _count: true,
    });

    const result = {
      totalRewards,
      claimedRewards,
      redemptionRate: totalRewards > 0 ? (claimedRewards / totalRewards) * 100 : 0,
      byType: byType.map((t) => ({ type: t.type, count: t._count })),
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getWalletActivity(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:wallet:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.WalletTransactionWhereInput = { tenantId };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };

    const transactions = await this.prisma.walletTransaction.findMany({
      where,
      select: { type: true, amount: true, createdAt: true, referenceType: true },
      orderBy: { createdAt: 'asc' },
    });

    const totalCredits = transactions
      .filter((t) => t.type === 'RECHARGE')
      .reduce((s, t) => s + Number(t.amount), 0);

    const totalDebits = transactions
      .filter((t) => t.type === 'SPEND')
      .reduce((s, t) => s + Number(t.amount), 0);

    const totalRefunds = transactions
      .filter((t) => t.type === 'REFUND')
      .reduce((s, t) => s + Number(t.amount), 0);

    const dailyTrend = await this.prisma.$queryRawUnsafe<
      Array<{ date: string; credits: number; debits: number }>
    >(
      `SELECT DATE("createdAt") as date,
              SUM(CASE WHEN type = 'RECHARGE' THEN amount ELSE 0 END) as credits,
              SUM(CASE WHEN type = 'SPEND' THEN amount ELSE 0 END) as debits
       FROM "WalletTransaction" WHERE "tenantId" = $1
       ${query.startDate ? `AND "createdAt" >= $2` : ''}
       ${query.endDate ? `AND "createdAt" <= $3` : ''}
       GROUP BY DATE("createdAt") ORDER BY date ASC`,
      query.startDate
        ? [tenantId, new Date(query.startDate), ...(query.endDate ? [new Date(query.endDate)] : [])]
        : query.endDate
          ? [tenantId, new Date(query.endDate)]
          : [tenantId],
    );

    const walletAgg = await this.prisma.wallet.aggregate({
      where: { tenantId },
      _avg: { balance: true },
      _sum: { balance: true },
    });

    const result = {
      totalCredits,
      totalDebits,
      totalRefunds,
      netFlow: totalCredits - totalDebits,
      transactionCount: transactions.length,
      averageWalletBalance: Number(walletAgg._avg.balance ?? 0),
      totalWalletBalance: Number(walletAgg._sum.balance ?? 0),
      trend: dailyTrend,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getReferralPerformance(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:referrals:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.ReferralWhereInput = { tenantId };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };

    const referrals = await this.prisma.referral.findMany({
      where,
      select: { id: true, status: true, rewardAmount: true, referrerId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const convertedReferrals = referrals.filter((r) => r.status === 'REWARDED');
    const totalRewardAmount = convertedReferrals.reduce(
      (s, r) => s + Number(r.rewardAmount ?? 0),
      0,
    );

    const result = {
      totalReferrals: referrals.length,
      convertedReferrals: convertedReferrals.length,
      conversionRate:
        referrals.length > 0 ? (convertedReferrals.length / referrals.length) * 100 : 0,
      totalRewardAmount,
      averageRewardPerReferral:
        convertedReferrals.length > 0 ? totalRewardAmount / convertedReferrals.length : 0,
      byStatus: this.groupByStatus(referrals),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  private groupByStatus(referrals: Array<{ status: string; rewardAmount: number | null }>) {
    const grouped: Record<string, { count: number; totalReward: number }> = {};
    for (const r of referrals) {
      if (!grouped[r.status]) grouped[r.status] = { count: 0, totalReward: 0 };
      grouped[r.status].count++;
      grouped[r.status].totalReward += Number(r.rewardAmount ?? 0);
    }
    return Object.entries(grouped).map(([status, data]) => ({
      status,
      count: data.count,
      totalReward: data.totalReward,
    }));
  }

  async getMembershipDistribution(tenantId: string, query: CustomerAnalyticsQueryDto) {
    const cacheKey = `customer-analytics:memberships:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const byTier = await this.prisma.membership.groupBy({
      by: ['tier'],
      where: { tenantId },
      _count: { id: true },
      _avg: { points: true, totalSpent: true },
    });

    const totalMemberships = byTier.reduce((s, t) => s + t._count.id, 0);

    const result = {
      totalMemberships,
      byTier: byTier.map((t) => ({
        tier: t.tier,
        count: t._count.id,
        percentage: totalMemberships > 0 ? (t._count.id / totalMemberships) * 100 : 0,
        averagePoints: Math.round(Number(t._avg.points ?? 0) * 100) / 100,
        averageTotalSpent: Math.round(Number(t._avg.totalSpent ?? 0) * 100) / 100,
      })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
