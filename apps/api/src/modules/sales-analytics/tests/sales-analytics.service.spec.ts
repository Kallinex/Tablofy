import { Test, TestingModule } from '@nestjs/testing';
import { SalesAnalyticsService } from '../sales-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('SalesAnalyticsService', () => {
  let service: SalesAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesAnalyticsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<SalesAnalyticsService>(SalesAnalyticsService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
  });

  describe('getOverview', () => {
    it('should return cached result when available', async () => {
      const cached = [{ period: '2025-01-01', revenue: 100, orderCount: 5 }];
      cache.get.mockResolvedValue(cached);

      const result = await service.getOverview(testTenantId, { groupBy: 'DAILY' } as never);

      expect(result).toEqual(cached);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('should compute overview from orders', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([
        { createdAt: new Date('2025-01-01T10:00:00Z'), total: 100, id: '1' },
        { createdAt: new Date('2025-01-01T14:00:00Z'), total: 50, id: '2' },
        { createdAt: new Date('2025-01-02T10:00:00Z'), total: 75, id: '3' },
      ]);

      const result = await service.getOverview(testTenantId, { groupBy: 'DAILY' } as never);

      expect(result).toHaveLength(2);
      expect(result[0].revenue).toBe(150);
      expect(result[0].orderCount).toBe(2);
      expect(result[1].revenue).toBe(75);
      expect(result[1].orderCount).toBe(1);
    });

    it('should group by MONTHLY', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([
        { createdAt: new Date('2025-01-15T10:00:00Z'), total: 200, id: '1' },
        { createdAt: new Date('2025-02-10T10:00:00Z'), total: 300, id: '2' },
      ]);

      const result = await service.getOverview(testTenantId, { groupBy: 'MONTHLY' } as never);

      expect(result).toHaveLength(2);
      expect(result[0].revenue).toBe(200);
      expect(result[1].revenue).toBe(300);
    });

    it('should filter by branchId', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([]);

      await service.getOverview(testTenantId, { branchId: 'branch-1' } as never);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ branchId: 'branch-1' }),
        }),
      );
    });

    it('should cache the result', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([]);

      await service.getOverview(testTenantId, { groupBy: 'DAILY' } as never);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('sales:overview:'),
        expect.any(Array),
        300,
      );
    });
  });

  describe('getRevenueComparison', () => {
    it('should return cached result', async () => {
      const cached = { period1: { revenue: 1000 }, period2: { revenue: 1200 } };
      cache.get.mockResolvedValue(cached);

      const result = await service.getRevenueComparison(testTenantId, {} as never);

      expect(result).toEqual(cached);
    });

    it('should compute revenue comparison', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany
        .mockResolvedValueOnce([{ total: 200 }, { total: 300 }])
        .mockResolvedValueOnce([{ total: 400 }, { total: 500 }]);

      const result = await service.getRevenueComparison(testTenantId, {
        period1Start: '2025-01-01',
        period1End: '2025-01-31',
        period2Start: '2025-02-01',
        period2End: '2025-02-28',
      } as never);

      expect(result).toHaveProperty('period1');
      expect(result).toHaveProperty('period2');
      expect(result.period1.revenue).toBe(500);
      expect(result.period2.revenue).toBe(900);
    });
  });
});
