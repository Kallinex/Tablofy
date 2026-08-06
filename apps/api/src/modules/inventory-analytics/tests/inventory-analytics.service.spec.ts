import { Test, TestingModule } from '@nestjs/testing';
import { InventoryAnalyticsService } from '../inventory-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('InventoryAnalyticsService', () => {
  let service: InventoryAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;

  const fakeItem = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `Item ${id}`,
    sku: `SKU-${id}`,
    currentQuantity: 10,
    unitCost: 5,
    updatedAt: new Date('2020-01-01'),
    ...overrides,
  });

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
    jest.clearAllMocks();
  });

  describe('getDeadStock', () => {
    it('should resolve latest movement with a single groupBy, not per-item queries', async () => {
      const items = [
        fakeItem('item-1', { updatedAt: new Date('2020-01-01') }),
        fakeItem('item-2', { updatedAt: new Date('2020-01-01') }),
      ];
      prisma.inventoryItem.findMany.mockResolvedValue(items);
      prisma.stockMovement.groupBy.mockResolvedValue([
        { inventoryItemId: 'item-1', _max: { createdAt: new Date('2020-01-01') } },
        { inventoryItemId: 'item-2', _max: { createdAt: new Date('2020-01-01') } },
      ]);

      const result = await service.getDeadStock(testTenantId, {} as never);

      expect(prisma.stockMovement.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['inventoryItemId'],
          where: expect.objectContaining({ tenantId: testTenantId }),
        }),
      );
      expect(prisma.stockMovement.findFirst).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(2);
    });
  });

  describe('getClassification', () => {
    it('should resolve consumption counts with a single groupBy, not per-item counts', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([fakeItem('item-1'), fakeItem('item-2')]);
      prisma.consumptionRecord.groupBy.mockResolvedValue([
        { inventoryItemId: 'item-1', _count: 12 },
        { inventoryItemId: 'item-2', _count: 3 },
      ]);

      const result = await service.getClassification(testTenantId, {} as never);

      expect(prisma.consumptionRecord.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['inventoryItemId'],
          where: expect.objectContaining({ tenantId: testTenantId }),
        }),
      );
      expect(prisma.consumptionRecord.count).not.toHaveBeenCalled();
      expect(result.fastMoving.count).toBe(1);
      expect(result.slowMoving.count).toBe(1);
    });
  });

  describe('getForecastAccuracy', () => {
    it('should resolve actual consumption with a single groupBy, not per-forecast aggregates', async () => {
      const forecastDate = new Date('2026-07-01');
      prisma.inventoryForecast.findMany.mockResolvedValue([
        {
          id: 'fc-1',
          inventoryItemId: 'item-1',
          forecastDate,
          quantity: 10,
          method: 'SMA',
        },
      ]);
      prisma.consumptionRecord.groupBy.mockResolvedValue([
        {
          inventoryItemId: 'item-1',
          date: forecastDate,
          _sum: { quantity: 8 },
        },
      ]);

      const result = await service.getForecastAccuracy(testTenantId, {} as never);

      expect(prisma.consumptionRecord.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['inventoryItemId', 'date'],
          where: expect.objectContaining({ tenantId: testTenantId }),
        }),
      );
      expect(prisma.consumptionRecord.aggregate).not.toHaveBeenCalled();
      expect(result.forecasts[0].actualQuantity).toBe(8);
      expect(result.forecasts[0].accuracyPercentage).toBe(80);
    });
  });

  describe('getStockAging', () => {
    it('should resolve latest movement with a single groupBy, not per-item queries', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([fakeItem('item-1'), fakeItem('item-2')]);
      prisma.stockMovement.groupBy.mockResolvedValue([
        { inventoryItemId: 'item-1', _max: { createdAt: new Date('2026-07-01') } },
        { inventoryItemId: 'item-2', _max: { createdAt: new Date('2026-07-01') } },
      ]);

      const result = await service.getStockAging(testTenantId, {} as never);

      expect(prisma.stockMovement.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.stockMovement.findFirst).not.toHaveBeenCalled();
      expect(result).toHaveLength(5);
    });
  });

  describe('getShrinkage', () => {
    it('should run a tenant-scoped parameterized query with correct column names', async () => {
      prisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { currentQuantity: 100 } });
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'adj-1',
          quantity: 5,
          type: 'DECREASE',
          reason: 'SPOILAGE',
          createdAt: new Date(),
          inventoryItemId: 'item-1',
        },
      ]);

      const result = await service.getShrinkage(testTenantId, {} as never);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(sqlArg.values[0]).toBe(testTenantId);
      expect(sqlArg.text).toContain('"tenantId"');
      expect(sqlArg.text).toContain('"createdAt"');
      expect(sqlArg.text).toContain('"inventoryItemId"');
      expect(sqlArg.text).not.toContain('created_at');
      expect(sqlArg.text).not.toContain('inventory_item_id');
      expect(result.removalQuantity).toBe(5);
    });
  });
});
