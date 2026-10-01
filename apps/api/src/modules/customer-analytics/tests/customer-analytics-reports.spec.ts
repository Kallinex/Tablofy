import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CustomerAnalyticsService } from '../customer-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';

const TENANT = 'tenant-1';

describe('CustomerAnalyticsService computed reports', () => {
  let service: CustomerAnalyticsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cacheService: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customer: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _avg: {}, _count: {}, _sum: {} }),
      },
      reward: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
      wallet: { aggregate: jest.fn().mockResolvedValue({ _avg: {}, _sum: {} }) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      referral: { findMany: jest.fn().mockResolvedValue([]) },
      membership: { groupBy: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerAnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: CacheService, useValue: cacheService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<CustomerAnalyticsService>(CustomerAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getOverview', () => {
    it('counts customers by status and compares against the previous period', async () => {
      prisma.customer.count
        .mockResolvedValueOnce(40) // total
        .mockResolvedValueOnce(12) // new in period
        .mockResolvedValueOnce(6); // previous period
      prisma.customer.groupBy.mockResolvedValue([
        { status: 'ACTIVE', _count: 30 },
        { status: 'INACTIVE', _count: 8 },
        { status: 'BLOCKED', _count: 2 },
      ]);

      const result = await service.getOverview(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      } as never);

      expect(result).toEqual({
        totalCustomers: 40,
        newCustomers: 12,
        activeCustomers: 30,
        inactiveCustomers: 8,
        blockedCustomers: 2,
        growthRate: 100,
        statusBreakdown: [
          { status: 'ACTIVE', count: 30 },
          { status: 'INACTIVE', count: 8 },
          { status: 'BLOCKED', count: 2 },
        ],
      });
    });

    it('reports zeroed status counts when no status rows exist', async () => {
      prisma.customer.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await service.getOverview(TENANT, {} as never);

      expect(result).toEqual(
        expect.objectContaining({
          activeCustomers: 0,
          inactiveCustomers: 0,
          blockedCustomers: 0,
          growthRate: 0,
          statusBreakdown: [],
        }),
      );
    });

    it('reports a hundred percent growth when the previous period was empty', async () => {
      prisma.customer.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(0);

      const result = await service.getOverview(TENANT, {} as never);

      expect(result.growthRate).toBe(100);
    });

    it('caches the computed overview', async () => {
      await service.getOverview(TENANT, {} as never);

      expect(cacheService.set).toHaveBeenCalledWith(
        TENANT,
        expect.stringContaining('customer-analytics:overview'),
        expect.any(Object),
        300,
      );
    });
  });

  describe('getRetention', () => {
    it('counts returning customers and reports the cohort rates', async () => {
      prisma.customer.count.mockResolvedValue(50);
      prisma.order.groupBy.mockResolvedValue([
        { customerPhone: '1', _count: { id: 3 } },
        { customerPhone: '2', _count: { id: 1 } },
      ]);
      prisma.$queryRaw.mockResolvedValue([
        { cohortMonth: '2026-01-01', totalCustomers: 10, retainedCustomers: 4 },
      ]);

      const result = await service.getRetention(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      } as never);

      expect(result).toEqual({
        totalCustomers: 50,
        activeCustomersInPeriod: 2,
        returningCustomers: 1,
        retentionRate: 50,
        cohortAnalysis: [
          {
            cohortMonth: '2026-01-01',
            totalCustomers: 10,
            retainedCustomers: 4,
            retentionRate: 40,
          },
        ],
      });
    });

    it('reports a zero retention rate when nobody ordered', async () => {
      prisma.customer.count.mockResolvedValue(0);

      const result = await service.getRetention(TENANT, {} as never);

      expect(result.retentionRate).toBe(0);
      expect(result.activeCustomersInPeriod).toBe(0);
      expect(result.cohortAnalysis).toEqual([]);
    });

    it('guards against a cohort with no customers', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { cohortMonth: '2026-01-01', totalCustomers: 0, retainedCustomers: 0 },
      ]);

      const result = await service.getRetention(TENANT, {} as never);

      expect(result.cohortAnalysis[0].retentionRate).toBe(0);
    });
  });

  describe('getChurn', () => {
    it('adds status churn and inactivity churn', async () => {
      prisma.customer.count.mockResolvedValueOnce(100).mockResolvedValueOnce(4);
      prisma.$queryRaw.mockResolvedValue([{ count: 6 }]);

      const result = await service.getChurn(TENANT, {} as never);

      expect(result).toEqual({
        totalCustomersAtPeriodStart: 100,
        churnedByStatus: 4,
        churnedByInactivity: 6,
        totalChurned: 10,
        churnRate: 10,
      });
    });

    it('treats a missing inactivity row as zero', async () => {
      prisma.customer.count.mockResolvedValueOnce(50).mockResolvedValueOnce(0);
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getChurn(TENANT, {} as never);

      expect(result.churnedByInactivity).toBe(0);
      expect(result.totalChurned).toBe(0);
      expect(result.churnRate).toBe(0);
    });
  });

  describe('getLifetimeValue', () => {
    const withAnalytics = (id: string, ltv: number, tier?: string) => ({
      id,
      firstName: `F${id}`,
      lastName: `L${id}`,
      email: `${id}@x.com`,
      phone: `000${id}`,
      analytics: {
        lifetimeValue: ltv,
        totalOrders: 2,
        totalSpent: ltv,
        averageOrderValue: ltv / 2,
      },
      memberships: tier ? [{ tier }] : [],
    });

    it('averages, medians and buckets the lifetime values', async () => {
      prisma.customer.findMany.mockResolvedValue([
        withAnalytics('1', 50, 'BRONZE'),
        withAnalytics('2', 150, 'BRONZE'),
        withAnalytics('3', 900, 'GOLD'),
        withAnalytics('4', 50000, 'GOLD'),
      ]);

      const result = await service.getLifetimeValue(TENANT, {} as never);

      expect(result.totalCustomers).toBe(4);
      expect(result.averageLifetimeValue).toBe(12775);
      expect(result.medianLifetimeValue).toBe(525);
      expect(result.distribution).toEqual([
        { range: '0-100', min: 0, max: 100, count: 1 },
        { range: '101-500', min: 101, max: 500, count: 1 },
        { range: '501-2000', min: 501, max: 2000, count: 1 },
        { range: '2001-10000', min: 2001, max: 10000, count: 0 },
        { range: '10000+', min: 10001, max: Infinity, count: 1 },
      ]);
    });

    it('groups the lifetime values by membership tier', async () => {
      prisma.customer.findMany.mockResolvedValue([
        withAnalytics('1', 100, 'BRONZE'),
        withAnalytics('2', 300, 'SILVER'),
      ]);

      const result = await service.getLifetimeValue(TENANT, {} as never);

      expect(result.byTier).toEqual(
        expect.arrayContaining([
          { tier: 'BRONZE', customerCount: 1, averageLtv: 100 },
          { tier: 'SILVER', customerCount: 1, averageLtv: 300 },
        ]),
      );
    });

    it('falls back to the NONE tier for a customer without a membership', async () => {
      prisma.customer.findMany.mockResolvedValue([withAnalytics('1', 100)]);

      const result = await service.getLifetimeValue(TENANT, {} as never);

      expect(result.byTier).toEqual([{ tier: 'NONE', customerCount: 1, averageLtv: 100 }]);
      expect(result.topCustomers[0].tier).toBe('NONE');
    });

    it('sorts the top customers by lifetime value and honours the limit', async () => {
      prisma.customer.findMany.mockResolvedValue([
        withAnalytics('1', 100),
        withAnalytics('2', 900),
        withAnalytics('3', 500),
      ]);

      const result = await service.getLifetimeValue(TENANT, { limit: 2 } as never);

      expect(result.topCustomers.map((c) => c.id)).toEqual(['2', '3']);
    });

    it('reports a zero average and median with no customers', async () => {
      const result = await service.getLifetimeValue(TENANT, {} as never);

      expect(result).toEqual(
        expect.objectContaining({
          averageLifetimeValue: 0,
          medianLifetimeValue: 0,
          totalCustomers: 0,
          topCustomers: [],
          byTier: [],
        }),
      );
    });

    it('handles a customer with no analytics row', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          id: '1',
          firstName: null,
          lastName: null,
          email: null,
          phone: null,
          analytics: null,
          memberships: [],
        },
      ]);

      const result = await service.getLifetimeValue(TENANT, {} as never);

      expect(result.topCustomers[0]).toEqual(
        expect.objectContaining({ name: '', lifetimeValue: 0, totalOrders: 0 }),
      );
      expect(result.medianLifetimeValue).toBe(0);
    });
  });

  describe('getAverageSpend', () => {
    it('reports the order aggregate alongside the per tier averages', async () => {
      prisma.order.aggregate.mockResolvedValue({
        _avg: { total: 42 },
        _count: { id: 10 },
        _sum: { total: 420 },
      });
      prisma.customer.findMany.mockResolvedValue([
        {
          id: '1',
          firstName: 'A',
          lastName: 'B',
          analytics: { averageOrderValue: 50, totalSpent: 100, totalOrders: 2 },
          memberships: [{ tier: 'GOLD' }],
        },
        {
          id: '2',
          firstName: 'C',
          lastName: 'D',
          analytics: { averageOrderValue: 10, totalSpent: 10, totalOrders: 1 },
          memberships: [{ tier: 'GOLD' }],
        },
      ]);

      const result = await service.getAverageSpend(TENANT, {} as never);

      expect(result.averageOrderValue).toBe(42);
      expect(result.totalOrders).toBe(10);
      expect(result.totalRevenue).toBe(420);
      expect(result.averageByTier).toEqual([
        { tier: 'GOLD', customerCount: 2, averageOrderValue: 110 / 3, averageTotalSpent: 55 },
      ]);
    });

    it('reports zero averages for a tier with no orders', async () => {
      prisma.customer.findMany.mockResolvedValue([
        {
          id: '1',
          firstName: 'A',
          lastName: 'B',
          analytics: { averageOrderValue: 0, totalSpent: 0, totalOrders: 0 },
          memberships: [{ tier: 'BRONZE' }],
        },
      ]);

      const result = await service.getAverageSpend(TENANT, {} as never);

      expect(result.averageByTier).toEqual([
        { tier: 'BRONZE', customerCount: 1, averageOrderValue: 0, averageTotalSpent: 0 },
      ]);
    });

    it('falls back to the NONE tier and zero aggregates', async () => {
      prisma.customer.findMany.mockResolvedValue([
        { id: '1', firstName: 'A', lastName: 'B', analytics: null, memberships: [] },
      ]);

      const result = await service.getAverageSpend(TENANT, {} as never);

      expect(result.averageByTier).toEqual([
        { tier: 'NONE', customerCount: 1, averageOrderValue: 0, averageTotalSpent: 0 },
      ]);
      expect(result.averageOrderValue).toBe(0);
      expect(result.totalOrders).toBeUndefined();
    });

    it('excludes voided orders from the aggregate window', async () => {
      await service.getAverageSpend(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      const [args] = prisma.order.aggregate.mock.calls[0];
      expect(args.where.status).toEqual({ not: 'VOIDED' });
      expect(args.where.createdAt).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-02-01'),
      });
    });
  });

  describe('getVisitFrequency', () => {
    it('averages the monthly visit frequency and fills the distribution', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { customerPhone: '1', orderCount: 4 },
        { customerPhone: '2', orderCount: 40 },
      ]);

      const result = await service.getVisitFrequency(TENANT, {
        startDate: '2025-11-01',
        endDate: '2026-01-31',
      } as never);

      // November through January spans two month boundaries.
      expect(result.periodMonths).toBe(2);
      expect(result.totalActiveCustomers).toBe(2);
      expect(result.averageVisitsPerMonth).toBe(11);
      expect(result.distribution).toEqual([
        { range: '0-1 visits/month', min: 0, max: 1, count: 0 },
        { range: '1-3 visits/month', min: 1, max: 3, count: 1 },
        { range: '3-5 visits/month', min: 3, max: 5, count: 0 },
        { range: '5-10 visits/month', min: 5, max: 10, count: 0 },
        { range: '10+ visits/month', min: 10, max: Infinity, count: 1 },
      ]);
    });

    it('reports a zero average when no customer ordered', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getVisitFrequency(TENANT, {} as never);

      expect(result.averageVisitsPerMonth).toBe(0);
      expect(result.totalActiveCustomers).toBe(0);
      expect(result.periodMonths).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getRewardsUsage', () => {
    it('reports the redemption rate with type and status breakdowns', async () => {
      prisma.reward.count.mockResolvedValueOnce(8).mockResolvedValueOnce(2);
      prisma.reward.groupBy
        .mockResolvedValueOnce([{ type: 'DISCOUNT', _count: 5 }])
        .mockResolvedValueOnce([{ status: 'REDEEMED', _count: 2 }]);

      const result = await service.getRewardsUsage(TENANT, {} as never);

      expect(result).toEqual({
        totalRewards: 8,
        claimedRewards: 2,
        redemptionRate: 25,
        byType: [{ type: 'DISCOUNT', count: 5 }],
        byStatus: [{ status: 'REDEEMED', count: 2 }],
      });
    });

    it('reports a zero redemption rate when nothing was issued', async () => {
      prisma.reward.count.mockResolvedValue(0);

      const result = await service.getRewardsUsage(TENANT, {} as never);

      expect(result.redemptionRate).toBe(0);
      expect(result.byType).toEqual([]);
      expect(result.byStatus).toEqual([]);
    });

    it('applies the date window to the reward queries', async () => {
      await service.getRewardsUsage(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      expect(prisma.reward.count).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-02-01') },
        },
      });
    });
  });

  describe('getWalletActivity', () => {
    it('splits credits, debits and refunds and derives the net flow', async () => {
      prisma.walletTransaction.findMany.mockResolvedValue([
        { type: 'RECHARGE', amount: 100, createdAt: new Date(), referenceType: null },
        { type: 'SPEND', amount: 30, createdAt: new Date(), referenceType: 'ORDER' },
        { type: 'SPEND', amount: 20, createdAt: new Date(), referenceType: 'ORDER' },
        { type: 'REFUND', amount: 5, createdAt: new Date(), referenceType: null },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ date: '2026-01-01', credits: 100, debits: 50 }]);
      prisma.wallet.aggregate.mockResolvedValue({ _avg: { balance: 25 }, _sum: { balance: 75 } });

      const result = await service.getWalletActivity(TENANT, {} as never);

      expect(result).toEqual({
        totalCredits: 100,
        totalDebits: 50,
        totalRefunds: 5,
        netFlow: 50,
        transactionCount: 4,
        averageWalletBalance: 25,
        totalWalletBalance: 75,
        trend: [{ date: '2026-01-01', credits: 100, debits: 50 }],
      });
    });

    it('reports zeroed aggregates for an empty ledger', async () => {
      const result = await service.getWalletActivity(TENANT, {} as never);

      expect(result).toEqual(
        expect.objectContaining({
          totalCredits: 0,
          totalDebits: 0,
          totalRefunds: 0,
          netFlow: 0,
          transactionCount: 0,
          averageWalletBalance: 0,
          totalWalletBalance: 0,
          trend: [],
        }),
      );
    });

    it('passes the date window to both the ledger and the trend query', async () => {
      await service.getWalletActivity(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT,
            createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-02-01') },
          },
        }),
      );
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('getReferralPerformance', () => {
    it('summarises conversions and reward points by status', async () => {
      prisma.referral.findMany.mockResolvedValue([
        { id: '1', status: 'REWARDED', rewardPoints: 50, referrerId: 'c1', createdAt: new Date() },
        { id: '2', status: 'REWARDED', rewardPoints: 30, referrerId: 'c1', createdAt: new Date() },
        { id: '3', status: 'PENDING', rewardPoints: null, referrerId: 'c2', createdAt: new Date() },
      ]);

      const result = await service.getReferralPerformance(TENANT, {} as never);

      expect(result).toEqual({
        totalReferrals: 3,
        convertedReferrals: 2,
        conversionRate: (2 / 3) * 100,
        totalRewardPoints: 80,
        averageRewardPerReferral: 40,
        byStatus: [
          { status: 'REWARDED', count: 2, totalReward: 80 },
          { status: 'PENDING', count: 1, totalReward: 0 },
        ],
      });
    });

    it('reports zero rates when nobody was referred', async () => {
      const result = await service.getReferralPerformance(TENANT, {} as never);

      expect(result).toEqual({
        totalReferrals: 0,
        convertedReferrals: 0,
        conversionRate: 0,
        totalRewardPoints: 0,
        averageRewardPerReferral: 0,
        byStatus: [],
      });
    });
  });

  describe('getMembershipDistribution', () => {
    it('reports tier percentages and averages', async () => {
      prisma.membership.groupBy.mockResolvedValue([
        { tier: 'BRONZE', _count: { id: 3 }, _avg: { points: 50, totalSpent: 100 } },
        { tier: 'GOLD', _count: { id: 1 }, _avg: { points: 900, totalSpent: 5000 } },
      ]);

      const result = await service.getMembershipDistribution(TENANT, {} as never);

      expect(result.totalMemberships).toBe(4);
      expect(result.byTier).toEqual([
        { tier: 'BRONZE', count: 3, percentage: 75, averagePoints: 50, averageTotalSpent: 100 },
        { tier: 'GOLD', count: 1, percentage: 25, averagePoints: 900, averageTotalSpent: 5000 },
      ]);
    });

    it('reports zero percentages and averages when there are no memberships', async () => {
      prisma.membership.groupBy.mockResolvedValue([
        { tier: 'BRONZE', _count: { id: 0 }, _avg: { points: null, totalSpent: null } },
      ]);

      const result = await service.getMembershipDistribution(TENANT, {} as never);

      expect(result.totalMemberships).toBe(0);
      expect(result.byTier[0]).toEqual(
        expect.objectContaining({ percentage: 0, averagePoints: 0, averageTotalSpent: 0 }),
      );
    });
  });

  describe('getRfmSegmentation', () => {
    it('returns an empty report when there is no order history', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getRfmSegmentation(TENANT, {} as never)).resolves.toEqual({
        segments: [],
        customers: [],
      });
    });

    it('assigns champions and low value customers to segments', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { customerPhone: '1', recency: 1, frequency: 20, monetary: 900 },
        { customerPhone: '2', recency: 90, frequency: 1, monetary: 10 },
      ]);

      const result = (await service.getRfmSegmentation(TENANT, {} as never)) as {
        segments: Array<{ name: string; count: number }>;
      };

      expect(result.segments).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Champions', count: 1 })]),
      );
    });
  });
});
