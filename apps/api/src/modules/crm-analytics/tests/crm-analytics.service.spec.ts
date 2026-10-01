import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { CrmAnalyticsService } from '../crm-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

const Q = {} as never;

const analytics = (over: Record<string, unknown> = {}) => ({
  sentCount: 0,
  deliveredCount: 0,
  openedCount: 0,
  clickedCount: 0,
  conversionCount: 0,
  revenueGenerated: null,
  ...over,
});

const campaign = (over: Record<string, unknown> = {}) => ({
  id: 'cmp-1',
  name: 'Spring Sale',
  type: 'EMAIL',
  status: 'ACTIVE',
  budget: null,
  startsAt: null,
  endsAt: null,
  metadata: null,
  analytics: null,
  ...over,
});

describe('CrmAnalyticsService', () => {
  let service: CrmAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmAnalyticsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<CrmAnalyticsService>(CrmAnalyticsService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
  });

  describe('getOverview', () => {
    beforeEach(() => {
      prisma.campaign.count.mockResolvedValue(0);
      prisma.promotion.count.mockResolvedValue(0);
      prisma.campaignAnalytics.aggregate.mockResolvedValue({ _sum: {} });
    });

    it('should return the cached overview', async () => {
      const cached = { totalCampaigns: 5 };
      cache.get.mockResolvedValue(cached);

      expect(await service.getOverview(testTenantId, Q)).toEqual(cached);
      expect(prisma.campaign.count).not.toHaveBeenCalled();
    });

    it('should count only ACTIVE campaigns and promotions', async () => {
      await service.getOverview(testTenantId, Q);

      expect(prisma.campaign.count).toHaveBeenCalledWith({
        where: { tenantId: testTenantId, status: 'ACTIVE' },
      });
      expect(prisma.promotion.count).toHaveBeenCalledWith({
        where: { tenantId: testTenantId, status: 'ACTIVE' },
      });
    });

    it('should scope the analytics aggregate to the tenant', async () => {
      await service.getOverview(testTenantId, Q);

      expect(prisma.campaignAnalytics.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: testTenantId } }),
      );
    });

    it('should not leak another tenant revenue into the totals', async () => {
      prisma.campaignAnalytics.aggregate.mockResolvedValue({
        _sum: { revenueGenerated: 500, sentCount: 100, conversionCount: 10 },
      });

      const result = await service.getOverview(testTenantId, Q);

      expect(result.totalCampaignRevenue).toBe(500);
      expect(result.overallConversionRate).toBe(10);
    });

    it('should report zero conversion rate when nothing was sent', async () => {
      prisma.campaignAnalytics.aggregate.mockResolvedValue({
        _sum: { revenueGenerated: null, sentCount: 0, conversionCount: 0 },
      });

      const result = await service.getOverview(testTenantId, Q);

      expect(result.overallConversionRate).toBe(0);
      expect(result.totalCampaignCost).toBe(0);
      expect(result.campaignRoi).toBe(0);
    });

    it('should apply the date range to both campaigns and promotions', async () => {
      await service.getOverview(testTenantId, {
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-03-31T00:00:00.000Z',
      } as never);

      const expectedDate = {
        gte: new Date('2025-01-01T00:00:00.000Z'),
        lte: new Date('2025-03-31T00:00:00.000Z'),
      };
      expect(prisma.campaign.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ createdAt: expectedDate }),
      });
      expect(prisma.promotion.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ createdAt: expectedDate }),
      });
    });

    it('should cache for 300 seconds', async () => {
      const result = await service.getOverview(testTenantId, Q);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('crm-analytics:overview'),
        result,
        300,
      );
    });
  });

  describe('getCampaignDetail', () => {
    it('should throw when the campaign is missing', async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);

      await expect(service.getCampaignDetail(testTenantId, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should scope the lookup to the tenant', async () => {
      prisma.campaign.findFirst.mockResolvedValue(campaign());

      await service.getCampaignDetail(testTenantId, 'cmp-1');

      expect(prisma.campaign.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cmp-1', tenantId: testTenantId } }),
      );
    });

    it('should convert the budget to a number', async () => {
      prisma.campaign.findFirst.mockResolvedValue(campaign({ budget: '250.50' }));

      const result = await service.getCampaignDetail(testTenantId, 'cmp-1');

      expect(result.budget).toBe(250.5);
    });

    it('should return null analytics when the campaign has none', async () => {
      prisma.campaign.findFirst.mockResolvedValue(campaign({ analytics: null }));

      const result = await service.getCampaignDetail(testTenantId, 'cmp-1');

      expect(result.analytics).toBeNull();
    });

    it('should default missing analytics counts to zero', async () => {
      prisma.campaign.findFirst.mockResolvedValue(
        campaign({ analytics: analytics({ sentCount: 5 }) }),
      );

      const result = await service.getCampaignDetail(testTenantId, 'cmp-1');

      expect(result.analytics).toEqual({
        sentCount: 5,
        deliveredCount: 0,
        openedCount: 0,
        clickedCount: 0,
        conversionCount: 0,
        revenueGenerated: 0,
      });
    });

    it('should return the cached campaign', async () => {
      const cached = { id: 'cmp-1' };
      cache.get.mockResolvedValue(cached);

      expect(await service.getCampaignDetail(testTenantId, 'cmp-1')).toEqual(cached);
      expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getCampaignRoi', () => {
    it('should compute roi as (revenue - budget) / budget', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'a', budget: '100', analytics: analytics({ revenueGenerated: '250' }) }),
      ]);

      const result = await service.getCampaignRoi(testTenantId, Q);

      expect(result[0].roi).toBe(150);
      expect(result[0].cost).toBe(100);
      expect(result[0].revenueGenerated).toBe(250);
    });

    it('should report zero roi when the budget is missing or zero', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'a', budget: null, analytics: analytics({ revenueGenerated: '500' }) }),
        campaign({ id: 'b', budget: '0', analytics: analytics({ revenueGenerated: '500' }) }),
      ]);

      const result = await service.getCampaignRoi(testTenantId, Q);

      expect(result.every((c) => c.roi === 0)).toBe(true);
    });

    it('should sort campaigns by roi descending', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'low', budget: '100', analytics: analytics({ revenueGenerated: '110' }) }),
        campaign({ id: 'high', budget: '100', analytics: analytics({ revenueGenerated: '500' }) }),
      ]);

      const result = await service.getCampaignRoi(testTenantId, Q);

      expect(result.map((c) => c.id)).toEqual(['high', 'low']);
    });

    it('should filter by campaign type', async () => {
      prisma.campaign.findMany.mockResolvedValue([]);

      await service.getCampaignRoi(testTenantId, { type: 'SMS' } as never);

      expect(prisma.campaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ type: 'SMS' }) }),
      );
    });

    it('should round roi to two decimals', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ budget: '3', analytics: analytics({ revenueGenerated: '10' }) }),
      ]);

      const result = await service.getCampaignRoi(testTenantId, Q);

      expect(result[0].roi).toBe(233.33);
    });
  });

  describe('getPromotionMetrics', () => {
    const promo = (over: Record<string, unknown> = {}) => ({
      id: 'promo-1',
      name: '10% off',
      type: 'PERCENTAGE',
      status: 'ACTIVE',
      value: '10',
      maxDiscount: null,
      minOrderAmount: null,
      code: 'SAVE10',
      usageLimit: null,
      usedCount: 0,
      usages: [],
      ...over,
    });

    it('should sum discounts across usages', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        promo({
          usages: [
            { id: 'u1', discountAmount: '5', usedAt: null, customerId: null, orderId: null },
            { id: 'u2', discountAmount: '15', usedAt: null, customerId: null, orderId: null },
          ],
        }),
      ]);

      const result = await service.getPromotionMetrics(testTenantId, Q);

      expect(result[0].actualUsageCount).toBe(2);
      expect(result[0].totalDiscountAmount).toBe(20);
      expect(result[0].averageDiscount).toBe(10);
    });

    it('should compute redemption rate against the usage limit', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        promo({
          usageLimit: 4,
          usages: [
            { id: 'u1', discountAmount: '5', usedAt: null, customerId: null, orderId: null },
          ],
        }),
      ]);

      const result = await service.getPromotionMetrics(testTenantId, Q);

      expect(result[0].redemptionRate).toBe(25);
    });

    it('should report zero redemption rate without a usage limit', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        promo({
          usageLimit: null,
          usages: [
            { id: 'u1', discountAmount: '5', usedAt: null, customerId: null, orderId: null },
          ],
        }),
      ]);

      const result = await service.getPromotionMetrics(testTenantId, Q);

      expect(result[0].redemptionRate).toBe(0);
    });

    it('should report zero average discount for an unused promotion', async () => {
      prisma.promotion.findMany.mockResolvedValue([promo()]);

      const result = await service.getPromotionMetrics(testTenantId, Q);

      expect(result[0].averageDiscount).toBe(0);
      expect(result[0].totalDiscountAmount).toBe(0);
    });
  });

  describe('getCouponUsage', () => {
    const coupon = (usages: Array<{ id: string; discountAmount: string; createdAt: Date }>) => ({
      id: 'c-1',
      name: 'Free Coffee',
      code: 'COFFEE',
      status: 'ACTIVE',
      usageLimit: 10,
      usages,
    });

    it('should only query promotions that have a code', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      await service.getCouponUsage(testTenantId, Q);

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: testTenantId, code: { not: null } }),
        }),
      );
    });

    it('should aggregate totals and average discount per use', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        coupon([
          { id: 'u1', discountAmount: '4', createdAt: new Date() },
          { id: 'u2', discountAmount: '6', createdAt: new Date() },
        ]),
      ]);

      const result = await service.getCouponUsage(testTenantId, Q);

      expect(result.totalCoupons).toBe(1);
      expect(result.activeCoupons).toBe(1);
      expect(result.totalUsageCount).toBe(2);
      expect(result.totalDiscountGiven).toBe(10);
      expect(result.averageDiscountPerUse).toBe(5);
    });

    it('should return the top coupons by usage limited to ten by default', async () => {
      const many = Array.from({ length: 15 }, (_, i) =>
        coupon(
          Array.from({ length: i + 1 }, (_, j) => ({
            id: `u${i}-${j}`,
            discountAmount: '1',
            createdAt: new Date(),
          })),
        ),
      );
      prisma.promotion.findMany.mockResolvedValue(many);

      const result = await service.getCouponUsage(testTenantId, Q);

      expect(result.mostUsed).toHaveLength(10);
      expect(result.mostUsed[0].usageCount).toBe(15);
    });

    it('should honour an explicit limit', async () => {
      prisma.promotion.findMany.mockResolvedValue([coupon([])]);

      const result = await service.getCouponUsage(testTenantId, { limit: 3 } as never);

      expect(result.mostUsed).toHaveLength(1);
    });

    it('should report zero average when no coupon was redeemed', async () => {
      prisma.promotion.findMany.mockResolvedValue([coupon([])]);

      const result = await service.getCouponUsage(testTenantId, Q);

      expect(result.averageDiscountPerUse).toBe(0);
    });
  });

  describe('getConversionRates', () => {
    it('should compute the funnel rates from the right denominators', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({
          analytics: analytics({
            sentCount: 100,
            deliveredCount: 80,
            openedCount: 40,
            clickedCount: 20,
            conversionCount: 10,
          }),
        }),
      ]);

      const result = await service.getConversionRates(testTenantId, Q);

      expect(result.campaigns[0].deliveryRate).toBe(80);
      expect(result.campaigns[0].openRate).toBe(50);
      expect(result.campaigns[0].clickRate).toBe(50);
      expect(result.campaigns[0].conversionRate).toBe(10);
      expect(result.campaigns[0].clickToConversionRate).toBe(50);
    });

    it('should report zero rates for a campaign with no sends', async () => {
      prisma.campaign.findMany.mockResolvedValue([campaign({ analytics: null })]);

      const result = await service.getConversionRates(testTenantId, Q);

      expect(result.campaigns[0].deliveryRate).toBe(0);
      expect(result.campaigns[0].openRate).toBe(0);
      expect(result.campaigns[0].clickToConversionRate).toBe(0);
      expect(result.averageConversionRate).toBe(0);
    });

    it('should average the conversion rate across campaigns', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'a', analytics: analytics({ sentCount: 100, conversionCount: 10 }) }),
        campaign({ id: 'b', analytics: analytics({ sentCount: 100, conversionCount: 30 }) }),
      ]);

      const result = await service.getConversionRates(testTenantId, Q);

      expect(result.averageConversionRate).toBe(20);
      expect(result.totalCampaigns).toBe(2);
    });

    it('should return an empty report when there are no campaigns', async () => {
      prisma.campaign.findMany.mockResolvedValue([]);

      const result = await service.getConversionRates(testTenantId, Q);

      expect(result).toEqual({ campaigns: [], averageConversionRate: 0, totalCampaigns: 0 });
    });
  });

  describe('getCustomerEngagement', () => {
    it('should weight open rate 40% and click rate 60%', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({
          analytics: analytics({
            sentCount: 100,
            deliveredCount: 100,
            openedCount: 50,
            clickedCount: 25,
          }),
        }),
      ]);

      const result = await service.getCustomerEngagement(testTenantId, Q);

      expect(result.openRate).toBe(50);
      expect(result.clickRate).toBe(50);
      expect(result.engagementScore).toBe(50);
    });

    it('should break rates down by campaign type', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({
          id: 'a',
          type: 'EMAIL',
          analytics: analytics({
            sentCount: 100,
            deliveredCount: 90,
            openedCount: 45,
            clickedCount: 9,
          }),
        }),
        campaign({
          id: 'b',
          type: 'SMS',
          analytics: analytics({
            sentCount: 100,
            deliveredCount: 100,
            openedCount: 10,
            clickedCount: 1,
          }),
        }),
      ]);

      const result = await service.getCustomerEngagement(testTenantId, Q);

      const email = result.byType.find((t: { type: string }) => t.type === 'EMAIL');
      const sms = result.byType.find((t: { type: string }) => t.type === 'SMS');
      expect(email.sent).toBe(100);
      expect(email.opened).toBe(45);
      expect(email.clickRate).toBe(20);
      expect(sms.clickRate).toBe(10);
    });

    it('should report zero totals when there are no campaigns', async () => {
      prisma.campaign.findMany.mockResolvedValue([]);

      const result = await service.getCustomerEngagement(testTenantId, Q);

      expect(result.totalSent).toBe(0);
      expect(result.openRate).toBe(0);
      expect(result.conversionRate).toBe(0);
      expect(result.byType).toEqual([]);
    });

    it('should not divide by zero when nothing was delivered', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ analytics: analytics({ sentCount: 50, deliveredCount: 0, openedCount: 0 }) }),
      ]);

      const result = await service.getCustomerEngagement(testTenantId, Q);

      expect(result.openRate).toBe(0);
      expect(result.clickRate).toBe(0);
    });
  });

  describe('getAutomationEffectiveness', () => {
    it('should return null metrics for an empty segment', async () => {
      prisma.campaign.findMany.mockResolvedValue([]);

      const result = await service.getAutomationEffectiveness(testTenantId, Q);

      expect(result.automated).toBeNull();
      expect(result.manual).toBeNull();
      expect(result.comparison).toBeNull();
    });

    it('should split campaigns by type containing auto', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'a', type: 'AUTOMATED', analytics: analytics({ sentCount: 10 }) }),
        campaign({ id: 'b', type: 'EMAIL', analytics: analytics({ sentCount: 10 }) }),
      ]);

      const result = await service.getAutomationEffectiveness(testTenantId, Q);

      expect(result.automated?.campaignCount).toBe(1);
      expect(result.manual?.campaignCount).toBe(1);
    });

    it('should treat a metadata flag of automated true as automated', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'a', type: 'EMAIL', metadata: { automated: true }, analytics: analytics() }),
        campaign({ id: 'b', type: 'EMAIL', analytics: analytics() }),
      ]);

      const result = await service.getAutomationEffectiveness(testTenantId, Q);

      expect(result.automated?.campaignCount).toBe(1);
      expect(result.manual?.campaignCount).toBe(1);
    });

    it('should compute rate differences between automated and manual', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({
          id: 'a',
          type: 'AUTOMATED',
          analytics: analytics({
            sentCount: 100,
            deliveredCount: 100,
            openedCount: 50,
            conversionCount: 20,
            revenueGenerated: '1000',
          }),
        }),
        campaign({
          id: 'b',
          type: 'EMAIL',
          analytics: analytics({
            sentCount: 100,
            deliveredCount: 100,
            openedCount: 20,
            conversionCount: 5,
            revenueGenerated: '100',
          }),
        }),
      ]);

      const result = await service.getAutomationEffectiveness(testTenantId, Q);

      expect(result.automated?.conversionRate).toBe(20);
      expect(result.manual?.conversionRate).toBe(5);
      expect(result.comparison?.conversionRateDiff).toBe(15);
      expect(result.comparison?.openRateDiff).toBe(30);
      expect(result.comparison?.revenuePerCampaignDiff).toBe(900);
    });

    it('should return null comparison when only one segment exists', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'a', type: 'AUTOMATED', analytics: analytics() }),
      ]);

      const result = await service.getAutomationEffectiveness(testTenantId, Q);

      expect(result.automated).not.toBeNull();
      expect(result.manual).toBeNull();
      expect(result.comparison).toBeNull();
    });

    it('should round the average sends per campaign', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'a', type: 'AUTO', analytics: analytics({ sentCount: 10 }) }),
        campaign({ id: 'b', type: 'AUTO', analytics: analytics({ sentCount: 11 }) }),
        campaign({ id: 'c', type: 'AUTO', analytics: analytics({ sentCount: 12 }) }),
      ]);

      const result = await service.getAutomationEffectiveness(testTenantId, Q);

      expect(result.automated?.avgSentPerCampaign).toBe(11);
    });

    it('should report zero rates for automated campaigns with no sends', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        campaign({ id: 'a', type: 'AUTO', analytics: null }),
      ]);

      const result = await service.getAutomationEffectiveness(testTenantId, Q);

      expect(result.automated?.deliveryRate).toBe(0);
      expect(result.automated?.openRate).toBe(0);
      expect(result.automated?.totalRevenue).toBe(0);
    });
  });

  describe('cache isolation', () => {
    it('should use a distinct cache key per report', async () => {
      prisma.campaign.count.mockResolvedValue(0);
      prisma.promotion.count.mockResolvedValue(0);
      prisma.campaignAnalytics.aggregate.mockResolvedValue({ _sum: {} });
      prisma.campaign.findMany.mockResolvedValue([]);
      prisma.promotion.findMany.mockResolvedValue([]);

      await service.getOverview(testTenantId, Q);
      await service.getConversionRates(testTenantId, Q);
      await service.getCustomerEngagement(testTenantId, Q);
      await service.getPromotionMetrics(testTenantId, Q);
      await service.getCouponUsage(testTenantId, Q);
      await service.getAutomationEffectiveness(testTenantId, Q);

      const keys = cache.set.mock.calls.map((c) => c[1]);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});
