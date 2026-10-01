import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DashboardService } from '../dashboard.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
  });

  describe('getInventorySummary', () => {
    it('computes value, low stock and out-of-stock counts', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: '1', currentQuantity: 10, unitCost: 2, minStock: 5 },
        { id: '2', currentQuantity: 3, unitCost: 4, minStock: 5 },
        { id: '3', currentQuantity: 0, unitCost: 7, minStock: 1 },
        { id: '4', currentQuantity: 2, unitCost: null, minStock: null },
      ]);

      const result = await service.getInventorySummary(testTenantId);

      expect(result.totalItems).toBe(4);
      expect(result.totalValue).toBe(10 * 2 + 3 * 4 + 0 + 2 * 0);
      expect(result.lowStockCount).toBe(2); // items 2 and 3; item 4 has no minStock so it is excluded
      expect(result.outOfStockCount).toBe(1);
    });

    it('scopes to active, non-deleted items', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);

      await service.getInventorySummary(testTenantId);

      expect(prisma.inventoryItem.findMany.mock.calls[0][0].where).toEqual({
        tenantId: testTenantId,
        deletedAt: null,
        isActive: true,
      });
    });

    it('uses the cached summary when present', async () => {
      const cached = { totalItems: 1 };
      cache.get.mockResolvedValue(cached);

      expect(await service.getInventorySummary(testTenantId)).toBe(cached);
      expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getWarehouseSummary', () => {
    it('maps warehouse counts and capacity', async () => {
      prisma.warehouse.findMany.mockResolvedValue([
        {
          id: 'w-1',
          name: 'Main',
          code: 'W1',
          capacity: '1000',
          capacityUnit: 'kg',
          _count: { zones: 3, bins: 20 },
        },
      ]);

      const result = await service.getWarehouseSummary(testTenantId);

      expect(result).toEqual([
        {
          id: 'w-1',
          name: 'Main',
          code: 'W1',
          totalZones: 3,
          totalBins: 20,
          capacity: 1000,
          capacityUnit: 'kg',
        },
      ]);
    });
  });

  describe('getMovementSummary', () => {
    it('separates inbound and outbound movements in the last 30 days', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([
        { type: 'IN', quantity: 5, createdAt: new Date() },
        { type: 'IN', quantity: 2, createdAt: new Date() },
        { type: 'OUT', quantity: -3, createdAt: new Date() },
      ]);

      const result = await service.getMovementSummary(testTenantId);

      expect(result).toMatchObject({
        totalMovements: 3,
        inboundCount: 2,
        outboundCount: 1,
        periodDays: 30,
      });
    });
  });

  describe('getTurnoverRate', () => {
    it('divides COGS by the total inventory value, not the per-item average', async () => {
      prisma.consumptionRecord.findMany.mockResolvedValue([
        { totalCost: 600, createdAt: new Date() },
        { totalCost: 400, createdAt: new Date() },
      ]);
      prisma.inventoryItem.findMany.mockResolvedValue([
        { currentQuantity: 10, unitCost: 10 },
        { currentQuantity: 10, unitCost: 10 },
      ]);

      const result = await service.getTurnoverRate(testTenantId);

      // total inventory value = 200, not 200 / 2 items
      expect(result.averageInventoryValue).toBe(200);
      expect(result.cogs).toBe(1000);
      expect(result.turnoverRate).toBe(5);
      expect(result.periodMonths).toBe(3);
    });

    it('returns a zero turnover rate when there is no inventory', async () => {
      prisma.consumptionRecord.findMany.mockResolvedValue([]);
      prisma.inventoryItem.findMany.mockResolvedValue([]);

      const result = await service.getTurnoverRate(testTenantId);

      expect(result.turnoverRate).toBe(0);
      expect(result.averageInventoryValue).toBe(0);
    });
  });

  describe('getSupplierPerformanceSummary', () => {
    it('fetches top and bottom performers independently', async () => {
      prisma.supplierPerformanceMetric.findMany
        .mockResolvedValueOnce([
          {
            supplierId: 'best',
            overallScore: 99,
            qualityScore: 98,
            costScore: 97,
            supplier: { name: 'Best' },
          },
        ])
        .mockResolvedValueOnce([
          {
            supplierId: 'worst',
            overallScore: 12,
            qualityScore: null,
            costScore: null,
            supplier: { name: 'Worst' },
          },
        ]);

      const result = await service.getSupplierPerformanceSummary(testTenantId);

      expect(result.topPerformers[0]).toMatchObject({ supplierId: 'best', overallScore: 99 });
      expect(result.bottomPerformers[0]).toMatchObject({ supplierId: 'worst', overallScore: 12 });
    });

    it('queries top descending and bottom ascending', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);

      await service.getSupplierPerformanceSummary(testTenantId);

      const calls = prisma.supplierPerformanceMetric.findMany.mock.calls;
      expect(calls[0][0].orderBy).toEqual({ overallScore: 'desc' });
      expect(calls[1][0].orderBy).toEqual({ overallScore: 'asc' });
      expect(calls[0][0].take).toBe(5);
      expect(calls[1][0].take).toBe(5);
    });
  });

  describe('getReorderAlert', () => {
    it('returns items at or below their reorder level, capped at 20', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        {
          id: 'i-1',
          name: 'Flour',
          sku: 'FL',
          currentQuantity: 2,
          reorderLevel: 5,
          unit: { abbreviation: 'kg' },
        },
        { id: 'i-2', name: 'Salt', sku: 'SL', currentQuantity: 9, reorderLevel: 5, unit: null },
      ]);

      const result = await service.getReorderAlert(testTenantId);

      expect(result.totalNeedingReorder).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'i-1',
        currentQuantity: 2,
        reorderLevel: 5,
        unit: 'kg',
      });
      expect(result.items[0].unit).toBe('kg');
    });

    it('only considers items that define a reorder level', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);

      await service.getReorderAlert(testTenantId);

      expect(prisma.inventoryItem.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: testTenantId,
        reorderLevel: { not: null },
      });
    });
  });

  describe('getValuationSummary', () => {
    it('reports FIFO and weighted-average valuations separately', async () => {
      prisma.inventoryValuation.aggregate
        .mockResolvedValueOnce({ _sum: { totalValue: '1500', quantity: '30' } })
        .mockResolvedValueOnce({ _sum: { totalValue: null, quantity: null } });

      const result = await service.getValuationSummary(testTenantId);

      expect(result.fifo).toEqual({ totalValue: 1500, totalQuantity: 30 });
      expect(result.weightedAverage).toEqual({ totalValue: 0, totalQuantity: 0 });
      expect(prisma.inventoryValuation.aggregate.mock.calls[0][0].where).toEqual({
        tenantId: testTenantId,
        method: 'FIFO',
      });
      expect(prisma.inventoryValuation.aggregate.mock.calls[1][0].where).toEqual({
        tenantId: testTenantId,
        method: 'WEIGHTED_AVERAGE',
      });
    });
  });
});
