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

    it('should run a tenant-scoped parameterized cohort query', async () => {
      cache.get.mockResolvedValue(null);
      prisma.customer.count.mockResolvedValue(10);
      prisma.order.groupBy.mockResolvedValue([{ customerPhone: 'p1', _count: { id: 2 } }]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { cohortMonth: '2026-01', totalCustomers: 2, retainedCustomers: 1 },
      ]);

      await service.getRetention(testTenantId, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(sqlArg.values[0]).toBe(testTenantId);
      expect(sqlArg.values[1]).toBe(testTenantId);
      expect(sqlArg.values[2]).toBeInstanceOf(Date);
      expect(sqlArg.values[3]).toBeInstanceOf(Date);
      expect(sqlArg.text).toContain('"tenantId"');
      expect(sqlArg.text).toContain('"customerPhone"');
      expect(sqlArg.text).toContain('"cohortMonth"');
      expect(sqlArg.text).not.toContain('tenant_id');
    });
  });

  describe('getChurn', () => {
    it('should bind tenant and date as parameters in the inactivity query', async () => {
      cache.get.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ count: 3 }]);

      const result = await service.getChurn(testTenantId, {
        startDate: '2026-01-01',
      } as never);

      expect(result.churnedByInactivity).toBe(3);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(sqlArg.values[0]).toBe(testTenantId);
      expect(sqlArg.values[1]).toBeInstanceOf(Date);
      expect(sqlArg.text).toContain('"tenantId"');
      expect(sqlArg.text).not.toContain('2026-01-01');
    });
  });

  describe('getVisitFrequency', () => {
    it('should run a tenant-scoped parameterized frequency query', async () => {
      cache.get.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValueOnce([
        { customerPhone: 'p1', orderCount: 4 },
        { customerPhone: 'p2', orderCount: 2 },
      ]);

      const result = await service.getVisitFrequency(testTenantId, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      expect(result.totalActiveCustomers).toBe(2);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(sqlArg.values[0]).toBe(testTenantId);
      expect(sqlArg.values[1]).toBeInstanceOf(Date);
      expect(sqlArg.values[2]).toBeInstanceOf(Date);
      expect(sqlArg.text).toContain('"orderCount"');
      expect(sqlArg.text).not.toContain('order_count');
    });
  });

  describe('getRfmSegmentation', () => {
    it('should run a tenant-scoped parameterized RFM query', async () => {
      cache.get.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValueOnce([
        { customerPhone: 'p1', recency: 3, frequency: 5, monetary: 120 },
      ]);

      const result = await service.getRfmSegmentation(testTenantId, {} as never);

      expect(result.segments.length).toBeGreaterThan(0);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(sqlArg.values[0]).toBe(testTenantId);
      expect(sqlArg.text).toContain('"customerPhone"');
    });

    it('should return cached result without querying', async () => {
      cache.get.mockResolvedValueOnce({ segments: [], customers: [] });

      const result = await service.getRfmSegmentation(testTenantId, {} as never);

      expect(result).toEqual({ segments: [], customers: [] });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('getWalletActivity', () => {
    it('should run a tenant-scoped parameterized trend query', async () => {
      cache.get.mockResolvedValue(null);
      prisma.walletTransaction.findMany.mockResolvedValue([
        { type: 'RECHARGE', amount: 10, createdAt: new Date(), referenceType: null },
      ]);
      prisma.wallet.aggregate.mockResolvedValue({ _avg: { balance: 5 }, _sum: { balance: 15 } });
      prisma.$queryRaw.mockResolvedValueOnce([{ date: '2026-01-01', credits: 10, debits: 0 }]);

      const result = await service.getWalletActivity(testTenantId, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      expect(result.totalCredits).toBe(10);
      expect(result.trend).toHaveLength(1);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(sqlArg.values[0]).toBe(testTenantId);
      expect(sqlArg.values[1]).toBeInstanceOf(Date);
      expect(sqlArg.values[2]).toBeInstanceOf(Date);
      expect(sqlArg.text).toContain('wallet_transactions');
    });
  });
});
