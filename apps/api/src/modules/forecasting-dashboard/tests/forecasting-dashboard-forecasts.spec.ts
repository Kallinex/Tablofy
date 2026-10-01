import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForecastingDashboardService } from '../forecasting-dashboard.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';

const TENANT = 'tenant-1';

const day = (n: number, total = 10) => ({
  id: `o${n}`,
  createdAt: new Date(Date.UTC(2026, 0, n, 12, 0, 0)),
  total,
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  name: 'Tomato',
  sku: 'SKU-1',
  currentQuantity: 100,
  unitCost: 2,
  averageCost: 3,
  ...overrides,
});

describe('ForecastingDashboardService forecasts', () => {
  let service: ForecastingDashboardService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cacheService: { get: jest.Mock; set: jest.Mock };
  const query = {} as never;

  beforeEach(async () => {
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryForecast: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
      consumptionRecord: { findMany: jest.fn().mockResolvedValue([]) },
      customer: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ForecastingDashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: CacheService, useValue: cacheService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<ForecastingDashboardService>(ForecastingDashboardService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getSalesForecast', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue({ forecast: [] });

      await expect(service.getSalesForecast(TENANT, query)).resolves.toEqual({ forecast: [] });
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('restricts the history window to completed orders for the tenant', async () => {
      await service.getSalesForecast(TENANT, query);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT, status: 'COMPLETED' }),
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('adds the branch filter and the supplied date range', async () => {
      await service.getSalesForecast(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        branchId: 'branch-1',
      } as never);

      const [args] = prisma.order.findMany.mock.calls[0];
      expect(args.where.branchId).toBe('branch-1');
      expect(args.where.createdAt.lte).toEqual(new Date('2026-02-01'));
    });

    it('counts orders per day and defaults to a stable trend with no data', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getSalesForecast(TENANT, { periods: 3 } as never);

      expect(result.historical).toEqual([]);
      expect(result.forecast).toHaveLength(3);
      expect(result.metadata).toEqual(
        expect.objectContaining({
          avgPerPeriod: 0,
          // growthFactor is reported as a percentage, so a factor of 1 surfaces as 100.
          growthFactor: 100,
          trend: 'stable',
          confidence: 'low',
        }),
      );
      expect(result.forecast[0].forecastedValue).toBe(0);
      expect(result.forecast[0].lowerBound).toBe(0);
    });

    it('aggregates several orders on the same day', async () => {
      prisma.order.findMany.mockResolvedValue([day(1), day(1), { ...day(1), id: 'o3' }, day(2)]);

      const result = await service.getSalesForecast(TENANT, {
        periods: 2,
        period: 'DAILY',
      } as never);

      expect(result.historical).toEqual([
        { period: '2026-01-01', value: 3 },
        { period: '2026-01-02', value: 1 },
      ]);
      expect(result.metadata.avgPerPeriod).toBe(2);
    });

    it('buckets by ISO week when the period is weekly', async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: 'a', createdAt: new Date(Date.UTC(2026, 0, 4, 10)) }, // Sunday
        { id: 'b', createdAt: new Date(Date.UTC(2026, 0, 5, 10)) }, // Monday
        { id: 'c', createdAt: new Date(Date.UTC(2026, 0, 11, 10)) }, // next Sunday
      ]);

      const result = await service.getSalesForecast(TENANT, {
        periods: 2,
        period: 'WEEKLY',
      } as never);

      // Sunday 2026-01-04 starts its own week; Monday 2026-01-05 rolls back to it.
      expect(result.historical).toEqual([
        { period: '2026-01-04', value: 2 },
        { period: '2026-01-11', value: 1 },
      ]);
      expect(result.forecast[0].period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('buckets by month when the period is monthly', async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: 'a', createdAt: new Date(Date.UTC(2026, 0, 5)) },
        { id: 'b', createdAt: new Date(Date.UTC(2026, 1, 7)) },
      ]);

      const result = await service.getSalesForecast(TENANT, {
        periods: 2,
        period: 'MONTHLY',
      } as never);

      expect(result.historical.map((h) => h.period)).toEqual(['2026-01', '2026-02']);
      expect(result.forecast[0].period).toMatch(/^\d{4}-\d{2}$/);
    });

    it('reports an upward trend when order volume grows', async () => {
      prisma.order.findMany.mockResolvedValue([
        day(1),
        day(2),
        day(2),
        { ...day(3), id: 'o4' },
        { ...day(3), id: 'o5' },
        { ...day(3), id: 'o6' },
      ]);

      const result = await service.getSalesForecast(TENANT, {
        periods: 2,
        period: 'DAILY',
      } as never);

      expect(result.metadata.trend).toBe('upward');
      expect(result.metadata.growthFactor).toBeGreaterThan(100);
      expect(result.forecast[1].forecastedValue).toBeGreaterThan(
        result.forecast[0].forecastedValue,
      );
    });

    it('reports a downward trend when order volume falls', async () => {
      prisma.order.findMany.mockResolvedValue([day(1), day(1), day(1), day(2), day(2), day(3)]);

      const result = await service.getSalesForecast(TENANT, {
        periods: 2,
        period: 'DAILY',
      } as never);

      expect(result.metadata.trend).toBe('downward');
      expect(result.metadata.growthFactor).toBeLessThan(100);
    });

    it('clamps the lower bound at zero', async () => {
      prisma.order.findMany.mockResolvedValue([
        day(1, 1000),
        { ...day(2), id: 'o2', total: 1 },
        { ...day(3), id: 'o3', total: 1 },
      ]);

      const result = await service.getSalesForecast(TENANT, {
        periods: 3,
        period: 'DAILY',
      } as never);

      for (const point of result.forecast) {
        expect(point.lowerBound).toBeGreaterThanOrEqual(0);
        expect(point.upperBound).toBeGreaterThanOrEqual(point.forecastedValue);
      }
    });

    it.each([
      [5, 'medium'],
      [10, 'high'],
    ])('grades %i data points as %s confidence', async (count, confidence) => {
      prisma.order.findMany.mockResolvedValue(
        Array.from({ length: count }, (_, i) => ({
          id: `o${i}`,
          createdAt: new Date(Date.UTC(2026, 0, i + 1)),
        })),
      );

      const result = await service.getSalesForecast(TENANT, {
        periods: 2,
        period: 'DAILY',
      } as never);

      expect(result.metadata.confidence).toBe(confidence);
    });
  });

  describe('getRevenueForecast', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue({ forecast: [] });

      await expect(service.getRevenueForecast(TENANT, query)).resolves.toEqual({ forecast: [] });
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('sums order totals per day', async () => {
      prisma.order.findMany.mockResolvedValue([day(1, 10), day(1, 15), day(2, 25)]);

      const result = await service.getRevenueForecast(TENANT, {
        periods: 2,
        period: 'DAILY',
      } as never);

      expect(result.historical).toEqual([
        { period: '2026-01-01', value: 25 },
        { period: '2026-01-02', value: 25 },
      ]);
      expect(result.metadata.avgPerPeriod).toBe(25);
      expect(result.metadata.trend).toBe('stable');
    });

    it('reports a zero average when there are no orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getRevenueForecast(TENANT, { periods: 2 } as never);

      expect(result.historical).toEqual([]);
      expect(result.forecast).toHaveLength(2);
      expect(result.metadata).toEqual(
        expect.objectContaining({ avgPerPeriod: 0, growthFactor: 100, trend: 'stable' }),
      );
    });

    it('reports an upward revenue trend and rounds the historical values', async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: 'a', createdAt: new Date(Date.UTC(2026, 0, 1)), total: 10.005 },
        { id: 'b', createdAt: new Date(Date.UTC(2026, 0, 2)), total: 20 },
        { id: 'c', createdAt: new Date(Date.UTC(2026, 0, 3)), total: 40 },
      ]);

      const result = await service.getRevenueForecast(TENANT, {
        periods: 3,
        period: 'DAILY',
      } as never);

      expect(result.historical[0].value).toBe(10.01);
      expect(result.metadata.trend).toBe('upward');
    });

    it('buckets revenue weekly and monthly', async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: 'a', createdAt: new Date(Date.UTC(2026, 0, 4)), total: 10 },
        { id: 'b', createdAt: new Date(Date.UTC(2026, 0, 5)), total: 10 },
      ]);

      const weekly = await service.getRevenueForecast(TENANT, {
        periods: 1,
        period: 'WEEKLY',
      } as never);
      expect(weekly.historical).toEqual([{ period: '2026-01-04', value: 20 }]);

      const monthly = await service.getRevenueForecast(TENANT, {
        periods: 1,
        period: 'MONTHLY',
      } as never);
      expect(monthly.historical).toEqual([{ period: '2026-01', value: 20 }]);
    });
  });

  describe('getDemandForecast', () => {
    const forecast = (overrides: Record<string, unknown> = {}) => ({
      id: 'f1',
      tenantId: TENANT,
      inventoryItemId: 'item-1',
      forecastDate: new Date(Date.UTC(2026, 0, 5)),
      quantity: 5,
      confidence: 0.8,
      ...overrides,
    });

    it('serves the cached payload without querying forecasts', async () => {
      cacheService.get.mockResolvedValue({ predictions: [] });

      await expect(service.getDemandForecast(TENANT, query)).resolves.toEqual({ predictions: [] });
      expect(prisma.inventoryForecast.findMany).not.toHaveBeenCalled();
    });

    it('sums quantities and averages confidence per forecast date', async () => {
      prisma.inventoryForecast.findMany.mockResolvedValue([
        forecast(),
        forecast({ id: 'f2', inventoryItemId: 'item-2', quantity: 5, confidence: 0.6 }),
        forecast({ id: 'f3', forecastDate: new Date(Date.UTC(2026, 0, 6)), quantity: 2 }),
      ]);

      const result = await service.getDemandForecast(TENANT, query);

      expect(result.predictions).toEqual([
        // avgConfidence is also surfaced as a percentage.
        { date: '2026-01-05', totalDemand: 10, avgConfidence: 70, itemCount: 2 },
        { date: '2026-01-06', totalDemand: 2, avgConfidence: 80, itemCount: 1 },
      ]);
      expect(result.summary).toEqual({
        totalItems: 3,
        dateRange: { from: '2026-01-05', to: '2026-01-06' },
      });
    });

    it('treats a missing confidence as zero', async () => {
      prisma.inventoryForecast.findMany.mockResolvedValue([
        forecast({ confidence: null }),
        forecast({ id: 'f2', confidence: null }),
      ]);

      const result = await service.getDemandForecast(TENANT, query);

      expect(result.predictions[0].avgConfidence).toBe(0);
    });

    it('reports a null date range when there are no forecasts', async () => {
      prisma.inventoryForecast.findMany.mockResolvedValue([]);

      const result = await service.getDemandForecast(TENANT, query);

      expect(result).toEqual({ predictions: [], summary: { totalItems: 0, dateRange: null } });
    });

    it('passes the supplied date range to the forecast query', async () => {
      await service.getDemandForecast(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      const [args] = prisma.inventoryForecast.findMany.mock.calls[0];
      expect(args.where.forecastDate).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-02-01'),
      });
    });

    it('omits the date filter when none is supplied', async () => {
      await service.getDemandForecast(TENANT, query);

      const [args] = prisma.inventoryForecast.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: TENANT });
    });
  });

  describe('getInventoryForecast', () => {
    const consumption = (inventoryItemId: string, quantity: number) => ({
      inventoryItemId,
      quantity,
      date: new Date(Date.UTC(2026, 0, 1)),
    });

    it('serves the cached payload without querying inventory', async () => {
      cacheService.get.mockResolvedValue({ projections: [] });

      await expect(service.getInventoryForecast(TENANT, query)).resolves.toEqual({
        projections: [],
      });
      expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    });

    it('classifies stock levels across the health thresholds', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        item({ id: 'healthy', currentQuantity: 100 }),
        item({ id: 'low', currentQuantity: 100 }),
        item({ id: 'critical', currentQuantity: 100 }),
        item({ id: 'empty', currentQuantity: 100 }),
      ]);
      prisma.consumptionRecord.findMany
        .mockResolvedValueOnce([
          consumption('healthy', 1),
          consumption('low', 2),
          consumption('critical', 3),
          consumption('empty', 4),
        ])
        .mockResolvedValueOnce([
          { inventoryItemId: 'healthy' },
          { inventoryItemId: 'low' },
          { inventoryItemId: 'critical' },
          { inventoryItemId: 'empty' },
        ]);

      const result = await service.getInventoryForecast(TENANT, { periods: 30 } as never);
      const byId = Object.fromEntries(result.projections.map((p) => [p.itemId, p]));

      // One observation each, so average consumption equals the single record.
      expect(byId.healthy).toEqual(
        expect.objectContaining({
          avgDailyConsumption: 1,
          forecastedConsumption: 30,
          projectedStock: 70,
          daysUntilEmpty: 100,
          status: 'HEALTHY',
        }),
      );
      expect(byId.low.status).toBe('LOW');
      expect(byId.critical.status).toBe('CRITICAL');
      expect(byId.empty.status).toBe('OUT_OF_STOCK');
      expect(byId.empty.projectedStock).toBe(0);
      expect(result.summary).toEqual({
        totalItems: 4,
        healthy: 1,
        low: 1,
        critical: 1,
        outOfStock: 1,
      });
    });

    it('reports 999 days until empty when there is no consumption history', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item()]);

      const [row] = (await service.getInventoryForecast(TENANT, query)).projections;

      expect(row.avgDailyConsumption).toBe(0);
      expect(row.forecastedConsumption).toBe(0);
      expect(row.daysUntilEmpty).toBe(999);
      expect(row.status).toBe('HEALTHY');
    });

    it('prefers explicit forecasts over the consumption average', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ currentQuantity: 50 })]);
      prisma.consumptionRecord.findMany
        .mockResolvedValueOnce([consumption('item-1', 1)])
        .mockResolvedValueOnce([{ inventoryItemId: 'item-1' }]);
      prisma.inventoryForecast.findMany.mockResolvedValue([
        { inventoryItemId: 'item-1', quantity: 7 },
        { inventoryItemId: 'item-1', quantity: 3 },
      ]);

      const [row] = (await service.getInventoryForecast(TENANT, { periods: 30 } as never))
        .projections;

      expect(row.forecastedConsumption).toBe(10);
      expect(row.projectedStock).toBe(40);
    });

    it('falls back to average consumption times periods when there are no forecasts', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ currentQuantity: 50 })]);
      prisma.consumptionRecord.findMany
        .mockResolvedValueOnce([consumption('item-1', 1)])
        .mockResolvedValueOnce([{ inventoryItemId: 'item-1' }]);

      const [row] = (await service.getInventoryForecast(TENANT, { periods: 10 } as never))
        .projections;

      expect(row.forecastedConsumption).toBe(10);
      expect(row.daysUntilEmpty).toBe(50);
    });

    it('resolves the unit cost from unitCost, then averageCost, then zero', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        item({ id: 'a', unitCost: 5, averageCost: 7 }),
        item({ id: 'b', unitCost: null, averageCost: 7 }),
        item({ id: 'c', unitCost: null, averageCost: null }),
      ]);

      const rows = (await service.getInventoryForecast(TENANT, query)).projections;

      expect(rows.map((r) => r.unitCost)).toEqual([5, 7, 0]);
    });

    it('excludes reversal rows from the observation count', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([item({ currentQuantity: 100 })]);
      prisma.consumptionRecord.findMany
        .mockResolvedValueOnce([consumption('item-1', 1), consumption('item-1', 1)])
        .mockResolvedValueOnce([{ inventoryItemId: 'item-1' }]);

      await service.getInventoryForecast(TENANT, query);

      const [args] = prisma.consumptionRecord.findMany.mock.calls[1];
      expect(args.where.reversedFromId).toBeNull();
      expect(args.select).toEqual({ inventoryItemId: true });
    });

    it('defaults the consumption window to the last 90 days', async () => {
      await service.getInventoryForecast(TENANT, query);

      const [args] = prisma.consumptionRecord.findMany.mock.calls[0];
      expect(args.where.date.gte).toBeInstanceOf(Date);
      expect(args.orderBy).toEqual({ date: 'asc' });
    });

    it('restricts inventory items to active, non-deleted rows', async () => {
      await service.getInventoryForecast(TENANT, query);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, isActive: true, deletedAt: null } }),
      );
    });
  });

  describe('getCustomerForecast', () => {
    const customer = (month: number, id: string) => ({
      id,
      createdAt: new Date(Date.UTC(2026, month, 3)),
    });

    it('serves the cached payload without querying customers', async () => {
      cacheService.get.mockResolvedValue({ forecast: [] });

      await expect(service.getCustomerForecast(TENANT, query)).resolves.toEqual({ forecast: [] });
      expect(prisma.customer.findMany).not.toHaveBeenCalled();
    });

    it('reports a stable trend when no customers were acquired', async () => {
      prisma.customer.findMany.mockResolvedValue([]);

      const result = await service.getCustomerForecast(TENANT, { periods: 3 } as never);

      expect(result.historical).toEqual([]);
      expect(result.summary).toEqual(
        expect.objectContaining({ monthlyAvgNew: 0, monthlyGrowthRate: 0, trend: 'stable' }),
      );
      expect(result.forecast[0].projectedCustomers).toBe(0);
    });

    it('counts new customers per month and accumulates the projection from the current total', async () => {
      prisma.customer.findMany.mockResolvedValue([
        customer(0, 'a'),
        customer(0, 'b'),
        customer(1, 'c'),
        customer(1, 'd'),
        customer(1, 'e'),
      ]);
      prisma.customer.count.mockResolvedValue(50);

      const result = await service.getCustomerForecast(TENANT, { periods: 2 } as never);

      expect(result.historical).toEqual([
        { month: '2026-01', newCustomers: 2 },
        { month: '2026-02', newCustomers: 3 },
      ]);
      expect(result.summary.totalCustomers).toBe(50);
      expect(result.summary.trend).toBe('growing');
      expect(result.forecast[0].cumulative).toBeGreaterThan(50);
      expect(result.forecast[1].cumulative).toBeGreaterThan(result.forecast[0].cumulative);
    });

    it('looks back twelve months per forecast period', async () => {
      await service.getCustomerForecast(TENANT, { periods: 2 } as never);

      const [args] = prisma.customer.findMany.mock.calls[0];
      const lookback = new Date();
      lookback.setDate(lookback.getDate() - 60);
      expect(args.where.createdAt.gte.getTime()).toBeLessThanOrEqual(lookback.getTime() + 2000);
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('reports a declining trend when new signups slow down', async () => {
      prisma.customer.findMany.mockResolvedValue([
        customer(0, 'a'),
        customer(0, 'b'),
        customer(0, 'c'),
        customer(1, 'd'),
      ]);

      const result = await service.getCustomerForecast(TENANT, { periods: 2 } as never);

      expect(result.summary.trend).toBe('declining');
    });
  });

  describe('getTrendAnalysis', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue({ sales: {} });

      await expect(service.getTrendAnalysis(TENANT, query)).resolves.toEqual({ sales: {} });
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('reports a stable trend with fewer than three data points', async () => {
      prisma.order.findMany.mockResolvedValue([day(1, 10), day(2, 20)]);

      const result = await service.getTrendAnalysis(TENANT, query);

      expect(result.sales).toEqual(
        expect.objectContaining({
          direction: 'stable',
          strength: 0,
          slope: 0,
          label: 'Sales Revenue',
        }),
      );
      expect(result.orderVolume).toEqual(
        expect.objectContaining({ direction: 'stable', label: 'Order Volume' }),
      );
    });

    it('reports an upward sales trend and describes it', async () => {
      prisma.order.findMany.mockResolvedValue([day(1, 10), day(2, 20), day(3, 30), day(4, 40)]);

      const result = await service.getTrendAnalysis(TENANT, query);

      expect(result.sales.direction).toBe('upward');
      expect(result.sales.strength).toBe(100);
      expect(result.sales.description).toBe('Revenue trending upward with 100% confidence');
      expect(result.sales.data).toEqual([
        { date: '2026-01-01', orderCount: 1, revenue: 10 },
        { date: '2026-01-02', orderCount: 1, revenue: 20 },
        { date: '2026-01-03', orderCount: 1, revenue: 30 },
        { date: '2026-01-04', orderCount: 1, revenue: 40 },
      ]);
      expect(result.orderVolume.data).toEqual([
        { date: '2026-01-01', count: 1 },
        { date: '2026-01-02', count: 1 },
        { date: '2026-01-03', count: 1 },
        { date: '2026-01-04', count: 1 },
      ]);
    });

    it('reports a downward sales trend', async () => {
      prisma.order.findMany.mockResolvedValue([day(1, 40), day(2, 30), day(3, 20), day(4, 10)]);

      const result = await service.getTrendAnalysis(TENANT, query);

      expect(result.sales.direction).toBe('downward');
    });

    it('reports zero confidence for perfectly flat data', async () => {
      prisma.order.findMany.mockResolvedValue([day(1, 50), day(2, 50), day(3, 50)]);

      const result = await service.getTrendAnalysis(TENANT, query);

      expect(result.sales.direction).toBe('stable');
      expect(result.sales.strength).toBe(0);
    });

    it('marks customer growth upward when customers exist', async () => {
      prisma.customer.count.mockResolvedValue(12);

      const result = await service.getTrendAnalysis(TENANT, query);

      expect(result.customerGrowth).toEqual(
        expect.objectContaining({
          direction: 'upward',
          strength: 0.5,
          totalCustomers: 12,
          description: 'Total customers: 12',
        }),
      );
    });

    it('marks customer growth stable when no customers exist', async () => {
      prisma.customer.count.mockResolvedValue(0);

      const result = await service.getTrendAnalysis(TENANT, query);

      expect(result.customerGrowth).toEqual(
        expect.objectContaining({ direction: 'stable', strength: 0, totalCustomers: 0 }),
      );
    });

    it('scopes the order query to completed orders and the supplied dates', async () => {
      await service.getTrendAnalysis(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-02-01',
      } as never);

      const [args] = prisma.order.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: TENANT,
        status: 'COMPLETED',
        createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-02-01') },
      });
    });
  });

  describe('getSeasonality', () => {
    it('serves the cached payload without querying orders', async () => {
      cacheService.get.mockResolvedValue({ dayOfWeek: [] });

      await expect(service.getSeasonality(TENANT, query)).resolves.toEqual({ dayOfWeek: [] });
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('returns no insights when there are no orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getSeasonality(TENANT, query);

      expect(result.dayOfWeek).toEqual([]);
      expect(result.monthOfYear).toEqual([]);
      expect(result.insights.busiestDay).toBe('N/A');
      expect(result.insights.busiestMonth).toBe('N/A');
    });

    it('buckets revenue by weekday and identifies the busiest days', async () => {
      // 2026-01-04 is a Sunday, 2026-01-05 a Monday, 2026-01-06 a Tuesday.
      prisma.order.findMany.mockResolvedValue([
        { createdAt: new Date(Date.UTC(2026, 0, 4)), total: 10 },
        { createdAt: new Date(Date.UTC(2026, 0, 5)), total: 20 },
        { createdAt: new Date(Date.UTC(2026, 0, 5)), total: 20 },
        { createdAt: new Date(Date.UTC(2026, 0, 6)), total: 50 },
      ]);

      const result = await service.getSeasonality(TENANT, query);

      expect(result.dayOfWeek).toEqual([
        {
          day: 0,
          dayName: 'Sunday',
          totalRevenue: 10,
          orderCount: 1,
          revenuePercent: 10,
          orderPercent: 25,
        },
        {
          day: 1,
          dayName: 'Monday',
          totalRevenue: 40,
          orderCount: 2,
          revenuePercent: 40,
          orderPercent: 50,
        },
        {
          day: 2,
          dayName: 'Tuesday',
          totalRevenue: 50,
          orderCount: 1,
          revenuePercent: 50,
          orderPercent: 25,
        },
      ]);
      expect(result.insights.busiestDay).toBe('Monday');
      expect(result.insights.busiestMonth).toBe('Jan');
      expect(result.insights.weekdayVsWeekend).toEqual({ weekday: 3, weekend: 1 });
    });

    it('aggregates revenue per month of the year', async () => {
      prisma.order.findMany.mockResolvedValue([
        { createdAt: new Date(Date.UTC(2026, 0, 4)), total: 10 },
        { createdAt: new Date(Date.UTC(2026, 2, 4)), total: 30 },
        { createdAt: new Date(Date.UTC(2027, 2, 6)), total: 60 },
      ]);

      const result = await service.getSeasonality(TENANT, query);

      expect(result.monthOfYear).toEqual([
        {
          month: 1,
          monthName: 'Jan',
          totalRevenue: 10,
          orderCount: 1,
          revenuePercent: 10,
          orderPercent: 33.33,
        },
        {
          month: 3,
          monthName: 'Mar',
          totalRevenue: 90,
          orderCount: 2,
          revenuePercent: 90,
          orderPercent: 66.67,
        },
      ]);
      expect(result.insights.busiestMonth).toBe('Mar');
    });

    it('scopes the query to completed orders in the tenant', async () => {
      await service.getSeasonality(TENANT, query);

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, status: 'COMPLETED' },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });
  });

  describe('getGrowthProjection', () => {
    const order = (month: number, total: number) => ({
      createdAt: new Date(Date.UTC(2026, month, 15)),
      total,
    });

    it('serves the cached payload without running the queries', async () => {
      cacheService.get.mockResolvedValue({ projection: [] });

      await expect(service.getGrowthProjection(TENANT, query)).resolves.toEqual({ projection: [] });
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('reports zero growth when there are no completed orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.getGrowthProjection(TENANT, { periods: 2 } as never);

      expect(result.historical).toEqual([]);
      expect(result.projection).toHaveLength(2);
      expect(result.metrics.cagr).toBe(0);
      expect(result.metrics.monthsOfData).toBe(0);
      expect(result.projection[0].projectedRevenue).toBe(0);
    });

    it('computes a compound monthly growth rate across the history', async () => {
      prisma.order.findMany.mockResolvedValue([order(0, 100), order(1, 200), order(2, 400)]);
      prisma.customer.count.mockResolvedValueOnce(50).mockResolvedValueOnce(100);

      const result = await service.getGrowthProjection(TENANT, { periods: 2 } as never);

      // 100 -> 400 over two month gaps doubles monthly, so CAGR is 100%.
      expect(result.metrics.cagr).toBe(100);
      expect(result.metrics.monthsOfData).toBe(3);
      expect(result.metrics.customerGrowth).toBe(100);
      expect(result.metrics.totalCustomers).toBe(100);
    });

    it('reports a negative growth rate when the customer base shrank', async () => {
      prisma.order.findMany.mockResolvedValue([order(0, 100), order(1, 120)]);
      prisma.customer.count.mockResolvedValueOnce(100).mockResolvedValueOnce(50);

      const result = await service.getGrowthProjection(TENANT, { periods: 1 } as never);

      expect(result.metrics.customerGrowth).toBe(-50);
      expect(result.projection[0].projectedCustomers).toBe(50);
    });

    it('projects revenue, orders and customers forward from the last month', async () => {
      prisma.order.findMany.mockResolvedValue([order(0, 100), order(1, 110)]);
      prisma.customer.count.mockResolvedValueOnce(20).mockResolvedValueOnce(40);

      const result = await service.getGrowthProjection(TENANT, { periods: 2 } as never);

      expect(result.projection[0].month).toBe('2026-03');
      expect(result.projection[1].month).toBe('2026-04');
      expect(result.projection[0].projectedRevenue).toBeGreaterThan(110);
      expect(result.projection[1].projectedCustomers).toBeGreaterThanOrEqual(
        result.projection[0].projectedCustomers,
      );
    });

    it('does not divide by a zero prior customer count', async () => {
      prisma.order.findMany.mockResolvedValue([order(0, 100), order(1, 100)]);
      prisma.customer.count.mockResolvedValueOnce(0).mockResolvedValueOnce(10);

      const result = await service.getGrowthProjection(TENANT, { periods: 1 } as never);

      // max(1, customersThen) keeps the divisor at 1, so the growth reads as 1000%.
      expect(result.metrics.customerGrowth).toBe(1000);
    });

    it('restricts the history window to the last twelve months of completed orders', async () => {
      await service.getGrowthProjection(TENANT, query);

      const [args] = prisma.order.findMany.mock.calls[0];
      expect(args.where.status).toBe('COMPLETED');
      expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    });
  });
});
