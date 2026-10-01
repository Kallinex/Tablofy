import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ForecastingService } from '../forecasting.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { ForecastingGateway } from '../forecasting.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

const TEST_USER = 'user-1';
const ITEM = { id: 'item-1', tenantId: testTenantId };

describe('ForecastingService', () => {
  let service: ForecastingService;
  let prisma: MockPrisma;
  let cache: MockCache;
  let audit: ReturnType<typeof createMockAuditLogs>;
  let gateway: { broadcastForecastUpdate: jest.Mock; broadcastReorderUpdate: jest.Mock };

  beforeAll(async () => {
    gateway = { broadcastForecastUpdate: jest.fn(), broadcastReorderUpdate: jest.fn() };
    audit = createMockAuditLogs();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastingService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: audit },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: { add: jest.fn(), addBulk: jest.fn() } },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: ForecastingGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<ForecastingService>(ForecastingService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
  });

  describe('generateForecast', () => {
    it('should throw when the inventory item is missing', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.generateForecast({ inventoryItemId: 'missing' } as never, testTenantId, TEST_USER),
      ).rejects.toThrow(NotFoundException);
    });

    it('should look up the item scoped to the tenant and not soft-deleted', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);
      prisma.inventoryForecast.create.mockResolvedValue({ id: 'fc-1' });

      await service.generateForecast(
        { inventoryItemId: 'item-1' } as never,
        testTenantId,
        TEST_USER,
      );

      expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
        where: { id: 'item-1', tenantId: testTenantId, deletedAt: null },
      });
    });

    it('should default to DAILY period and MOVING_AVERAGE method', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);
      prisma.inventoryForecast.create.mockResolvedValue({ id: 'fc-1' });

      await service.generateForecast(
        { inventoryItemId: 'item-1' } as never,
        testTenantId,
        TEST_USER,
      );

      expect(prisma.inventoryForecast.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ period: 'DAILY', method: 'MOVING_AVERAGE' }),
        }),
      );
    });

    it('should store a null confidence when there is no consumption history', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);
      prisma.inventoryForecast.create.mockResolvedValue({ id: 'fc-1' });

      await service.generateForecast(
        { inventoryItemId: 'item-1' } as never,
        testTenantId,
        TEST_USER,
      );

      const call = prisma.inventoryForecast.create.mock.calls[0][0];
      expect(call.data.confidence).toBeUndefined();
    });

    it('should record the aggregation window and data point count in factors', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.consumptionRecord.findMany.mockResolvedValue([
        { date: new Date('2025-01-01T00:00:00Z'), quantity: 4 },
        { date: new Date('2025-01-02T00:00:00Z'), quantity: 6 },
      ]);
      prisma.inventoryForecast.create.mockResolvedValue({ id: 'fc-1' });

      await service.generateForecast(
        { inventoryItemId: 'item-1', period: 'WEEKLY' } as never,
        testTenantId,
        TEST_USER,
      );

      const factors = prisma.inventoryForecast.create.mock.calls[0][0].data.factors as {
        dataPoints: number;
        aggregationPeriod: string;
      };
      expect(factors.dataPoints).toBe(2);
      expect(factors.aggregationPeriod).toBe('WEEKLY');
    });

    it('should audit, invalidate the item cache and broadcast the new forecast', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);
      prisma.inventoryForecast.create.mockResolvedValue({ id: 'fc-9' });

      await service.generateForecast(
        { inventoryItemId: 'item-1' } as never,
        testTenantId,
        TEST_USER,
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FORECAST_GENERATED', resourceId: 'fc-9' }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'forecasts:item:item-1');
      expect(gateway.broadcastForecastUpdate).toHaveBeenCalledWith(
        testTenantId,
        'forecast.created',
        expect.objectContaining({ id: 'fc-9' }),
      );
    });
  });

  describe('getForecastsForItem', () => {
    it('should throw when the item is missing', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.getForecastsForItem('nope', testTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the cached page without querying', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      const cached = { data: [], meta: { total: 0 } };
      cache.get.mockResolvedValue(cached);

      expect(await service.getForecastsForItem('item-1', testTenantId)).toEqual(cached);
      expect(prisma.inventoryForecast.findMany).not.toHaveBeenCalled();
    });

    it('should return correct pagination metadata', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.inventoryForecast.findMany.mockResolvedValue([{ id: 'fc-1' }, { id: 'fc-2' }]);
      prisma.inventoryForecast.count.mockResolvedValue(45);

      const result = await service.getForecastsForItem('item-1', testTenantId, {
        page: 2,
        limit: 20,
      } as never);

      expect(result.meta).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
      expect(prisma.inventoryForecast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });

    it('should default to page 1 with a limit of 20', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.inventoryForecast.findMany.mockResolvedValue([]);
      prisma.inventoryForecast.count.mockResolvedValue(0);

      const result = await service.getForecastsForItem('item-1', testTenantId);

      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('should apply period and date-range filters', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.inventoryForecast.findMany.mockResolvedValue([]);
      prisma.inventoryForecast.count.mockResolvedValue(0);

      await service.getForecastsForItem('item-1', testTenantId, {
        period: 'WEEKLY',
        fromDate: new Date('2025-01-01'),
        toDate: new Date('2025-02-01'),
      } as never);

      expect(prisma.inventoryForecast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            period: 'WEEKLY',
            forecastDate: { gte: new Date('2025-01-01'), lte: new Date('2025-02-01') },
          }),
        }),
      );
    });

    it('should cache the page for 120 seconds', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(ITEM);
      prisma.inventoryForecast.findMany.mockResolvedValue([]);
      prisma.inventoryForecast.count.mockResolvedValue(0);

      const result = await service.getForecastsForItem('item-1', testTenantId);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('forecasts:item:item-1'),
        result,
        120,
      );
    });
  });

  describe('getReorderRecommendations', () => {
    const item = (over: Record<string, unknown> = {}) => ({
      id: 'item-1',
      name: 'Tomato',
      sku: 'TOM-1',
      currentQuantity: 10,
      minStock: 5,
      maxStock: 50,
      reorderLevel: 12,
      unit: null,
      category: null,
      ...over,
    });

    it('should return the cached recommendations', async () => {
      const cached = { data: [], summary: {} };
      cache.get.mockResolvedValue(cached);

      expect(await service.getReorderRecommendations(testTenantId)).toEqual(cached);
      expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    });

    it('should only consider active, non-deleted tenant items', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      await service.getReorderRecommendations(testTenantId);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: testTenantId, deletedAt: null, isActive: true },
        }),
      );
    });

    it('should flag OUT_OF_STOCK when stock hits zero', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ currentQuantity: 0 })]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getReorderRecommendations(testTenantId);

      expect(result.data[0].status).toBe('OUT_OF_STOCK');
      expect(result.summary.outOfStock).toBe(1);
      expect(result.summary.ok).toBe(0);
    });

    it('should flag NEEDS_REORDER when stock is at or below the reorder level', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ currentQuantity: 12 })]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getReorderRecommendations(testTenantId);

      expect(result.data[0].status).toBe('NEEDS_REORDER');
      expect(result.summary.needsReorder).toBe(1);
    });

    it('should flag OK above the reorder level', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ currentQuantity: 40 })]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getReorderRecommendations(testTenantId);

      expect(result.data[0].status).toBe('OK');
      expect(result.summary.ok).toBe(1);
    });

    it('should suggest top-up to maxStock when both bounds are set', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ currentQuantity: 30 })]);
      prisma.consumptionRecord.findMany.mockResolvedValue([{ quantity: 60 }]);

      const result = await service.getReorderRecommendations(testTenantId);

      expect(result.data[0].suggestedQuantity).toBe(20);
    });

    it('should never suggest a negative quantity when stock exceeds maxStock', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        item({ currentQuantity: 999, reorderLevel: 2000, minStock: 5, maxStock: 50 }),
      ]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getReorderRecommendations(testTenantId);

      expect(result.data[0].suggestedQuantity).toBe(0);
    });

    it('should fall back to seven days of consumption without a maxStock', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        item({ maxStock: null, minStock: null, currentQuantity: 4 }),
      ]);
      prisma.consumptionRecord.findMany.mockResolvedValue([{ quantity: 30 }]);

      const result = await service.getReorderRecommendations(testTenantId);

      expect(result.data[0].averageDailyConsumption).toBe(1);
      expect(result.data[0].suggestedQuantity).toBe(7);
    });

    it('should treat null stock thresholds as absent rather than zero', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        item({ minStock: null, maxStock: null, reorderLevel: null, currentQuantity: 5 }),
      ]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getReorderRecommendations(testTenantId);

      expect(result.data[0].minStock).toBeNull();
      expect(result.data[0].status).toBe('OK');
      expect(result.data[0].suggestedQuantity).toBe(0);
    });

    it('should cache recommendations for 60 seconds', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getReorderRecommendations(testTenantId);

      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'reorder:recommendations', result, 60);
    });
  });

  describe('generateReorderSuggestions', () => {
    const item = (over: Record<string, unknown> = {}) => ({
      id: 'item-1',
      currentQuantity: 10,
      minStock: 5,
      maxStock: 50,
      reorderLevel: 12,
      ...over,
    });

    it('should skip createMany when nothing needs reordering', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        item({ currentQuantity: 40, reorderLevel: 12 }),
      ]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.generateReorderSuggestions(testTenantId, TEST_USER);

      expect(result).toEqual({ count: 0 });
      expect(prisma.reorderSuggestion.createMany).not.toHaveBeenCalled();
    });

    it('should create a CRITICAL suggestion for out-of-stock items', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ currentQuantity: 0 })]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);
      prisma.reorderSuggestion.createMany.mockResolvedValue({ count: 1 });

      await service.generateReorderSuggestions(testTenantId, TEST_USER);

      const data = prisma.reorderSuggestion.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(1);
      expect(data[0].priority).toBe('CRITICAL');
      expect(data[0].status).toBe('PENDING');
    });

    it('should mark HALF_REORDER_LEVEL as HIGH and the rest MEDIUM', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        item({ id: 'a', currentQuantity: 5, reorderLevel: 12 }),
        item({ id: 'b', currentQuantity: 11, reorderLevel: 12 }),
      ]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);
      prisma.reorderSuggestion.createMany.mockResolvedValue({ count: 2 });

      await service.generateReorderSuggestions(testTenantId, TEST_USER);

      const data = prisma.reorderSuggestion.createMany.mock.calls[0][0].data;
      expect(
        data.find((d: { inventoryItemId: string }) => d.inventoryItemId === 'a').priority,
      ).toBe('HIGH');
      expect(
        data.find((d: { inventoryItemId: string }) => d.inventoryItemId === 'b').priority,
      ).toBe('MEDIUM');
    });

    it('should compute safety stock from lead time and daily consumption', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ maxStock: null })]);
      prisma.consumptionRecord.findMany.mockResolvedValue([{ quantity: 60 }]);
      prisma.reorderSuggestion.createMany.mockResolvedValue({ count: 1 });

      await service.generateReorderSuggestions(testTenantId, TEST_USER);

      const data = prisma.reorderSuggestion.createMany.mock.calls[0][0].data[0];
      expect(Number(data.safetyStock)).toBe(1);
      expect(data.leadTimeDays).toBe(1);
    });

    it('should omit safety stock clamping for zero consumption', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ maxStock: null })]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);
      prisma.reorderSuggestion.createMany.mockResolvedValue({ count: 1 });

      await service.generateReorderSuggestions(testTenantId, TEST_USER);

      const data = prisma.reorderSuggestion.createMany.mock.calls[0][0].data[0];
      expect(Number(data.safetyStock)).toBe(0);
      expect(data.suggestedQuantity).toEqual(new Prisma.Decimal(0));
    });

    it('should still audit and broadcast when zero suggestions were produced', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      await service.generateReorderSuggestions(testTenantId, TEST_USER);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REORDER_SUGGESTIONS_GENERATED',
          newValues: { count: 0 },
        }),
      );
      expect(gateway.broadcastReorderUpdate).toHaveBeenCalledWith(
        testTenantId,
        'reorder.suggestions_generated',
        { count: 0 },
      );
    });

    it('should invalidate reorder and forecast cache patterns', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      await service.generateReorderSuggestions(testTenantId, TEST_USER);

      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'reorder:*');
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'forecasts:*');
    });
  });

  describe('getReorderSuggestions', () => {
    it('should paginate and cache by page and limit', async () => {
      prisma.reorderSuggestion.findMany.mockResolvedValue([]);
      prisma.reorderSuggestion.count.mockResolvedValue(5);

      const result = await service.getReorderSuggestions(testTenantId, 2, 2);

      expect(result.meta).toEqual({
        total: 5,
        page: 2,
        limit: 2,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
      expect(prisma.reorderSuggestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 2, take: 2 }),
      );
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'reorder:suggestions:2:2', result, 60);
    });

    it('should scope the query to the tenant', async () => {
      prisma.reorderSuggestion.findMany.mockResolvedValue([]);
      prisma.reorderSuggestion.count.mockResolvedValue(0);

      await service.getReorderSuggestions(testTenantId);

      expect(prisma.reorderSuggestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: testTenantId } }),
      );
    });
  });

  describe('getReorderSuggestion', () => {
    it('should throw when the suggestion is missing', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue(null);

      await expect(service.getReorderSuggestion('x', testTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return and cache a found suggestion', async () => {
      const suggestion = { id: 'rs-1', status: 'PENDING' };
      prisma.reorderSuggestion.findFirst.mockResolvedValue(suggestion);

      const result = await service.getReorderSuggestion('rs-1', testTenantId);

      expect(result).toEqual(suggestion);
      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        'reorder:suggestion:rs-1',
        suggestion,
        120,
      );
    });
  });

  describe('approveSuggestion', () => {
    it('should throw when the suggestion is missing', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue(null);

      await expect(service.approveSuggestion('x', TEST_USER, testTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject approving a suggestion that is not PENDING', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue({ id: 'rs-1', status: 'APPROVED' });

      await expect(service.approveSuggestion('rs-1', TEST_USER, testTenantId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.reorderSuggestion.update).not.toHaveBeenCalled();
    });

    it('should approve, record the approver and broadcast', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue({
        id: 'rs-1',
        status: 'PENDING',
        notes: null,
      });
      prisma.reorderSuggestion.update.mockResolvedValue({ id: 'rs-1', status: 'APPROVED' });

      const result = await service.approveSuggestion('rs-1', TEST_USER, testTenantId);

      expect(result).toEqual({ id: 'rs-1', status: 'APPROVED' });
      expect(prisma.reorderSuggestion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rs-1' },
          data: expect.objectContaining({ status: 'APPROVED', approvedById: TEST_USER }),
        }),
      );
      expect(gateway.broadcastReorderUpdate).toHaveBeenCalledWith(
        testTenantId,
        'reorder.suggestion_approved',
        expect.objectContaining({ id: 'rs-1' }),
      );
    });

    it('should overwrite existing notes when the dto supplies them', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue({
        id: 'rs-1',
        status: 'PENDING',
        notes: 'old',
      });
      prisma.reorderSuggestion.update.mockResolvedValue({ id: 'rs-1' });

      await service.approveSuggestion('rs-1', TEST_USER, testTenantId, { notes: 'new' } as never);

      expect(prisma.reorderSuggestion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ notes: 'new' }) }),
      );
    });

    it('should preserve existing notes when the dto omits them', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue({
        id: 'rs-1',
        status: 'PENDING',
        notes: 'old',
      });
      prisma.reorderSuggestion.update.mockResolvedValue({ id: 'rs-1' });

      await service.approveSuggestion('rs-1', TEST_USER, testTenantId);

      expect(prisma.reorderSuggestion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ notes: 'old' }) }),
      );
    });
  });

  describe('completeSuggestion', () => {
    it('should reject completing a suggestion that is not APPROVED', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue({ id: 'rs-1', status: 'PENDING' });

      await expect(service.completeSuggestion('rs-1', TEST_USER, testTenantId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.reorderSuggestion.update).not.toHaveBeenCalled();
    });

    it('should reject completing an already COMPLETED suggestion', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue({ id: 'rs-1', status: 'COMPLETED' });

      await expect(service.completeSuggestion('rs-1', TEST_USER, testTenantId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should complete an APPROVED suggestion and audit it', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue({
        id: 'rs-1',
        status: 'APPROVED',
        notes: null,
      });
      prisma.reorderSuggestion.update.mockResolvedValue({ id: 'rs-1', status: 'COMPLETED' });

      const result = await service.completeSuggestion('rs-1', TEST_USER, testTenantId);

      expect(result).toEqual({ id: 'rs-1', status: 'COMPLETED' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REORDER_SUGGESTION_COMPLETED' }),
      );
      expect(gateway.broadcastReorderUpdate).toHaveBeenCalledWith(
        testTenantId,
        'reorder.suggestion_completed',
        expect.objectContaining({ id: 'rs-1' }),
      );
    });
  });

  describe('tenant isolation', () => {
    it('should never approve a suggestion belonging to another tenant', async () => {
      prisma.reorderSuggestion.findFirst.mockResolvedValue(null);

      await expect(service.approveSuggestion('rs-1', TEST_USER, 'tenant-2')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.reorderSuggestion.findFirst).toHaveBeenCalledWith({
        where: { id: 'rs-1', tenantId: 'tenant-2' },
      });
    });
  });
});
