import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FinancialAnalyticsService } from '../financial-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';

const Q = {} as never;

describe('FinancialAnalyticsService', () => {
  let service: FinancialAnalyticsService;
  let prisma: MockPrisma;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialAnalyticsService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<FinancialAnalyticsService>(FinancialAnalyticsService);
    prisma = module.get(PrismaService) as MockPrisma;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
  });

  describe('getOverview', () => {
    it('should return cached overview without hitting the database', async () => {
      const cached = { revenue: 999 };
      cache.get.mockResolvedValue(cached);

      expect(await service.getOverview(testTenantId, Q)).toEqual(cached);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('should count revenue from COMPLETED orders only', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          total: 100,
          subtotal: 80,
          discountAmount: 0,
          taxAmount: 20,
          serviceCharge: 0,
          status: 'COMPLETED',
        },
        {
          total: 50,
          subtotal: 40,
          discountAmount: 0,
          taxAmount: 10,
          serviceCharge: 0,
          status: 'CANCELLED',
        },
        {
          total: 70,
          subtotal: 60,
          discountAmount: 0,
          taxAmount: 10,
          serviceCharge: 0,
          status: 'DRAFT',
        },
      ]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getOverview(testTenantId, Q);

      expect(result.revenue).toBe(100);
      expect(result.grossProfit).toBe(80);
    });

    it('should compute netProfit as grossProfit - expenses + serviceCharges - discounts', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          total: 200,
          subtotal: 150,
          discountAmount: 10,
          taxAmount: 25,
          serviceCharge: 25,
          status: 'COMPLETED',
        },
      ]);
      prisma.purchaseOrder.findMany.mockResolvedValue([{ total: 30 }]);
      prisma.consumptionRecord.findMany.mockResolvedValue([{ totalCost: 40 }]);

      const result = await service.getOverview(testTenantId, Q);

      expect(result.expenses).toBe(30);
      expect(result.cogs).toBe(40);
      expect(result.grossProfit).toBe(110);
      expect(result.netProfit).toBe(110 - 30 + 25 - 10);
    });

    it('should return zero margins instead of NaN when there is no revenue', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getOverview(testTenantId, Q);

      expect(result.revenue).toBe(0);
      expect(result.grossMargin).toBe(0);
      expect(result.netMargin).toBe(0);
    });

    it('should treat VOIDED and REFUNDED orders as refunds', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          total: 100,
          subtotal: 100,
          discountAmount: 0,
          taxAmount: 0,
          serviceCharge: 0,
          status: 'COMPLETED',
        },
        {
          total: 40,
          subtotal: 40,
          discountAmount: 0,
          taxAmount: 0,
          serviceCharge: 0,
          status: 'REFUNDED',
        },
        {
          total: 25,
          subtotal: 25,
          discountAmount: 0,
          taxAmount: 0,
          serviceCharge: 0,
          status: 'VOIDED',
        },
      ]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getOverview(testTenantId, Q);

      expect(result.totalRefunds).toBe(65);
    });

    it('should round monetary values to two decimals', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          total: 10.005,
          subtotal: 0.333,
          discountAmount: 0,
          taxAmount: 0,
          serviceCharge: 0,
          status: 'COMPLETED',
        },
      ]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getOverview(testTenantId, Q);

      expect(result.revenue).toBe(10.01);
      expect(result.grossProfit).toBe(0.33);
    });

    it('should cache the overview for 300 seconds', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getOverview(testTenantId, Q);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('financial-analytics:overview'),
        result,
        300,
      );
    });

    it('should scope queries by tenant and apply branch/date filters', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      await service.getOverview(testTenantId, {
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-01-31T00:00:00.000Z',
        branchId: 'branch-1',
      } as never);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: testTenantId,
            branchId: 'branch-1',
            createdAt: {
              gte: new Date('2025-01-01T00:00:00.000Z'),
              lte: new Date('2025-01-31T00:00:00.000Z'),
            },
          }),
        }),
      );
    });
  });

  describe('getRevenueBreakdown', () => {
    it('should group completed orders by day with min/max/avg', async () => {
      prisma.order.findMany.mockResolvedValue([
        { total: 100, createdAt: new Date('2025-01-01T10:00:00Z') },
        { total: 50, createdAt: new Date('2025-01-01T14:00:00Z') },
        { total: 75, createdAt: new Date('2025-01-02T10:00:00Z') },
      ]);

      const result = await service.getRevenueBreakdown(testTenantId, Q);

      expect(result.daily).toHaveLength(2);
      expect(result.daily[0]).toEqual({ date: '2025-01-01', revenue: 150, orderCount: 2 });
      expect(result.daily[1]).toEqual({ date: '2025-01-02', revenue: 75, orderCount: 1 });
      expect(result.summary.totalRevenue).toBe(225);
      expect(result.summary.avgDaily).toBe(112.5);
      expect(result.summary.minDaily).toBe(75);
      expect(result.summary.maxDaily).toBe(150);
      expect(result.summary.totalDays).toBe(2);
    });

    it('should filter to COMPLETED orders at query level', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      await service.getRevenueBreakdown(testTenantId, Q);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('should return an empty summary when there are no orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getRevenueBreakdown(testTenantId, Q);

      expect(result.daily).toEqual([]);
      expect(result.summary).toEqual({
        totalRevenue: 0,
        avgDaily: 0,
        minDaily: 0,
        maxDaily: 0,
        totalDays: 0,
      });
    });
  });

  describe('getCogsBreakdown', () => {
    it('should aggregate COGS by category and by month', async () => {
      prisma.consumptionRecord.findMany.mockResolvedValue([
        {
          inventoryItemId: 'inv-1',
          totalCost: 30,
          quantity: 3,
          date: new Date('2025-01-05T00:00:00Z'),
        },
        {
          inventoryItemId: 'inv-2',
          totalCost: 20,
          quantity: 1,
          date: new Date('2025-01-20T00:00:00Z'),
        },
        {
          inventoryItemId: 'inv-1',
          totalCost: 10,
          quantity: 1,
          date: new Date('2025-02-02T00:00:00Z'),
        },
      ]);
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-1', name: 'Tomato', categoryId: 'cat-1' },
        { id: 'inv-2', name: 'Basil', categoryId: 'cat-1' },
      ]);
      prisma.menuCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Vegetables' }]);

      const result = await service.getCogsBreakdown(testTenantId, Q);

      expect(result.totalCogs).toBe(60);
      expect(result.byCategory).toEqual([
        { categoryId: 'cat-1', categoryName: 'Vegetables', totalCost: 60, totalQuantity: 5 },
      ]);
      expect(result.byPeriod).toEqual([
        { period: '2025-01', totalCost: 50 },
        { period: '2025-02', totalCost: 10 },
      ]);
    });

    it('should group items without a category under uncategorized', async () => {
      prisma.consumptionRecord.findMany.mockResolvedValue([
        {
          inventoryItemId: 'inv-1',
          totalCost: 15,
          quantity: 1,
          date: new Date('2025-03-01T00:00:00Z'),
        },
      ]);
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-1', name: 'Mystery', categoryId: null },
      ]);

      const result = await service.getCogsBreakdown(testTenantId, Q);

      expect(result.byCategory).toEqual([
        {
          categoryId: 'uncategorized',
          categoryName: 'Uncategorized',
          totalCost: 15,
          totalQuantity: 1,
        },
      ]);
    });

    it('should skip inventory/category lookups when there are no consumption records', async () => {
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      const result = await service.getCogsBreakdown(testTenantId, Q);

      expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
      expect(prisma.menuCategory.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({ totalCogs: 0, byCategory: [], byPeriod: [] });
    });
  });

  describe('getProfitabilityByBranch', () => {
    it('should allocate COGS across branches by revenue share', async () => {
      prisma.order.findMany.mockResolvedValue([
        { branchId: 'b-1', subtotal: 100, total: 100, discountAmount: 0 },
        { branchId: 'b-2', subtotal: 300, total: 300, discountAmount: 0 },
      ]);
      prisma.consumptionRecord.aggregate.mockResolvedValue({ _sum: { totalCost: 400 } });

      const result = await service.getProfitabilityByBranch(testTenantId, Q);

      expect(result.branches).toHaveLength(2);
      const b1 = result.branches.find((b) => b.branchId === 'b-1')!;
      const b2 = result.branches.find((b) => b.branchId === 'b-2')!;
      expect(b1.allocatedCogs).toBe(100);
      expect(b1.grossProfit).toBe(0);
      expect(b2.allocatedCogs).toBe(300);
      expect(b2.grossProfit).toBe(0);
      expect(result.totalRevenue).toBe(400);
      expect(result.totalCogs).toBe(400);
    });

    it('should sort branches by revenue descending', async () => {
      prisma.order.findMany.mockResolvedValue([
        { branchId: 'small', subtotal: 10, total: 10, discountAmount: 0 },
        { branchId: 'big', subtotal: 500, total: 500, discountAmount: 0 },
      ]);
      prisma.consumptionRecord.aggregate.mockResolvedValue({ _sum: { totalCost: 0 } });

      const result = await service.getProfitabilityByBranch(testTenantId, Q);

      expect(result.branches.map((b) => b.branchId)).toEqual(['big', 'small']);
    });

    it('should subtract discounts from gross profit', async () => {
      prisma.order.findMany.mockResolvedValue([
        { branchId: 'b-1', subtotal: 200, total: 180, discountAmount: 20 },
      ]);
      prisma.consumptionRecord.aggregate.mockResolvedValue({ _sum: { totalCost: 50 } });

      const result = await service.getProfitabilityByBranch(testTenantId, Q);

      expect(result.branches[0].grossProfit).toBe(200 - 50 - 20);
    });

    it('should bucket orders without a branch as unknown', async () => {
      prisma.order.findMany.mockResolvedValue([
        { branchId: null, subtotal: 80, total: 80, discountAmount: 0 },
      ]);
      prisma.consumptionRecord.aggregate.mockResolvedValue({ _sum: { totalCost: null } });

      const result = await service.getProfitabilityByBranch(testTenantId, Q);

      expect(result.branches[0].branchId).toBe('unknown');
      expect(result.branches[0].margin).toBe(100);
      expect(result.totalCogs).toBe(0);
    });

    it('should not divide by zero when there are no completed orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.aggregate.mockResolvedValue({ _sum: { totalCost: 100 } });

      const result = await service.getProfitabilityByBranch(testTenantId, Q);

      expect(result.branches).toEqual([]);
      expect(result.totalRevenue).toBe(0);
    });
  });

  describe('getProfitabilityByCategory', () => {
    it('should compute revenue, estimated cost and margin per category', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-1', quantity: 2, unitPrice: 50, total: 100 },
        { productId: 'p-1', quantity: 1, unitPrice: 50, total: 50 },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'p-1', name: 'Burger', categoryId: 'cat-1', cost: 20 },
      ]);
      prisma.menuCategory.findMany.mockResolvedValue([{ id: 'cat-1', name: 'Mains' }]);

      const result = await service.getProfitabilityByCategory(testTenantId, Q);

      expect(result.categories).toEqual([
        {
          categoryId: 'cat-1',
          categoryName: 'Mains',
          revenue: 150,
          estimatedCost: 60,
          grossProfit: 90,
          margin: 60,
          quantity: 3,
        },
      ]);
    });

    it('orders categories by revenue descending', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-1', quantity: 1, unitPrice: 10, total: 10 },
        { productId: 'p-2', quantity: 1, unitPrice: 90, total: 90 },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'p-1', name: 'Low', categoryId: 'cat-1', cost: 0 },
        { id: 'p-2', name: 'High', categoryId: 'cat-2', cost: 0 },
      ]);
      prisma.menuCategory.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'Low' },
        { id: 'cat-2', name: 'High' },
      ]);

      const result = await service.getProfitabilityByCategory(testTenantId, Q);

      expect(result.categories.map((category) => category.categoryId)).toEqual(['cat-2', 'cat-1']);
    });

    it('should restrict revenue to COMPLETED orders', async () => {
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.getProfitabilityByCategory(testTenantId, Q);

      expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ status: 'COMPLETED' }),
          }),
        }),
      );
    });

    it('should group items whose product has no category under uncategorized', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-9', quantity: 1, unitPrice: 10, total: 10 },
      ]);
      prisma.product.findMany.mockResolvedValue([]);

      const result = await service.getProfitabilityByCategory(testTenantId, Q);

      expect(result.categories[0].categoryId).toBe('uncategorized');
      expect(result.categories[0].estimatedCost).toBe(0);
      expect(result.categories[0].margin).toBe(100);
    });

    it('should skip lookups when there are no order items', async () => {
      prisma.orderItem.findMany.mockResolvedValue([]);

      const result = await service.getProfitabilityByCategory(testTenantId, Q);

      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.menuCategory.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({ categories: [] });
    });
  });

  describe('getProfitabilityByProduct', () => {
    it('should compute per-product revenue, cost and margin', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-1', productName: 'Burger', quantity: 2, unitPrice: 50, total: 100 },
        { productId: 'p-2', productName: 'Cola', quantity: 4, unitPrice: 5, total: 20 },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'p-1', cost: 15 },
        { id: 'p-2', cost: null },
      ]);

      const result = await service.getProfitabilityByProduct(testTenantId, Q);

      expect(result.products.map((p) => p.productId)).toEqual(['p-1', 'p-2']);
      expect(result.products[0]).toEqual({
        productId: 'p-1',
        productName: 'Burger',
        revenue: 100,
        estimatedCost: 30,
        grossProfit: 70,
        margin: 70,
        quantity: 2,
      });
      expect(result.products[1].grossProfit).toBe(20);
      expect(result.products[1].margin).toBe(100);
    });

    it('should restrict revenue to COMPLETED orders', async () => {
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.getProfitabilityByProduct(testTenantId, Q);

      expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            order: expect.objectContaining({ status: 'COMPLETED' }),
          }),
        }),
      );
    });

    it('should treat products with no cost record as zero cost', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        { productId: 'p-x', productName: 'Mystery', quantity: 1, unitPrice: 12, total: 12 },
      ]);
      prisma.product.findMany.mockResolvedValue([]);

      const result = await service.getProfitabilityByProduct(testTenantId, Q);

      expect(result.products[0].estimatedCost).toBe(0);
      expect(result.products[0].productName).toBe('Mystery');
    });
  });

  describe('getTaxAnalysis', () => {
    it('should count orders with and without tax', async () => {
      prisma.order.findMany.mockResolvedValue([
        { taxAmount: 15, subtotal: 100, total: 115 },
        { taxAmount: 0, subtotal: 50, total: 50 },
      ]);

      const result = await service.getTaxAnalysis(testTenantId, Q);

      expect(result.totalTaxCollected).toBe(15);
      expect(result.totalRevenue).toBe(165);
      expect(result.ordersWithTax).toBe(1);
      expect(result.ordersWithoutTax).toBe(1);
      expect(result.avgTaxRate).toBe(9.09);
    });

    it('should return zero tax rate when there is no revenue', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getTaxAnalysis(testTenantId, Q);

      expect(result.avgTaxRate).toBe(0);
      expect(result.totalTaxCollected).toBe(0);
    });
  });

  describe('getDiscountAnalysis', () => {
    it('should compute average discount percent and impact on subtotal', async () => {
      prisma.order.findMany.mockResolvedValue([
        { discountAmount: 10, subtotal: 100, total: 90, discount: 10 },
        { discountAmount: 30, subtotal: 100, total: 70, discount: 30 },
        { discountAmount: 0, subtotal: 200, total: 200, discount: 0 },
      ]);

      const result = await service.getDiscountAnalysis(testTenantId, Q);

      expect(result.totalDiscountsGiven).toBe(40);
      expect(result.ordersWithDiscounts).toBe(2);
      expect(result.totalOrders).toBe(3);
      expect(result.avgDiscountPercent).toBe(20);
      expect(result.discountImpact).toBe(10);
    });

    it('should dilute the average with discounted orders that have no subtotal', async () => {
      prisma.order.findMany.mockResolvedValue([
        { discountAmount: 10, subtotal: 0, total: 0, discount: 0 },
        { discountAmount: 10, subtotal: 100, total: 90, discount: 10 },
      ]);

      const result = await service.getDiscountAnalysis(testTenantId, Q);

      expect(result.ordersWithDiscounts).toBe(2);
      expect(result.avgDiscountPercent).toBe(5);
    });

    it('should return zeroed metrics when nothing was discounted', async () => {
      prisma.order.findMany.mockResolvedValue([
        { discountAmount: 0, subtotal: 100, total: 100, discount: 0 },
      ]);

      const result = await service.getDiscountAnalysis(testTenantId, Q);

      expect(result.avgDiscountPercent).toBe(0);
      expect(result.discountImpact).toBe(0);
      expect(result.ordersWithDiscounts).toBe(0);
    });
  });

  describe('getRefundAnalysis', () => {
    it('should compute refund rate and group refunds by month', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          total: 40,
          completedAt: new Date('2025-01-10T00:00:00Z'),
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
        { total: 60, completedAt: null, createdAt: new Date('2025-02-05T00:00:00Z') },
      ]);
      prisma.order.count.mockResolvedValue(20);

      const result = await service.getRefundAnalysis(testTenantId, Q);

      expect(result.totalRefunded).toBe(100);
      expect(result.refundCount).toBe(2);
      expect(result.totalCompletedOrRefunded).toBe(20);
      expect(result.refundRate).toBe(10);
      expect(result.byPeriod).toEqual([
        { period: '2025-01', refundAmount: 40, refundCount: 1 },
        { period: '2025-02', refundAmount: 60, refundCount: 1 },
      ]);
    });

    it('should fall back to createdAt when completedAt is null', async () => {
      prisma.order.findMany.mockResolvedValue([
        { total: 15, completedAt: null, createdAt: new Date('2025-05-09T00:00:00Z') },
      ]);
      prisma.order.count.mockResolvedValue(4);

      const result = await service.getRefundAnalysis(testTenantId, Q);

      expect(result.byPeriod[0].period).toBe('2025-05');
      expect(result.refundRate).toBe(25);
    });

    it('should return zero rate when there are no completed or refunded orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      const result = await service.getRefundAnalysis(testTenantId, Q);

      expect(result.refundRate).toBe(0);
      expect(result.byPeriod).toEqual([]);
    });
  });

  describe('getServiceChargeAnalysis', () => {
    it('should average the service charge over charged orders only', async () => {
      prisma.order.findMany.mockResolvedValue([
        { serviceCharge: 20, subtotal: 100, total: 120 },
        { serviceCharge: 10, subtotal: 100, total: 110 },
        { serviceCharge: 0, subtotal: 100, total: 100 },
      ]);

      const result = await service.getServiceChargeAnalysis(testTenantId, Q);

      expect(result.totalServiceCharges).toBe(30);
      expect(result.totalRevenue).toBe(330);
      expect(result.ordersWithCharges).toBe(2);
      expect(result.totalOrders).toBe(3);
      expect(result.avgChargePerOrder).toBe(15);
      expect(result.chargeImpact).toBe(9.09);
    });

    it('should return zeroed metrics when no order was charged', async () => {
      prisma.order.findMany.mockResolvedValue([{ serviceCharge: 0, subtotal: 100, total: 100 }]);

      const result = await service.getServiceChargeAnalysis(testTenantId, Q);

      expect(result.avgChargePerOrder).toBe(0);
      expect(result.chargeImpact).toBe(0);
    });
  });

  describe('cache isolation', () => {
    it('should not reuse an overview cache entry for the revenue breakdown', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      await service.getOverview(testTenantId, Q);
      await service.getRevenueBreakdown(testTenantId, Q);

      const keys = cache.set.mock.calls.map((c) => c[1]);
      expect(keys.some((k) => k.includes('overview'))).toBe(true);
      expect(keys.some((k) => k.includes('revenue'))).toBe(true);
    });

    it('should scope cache keys to the tenant', async () => {
      cache.get.mockResolvedValue(null);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.purchaseOrder.findMany.mockResolvedValue([]);
      prisma.consumptionRecord.findMany.mockResolvedValue([]);

      await service.getOverview(testTenantId, Q);

      expect(cache.set.mock.calls[0][0]).toBe(testTenantId);
    });
  });
});
