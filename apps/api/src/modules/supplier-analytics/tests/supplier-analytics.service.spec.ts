import { Test, TestingModule } from '@nestjs/testing';
import { SupplierAnalyticsService } from '../supplier-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

describe('SupplierAnalyticsService', () => {
  let service: SupplierAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierAnalyticsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<SupplierAnalyticsService>(SupplierAnalyticsService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
  });

  describe('getPriceVariance', () => {
    it('should run a tenant-scoped parameterized query with correct column names', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.getPriceVariance(testTenantId, { startDate: '2026-01-01' } as never);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(sqlArg.values[0]).toBe(testTenantId);
      expect(sqlArg.values[1]).toBeInstanceOf(Date);
      expect(sqlArg.text).toContain('po."tenantId"');
      expect(sqlArg.text).toContain('po."createdAt"');
      expect(sqlArg.text).toContain('po."supplierDetailId"');
      expect(sqlArg.text).toContain('poi."inventoryItemId"');
      expect(sqlArg.text).toContain('poi."unitPrice"');
      expect(sqlArg.text).toContain('poi."purchaseOrderId"');
      expect(sqlArg.text).toContain('sd."supplierId"');
      expect(sqlArg.text).toContain('ii.name');
      expect(sqlArg.text).not.toContain('tenant_id');
      expect(sqlArg.text).not.toContain('inventory_item_id');
      expect(sqlArg.text).not.toContain('purchase_order_id');
      expect(sqlArg.text).not.toContain('company_name');
    });

    it('should bind supplierId filter as a parameter', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.getPriceVariance(testTenantId, { supplierId: 'supplier-detail-1' } as never);

      const sqlArg = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(sqlArg.values).toContain('supplier-detail-1');
      expect(sqlArg.text).toContain('AND');
    });
  });

  describe('getPurchaseTrends', () => {
    it('should run tenant-scoped parameterized queries and aggregate results', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { period: '2026-01', totalSpend: 100, orderCount: 2n },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { supplierDetailId: 'sd-1', supplierName: 'Vendor A', totalSpend: 100, orderCount: 2n },
      ]);

      const result = (await service.getPurchaseTrends(testTenantId, {} as never)) as {
        trends: unknown[];
        totalSpend: number;
        totalOrders: number;
        bySupplier: Array<{ supplierId: string; supplierName: string }>;
      };

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      const first = (prisma.$queryRaw as jest.Mock).mock.calls[0][0] as {
        text: string;
        values: unknown[];
      };
      expect(first.values[0]).toBe(testTenantId);
      expect(first.text).toContain('"tenantId"');
      expect(first.text).toContain('TO_CHAR("createdAt"');

      const second = (prisma.$queryRaw as jest.Mock).mock.calls[1][0] as {
        text: string;
        values: unknown[];
      };
      expect(second.values[0]).toBe(testTenantId);
      expect(second.text).toContain('po."tenantId"');
      expect(second.text).toContain('po."supplierDetailId"');

      expect(result.trends).toHaveLength(1);
      expect(result.totalSpend).toBe(100);
      expect(result.totalOrders).toBe(2);
      expect(result.bySupplier[0].supplierName).toBe('Vendor A');
    });
  });

  describe('caching', () => {
    it('should return cached getPriceVariance result without querying', async () => {
      cache.get.mockResolvedValueOnce({ items: [], totalItemsWithMultipleSuppliers: 0 });

      const result = await service.getPriceVariance(testTenantId, {} as never);

      expect(result).toEqual({ items: [], totalItemsWithMultipleSuppliers: 0 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
