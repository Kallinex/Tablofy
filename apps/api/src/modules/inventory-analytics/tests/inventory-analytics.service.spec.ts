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

  describe('getValuation', () => {
    it('should return cached result', async () => {
      const cached = [{ method: 'FIFO', totalValue: 5000 }];
      cache.get.mockResolvedValue(cached);

      const result = await service.getValuation(testTenantId, {} as never);

      expect(result).toEqual(cached);
      expect(prisma.inventoryValuation.groupBy).not.toHaveBeenCalled();
    });

    it('should compute valuation', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryValuation.groupBy.mockResolvedValue([
        { method: 'FIFO', _sum: { totalValue: 5000, quantity: 100 }, _count: 10 },
      ]);

      const result = await service.getValuation(testTenantId, {} as never);

      expect(result).toHaveLength(1);
      expect(result[0].method).toBe('FIFO');
      expect(result[0].totalValue).toBe(5000);
    });

    it('should cache result', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryValuation.groupBy.mockResolvedValue([]);

      await service.getValuation(testTenantId, {} as never);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('inventory-analytics:valuation:'),
        [],
        300,
      );
    });
  });

  describe('getTurnover', () => {
    it('should return cached result', async () => {
      const cached = { cogs: 10000, turnoverRatio: 2.5 };
      cache.get.mockResolvedValue(cached);

      const result = await service.getTurnover(testTenantId, {} as never);

      expect(result).toEqual(cached);
    });

    it('should compute turnover', async () => {
      cache.get.mockResolvedValue(null);
      prisma.consumptionRecord.aggregate.mockResolvedValue({
        _sum: { totalCost: 10000 },
      } as never);
      prisma.inventoryItem.findMany.mockResolvedValue([
        { currentQuantity: 100, averageCost: 20, unitCost: 25 },
      ]);

      const result = await service.getTurnover(testTenantId, {} as never);

      expect(result.cogs).toBe(10000);
      expect(result.turnoverRatio).toBeGreaterThan(0);
    });
  });
});
