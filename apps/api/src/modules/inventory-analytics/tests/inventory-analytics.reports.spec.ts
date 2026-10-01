import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryAnalyticsService } from '../inventory-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('InventoryAnalyticsService valuation, waste, shrinkage and recipe usage', () => {
  let service: InventoryAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryAnalyticsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<InventoryAnalyticsService>(InventoryAnalyticsService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    cache.get.mockResolvedValue(null);
    jest.clearAllMocks();
  });

  describe('getValuation', () => {
    it('returns the cached valuation', async () => {
      cache.get.mockResolvedValue([{ method: 'FIFO', totalValue: 10 }]);

      await expect(service.getValuation(testTenantId, {})).resolves.toEqual([
        { method: 'FIFO', totalValue: 10 },
      ]);
      expect(prisma.inventoryValuation.groupBy).not.toHaveBeenCalled();
    });

    it('groups valuations by costing method and caches the result', async () => {
      prisma.inventoryValuation.groupBy.mockResolvedValue([
        { method: 'FIFO', _sum: { totalValue: 150.5, quantity: 20 }, _count: 3 },
        { method: 'AVERAGE', _sum: { totalValue: null, quantity: null }, _count: 1 },
      ]);

      const result = await service.getValuation(testTenantId, {});

      const [args] = prisma.inventoryValuation.groupBy.mock.calls[0];
      expect(args.by).toEqual(['method']);
      expect(args.where).toEqual({ tenantId: testTenantId });
      expect(result).toEqual([
        { method: 'FIFO', totalValue: 150.5, totalQuantity: 20, count: 3 },
        { method: 'AVERAGE', totalValue: 0, totalQuantity: 0, count: 1 },
      ]);
      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        'inventory-analytics:valuation:{}',
        result,
        300,
      );
    });

    it('applies the date range, item and method filters', async () => {
      prisma.inventoryValuation.groupBy.mockResolvedValue([]);
      await service.getValuation(testTenantId, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        inventoryItemId: 'inv-1',
        method: 'FIFO' as never,
      });

      const [args] = prisma.inventoryValuation.groupBy.mock.calls[0];
      expect(args.where.valuationDate).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-01-31'),
      });
      expect(args.where.inventoryItemId).toBe('inv-1');
      expect(args.where.method).toBe('FIFO');
    });
  });

  describe('getWasteAnalysis', () => {
    it('returns the cached waste analysis', async () => {
      cache.get.mockResolvedValue({ byType: [], trend: [] });

      await expect(service.getWasteAnalysis(testTenantId, {})).resolves.toEqual({
        byType: [],
        trend: [],
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('converts bigint aggregates to numbers', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { wasteType: 'SPOILAGE', totalQuantity: 5, totalCost: 12.5, count: BigInt(3) },
        ])
        .mockResolvedValueOnce([{ date: '2026-01-01', quantity: 5, cost: 12.5 }]);

      const result = await service.getWasteAnalysis(testTenantId, {});

      expect(result.byType).toEqual([
        { wasteType: 'SPOILAGE', totalQuantity: 5, totalCost: 12.5, count: 3 },
      ]);
      expect(result.trend).toEqual([{ date: '2026-01-01', quantity: 5, cost: 12.5 }]);
      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        'inventory-analytics:waste:{}',
        result,
        300,
      );
    });

    it('scopes the raw waste query to the tenant, dates and item', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getWasteAnalysis(testTenantId, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        inventoryItemId: 'inv-1',
      });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      const [sql] = prisma.$queryRaw.mock.calls[0];
      expect(sql.values).toEqual(
        expect.arrayContaining([
          testTenantId,
          new Date('2026-01-01'),
          new Date('2026-01-31'),
          'inv-1',
        ]),
      );
    });
  });

  describe('getShrinkage', () => {
    it('returns the cached shrinkage report', async () => {
      cache.get.mockResolvedValue({ totalShrinkageQuantity: 0 });

      await expect(service.getShrinkage(testTenantId, {})).resolves.toEqual({
        totalShrinkageQuantity: 0,
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('separates removal shrinkage from count corrections', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'adj-1',
          quantity: 4,
          type: 'DECREASE',
          reason: 'SPOILAGE',
          createdAt: new Date('2026-01-01'),
          inventoryItemId: 'inv-1',
        },
        {
          id: 'adj-2',
          quantity: 1,
          type: 'DECREASE',
          reason: 'CYCLE_COUNT',
          createdAt: new Date('2026-01-02'),
          inventoryItemId: 'inv-2',
        },
        {
          id: 'adj-3',
          quantity: 9,
          type: 'DECREASE',
          reason: 'THEFT',
          createdAt: new Date('2026-01-03'),
          inventoryItemId: 'inv-3',
        },
      ]);
      prisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { currentQuantity: 50 } });

      const result = await service.getShrinkage(testTenantId, {});

      expect(result.removalQuantity).toBe(4);
      expect(result.correctionQuantity).toBe(1);
      expect(result.totalShrinkageQuantity).toBe(5);
      expect(result.totalStock).toBe(50);
      expect(result.shrinkageRate).toBeCloseTo(0.1, 10);
      expect(result.adjustments).toHaveLength(3);
    });

    it('handles a null aggregate and a null adjustment reason', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: 'adj-1', quantity: 2, type: 'DECREASE', reason: null, createdAt: new Date() },
      ]);
      prisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { currentQuantity: null } });

      const result = await service.getShrinkage(testTenantId, {});

      expect(result.totalStock).toBe(0);
      expect(result.shrinkageRate).toBe(0);
    });

    it('scopes the raw adjustment query to the tenant, dates and item', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { currentQuantity: 0 } });

      await service.getShrinkage(testTenantId, {
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        inventoryItemId: 'inv-9',
      });

      const [sql] = prisma.$queryRaw.mock.calls[0];
      expect(sql.values).toEqual(
        expect.arrayContaining([
          testTenantId,
          new Date('2026-02-01'),
          new Date('2026-02-28'),
          'inv-9',
        ]),
      );
    });
  });

  describe('getRecipeUsage', () => {
    it('returns the cached recipe usage', async () => {
      cache.get.mockResolvedValue([{ id: 'recipe-1' }]);

      await expect(service.getRecipeUsage(testTenantId, {})).resolves.toEqual([{ id: 'recipe-1' }]);
      expect(prisma.recipe.findMany).not.toHaveBeenCalled();
    });

    it('summarises ingredient cost per recipe and caches the list', async () => {
      prisma.recipe.findMany.mockResolvedValue([
        {
          id: 'recipe-1',
          name: 'Tomato Soup',
          productId: 'prod-1',
          yield: 10,
          cost: null,
          foodCostPercentage: 18,
          items: [
            {
              inventoryItemId: 'inv-1',
              quantity: 2,
              unit: 'kg',
              inventoryItem: { id: 'inv-1', name: 'Tomato', sku: 'T-1', unitCost: 3 },
            },
            {
              inventoryItemId: 'inv-2',
              quantity: 1,
              unit: 'kg',
              inventoryItem: null,
            },
          ],
        },
        {
          id: 'recipe-2',
          name: 'Water',
          productId: null,
          yield: null,
          cost: 1,
          foodCostPercentage: null,
          items: [],
        },
      ]);

      const result = await service.getRecipeUsage(testTenantId, {});

      const [args] = prisma.recipe.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId, isActive: true });

      expect(result[0]).toEqual({
        id: 'recipe-1',
        name: 'Tomato Soup',
        productId: 'prod-1',
        yield: 10,
        cost: 6,
        foodCostPercentage: 18,
        ingredientCount: 2,
        ingredients: [
          {
            inventoryItemId: 'inv-1',
            name: 'Tomato',
            sku: 'T-1',
            quantity: 2,
            unit: 'kg',
            unitCost: 3,
            lineCost: 6,
          },
          {
            inventoryItemId: 'inv-2',
            name: 'Unknown',
            sku: '',
            quantity: 1,
            unit: 'kg',
            unitCost: 0,
            lineCost: 0,
          },
        ],
        totalIngredientCost: 6,
      });
      expect(result[1]).toEqual(
        expect.objectContaining({ id: 'recipe-2', cost: 1, ingredientCount: 0 }),
      );
      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        'inventory-analytics:recipe-usage:{}',
        result,
        300,
      );
    });

    it('prefers the stored recipe cost when present', async () => {
      prisma.recipe.findMany.mockResolvedValue([
        {
          id: 'recipe-1',
          name: 'Tomato Soup',
          productId: 'prod-1',
          yield: 1,
          cost: 99,
          foodCostPercentage: 5,
          items: [
            {
              inventoryItemId: 'inv-1',
              quantity: 1,
              unit: 'kg',
              inventoryItem: { id: 'inv-1', name: 'Tomato', sku: 'T-1', unitCost: 3 },
            },
          ],
        },
      ]);

      const result = await service.getRecipeUsage(testTenantId, {});

      expect(result[0].cost).toBe(99);
      expect(result[0].totalIngredientCost).toBe(3);
    });
  });
});
