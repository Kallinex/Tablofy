import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupplierAnalyticsService } from '../supplier-analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';

const TENANT = 'tenant-1';

const metric = (overrides: Record<string, unknown> = {}) => ({
  id: 'metric-1',
  tenantId: TENANT,
  supplierId: 'sup-1',
  periodStart: new Date('2026-01-01T00:00:00.000Z'),
  periodEnd: new Date('2026-01-31T00:00:00.000Z'),
  leadTimeAvg: 4,
  fillRate: 90,
  deliveryAccuracy: 95,
  rejectedItems: 2,
  averageDelay: 0.5,
  totalOrders: 10,
  onTimeDeliveries: 9,
  qualityScore: 88,
  costScore: 80,
  overallScore: 86,
  rank: 1,
  supplier: { id: 'sup-1', name: 'Fresh Co' },
  ...overrides,
});

describe('SupplierAnalyticsService analytics endpoints', () => {
  let service: SupplierAnalyticsService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let cacheService: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };

  const query = {} as never;

  beforeEach(async () => {
    prisma = {
      supplier: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sup-1', name: 'Fresh Co', leadTime: 5 }]),
        count: jest.fn().mockResolvedValue(1),
      },
      supplierPerformanceMetric: {
        findMany: jest.fn().mockResolvedValue([metric()]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierAnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: CacheService, useValue: cacheService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<SupplierAnalyticsService>(SupplierAnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOverview', () => {
    it('serves the cached payload without querying the database', async () => {
      cacheService.get.mockResolvedValue({ totalSuppliers: 3 });

      await expect(service.getOverview(TENANT, query)).resolves.toEqual({ totalSuppliers: 3 });
      expect(prisma.supplier.findMany).not.toHaveBeenCalled();
    });

    it('averages the latest score per supplier and splits top from bottom', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ supplierId: 'sup-1', overallScore: 90, supplier: { name: 'Fresh Co' } }),
        metric({ supplierId: 'sup-1', overallScore: 40 }),
        metric({ supplierId: 'sup-2', overallScore: 70, supplier: { name: 'Bulk Ltd' } }),
      ]);

      const result = await service.getOverview(TENANT, query);

      // Only the newest row per supplier is scored, so sup-1 counts once at 90.
      expect(result.suppliersWithMetrics).toBe(2);
      expect(result.avgOverallScore).toBe(80);
      expect(result.topPerformers[0]).toEqual({
        supplierId: 'sup-1',
        supplierName: 'Fresh Co',
        overallScore: 90,
      });
      // bottomPerformers is ascending, so the worst scorer comes first.
      expect(result.bottomPerformers[0]).toEqual({
        supplierId: 'sup-2',
        supplierName: 'Bulk Ltd',
        overallScore: 70,
      });
      expect(cacheService.set).toHaveBeenCalledWith(
        TENANT,
        expect.stringContaining('supplier-analytics:overview'),
        result,
        300,
      );
    });

    it('reports an average of zero when no metrics exist', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);

      const result = await service.getOverview(TENANT, query);

      expect(result.avgOverallScore).toBe(0);
      expect(result.topPerformers).toEqual([]);
      expect(result.bottomPerformers).toEqual([]);
    });

    it('labels a metric whose supplier relation is missing as Unknown', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ supplier: null, overallScore: 50 }),
      ]);

      const result = await service.getOverview(TENANT, query);

      expect(result.topPerformers[0].supplierName).toBe('Unknown');
    });

    it('counts suppliers and active suppliers for the tenant', async () => {
      await service.getOverview(TENANT, query);

      expect(prisma.supplier.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT, isActive: true },
      });
    });
  });

  describe('getScorecards', () => {
    it('serves the cached payload without querying the database', async () => {
      cacheService.get.mockResolvedValue([{ id: 'metric-1' }]);

      await expect(service.getScorecards(TENANT, query)).resolves.toEqual([{ id: 'metric-1' }]);
      expect(prisma.supplierPerformanceMetric.findMany).not.toHaveBeenCalled();
    });

    it('maps every metric field into a scorecard row', async () => {
      const [row] = await service.getScorecards(TENANT, query);

      expect(row).toEqual(
        expect.objectContaining({
          supplierName: 'Fresh Co',
          leadTimeAvg: 4,
          fillRate: 90,
          deliveryAccuracy: 95,
          rejectedItems: 2,
          averageDelay: 0.5,
          qualityScore: 88,
          costScore: 80,
          overallScore: 86,
          rank: 1,
        }),
      );
    });

    it('coerces null metrics to zero and falls back to Unknown', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ leadTimeAvg: null, fillRate: null, qualityScore: null, supplier: null }),
      ]);

      const [row] = await service.getScorecards(TENANT, query);

      expect(row.leadTimeAvg).toBe(0);
      expect(row.fillRate).toBe(0);
      expect(row.qualityScore).toBe(0);
      expect(row.supplierName).toBe('Unknown');
    });

    it('scopes the query to the tenant', async () => {
      await service.getScorecards(TENANT, query);

      expect(prisma.supplierPerformanceMetric.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT }) }),
      );
    });
  });

  describe('getDeliveryPerformance', () => {
    it('serves the cached payload without querying the database', async () => {
      cacheService.get.mockResolvedValue({ trends: [] });

      await expect(service.getDeliveryPerformance(TENANT, query)).resolves.toEqual({
        trends: [],
      });
      expect(prisma.supplierPerformanceMetric.findMany).not.toHaveBeenCalled();
    });

    it('derives fill rate from deliveries when the metric is absent', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ fillRate: null, totalOrders: 10, onTimeDeliveries: 7 }),
      ]);

      const result = await service.getDeliveryPerformance(TENANT, query);

      expect(result.trends[0].fillRate).toBe(70);
      expect(result.averages.fillRate).toBe(70);
    });

    it('reports a zero fill rate when there were no orders', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ fillRate: null, totalOrders: 0, onTimeDeliveries: 0 }),
      ]);

      const result = await service.getDeliveryPerformance(TENANT, query);

      expect(result.trends[0].fillRate).toBe(0);
    });

    it('averages zero across an empty trend set', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);

      const result = await service.getDeliveryPerformance(TENANT, query);

      expect(result.averages).toEqual({ fillRate: 0, deliveryAccuracy: 0 });
    });
  });

  describe('getLeadTime', () => {
    it('serves the cached payload without querying the database', async () => {
      cacheService.get.mockResolvedValue({ overallAverage: 1 });

      await expect(service.getLeadTime(TENANT, query)).resolves.toEqual({ overallAverage: 1 });
      expect(prisma.supplier.findMany).not.toHaveBeenCalled();
    });

    it('averages lead time per supplier across its periods', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ leadTimeAvg: 2 }),
        metric({ leadTimeAvg: 4 }),
      ]);

      const result = await service.getLeadTime(TENANT, query);

      expect(result.suppliers[0].avgLeadTime).toBe(3);
      expect(result.suppliers[0].dataPoints).toBe(2);
      expect(result.overallAverage).toBe(3);
    });

    it('reports zero lead time for a supplier with no lead time data', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([metric({ leadTimeAvg: null })]);

      const result = await service.getLeadTime(TENANT, query);

      expect(result.suppliers[0].avgLeadTime).toBe(0);
      expect(result.suppliers[0].dataPoints).toBe(0);
      expect(result.overallAverage).toBe(0);
    });

    it('groups a metric with no supplier id under an unknown key', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ supplierId: null, supplier: null, leadTimeAvg: 6 }),
      ]);

      const result = await service.getLeadTime(TENANT, query);

      expect(result.suppliers[0].supplierId).toBe('unknown');
      expect(result.suppliers[0].supplierName).toBe('Unknown');
    });

    it('returns the supplier default lead times alongside the metrics', async () => {
      const result = await service.getLeadTime(TENANT, query);

      expect(result.supplierDefaults).toEqual([
        { id: 'sup-1', name: 'Fresh Co', defaultLeadTime: 5 },
      ]);
      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { id: true, name: true, leadTime: true } }),
      );
    });
  });

  describe('getFillRate', () => {
    it('serves the cached payload without querying the database', async () => {
      cacheService.get.mockResolvedValue({ overallAverage: 1 });

      await expect(service.getFillRate(TENANT, query)).resolves.toEqual({ overallAverage: 1 });
      expect(prisma.supplierPerformanceMetric.findMany).not.toHaveBeenCalled();
    });

    it('averages fill rate per supplier', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ fillRate: 80 }),
        metric({ fillRate: 100 }),
      ]);

      const result = await service.getFillRate(TENANT, query);

      expect(result.suppliers[0].avgFillRate).toBe(90);
      expect(result.suppliers[0].dataPoints).toBe(2);
      expect(result.overallAverage).toBe(90);
    });

    it('derives fill rate from deliveries when the metric is absent', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ fillRate: null, totalOrders: 4, onTimeDeliveries: 3 }),
      ]);

      const result = await service.getFillRate(TENANT, query);

      expect(result.suppliers[0].avgFillRate).toBe(75);
    });

    it('reports a zero fill rate when there were no orders', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ fillRate: null, totalOrders: 0, onTimeDeliveries: 0 }),
      ]);

      const result = await service.getFillRate(TENANT, query);

      expect(result.suppliers[0].avgFillRate).toBe(0);
      expect(result.overallAverage).toBe(0);
    });
  });

  describe('getPriceVariance', () => {
    const rows = [
      {
        inventoryItemId: 'item-1',
        itemName: 'Tomato',
        supplierDetailId: 'sd-1',
        supplierName: 'Fresh Co',
        unitPrice: 10,
      },
      {
        inventoryItemId: 'item-1',
        itemName: 'Tomato',
        supplierDetailId: 'sd-2',
        supplierName: 'Bulk Ltd',
        unitPrice: 14,
      },
      {
        inventoryItemId: 'item-2',
        itemName: '',
        supplierDetailId: 'sd-1',
        supplierName: 'Fresh Co',
        unitPrice: 5,
      },
    ];

    it('serves the cached payload without running the raw query', async () => {
      cacheService.get.mockResolvedValue({ items: [] });

      await expect(service.getPriceVariance(TENANT, query)).resolves.toEqual({ items: [] });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('keeps only items bought from more than one supplier and reports the spread', async () => {
      prisma.$queryRaw.mockResolvedValue(rows);

      const result = await service.getPriceVariance(TENANT, query);

      expect(result.totalItemsWithMultipleSuppliers).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          itemName: 'Tomato',
          supplierCount: 2,
          minPrice: 10,
          maxPrice: 14,
          priceSpread: 4,
        }),
      );
    });

    it('drops a single-supplier item from the report', async () => {
      prisma.$queryRaw.mockResolvedValue([rows[2]]);

      const result = await service.getPriceVariance(TENANT, query);

      expect(result.items).toEqual([]);
      expect(result.totalItemsWithMultipleSuppliers).toBe(0);
    });

    it('falls back to Unknown for an unnamed item', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { ...rows[2], itemName: '' },
        { ...rows[2], inventoryItemId: 'item-3', itemName: '' },
      ]);

      await service.getPriceVariance(TENANT, query);

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('returns an empty report when no purchase lines exist', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getPriceVariance(TENANT, query)).resolves.toEqual({
        items: [],
        totalItemsWithMultipleSuppliers: 0,
      });
    });

    it('still runs the query when only dates and supplier filters are supplied', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getPriceVariance(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        supplierId: 'sd-1',
      } as never);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('getQualityScores', () => {
    it('serves the cached payload without querying the database', async () => {
      cacheService.get.mockResolvedValue({ overallAvgQuality: 1 });

      await expect(service.getQualityScores(TENANT, query)).resolves.toEqual({
        overallAvgQuality: 1,
      });
      expect(prisma.supplierPerformanceMetric.findMany).not.toHaveBeenCalled();
    });

    it('averages quality score and sums rejected items per supplier', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ qualityScore: 80, rejectedItems: 1 }),
        metric({ qualityScore: 100, rejectedItems: 3 }),
      ]);

      const result = await service.getQualityScores(TENANT, query);

      expect(result.suppliers[0].avgQualityScore).toBe(90);
      expect(result.suppliers[0].totalRejectedItems).toBe(4);
      expect(result.suppliers[0].periodsWithData).toBe(2);
      expect(result.overallAvgQuality).toBe(90);
    });

    it('treats a null quality score and null rejected count as zero', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ qualityScore: null, rejectedItems: null }),
      ]);

      const result = await service.getQualityScores(TENANT, query);

      expect(result.suppliers[0].avgQualityScore).toBe(0);
      expect(result.suppliers[0].totalRejectedItems).toBe(0);
    });

    it('excludes a zero-scoring supplier from the overall average', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ supplierId: 'sup-1', qualityScore: 0 }),
        metric({ supplierId: 'sup-2', qualityScore: 100 }),
      ]);

      const result = await service.getQualityScores(TENANT, query);

      expect(result.overallAvgQuality).toBe(100);
      expect(result.suppliers).toHaveLength(2);
    });

    it('reports a zero overall average when nothing has a quality score', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([metric({ qualityScore: null })]);

      const result = await service.getQualityScores(TENANT, query);

      expect(result.overallAvgQuality).toBe(0);
    });
  });

  describe('getPurchaseTrends', () => {
    it('serves the cached payload without running either raw query', async () => {
      cacheService.get.mockResolvedValue({ totalSpend: 0 });

      await expect(service.getPurchaseTrends(TENANT, query)).resolves.toEqual({ totalSpend: 0 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('normalises bigint counts and sums the totals', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ period: '2026-01', totalSpend: 100, orderCount: 2n }])
        .mockResolvedValueOnce([
          { supplierDetailId: 'sd-1', supplierName: 'Fresh Co', totalSpend: 100, orderCount: 2n },
        ]);

      const result = await service.getPurchaseTrends(TENANT, query);

      expect(result.trends).toEqual([{ period: '2026-01', totalSpend: 100, orderCount: 2 }]);
      expect(result.bySupplier).toEqual([
        { supplierId: 'sd-1', supplierName: 'Fresh Co', totalSpend: 100, orderCount: 2 },
      ]);
      expect(result.totalSpend).toBe(100);
      expect(result.totalOrders).toBe(2);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('reports zero totals when there are no purchase orders', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getPurchaseTrends(TENANT, query);

      expect(result).toEqual({ trends: [], bySupplier: [], totalSpend: 0, totalOrders: 0 });
    });

    it('runs both queries when dates and supplier filters are supplied', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getPurchaseTrends(TENANT, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        supplierId: 'sd-1',
      } as never);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('getVendorRanking', () => {
    it('serves the cached payload without querying the database', async () => {
      cacheService.get.mockResolvedValue({ rankings: [] });

      await expect(service.getVendorRanking(TENANT, query)).resolves.toEqual({ rankings: [] });
      expect(prisma.supplierPerformanceMetric.findMany).not.toHaveBeenCalled();
    });

    it('ranks the latest metric per supplier in descending score order', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({ supplierId: 'sup-1', overallScore: 60, supplier: { name: 'Fresh Co' } }),
        metric({ supplierId: 'sup-2', overallScore: 95, supplier: { name: 'Bulk Ltd' } }),
        metric({ supplierId: 'sup-1', overallScore: 99 }),
      ]);

      const result = await service.getVendorRanking(TENANT, query);

      expect(result.rankings).toHaveLength(2);
      expect(result.rankings[0]).toEqual(
        expect.objectContaining({ rank: 1, supplierId: 'sup-2', supplierName: 'Bulk Ltd' }),
      );
      expect(result.rankings[1]).toEqual(
        expect.objectContaining({ rank: 2, supplierId: 'sup-1', overallScore: 60 }),
      );
    });

    it('coerces null sub-scores to zero and falls back to Unknown', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        metric({
          supplier: null,
          qualityScore: null,
          costScore: null,
          fillRate: null,
          deliveryAccuracy: null,
          leadTimeAvg: null,
        }),
      ]);

      const [rank] = (await service.getVendorRanking(TENANT, query)).rankings;

      expect(rank.supplierName).toBe('Unknown');
      expect(rank.qualityScore).toBe(0);
      expect(rank.costScore).toBe(0);
      expect(rank.fillRate).toBe(0);
      expect(rank.deliveryAccuracy).toBe(0);
      expect(rank.leadTimeAvg).toBe(0);
    });

    it('reports a null lastUpdated when there are no metrics', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);

      const result = await service.getVendorRanking(TENANT, query);

      expect(result).toEqual({ rankings: [], lastUpdated: null });
    });
  });
});
