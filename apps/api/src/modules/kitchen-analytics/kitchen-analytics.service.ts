import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { Prisma } from '@prisma/client';
import { KitchenAnalyticsQueryDto } from './dto/kitchen-analytics-query.dto';

@Injectable()
export class KitchenAnalyticsService {
  private readonly logger = new Logger(KitchenAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly cacheService: CacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private buildDateFilter(query: KitchenAnalyticsQueryDto): { gte?: Date; lte?: Date } {
    const filter: { gte?: Date; lte?: Date } = {};
    if (query.startDate) filter.gte = new Date(query.startDate);
    if (query.endDate) filter.lte = new Date(query.endDate);
    return filter;
  }

  private getTicketWhere(
    tenantId: string,
    query: KitchenAnalyticsQueryDto,
  ): Prisma.KitchenTicketWhereInput {
    const where: Prisma.KitchenTicketWhereInput = { tenantId };
    const dateFilter = this.buildDateFilter(query);
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
    if (query.stationId) where.stationId = query.stationId;
    return where;
  }

  private getTicketItemWhere(
    tenantId: string,
    query: KitchenAnalyticsQueryDto,
  ): Prisma.KitchenTicketItemWhereInput {
    const where: Prisma.KitchenTicketItemWhereInput = { tenantId };
    const dateFilter = this.buildDateFilter(query);
    if (Object.keys(dateFilter).length > 0) where.createdAt = dateFilter;
    if (query.stationId) where.stationId = query.stationId;
    return where;
  }

  async getStationWorkload(tenantId: string, query: KitchenAnalyticsQueryDto) {
    const cacheKey = `kitchen:station-workload:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getTicketItemWhere(tenantId, query);
    const items = await this.prisma.kitchenTicketItem.findMany({
      where,
      select: { stationId: true, id: true },
    });

    const grouped = new Map<
      string,
      { stationId: string; totalTickets: number; totalItems: number }
    >();
    for (const item of items) {
      const sid = item.stationId ?? 'unassigned';
      if (!grouped.has(sid)) grouped.set(sid, { stationId: sid, totalTickets: 0, totalItems: 0 });
      const g = grouped.get(sid)!;
      g.totalItems++;
      g.totalTickets = new Set(
        items.filter((i) => (i.stationId ?? 'unassigned') === sid).map((i) => i.id),
      ).size;
    }

    const result = Array.from(grouped.values());
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getStationDetail(tenantId: string, stationId: string, query: KitchenAnalyticsQueryDto) {
    const cacheKey = `kitchen:station-detail:${stationId}:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const station = await this.prisma.kitchenStation.findFirst({
      where: { id: stationId, tenantId },
    });
    if (!station) throw new NotFoundException('Kitchen station not found');

    const itemWhere: Prisma.KitchenTicketItemWhereInput = { tenantId, stationId };
    const dateFilter = this.buildDateFilter(query);
    if (Object.keys(dateFilter).length > 0) itemWhere.createdAt = dateFilter;

    const items = await this.prisma.kitchenTicketItem.findMany({
      where: itemWhere,
      select: { id: true, status: true, startedAt: true, completedAt: true, createdAt: true },
    });

    const totalItems = items.length;
    const completedItems = items.filter((i) => i.status === 'SERVED').length;
    const cancelledItems = items.filter((i) => i.status === 'CANCELLED').length;
    const pendingItems = items.filter(
      (i) => i.status === 'PENDING' || i.status === 'QUEUED',
    ).length;
    const preparingItems = items.filter((i) => i.status === 'PREPARING').length;

    const completedWithTime = items.filter((i) => i.completedAt && i.startedAt);
    const avgPrepTime =
      completedWithTime.length > 0
        ? completedWithTime.reduce(
            (s, i) => s + (i.completedAt!.getTime() - i.startedAt!.getTime()),
            0,
          ) / completedWithTime.length
        : 0;

    const result = {
      stationId,
      stationName: station.name,
      totalItems,
      completedItems,
      cancelledItems,
      pendingItems,
      preparingItems,
      averagePreparationTimeMs: avgPrepTime,
      completionRate: totalItems > 0 ? (completedItems / totalItems) * 100 : 0,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getAveragePreparationTime(tenantId: string, query: KitchenAnalyticsQueryDto) {
    const cacheKey = `kitchen:avg-prep-time:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getTicketItemWhere(tenantId, query);
    const items = await this.prisma.kitchenTicketItem.findMany({
      where: { ...where, completedAt: { not: null }, startedAt: { not: null } },
      select: { startedAt: true, completedAt: true, stationId: true },
    });

    const totalDuration = items.reduce(
      (s, i) => s + (i.completedAt!.getTime() - i.startedAt!.getTime()),
      0,
    );
    const averageMs = items.length > 0 ? totalDuration / items.length : 0;

    const result = {
      averagePreparationTimeMs: averageMs,
      averagePreparationTimeMin: averageMs / 60000,
      sampleSize: items.length,
    };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getQueueAnalysis(tenantId: string, query: KitchenAnalyticsQueryDto) {
    const cacheKey = `kitchen:queue:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getTicketWhere(tenantId, query);
    const tickets = await this.prisma.kitchenTicket.findMany({
      where,
      select: { status: true },
    });

    const statusCounts = new Map<string, number>();
    for (const t of tickets) {
      statusCounts.set(t.status, (statusCounts.get(t.status) ?? 0) + 1);
    }

    const statusBreakdown = Array.from(statusCounts.entries()).map(([status, count]) => ({
      status,
      count,
    }));
    const totalInQueue = (statusCounts.get('PENDING') ?? 0) + (statusCounts.get('QUEUED') ?? 0);

    const result = { totalTickets: tickets.length, totalInQueue, statusBreakdown };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getDelayDetection(
    tenantId: string,
    query: KitchenAnalyticsQueryDto,
    thresholdMs: number = 20 * 60 * 1000,
  ) {
    const cacheKey = `kitchen:delays:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getTicketItemWhere(tenantId, query);
    const items = await this.prisma.kitchenTicketItem.findMany({
      where: { ...where, completedAt: { not: null }, startedAt: { not: null } },
      select: { id: true, startedAt: true, completedAt: true, stationId: true },
    });

    const delayed = items.filter(
      (i) => i.completedAt!.getTime() - i.startedAt!.getTime() > thresholdMs,
    );
    const totalWithTimes = items.length;

    const result = {
      thresholdMs,
      thresholdMin: thresholdMs / 60000,
      totalItemsWithTiming: totalWithTimes,
      delayedCount: delayed.length,
      delayRate: totalWithTimes > 0 ? (delayed.length / totalWithTimes) * 100 : 0,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getCompletionRate(tenantId: string, query: KitchenAnalyticsQueryDto) {
    const cacheKey = `kitchen:completion-rate:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getTicketItemWhere(tenantId, query);
    const items = await this.prisma.kitchenTicketItem.findMany({
      where,
      select: { status: true },
    });

    const total = items.length;
    const completed = items.filter((i) => i.status === 'SERVED').length;

    const result = {
      totalItems: total,
      completedItems: completed,
      completionRate: total > 0 ? (completed / total) * 100 : 0,
    };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getRecallRate(tenantId: string, query: KitchenAnalyticsQueryDto) {
    const cacheKey = `kitchen:recall-rate:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getTicketItemWhere(tenantId, query);
    const items = await this.prisma.kitchenTicketItem.findMany({
      where,
      select: { status: true },
    });

    const total = items.length;
    const cancelled = items.filter((i) => i.status === 'CANCELLED').length;

    const result = {
      totalItems: total,
      cancelledItems: cancelled,
      recallRate: total > 0 ? (cancelled / total) * 100 : 0,
    };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getKitchenEfficiency(tenantId: string, query: KitchenAnalyticsQueryDto) {
    const cacheKey = `kitchen:efficiency:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const dateFilter = this.buildDateFilter(query);

    const ticketWhere: Prisma.KitchenTicketWhereInput = { tenantId };
    if (Object.keys(dateFilter).length > 0) ticketWhere.createdAt = dateFilter;

    const tickets = await this.prisma.kitchenTicket.findMany({
      where: ticketWhere,
      select: { createdAt: true, completedAt: true },
    });

    const completedTickets = tickets.filter((t) => t.completedAt);
    const totalPrepTime = completedTickets.reduce(
      (s, t) => s + (t.completedAt!.getTime() - t.createdAt.getTime()),
      0,
    );
    const avgTicketTimeMs =
      completedTickets.length > 0 ? totalPrepTime / completedTickets.length : 0;

    const itemWhere = this.getTicketItemWhere(tenantId, query);
    const items = await this.prisma.kitchenTicketItem.findMany({
      where: itemWhere,
      select: { id: true },
    });

    const totalItems = items.length;

    const timeRange =
      tickets.length > 0
        ? Math.max(...tickets.map((t) => t.createdAt.getTime())) -
          Math.min(...tickets.map((t) => t.createdAt.getTime()))
        : 1;
    const hoursSpan = timeRange > 0 ? timeRange / 3600000 : 1;
    const itemsPerHour = totalItems / hoursSpan;
    const utilizationRate =
      completedTickets.length > 0 ? (completedTickets.length / tickets.length) * 100 : 0;

    const result = {
      totalTickets: tickets.length,
      completedTickets: completedTickets.length,
      totalItemsPrepared: totalItems,
      averageTicketTimeMs: avgTicketTimeMs,
      averageTicketTimeMin: avgTicketTimeMs / 60000,
      itemsPerHour,
      utilizationRate,
    };

    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }

  async getBottlenecks(tenantId: string, query: KitchenAnalyticsQueryDto) {
    const cacheKey = `kitchen:bottlenecks:${JSON.stringify(query)}`;
    const cached = await this.cacheService.get(tenantId, cacheKey);
    if (cached) return cached;

    const where = this.getTicketItemWhere(tenantId, query);
    const items = await this.prisma.kitchenTicketItem.findMany({
      where: { ...where, completedAt: { not: null }, startedAt: { not: null } },
      select: { stationId: true, startedAt: true, completedAt: true, status: true },
    });

    const stationMetrics = new Map<
      string,
      { stationId: string; totalItems: number; totalTimeMs: number; pendingCount: number }
    >();
    for (const item of items) {
      const sid = item.stationId ?? 'unassigned';
      if (!stationMetrics.has(sid))
        stationMetrics.set(sid, { stationId: sid, totalItems: 0, totalTimeMs: 0, pendingCount: 0 });
      const m = stationMetrics.get(sid)!;
      m.totalItems++;
      m.totalTimeMs += item.completedAt!.getTime() - item.startedAt!.getTime();
    }

    const allItems = await this.prisma.kitchenTicketItem.findMany({
      where: { ...where, status: { in: ['PENDING', 'QUEUED'] } },
      select: { stationId: true },
    });

    for (const item of allItems) {
      const sid = item.stationId ?? 'unassigned';
      if (!stationMetrics.has(sid))
        stationMetrics.set(sid, { stationId: sid, totalItems: 0, totalTimeMs: 0, pendingCount: 0 });
      stationMetrics.get(sid)!.pendingCount++;
    }

    const breakdown = Array.from(stationMetrics.values()).map((m) => ({
      stationId: m.stationId,
      averagePrepTimeMs: m.totalItems > 0 ? m.totalTimeMs / m.totalItems : 0,
      averagePrepTimeMin: m.totalItems > 0 ? m.totalTimeMs / m.totalItems / 60000 : 0,
      totalItemsProcessed: m.totalItems,
      itemsWaiting: m.pendingCount,
    }));

    breakdown.sort(
      (a, b) =>
        b.averagePrepTimeMs +
        b.itemsWaiting * 60000 -
        (a.averagePrepTimeMs + a.itemsWaiting * 60000),
    );

    const result = { bottlenecks: breakdown };
    await this.cacheService.set(tenantId, cacheKey, result, 300);
    return result;
  }
}
