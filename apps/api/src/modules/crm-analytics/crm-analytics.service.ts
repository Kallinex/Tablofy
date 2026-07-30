import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';
import { CrmAnalyticsQueryDto } from './dto/crm-analytics-query.dto';

@Injectable()
export class CrmAnalyticsService {
  private readonly logger = new Logger(CrmAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getOverview(tenantId: string, query: CrmAnalyticsQueryDto) {
    const cacheKey = `crm-analytics:overview:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const campaignWhere: Prisma.CampaignWhereInput = { tenantId };
    const promotionWhere: Prisma.PromotionWhereInput = { tenantId };
    if (query.startDate) {
      campaignWhere.createdAt = { gte: new Date(query.startDate) };
      promotionWhere.createdAt = { gte: new Date(query.startDate) };
    }
    if (query.endDate) {
      campaignWhere.createdAt = {
        ...((campaignWhere.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };
      promotionWhere.createdAt = {
        ...((promotionWhere.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };
    }

    const [totalCampaigns, activeCampaigns, totalPromotions, activePromotions, campaignAnalytics] =
      await Promise.all([
        this.prisma.campaign.count({ where: campaignWhere }),
        this.prisma.campaign.count({ where: { ...campaignWhere, status: 'ACTIVE' } }),
        this.prisma.promotion.count({ where: promotionWhere }),
        this.prisma.promotion.count({ where: { ...promotionWhere, status: 'ACTIVE' } }),
        this.prisma.campaignAnalytics.aggregate({
          _sum: { revenueGenerated: true, sentCount: true, conversionCount: true },
        }),
      ]);

    const totalRevenue = Number(campaignAnalytics._sum.revenueGenerated ?? 0);
    const totalCost = 0; // cost field not tracked directly
    const totalSent = Number(campaignAnalytics._sum.sentCount ?? 0);
    const totalConverted = Number(campaignAnalytics._sum.conversionCount ?? 0);

    const result = {
      totalCampaigns,
      activeCampaigns,
      totalPromotions,
      activePromotions,
      campaignRoi: totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0,
      totalCampaignRevenue: totalRevenue,
      totalCampaignCost: totalCost,
      overallConversionRate: totalSent > 0 ? (totalConverted / totalSent) * 100 : 0,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getCampaignDetail(tenantId: string, campaignId: string) {
    const cacheKey = `crm-analytics:campaign:${campaignId}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      include: { analytics: true },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');

    const result = {
      id: campaign.id,
      name: campaign.name,
      type: campaign.type,
      status: campaign.status,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      budget: campaign.budget ? Number(campaign.budget) : null,
      analytics: campaign.analytics
        ? {
            sentCount: campaign.analytics.sentCount,
            deliveredCount: campaign.analytics.deliveredCount,
            openedCount: campaign.analytics.openedCount,
            clickedCount: campaign.analytics.clickedCount,
            conversionCount: campaign.analytics.conversionCount,
            revenueGenerated: Number(campaign.analytics.revenueGenerated ?? 0),
          }
        : null,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getCampaignRoi(tenantId: string, query: CrmAnalyticsQueryDto) {
    const cacheKey = `crm-analytics:campaign-roi:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.CampaignWhereInput = { tenantId };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };
    if (query.type) where.type = query.type;

    const campaigns = await this.prisma.campaign.findMany({
      where,
      include: { analytics: true },
      orderBy: { createdAt: 'desc' },
    });

    const sorted = campaigns
      .map((c) => {
        const budget = c.budget ? Number(c.budget) : 0;
        const revenue = Number(c.analytics?.revenueGenerated ?? 0);
        const roi = budget > 0 ? ((revenue - budget) / budget) * 100 : 0;
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          status: c.status,
          budget,
          sentCount: c.analytics?.sentCount ?? 0,
          deliveredCount: c.analytics?.deliveredCount ?? 0,
          openedCount: c.analytics?.openedCount ?? 0,
          clickedCount: c.analytics?.clickedCount ?? 0,
          conversionCount: c.analytics?.conversionCount ?? 0,
          revenueGenerated: revenue,
          roi: Math.round(roi * 100) / 100,
          cost: budget,
        };
      })
      .sort((a, b) => b.roi - a.roi);

    await this.cacheService.set(tenantId, cacheKey, sorted, 300);
    return sorted;
  }

  async getPromotionMetrics(tenantId: string, query: CrmAnalyticsQueryDto) {
    const cacheKey = `crm-analytics:promotions:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.PromotionWhereInput = { tenantId };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };

    const promotions = await this.prisma.promotion.findMany({
      where,
      include: {
        usages: {
          select: { id: true, discountAmount: true, usedAt: true, customerId: true, orderId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = promotions.map((p) => {
      const totalDiscount = p.usages.reduce((s, u) => s + Number(u.discountAmount), 0);
      const usageCount = p.usages.length;
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        value: Number(p.value),
        maxDiscount: p.maxDiscount ? Number(p.maxDiscount) : null,
        minOrderAmount: p.minOrderAmount ? Number(p.minOrderAmount) : null,
        code: p.code,
        usageLimit: p.usageLimit,
        usedCount: p.usedCount,
        actualUsageCount: usageCount,
        totalDiscountAmount: totalDiscount,
        averageDiscount: usageCount > 0 ? totalDiscount / usageCount : 0,
        redemptionRate: (p.usageLimit ?? 0) > 0 ? (usageCount / (p.usageLimit ?? 1)) * 100 : 0,
      };
    });

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getCouponUsage(tenantId: string, query: CrmAnalyticsQueryDto) {
    const cacheKey = `crm-analytics:coupons:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.PromotionWhereInput = {
      tenantId,
      code: { not: null },
    };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };

    const coupons = await this.prisma.promotion.findMany({
      where,
      include: {
        usages: {
          select: { id: true, discountAmount: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalUsageCount = coupons.reduce((s, c) => s + c.usages.length, 0);
    const totalDiscountGiven = coupons.reduce(
      (s, c) => s + c.usages.reduce((su, u) => su + Number(u.discountAmount), 0),
      0,
    );

    const result = {
      totalCoupons: coupons.length,
      activeCoupons: coupons.filter((c) => c.status === 'ACTIVE').length,
      totalUsageCount,
      totalDiscountGiven,
      averageDiscountPerUse: totalUsageCount > 0 ? totalDiscountGiven / totalUsageCount : 0,
      mostUsed: coupons
        .map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          usageCount: c.usages.length,
          totalDiscount: c.usages.reduce((s, u) => s + Number(u.discountAmount), 0),
          usageLimit: c.usageLimit,
          status: c.status,
        }))
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, query.limit ?? 10),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getConversionRates(tenantId: string, query: CrmAnalyticsQueryDto) {
    const cacheKey = `crm-analytics:conversion:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.CampaignWhereInput = { tenantId };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };
    if (query.type) where.type = query.type;

    const campaigns = await this.prisma.campaign.findMany({
      where,
      include: { analytics: true },
    });

    const withRates = campaigns.map((c) => {
      const sent = c.analytics?.sentCount ?? 0;
      const delivered = c.analytics?.deliveredCount ?? 0;
      const opened = c.analytics?.openedCount ?? 0;
      const clicked = c.analytics?.clickedCount ?? 0;
      const converted = c.analytics?.conversionCount ?? 0;

      return {
        id: c.id,
        name: c.name,
        type: c.type,
        sentCount: sent,
        deliveredCount: delivered,
        openedCount: opened,
        clickedCount: clicked,
        conversionCount: converted,
        deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
        openRate: delivered > 0 ? (opened / delivered) * 100 : 0,
        clickRate: opened > 0 ? (clicked / opened) * 100 : 0,
        conversionRate: sent > 0 ? (converted / sent) * 100 : 0,
        clickToConversionRate: clicked > 0 ? (converted / clicked) * 100 : 0,
      };
    });

    const avgConversionRate =
      withRates.length > 0
        ? withRates.reduce((s, c) => s + c.conversionRate, 0) / withRates.length
        : 0;

    const result = {
      campaigns: withRates,
      averageConversionRate: Math.round(avgConversionRate * 100) / 100,
      totalCampaigns: withRates.length,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getCustomerEngagement(tenantId: string, query: CrmAnalyticsQueryDto) {
    const cacheKey = `crm-analytics:engagement:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.CampaignWhereInput = { tenantId };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };
    if (query.type) where.type = query.type;

    const campaigns = await this.prisma.campaign.findMany({
      where,
      include: { analytics: true },
    });

    const totalSent = campaigns.reduce((s, c) => s + (c.analytics?.sentCount ?? 0), 0);
    const totalDelivered = campaigns.reduce((s, c) => s + (c.analytics?.deliveredCount ?? 0), 0);
    const totalOpened = campaigns.reduce((s, c) => s + (c.analytics?.openedCount ?? 0), 0);
    const totalClicked = campaigns.reduce((s, c) => s + (c.analytics?.clickedCount ?? 0), 0);
    const totalConverted = campaigns.reduce((s, c) => s + (c.analytics?.conversionCount ?? 0), 0);

    const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
    const clickRate = totalOpened > 0 ? (totalClicked / totalOpened) * 100 : 0;
    const engagementScore = openRate * 0.4 + clickRate * 0.6;

    const byType = campaigns.reduce<
      Record<string, { sent: number; opened: number; clicked: number; converted: number }>
    >((acc, c) => {
      if (!acc[c.type]) acc[c.type] = { sent: 0, opened: 0, clicked: 0, converted: 0 };
      acc[c.type].sent += c.analytics?.sentCount ?? 0;
      acc[c.type].opened += c.analytics?.openedCount ?? 0;
      acc[c.type].clicked += c.analytics?.clickedCount ?? 0;
      acc[c.type].converted += c.analytics?.conversionCount ?? 0;
      return acc;
    }, {});

    const result = {
      totalSent,
      totalDelivered,
      totalOpened,
      totalClicked,
      totalConverted,
      openRate: Math.round(openRate * 100) / 100,
      clickRate: Math.round(clickRate * 100) / 100,
      conversionRate: totalSent > 0 ? Math.round((totalConverted / totalSent) * 10000) / 100 : 0,
      engagementScore: Math.round(engagementScore * 100) / 100,
      byType: Object.entries(byType).map(([type, data]) => ({
        type,
        sent: data.sent,
        opened: data.opened,
        clicked: data.clicked,
        converted: data.converted,
        openRate: data.sent > 0 ? Math.round((data.opened / data.sent) * 10000) / 100 : 0,
        clickRate: data.opened > 0 ? Math.round((data.clicked / data.opened) * 10000) / 100 : 0,
      })),
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getAutomationEffectiveness(tenantId: string, query: CrmAnalyticsQueryDto) {
    const cacheKey = `crm-analytics:automation:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where: Prisma.CampaignWhereInput = { tenantId };
    if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: new Date(query.endDate),
      };

    const campaigns = await this.prisma.campaign.findMany({
      where,
      include: { analytics: true },
    });

    const automated = campaigns.filter(
      (c) =>
        c.type?.toLowerCase().includes('auto') ||
        c.metadata?.toString().includes('"automated":true'),
    );
    const manual = campaigns.filter((c) => !automated.includes(c));

    const calcMetrics = (list: typeof campaigns) => {
      if (list.length === 0) return null;
      const totalSent = list.reduce((s, c) => s + (c.analytics?.sentCount ?? 0), 0);
      const totalDelivered = list.reduce((s, c) => s + (c.analytics?.deliveredCount ?? 0), 0);
      const totalOpened = list.reduce((s, c) => s + (c.analytics?.openedCount ?? 0), 0);
      const totalClicked = list.reduce((s, c) => s + (c.analytics?.clickedCount ?? 0), 0);
      const totalConverted = list.reduce((s, c) => s + (c.analytics?.conversionCount ?? 0), 0);
      const totalRevenue = list.reduce((s, c) => s + Number(c.analytics?.revenueGenerated ?? 0), 0);
      return {
        campaignCount: list.length,
        totalSent,
        avgSentPerCampaign: Math.round(totalSent / list.length),
        deliveryRate: totalSent > 0 ? Math.round((totalDelivered / totalSent) * 10000) / 100 : 0,
        openRate: totalDelivered > 0 ? Math.round((totalOpened / totalDelivered) * 10000) / 100 : 0,
        clickRate: totalOpened > 0 ? Math.round((totalClicked / totalOpened) * 10000) / 100 : 0,
        conversionRate: totalSent > 0 ? Math.round((totalConverted / totalSent) * 10000) / 100 : 0,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
      };
    };

    const autoMetrics = calcMetrics(automated);
    const manualMetrics = calcMetrics(manual);

    let comparison = null;
    if (autoMetrics && manualMetrics) {
      comparison = {
        conversionRateDiff:
          Math.round((autoMetrics.conversionRate - manualMetrics.conversionRate) * 100) / 100,
        openRateDiff: Math.round((autoMetrics.openRate - manualMetrics.openRate) * 100) / 100,
        revenuePerCampaignDiff:
          Math.round(
            (autoMetrics.totalRevenue / autoMetrics.campaignCount -
              manualMetrics.totalRevenue / manualMetrics.campaignCount) *
              100,
          ) / 100,
      };
    }

    const result = {
      automated: autoMetrics,
      manual: manualMetrics,
      comparison,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
