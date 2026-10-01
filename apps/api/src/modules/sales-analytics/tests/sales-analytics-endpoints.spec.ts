import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SalesAnalyticsService } from '../sales-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';

const TENANT = 'tenant-1';

describe('SalesAnalyticsService report endpoints', () => {
  let service: SalesAnalyticsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cacheService: { get: jest.Mock; set: jest.Mock };
  const query = {} as never;

  const order = (overrides: Record<string, unknown> = {}) => ({
    id: 'o1',
    createdAt: new Date('2026-01-05T10:00:00Z'),
    total: 100,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      menuCategory: { findMany: jest.fn().mockResolvedValue([]) },
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesAnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: CacheService, useValue: cacheService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<SalesAnalyticsService>(SalesAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getOverview grouping', () => {
    it('groups hourly using the local hour', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ id: 'a', createdAt: new Date(2026, 0, 5, 9) }),
        order({ id: 'b', createdAt: new Date(2026, 0, 5, 9) }),
        order({ id: 'c', createdAt: new Date(2026, 0, 5, 14) }),
      ]);

      const result = await service.getOverview(TENANT, { groupBy: 'HOURLY' } as never);

      expect(result).toEqual([
        { period: '2026-01-05-9', revenue: 200, orderCount: 2 },
        { period: '2026-01-05-14', revenue: 100, orderCount: 1 },
      ]);
    });

    it('groups weekly starting on Sunday', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ id: 'a', createdAt: new Date(2026, 0, 4, 12) }), // Sunday
        order({ id: 'b', createdAt: new Date(2026, 0, 7, 12) }), // Wednesday, same week
      ]);

      const result = await service.getOverview(TENANT, { groupBy: 'WEEKLY' } as never);

      expect(result).toHaveLength(1);
      expect(result[0].period).toBe('2026-01-04');
      expect(result[0].orderCount).toBe(2);
    });

    it('groups quarterly', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ id: 'a', createdAt: new Date(2026, 0, 10, 12) }),
        order({ id: 'b', createdAt: new Date(2026, 7, 10, 12) }),
      ]);

      const result = await service.getOverview(TENANT, { groupBy: 'QUARTERLY' } as never);

      expect(result.map((r) => r.period)).toEqual(['2026-Q1', '2026-Q3']);
    });

    it('groups yearly', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ id: 'a', createdAt: new Date(2026, 0, 10, 12) }),
        order({ id: 'b', createdAt: new Date(2027, 0, 10, 12) }),
      ]);

      const result = await service.getOverview(TENANT, { groupBy: 'YEARLY' } as never);

      expect(result.map((r) => r.period)).toEqual(['2026', '2027']);
      expect(result[0].revenue).toBe(100);
    });

    it('defaults to a daily grouping when none is supplied', async () => {
      prisma.order.findMany.mockResolvedValue([order()]);

      const result = await service.getOverview(TENANT, query);

      expect(result).toEqual([{ period: '2026-01-05', revenue: 100, orderCount: 1 }]);
    });

    it('applies the branch and date filters to the order query', async () => {
      await service.getOverview(TENANT, {
        branchId: 'branch-1',
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      const [args] = prisma.order.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: TENANT,
        branchId: 'branch-1',
        createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-02-01') },
      });
    });
  });

  describe('getRevenueComparison', () => {
    it('computes the growth rate between the two periods', async () => {
      prisma.order.findMany
        .mockResolvedValueOnce([{ total: 100 }, { total: 100 }])
        .mockResolvedValueOnce([{ total: 150 }, { total: 150 }]);

      const result = await service.getRevenueComparison(TENANT, query);

      expect(result).toEqual({
        period1: { revenue: 200, orderCount: 2 },
        period2: { revenue: 300, orderCount: 2 },
        growth: 50,
        percentageChange: 50,
      });
    });

    it('reports zero growth when the first period had no revenue', async () => {
      prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 500 }]);

      const result = await service.getRevenueComparison(TENANT, query);

      expect(result.growth).toBe(0);
      expect(result.period2.revenue).toBe(500);
    });

    it('scopes each period to its own date window', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.getRevenueComparison(TENANT, {
        period1Start: '2026-01-01',
        period1End: '2026-01-31',
        period2Start: '2026-02-01',
        period2End: '2026-02-28',
      } as never);

      const [first, second] = prisma.order.findMany.mock.calls;
      expect(first[0].where).toEqual({
        tenantId: TENANT,
        createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
      });
      expect(second[0].where).toEqual({
        tenantId: TENANT,
        createdAt: { gte: new Date('2026-02-01'), lte: new Date('2026-02-28') },
      });
    });

    it('handles a single-sided period window', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.getRevenueComparison(TENANT, {
        period1Start: '2026-01-01',
        period2End: '2026-02-28',
      } as never);

      const [first, second] = prisma.order.findMany.mock.calls;
      expect(first[0].where.createdAt).toEqual({ gte: new Date('2026-01-01') });
      expect(second[0].where.createdAt).toEqual({ lte: new Date('2026-02-28') });
    });
  });

  describe('getByBranch', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue([]);

      await service.getByBranch(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('groups revenue per branch and buckets a missing branch as unknown', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ branchId: 'branch-1', total: 100 }),
        order({ branchId: 'branch-1', total: 50 }),
        order({ branchId: null, total: 25 }),
      ]);

      const result = await service.getByBranch(TENANT, query);

      expect(result).toEqual([
        { branchId: 'branch-1', revenue: 150, orderCount: 2 },
        { branchId: 'unknown', revenue: 25, orderCount: 1 },
      ]);
    });

    it('caches the grouped result', async () => {
      prisma.order.findMany.mockResolvedValue([order()]);

      const result = await service.getByBranch(TENANT, query);

      expect(cacheService.set).toHaveBeenCalledWith(
        TENANT,
        expect.stringContaining('sales:by-branch'),
        result,
        300,
      );
    });
  });

  describe('getByProduct', () => {
    it('serves the cached payload without querying order items', async () => {
      cacheService.get.mockResolvedValue([]);

      await service.getByProduct(TENANT, query);

      expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
    });

    it('aggregates quantity and revenue per product', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p1', productName: 'Burger', quantity: 2, total: 40 },
        { productId: 'p1', productName: 'Burger', quantity: 1, total: 20 },
        { productId: 'p2', productName: 'Fries', quantity: 3, total: 15 },
      ]);

      const result = await service.getByProduct(TENANT, query);

      expect(result).toEqual([
        { productId: 'p1', productName: 'Burger', totalQuantity: 3, totalRevenue: 60 },
        { productId: 'p2', productName: 'Fries', totalQuantity: 3, totalRevenue: 15 },
      ]);
    });

    it('scopes the items to orders in the tenant', async () => {
      await service.getByProduct(TENANT, query);

      const [args] = prisma.orderItem.findMany.mock.calls[0];
      expect(args.where.order).toEqual({ tenantId: TENANT });
    });
  });

  describe('getByCategory', () => {
    it('serves the cached payload without querying order items', async () => {
      cacheService.get.mockResolvedValue([]);

      await service.getByCategory(TENANT, query);

      expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
    });

    it('rolls product revenue up into its category', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p1', quantity: 1, total: 10 },
        { productId: 'p2', quantity: 2, total: 20 },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', menuCategoryId: 'cat-1' },
        { id: 'p2', menuCategoryId: 'cat-1' },
      ]);
      prisma.menuCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Mains' }]);

      const result = await service.getByCategory(TENANT, query);

      expect(result).toEqual([
        { categoryId: 'cat-1', categoryName: 'Mains', totalQuantity: 3, totalRevenue: 30 },
      ]);
      expect(prisma.menuCategory.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['cat-1'] } },
        select: { id: true, name: true },
      });
    });

    it('labels a product without a category as Uncategorized', async () => {
      prisma.orderItem.findMany.mockResolvedValue([{ productId: 'p1', quantity: 1, total: 10 }]);
      prisma.product.findMany.mockResolvedValue([{ id: 'p1', menuCategoryId: null }]);

      const result = await service.getByCategory(TENANT, query);

      expect(result).toEqual([
        {
          categoryId: 'uncategorized',
          categoryName: 'Uncategorized',
          totalQuantity: 1,
          totalRevenue: 10,
        },
      ]);
      expect(prisma.menuCategory.findMany).not.toHaveBeenCalled();
    });

    it('skips the category lookup entirely when there are no items', async () => {
      await service.getByCategory(TENANT, query);

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: [] } },
        select: { id: true, menuCategoryId: true },
      });
      expect(prisma.menuCategory.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getEmployeePerformance', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue([]);

      await service.getEmployeePerformance(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('aggregates revenue and collected cash per employee', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ userId: 'u1', total: 100, paidAmount: 90 }),
        order({ userId: 'u1', total: 50, paidAmount: 50 }),
        order({ userId: 'u2', total: 20, paidAmount: null }),
      ]);

      const result = await service.getEmployeePerformance(TENANT, query);

      expect(result).toEqual([
        { userId: 'u1', totalRevenue: 150, totalSales: 140, orderCount: 2 },
        { userId: 'u2', totalRevenue: 20, totalSales: 0, orderCount: 1 },
      ]);
    });

    it('excludes orders that have no employee', async () => {
      await service.getEmployeePerformance(TENANT, query);

      const [args] = prisma.order.findMany.mock.calls[0];
      expect(args.where.userId).toEqual({ not: null });
    });
  });

  describe('getPaymentMethods', () => {
    it('serves the cached payload without querying payments', async () => {
      cacheService.get.mockResolvedValue([]);

      await service.getPaymentMethods(TENANT, query);

      expect(prisma.payment.findMany).not.toHaveBeenCalled();
    });

    it('aggregates amounts per payment method', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { method: 'CASH', amount: 50 },
        { method: 'CASH', amount: 25 },
        { method: 'CARD', amount: 100 },
      ]);

      const result = await service.getPaymentMethods(TENANT, query);

      expect(result).toEqual([
        { method: 'CASH', totalAmount: 75, paymentCount: 2 },
        { method: 'CARD', totalAmount: 100, paymentCount: 1 },
      ]);
    });

    it('applies the date filter to the payment query', async () => {
      await service.getPaymentMethods(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      const [args] = prisma.payment.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: TENANT,
        createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-02-01') },
      });
    });
  });

  describe('getOrderChannels', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue([]);

      await service.getOrderChannels(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('groups orders per source and buckets a missing source as unknown', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ source: 'POS', total: 100 }),
        order({ source: 'POS', total: 60 }),
        order({ source: null, total: 10 }),
      ]);

      const result = await service.getOrderChannels(TENANT, query);

      expect(result).toEqual([
        { source: 'POS', orderCount: 2, totalRevenue: 160 },
        { source: 'unknown', orderCount: 1, totalRevenue: 10 },
      ]);
    });
  });

  describe('getDiscountAnalysis', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue({ totalDiscounts: 0 });

      await service.getDiscountAnalysis(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('averages the discount across orders that received one', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ discount: true, discountAmount: 10 }),
        order({ discount: true, discountAmount: 30 }),
        order({ discount: false, discountAmount: null }),
      ]);

      await expect(service.getDiscountAnalysis(TENANT, query)).resolves.toEqual({
        totalDiscounts: 40,
        ordersWithDiscounts: 2,
        averageDiscount: 20,
      });
    });

    it('reports a zero average when no order was discounted', async () => {
      prisma.order.findMany.mockResolvedValue([order({ discountAmount: null })]);

      await expect(service.getDiscountAnalysis(TENANT, query)).resolves.toEqual({
        totalDiscounts: 0,
        ordersWithDiscounts: 0,
        averageDiscount: 0,
      });
    });
  });

  describe('getServiceChargeAnalysis', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue({ totalServiceCharge: 0 });

      await service.getServiceChargeAnalysis(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('averages the service charge across charged orders', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ serviceCharge: 5 }),
        order({ serviceCharge: 15 }),
        order({ serviceCharge: null }),
      ]);

      await expect(service.getServiceChargeAnalysis(TENANT, query)).resolves.toEqual({
        totalServiceCharge: 20,
        ordersWithCharge: 2,
        averageServiceCharge: 10,
      });
    });

    it('reports a zero average when nothing was charged', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await expect(service.getServiceChargeAnalysis(TENANT, query)).resolves.toEqual({
        totalServiceCharge: 0,
        ordersWithCharge: 0,
        averageServiceCharge: 0,
      });
    });
  });

  describe('getTaxAnalysis', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue({ totalTax: 0 });

      await service.getTaxAnalysis(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('averages tax across every order but counts only taxed orders', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ taxAmount: 10 }),
        order({ taxAmount: 30 }),
        order({ taxAmount: null }),
      ]);

      await expect(service.getTaxAnalysis(TENANT, query)).resolves.toEqual({
        totalTax: 40,
        averageTaxPerOrder: 40 / 3,
        taxedOrderCount: 2,
      });
    });

    it('reports zero tax across an empty order set', async () => {
      await expect(service.getTaxAnalysis(TENANT, query)).resolves.toEqual({
        totalTax: 0,
        averageTaxPerOrder: 0,
        taxedOrderCount: 0,
      });
    });
  });

  describe('getPeakHours', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue([]);

      await service.getPeakHours(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('counts orders per local hour in ascending order', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ createdAt: new Date(2026, 0, 5, 18) }),
        order({ createdAt: new Date(2026, 0, 5, 9) }),
        order({ createdAt: new Date(2026, 0, 5, 18) }),
      ]);

      const result = await service.getPeakHours(TENANT, query);

      expect(result).toEqual([
        { hour: 9, orderCount: 1 },
        { hour: 18, orderCount: 2 },
      ]);
    });
  });

  describe('getPeakDays', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue([]);

      await service.getPeakDays(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('counts orders per weekday with names in ascending day order', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ createdAt: new Date(2026, 0, 7, 12) }), // Wednesday
        order({ createdAt: new Date(2026, 0, 5, 12) }), // Monday
        order({ createdAt: new Date(2026, 0, 7, 12) }),
      ]);

      const result = await service.getPeakDays(TENANT, query);

      expect(result).toEqual([
        { dayOfWeek: 1, dayName: 'Monday', orderCount: 1 },
        { dayOfWeek: 3, dayName: 'Wednesday', orderCount: 2 },
      ]);
    });
  });

  describe('getConversionMetrics', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue({ totalOrders: 0 });

      await service.getConversionMetrics(TENANT, query);

      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('breaks orders down by status and computes the outcome rates', async () => {
      prisma.order.findMany.mockResolvedValue([
        order({ status: 'COMPLETED' }),
        order({ status: 'COMPLETED' }),
        order({ status: 'CANCELLED' }),
        order({ status: 'REFUNDED' }),
      ]);

      const result = await service.getConversionMetrics(TENANT, query);

      expect(result).toEqual({
        totalOrders: 4,
        statusBreakdown: [
          { status: 'COMPLETED', count: 2, percentage: 50 },
          { status: 'CANCELLED', count: 1, percentage: 25 },
          { status: 'REFUNDED', count: 1, percentage: 25 },
        ],
        completionRate: 50,
        cancellationRate: 25,
        refundRate: 25,
      });
    });

    it('reports zero rates when there are no orders', async () => {
      await expect(service.getConversionMetrics(TENANT, query)).resolves.toEqual({
        totalOrders: 0,
        statusBreakdown: [],
        completionRate: 0,
        cancellationRate: 0,
        refundRate: 0,
      });
    });
  });
});
