import { Test, TestingModule } from '@nestjs/testing';
import { CustomerAnalyticsService } from '../customer-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('CustomerAnalyticsService', () => {
  let service: CustomerAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerAnalyticsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<CustomerAnalyticsService>(CustomerAnalyticsService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
  });

  describe('getOverview', () => {
    it('should return cached result', async () => {
      const cached = { totalCustomers: 100, newCustomers: 10 };
      cache.get.mockResolvedValue(cached);

      const result = await service.getOverview(testTenantId, {} as never);

      expect(result).toEqual(cached);
      expect(prisma.customer.count).not.toHaveBeenCalled();
    });

    it('should compute customer overview', async () => {
      cache.get.mockResolvedValue(null);
      prisma.customer.count.mockResolvedValue(50);
      prisma.customer.groupBy.mockResolvedValue([
        { status: 'ACTIVE', _count: 30 },
        { status: 'INACTIVE', _count: 15 },
        { status: 'BLOCKED', _count: 5 },
      ]);

      const result = await service.getOverview(testTenantId, {} as never);

      expect(result.totalCustomers).toBe(50);
      expect(result.activeCustomers).toBe(30);
      expect(result.inactiveCustomers).toBe(15);
      expect(result.blockedCustomers).toBe(5);
      expect(result.statusBreakdown).toHaveLength(3);
    });

    it('should handle empty status counts', async () => {
      cache.get.mockResolvedValue(null);
      prisma.customer.count.mockResolvedValue(0);
      prisma.customer.groupBy.mockResolvedValue([]);

      const result = await service.getOverview(testTenantId, {} as never);

      expect(result.activeCustomers).toBe(0);
      expect(result.inactiveCustomers).toBe(0);
      expect(result.blockedCustomers).toBe(0);
    });

    it('should cache computed result', async () => {
      cache.get.mockResolvedValue(null);
      prisma.customer.count.mockResolvedValue(10);
      prisma.customer.groupBy.mockResolvedValue([{ status: 'ACTIVE', _count: 8 }]);

      await service.getOverview(testTenantId, {} as never);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('customer-analytics:overview:'),
        expect.any(Object),
        300,
      );
    });
  });

  describe('getRetention', () => {
    it('should return retention data', async () => {
      cache.get.mockResolvedValue(null);
      prisma.customer.count.mockResolvedValue(100);
      prisma.order.groupBy.mockResolvedValue([]);

      const result = await service.getRetention(testTenantId, {} as never);

      expect(result).toHaveProperty('retentionRate');
      expect(result).toHaveProperty('cohortAnalysis');
    });
  });
});
