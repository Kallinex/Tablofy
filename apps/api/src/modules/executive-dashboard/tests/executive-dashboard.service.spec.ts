import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExecutiveDashboardService } from '../executive-dashboard.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

const Q = {} as never;

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o-1',
  subtotal: '100',
  discount: '0',
  discountAmount: '0',
  serviceCharge: '0',
  taxAmount: '0',
  total: '100',
  paidAmount: null,
  status: 'COMPLETED',
  completedAt: null,
  createdAt: new Date('2025-01-01T10:00:00Z'),
  ...over,
});

describe('ExecutiveDashboardService', () => {
  let service: ExecutiveDashboardService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutiveDashboardService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<ExecutiveDashboardService>(ExecutiveDashboardService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
  });

  describe('getKpi', () => {
    beforeEach(() => {
      prisma.order.count.mockResolvedValue(0);
      prisma.customer.count.mockResolvedValue(0);
    });

    it('should return the cached kpi without querying', async () => {
      const cached = { totalRevenue: 1 };
      cache.get.mockResolvedValue(cached);

      expect(await service.getKpi(testTenantId, Q)).toEqual(cached);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('should count revenue across completed orders in scope only', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ total: '100' }),
        order({ id: 'o-2', total: '50' }),
        order({ id: 'o-3', total: '25', status: 'CANCELLED' }),
      ]);

      const result = await service.getKpi(testTenantId, Q);

      expect(result.totalRevenue).toBe(150);
      expect(result.totalOrders).toBe(3);
    });

    it('should count net revenue from completed orders only', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ total: '100', paidAmount: '90', status: 'COMPLETED' }),
        order({ id: 'o-2', total: '500', paidAmount: '500', status: 'CANCELLED' }),
      ]);

      const result = await service.getKpi(testTenantId, Q);

      expect(result.netRevenue).toBe(90);
    });

    it('should fall back to total when paidAmount is null', async () => {
      prisma.order.findMany.mockResolvedValue([order({ total: '100', paidAmount: null })]);

      const result = await service.getKpi(testTenantId, Q);

      expect(result.netRevenue).toBe(100);
    });

    it('should subtract the discount amount from the subtotal for gross profit', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ subtotal: '100', discountAmount: '20', total: '80' }),
      ]);

      const result = await service.getKpi(testTenantId, Q);

      expect(result.grossProfit).toBe(80);
      expect(result.grossMargin).toBe(100);
      expect(result.operatingMargin).toBe(100);
    });

    it('should report zero margins and averages when there are no orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getKpi(testTenantId, Q);

      expect(result.grossMargin).toBe(0);
      expect(result.operatingMargin).toBe(0);
      expect(result.avgOrderValue).toBe(0);
      expect(result.avgPreparationTime).toBe(0);
    });

    it('should average preparation time over completed orders that have completedAt', async () => {
      const created = new Date('2025-01-01T10:00:00Z');
      prisma.order.findMany.mockResolvedValue([
        order({ createdAt: created, completedAt: new Date('2025-01-01T10:20:00Z') }),
        order({ id: 'o-2', createdAt: created, completedAt: new Date('2025-01-01T10:40:00Z') }),
        order({ id: 'o-3', status: 'COMPLETED', completedAt: null }),
      ]);

      const result = await service.getKpi(testTenantId, Q);

      expect(result.avgPreparationTime).toBe(30 * 60 * 1000);
      expect(result.avgServiceTime).toBe(result.avgPreparationTime);
    });

    it('should return the status counts alongside the totals', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValueOnce(7).mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const result = await service.getKpi(testTenantId, Q);

      expect(result.completedOrders).toBe(7);
      expect(result.cancelledOrders).toBe(2);
      expect(result.refundedOrders).toBe(1);
    });

    it('should alias the average ticket and value to the same figure', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ total: '100' }),
        order({ id: 'o-2', total: '100' }),
      ]);

      const result = await service.getKpi(testTenantId, Q);

      expect(result.avgOrderValue).toBe(100);
      expect(result.avgTicket).toBe(100);
    });

    it('should cache the kpi for 300 seconds', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getKpi(testTenantId, Q);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('exec-dashboard:kpi'),
        result,
        300,
      );
    });
  });

  describe('getTopProducts', () => {
    it('should aggregate quantity and revenue per product, sorted by revenue', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-1', productName: 'Burger', quantity: '2', total: '100' },
        { productId: 'p-1', productName: 'Burger', quantity: '1', total: '50' },
        { productId: 'p-2', productName: 'Cola', quantity: '4', total: '40' },
      ]);

      const result = await service.getTopProducts(testTenantId, Q);

      expect(result[0]).toEqual({
        productId: 'p-1',
        productName: 'Burger',
        totalQuantity: 3,
        totalRevenue: 150,
      });
      expect(result[1].productId).toBe('p-2');
    });

    it('should honour the requested limit', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'a', productName: 'A', quantity: '1', total: '300' },
        { productId: 'b', productName: 'B', quantity: '1', total: '200' },
        { productId: 'c', productName: 'C', quantity: '1', total: '100' },
      ]);

      const result = await service.getTopProducts(testTenantId, { limit: 2 } as never);

      expect(result).toHaveLength(2);
      expect(result[0].productId).toBe('a');
    });

    it('should default the limit to ten', async () => {
      prisma.orderItem.findMany.mockResolvedValue(
        Array.from({ length: 15 }, (_, i) => ({
          productId: `p${i}`,
          productName: `P${i}`,
          quantity: '1',
          total: String(100 - i),
        })),
      );

      const result = await service.getTopProducts(testTenantId, Q);

      expect(result).toHaveLength(10);
    });

    it('should restrict items to completed orders', async () => {
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.getTopProducts(testTenantId, Q);

      expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ status: 'COMPLETED' }),
          }),
        }),
      );
    });
  });

  describe('getTopCategories', () => {
    it('should group product revenue into their menu category', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-1', quantity: '2', total: '100' },
        { productId: 'p-2', quantity: '1', total: '50' },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'p-1', menuCategoryId: 'cat-1' },
        { id: 'p-2', menuCategoryId: 'cat-1' },
      ]);
      prisma.menuCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Mains' }]);

      const result = await service.getTopCategories(testTenantId, Q);

      expect(result).toEqual([
        { categoryId: 'cat-1', categoryName: 'Mains', totalQuantity: 3, totalRevenue: 150 },
      ]);
    });

    it('should bucket products without a category under uncategorized', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-1', quantity: '1', total: '20' },
      ]);
      prisma.product.findMany.mockResolvedValue([{ id: 'p-1', menuCategoryId: null }]);

      const result = await service.getTopCategories(testTenantId, Q);

      expect(result[0]).toEqual({
        categoryId: 'uncategorized',
        categoryName: 'Uncategorized',
        totalQuantity: 1,
        totalRevenue: 20,
      });
    });

    it('should skip the category lookup when no product has a category', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-1', quantity: '1', total: '20' },
      ]);
      prisma.product.findMany.mockResolvedValue([{ id: 'p-1', menuCategoryId: null }]);

      await service.getTopCategories(testTenantId, Q);

      expect(prisma.menuCategory.findMany).not.toHaveBeenCalled();
    });

    it('ranks categories by total revenue descending', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-1', quantity: '1', total: '10' },
        { productId: 'p-2', quantity: '1', total: '90' },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'p-1', menuCategoryId: 'cat-1' },
        { id: 'p-2', menuCategoryId: 'cat-2' },
      ]);
      prisma.menuCategory.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'Low' },
        { id: 'cat-2', name: 'High' },
      ]);

      const result = await service.getTopCategories(testTenantId, Q);

      expect(result.map((category) => category.categoryId)).toEqual(['cat-2', 'cat-1']);
    });
  });

  describe('getTopBranches', () => {
    it('should aggregate and rank branches by revenue', async () => {
      prisma.order.findMany.mockResolvedValue([
        { branchId: 'b-1', total: '100' },
        { branchId: 'b-1', total: '50' },
        { branchId: 'b-2', total: '200' },
      ]);

      const result = await service.getTopBranches(testTenantId, Q);

      expect(result[0]).toEqual({ branchId: 'b-2', totalRevenue: 200, orderCount: 1 });
      expect(result[1]).toEqual({ branchId: 'b-1', totalRevenue: 150, orderCount: 2 });
    });

    it('should bucket orders without a branch as unknown', async () => {
      prisma.order.findMany.mockResolvedValue([{ branchId: null, total: '30' }]);

      const result = await service.getTopBranches(testTenantId, Q);

      expect(result[0].branchId).toBe('unknown');
    });

    it('should count only completed orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.getTopBranches(testTenantId, Q);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: testTenantId, status: 'COMPLETED' }),
        }),
      );
    });
  });

  describe('getTopEmployees', () => {
    it('should aggregate revenue per staff member', async () => {
      prisma.order.findMany.mockResolvedValue([
        { userId: 'u-1', total: '300' },
        { userId: 'u-1', total: '100' },
        { userId: 'u-2', total: '50' },
      ]);

      const result = await service.getTopEmployees(testTenantId, Q);

      expect(result[0]).toEqual({ userId: 'u-1', totalRevenue: 400, orderCount: 2 });
    });

    it('should exclude orders with no assigned staff', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.getTopEmployees(testTenantId, Q);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: { not: null }, status: 'COMPLETED' }),
        }),
      );
    });
  });

  describe('getTopCustomers', () => {
    it('should identify customers by phone first, then email, then anonymous', async () => {
      prisma.order.findMany.mockResolvedValue([
        { customerPhone: '+201', customerEmail: 'a@x.com', total: '100' },
        { customerPhone: null, customerEmail: 'a@x.com', total: '50' },
        { customerPhone: null, customerEmail: null, total: '10' },
      ]);

      const result = await service.getTopCustomers(testTenantId, Q);

      expect(result.map((r: { identifier: string }) => r.identifier)).toEqual([
        '+201',
        'a@x.com',
        'anonymous',
      ]);
      expect(result[1].orderCount).toBe(1);
    });

    it('should count only completed orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.getTopCustomers(testTenantId, Q);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: testTenantId, status: 'COMPLETED' }),
        }),
      );
    });
  });

  describe('getSalesTrend', () => {
    it('should group revenue by calendar day', async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: '1', total: '100', createdAt: new Date('2025-01-01T09:00:00Z') },
        { id: '2', total: '50', createdAt: new Date('2025-01-01T18:00:00Z') },
        { id: '3', total: '75', createdAt: new Date('2025-01-02T09:00:00Z') },
      ]);

      const result = await service.getSalesTrend(testTenantId, Q);

      expect(result).toEqual([
        { date: '2025-01-01', revenue: 150, orderCount: 2 },
        { date: '2025-01-02', revenue: 75, orderCount: 1 },
      ]);
    });

    it('should count only completed orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.getSalesTrend(testTenantId, Q);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: testTenantId, status: 'COMPLETED' }),
        }),
      );
    });

    it('should return an empty trend when there is no sales', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      expect(await service.getSalesTrend(testTenantId, Q)).toEqual([]);
    });
  });

  describe('cache isolation', () => {
    it('should use a distinct cache key per widget', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.customer.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.product.findMany.mockResolvedValue([]);

      await service.getKpi(testTenantId, Q);
      await service.getTopProducts(testTenantId, Q);
      await service.getTopCategories(testTenantId, Q);
      await service.getTopBranches(testTenantId, Q);
      await service.getTopEmployees(testTenantId, Q);
      await service.getTopCustomers(testTenantId, Q);
      await service.getSalesTrend(testTenantId, Q);

      const keys = cache.set.mock.calls.map((c) => c[1]);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('should scope every cache key to the tenant', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.customer.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.getKpi(testTenantId, Q);

      expect(cache.set.mock.calls[0][0]).toBe(testTenantId);
    });
  });
});
