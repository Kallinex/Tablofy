import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { KitchenAnalyticsService } from '../kitchen-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

const Q = {} as never;
const MINUTE = 60 * 1000;

describe('KitchenAnalyticsService', () => {
  let service: KitchenAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KitchenAnalyticsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<KitchenAnalyticsService>(KitchenAnalyticsService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
  });

  describe('getStationWorkload', () => {
    it('should return the cached workload', async () => {
      const cached = [{ stationId: 's-1' }];
      cache.get.mockResolvedValue(cached);

      expect(await service.getStationWorkload(testTenantId, Q)).toEqual(cached);
      expect(prisma.kitchenTicketItem.findMany).not.toHaveBeenCalled();
    });

    it('should count distinct tickets per station, not distinct items', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        { stationId: 's-1', ticketId: 't-1' },
        { stationId: 's-1', ticketId: 't-1' },
        { stationId: 's-1', ticketId: 't-2' },
        { stationId: 's-2', ticketId: 't-3' },
      ]);

      const result = await service.getStationWorkload(testTenantId, Q);

      const s1 = result.find((r) => r.stationId === 's-1')!;
      expect(s1.totalItems).toBe(3);
      expect(s1.totalTickets).toBe(2);
      expect(result.find((r) => r.stationId === 's-2')!.totalTickets).toBe(1);
    });

    it('should bucket items without a station as unassigned', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([{ stationId: null, ticketId: 't-1' }]);

      const result = await service.getStationWorkload(testTenantId, Q);

      expect(result[0]).toEqual({ stationId: 'unassigned', totalTickets: 1, totalItems: 1 });
    });

    it('should return an empty list when there are no items', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      expect(await service.getStationWorkload(testTenantId, Q)).toEqual([]);
    });

    it('should cache the workload for 300 seconds', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      const result = await service.getStationWorkload(testTenantId, Q);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('kitchen:station-workload'),
        result,
        300,
      );
    });
  });

  describe('getStationDetail', () => {
    it('should throw when the station does not exist', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue(null);

      await expect(service.getStationDetail(testTenantId, 's-1', Q)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should scope the station lookup to the tenant', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 's-1', name: 'Grill' });
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      await service.getStationDetail(testTenantId, 's-1', Q);

      expect(prisma.kitchenStation.findFirst).toHaveBeenCalledWith({
        where: { id: 's-1', tenantId: testTenantId },
      });
    });

    it('should break items down by status and compute the completion rate', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 's-1', name: 'Grill' });
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        { id: '1', status: 'SERVED', startedAt: null, completedAt: null, createdAt: new Date() },
        { id: '2', status: 'SERVED', startedAt: null, completedAt: null, createdAt: new Date() },
        { id: '3', status: 'CANCELLED', startedAt: null, completedAt: null, createdAt: new Date() },
        { id: '4', status: 'PREPARING', startedAt: null, completedAt: null, createdAt: new Date() },
        { id: '5', status: 'PENDING', startedAt: null, completedAt: null, createdAt: new Date() },
        { id: '6', status: 'QUEUED', startedAt: null, completedAt: null, createdAt: new Date() },
      ]);

      const result = await service.getStationDetail(testTenantId, 's-1', Q);

      expect(result.totalItems).toBe(6);
      expect(result.completedItems).toBe(2);
      expect(result.cancelledItems).toBe(1);
      expect(result.preparingItems).toBe(1);
      expect(result.pendingItems).toBe(2);
      expect(result.completionRate).toBeCloseTo(33.33, 2);
    });

    it('should average preparation time only over items with both timestamps', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 's-1', name: 'Grill' });
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        {
          id: '1',
          status: 'SERVED',
          startedAt: base,
          completedAt: new Date(base.getTime() + 10 * MINUTE),
          createdAt: base,
        },
        {
          id: '2',
          status: 'SERVED',
          startedAt: base,
          completedAt: new Date(base.getTime() + 20 * MINUTE),
          createdAt: base,
        },
        { id: '3', status: 'PREPARING', startedAt: base, completedAt: null, createdAt: base },
      ]);

      const result = await service.getStationDetail(testTenantId, 's-1', Q);

      expect(result.averagePreparationTimeMs).toBe(15 * MINUTE);
    });

    it('should report zero completion rate when the station has no items', async () => {
      prisma.kitchenStation.findFirst.mockResolvedValue({ id: 's-1', name: 'Grill' });
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      const result = await service.getStationDetail(testTenantId, 's-1', Q);

      expect(result.completionRate).toBe(0);
      expect(result.averagePreparationTimeMs).toBe(0);
    });
  });

  describe('getAveragePreparationTime', () => {
    it('should only consider items that have started and completed', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      await service.getAveragePreparationTime(testTenantId, Q);

      expect(prisma.kitchenTicketItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            completedAt: { not: null },
            startedAt: { not: null },
          }),
        }),
      );
    });

    it('should average the item durations and expose minutes', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        { startedAt: base, completedAt: new Date(base.getTime() + 5 * MINUTE), stationId: 's-1' },
        { startedAt: base, completedAt: new Date(base.getTime() + 15 * MINUTE), stationId: 's-1' },
      ]);

      const result = await service.getAveragePreparationTime(testTenantId, Q);

      expect(result.averagePreparationTimeMs).toBe(10 * MINUTE);
      expect(result.averagePreparationTimeMin).toBe(10);
      expect(result.sampleSize).toBe(2);
    });

    it('should report zero for an empty sample', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      const result = await service.getAveragePreparationTime(testTenantId, Q);

      expect(result).toEqual({
        averagePreparationTimeMs: 0,
        averagePreparationTimeMin: 0,
        sampleSize: 0,
      });
    });
  });

  describe('getQueueAnalysis', () => {
    it('should count tickets per status and total the queue', async () => {
      prisma.kitchenTicket.findMany.mockResolvedValue([
        { status: 'PENDING' },
        { status: 'PENDING' },
        { status: 'QUEUED' },
        { status: 'SERVED' },
      ]);

      const result = await service.getQueueAnalysis(testTenantId, Q);

      expect(result.totalTickets).toBe(4);
      expect(result.totalInQueue).toBe(3);
      expect(result.statusBreakdown).toEqual(
        expect.arrayContaining([
          { status: 'PENDING', count: 2 },
          { status: 'QUEUED', count: 1 },
          { status: 'SERVED', count: 1 },
        ]),
      );
    });

    it('should report an empty queue when there are no tickets', async () => {
      prisma.kitchenTicket.findMany.mockResolvedValue([]);

      const result = await service.getQueueAnalysis(testTenantId, Q);

      expect(result.totalTickets).toBe(0);
      expect(result.totalInQueue).toBe(0);
      expect(result.statusBreakdown).toEqual([]);
    });
  });

  describe('getDelayDetection', () => {
    it('should flag items over the default twenty minute threshold', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        {
          id: '1',
          startedAt: base,
          completedAt: new Date(base.getTime() + 25 * MINUTE),
          stationId: 's-1',
        },
        {
          id: '2',
          startedAt: base,
          completedAt: new Date(base.getTime() + 10 * MINUTE),
          stationId: 's-1',
        },
      ]);

      const result = await service.getDelayDetection(testTenantId, Q);

      expect(result.thresholdMs).toBe(20 * MINUTE);
      expect(result.thresholdMin).toBe(20);
      expect(result.delayedCount).toBe(1);
      expect(result.delayRate).toBe(50);
    });

    it('should honour a custom threshold', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        {
          id: '1',
          startedAt: base,
          completedAt: new Date(base.getTime() + 3 * MINUTE),
          stationId: 's-1',
        },
      ]);

      const result = await service.getDelayDetection(testTenantId, Q, 2 * MINUTE);

      expect(result.delayedCount).toBe(1);
      expect(result.thresholdMin).toBe(2);
    });

    it('should treat an item exactly at the threshold as not delayed', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        {
          id: '1',
          startedAt: base,
          completedAt: new Date(base.getTime() + 20 * MINUTE),
          stationId: 's-1',
        },
      ]);

      const result = await service.getDelayDetection(testTenantId, Q);

      expect(result.delayedCount).toBe(0);
    });

    it('should report zero delay rate with no timed items', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      const result = await service.getDelayDetection(testTenantId, Q);

      expect(result.delayRate).toBe(0);
      expect(result.totalItemsWithTiming).toBe(0);
    });
  });

  describe('getCompletionRate', () => {
    it('should compute the share of served items', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        { status: 'SERVED' },
        { status: 'SERVED' },
        { status: 'SERVED' },
        { status: 'PREPARING' },
      ]);

      const result = await service.getCompletionRate(testTenantId, Q);

      expect(result.totalItems).toBe(4);
      expect(result.completedItems).toBe(3);
      expect(result.completionRate).toBe(75);
    });

    it('should report zero completion rate with no items', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      const result = await service.getCompletionRate(testTenantId, Q);

      expect(result.completionRate).toBe(0);
    });
  });

  describe('getRecallRate', () => {
    it('should compute the share of cancelled items', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        { status: 'CANCELLED' },
        { status: 'SERVED' },
        { status: 'SERVED' },
        { status: 'SERVED' },
      ]);

      const result = await service.getRecallRate(testTenantId, Q);

      expect(result.cancelledItems).toBe(1);
      expect(result.recallRate).toBe(25);
    });

    it('should report zero recall rate with no items', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      const result = await service.getRecallRate(testTenantId, Q);

      expect(result.recallRate).toBe(0);
    });
  });

  describe('getKitchenEfficiency', () => {
    it('should average ticket time over completed tickets', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicket.findMany.mockResolvedValue([
        { createdAt: base, completedAt: new Date(base.getTime() + 10 * MINUTE) },
        { createdAt: base, completedAt: new Date(base.getTime() + 30 * MINUTE) },
        { createdAt: base, completedAt: null },
      ]);
      prisma.kitchenTicketItem.findMany.mockResolvedValue([{ id: '1' }, { id: '2' }]);

      const result = await service.getKitchenEfficiency(testTenantId, Q);

      expect(result.totalTickets).toBe(3);
      expect(result.completedTickets).toBe(2);
      expect(result.averageTicketTimeMs).toBe(20 * MINUTE);
      expect(result.averageTicketTimeMin).toBe(20);
      expect(result.totalItemsPrepared).toBe(2);
    });

    it('should compute the completion share as utilization rate', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicket.findMany.mockResolvedValue([
        { createdAt: base, completedAt: new Date(base.getTime() + MINUTE) },
        { createdAt: base, completedAt: null },
        { createdAt: base, completedAt: null },
        { createdAt: base, completedAt: null },
      ]);
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      const result = await service.getKitchenEfficiency(testTenantId, Q);

      expect(result.utilizationRate).toBe(25);
    });

    it('should derive items per hour from the ticket time span', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicket.findMany.mockResolvedValue([
        { createdAt: base, completedAt: null },
        { createdAt: new Date(base.getTime() + 2 * 60 * MINUTE), completedAt: null },
      ]);
      prisma.kitchenTicketItem.findMany.mockResolvedValue([
        { id: '1' },
        { id: '2' },
        { id: '3' },
        { id: '4' },
      ]);

      const result = await service.getKitchenEfficiency(testTenantId, Q);

      expect(result.itemsPerHour).toBe(2);
    });

    it('should avoid dividing by zero when all tickets share one timestamp', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicket.findMany.mockResolvedValue([{ createdAt: base, completedAt: null }]);
      prisma.kitchenTicketItem.findMany.mockResolvedValue([{ id: '1' }, { id: '2' }]);

      const result = await service.getKitchenEfficiency(testTenantId, Q);

      expect(Number.isFinite(result.itemsPerHour)).toBe(true);
      expect(result.itemsPerHour).toBe(2);
    });

    it('should return zeros for an empty kitchen', async () => {
      prisma.kitchenTicket.findMany.mockResolvedValue([]);
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      const result = await service.getKitchenEfficiency(testTenantId, Q);

      expect(result.averageTicketTimeMs).toBe(0);
      expect(result.itemsPerHour).toBe(0);
      expect(result.utilizationRate).toBe(0);
    });
  });

  describe('getBottlenecks', () => {
    it('should compute average prep time per station', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicketItem.findMany
        .mockResolvedValueOnce([
          {
            stationId: 's-1',
            startedAt: base,
            completedAt: new Date(base.getTime() + 10 * MINUTE),
            status: 'SERVED',
          },
          {
            stationId: 's-1',
            startedAt: base,
            completedAt: new Date(base.getTime() + 20 * MINUTE),
            status: 'SERVED',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getBottlenecks(testTenantId, Q);

      expect(result.bottlenecks[0].stationId).toBe('s-1');
      expect(result.bottlenecks[0].averagePrepTimeMs).toBe(15 * MINUTE);
      expect(result.bottlenecks[0].averagePrepTimeMin).toBe(15);
      expect(result.bottlenecks[0].totalItemsProcessed).toBe(2);
    });

    it('should count waiting PENDING/QUEUED items even though they have no timestamps', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicketItem.findMany
        .mockResolvedValueOnce([
          {
            stationId: 's-1',
            startedAt: base,
            completedAt: new Date(base.getTime() + 5 * MINUTE),
            status: 'SERVED',
          },
        ])
        .mockResolvedValueOnce([{ stationId: 's-1' }, { stationId: 's-1' }]);

      const result = await service.getBottlenecks(testTenantId, Q);

      expect(result.bottlenecks[0].itemsWaiting).toBe(2);
    });

    it('should query waiting items without the started/completed not-null filter', async () => {
      prisma.kitchenTicketItem.findMany.mockResolvedValue([]);

      await service.getBottlenecks(testTenantId, Q);

      const secondCall = prisma.kitchenTicketItem.findMany.mock.calls[1][0];
      expect(secondCall.where.status).toEqual({ in: ['PENDING', 'QUEUED'] });
      expect(secondCall.where.startedAt).toBeUndefined();
      expect(secondCall.where.completedAt).toBeUndefined();
    });

    it('should sort stations by combined prep time and waiting load', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicketItem.findMany
        .mockResolvedValueOnce([
          {
            stationId: 'slow',
            startedAt: base,
            completedAt: new Date(base.getTime() + 30 * MINUTE),
            status: 'SERVED',
          },
          {
            stationId: 'fast',
            startedAt: base,
            completedAt: new Date(base.getTime() + 1 * MINUTE),
            status: 'SERVED',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getBottlenecks(testTenantId, Q);

      expect(result.bottlenecks.map((b) => b.stationId)).toEqual(['slow', 'fast']);
    });

    it('should include a waiting-only station', async () => {
      prisma.kitchenTicketItem.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ stationId: 's-9' }]);

      const result = await service.getBottlenecks(testTenantId, Q);

      expect(result.bottlenecks).toEqual([
        {
          stationId: 's-9',
          averagePrepTimeMs: 0,
          averagePrepTimeMin: 0,
          totalItemsProcessed: 0,
          itemsWaiting: 1,
        },
      ]);
    });

    it('should bucket items without a station as unassigned', async () => {
      const base = new Date('2025-01-01T10:00:00Z');
      prisma.kitchenTicketItem.findMany
        .mockResolvedValueOnce([
          {
            stationId: null,
            startedAt: base,
            completedAt: new Date(base.getTime() + 2 * MINUTE),
            status: 'SERVED',
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getBottlenecks(testTenantId, Q);

      expect(result.bottlenecks[0].stationId).toBe('unassigned');
    });
  });
});
