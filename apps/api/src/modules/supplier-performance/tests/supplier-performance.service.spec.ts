import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@nestjs/common';
import { SupplierPerformanceService } from '../supplier-performance.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId } from '../../../test/fixtures/auth.fixture';
import { CreatePerformanceDto } from '../dto/create-performance.dto';
import { QueryPerformanceDto } from '../dto/query-performance.dto';

const userId = 'user-1';

function baseDto(overrides: Partial<CreatePerformanceDto> = {}): CreatePerformanceDto {
  return {
    periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-01-31T23:59:59.000Z',
    ...overrides,
  };
}

describe('SupplierPerformanceService', () => {
  let service: SupplierPerformanceService;
  let prisma: MockPrisma;
  let audit: MockAuditLogs;
  let cache: MockCache;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPerformanceService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<SupplierPerformanceService>(SupplierPerformanceService);
    prisma = module.get(PrismaService) as MockPrisma;
    audit = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
  });

  beforeEach(() => {
    prisma.reset();
    audit.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    cache.deletePattern.mockResolvedValue(undefined);
  });

  describe('create', () => {
    it('computes the weighted overall score and persists the metric', async () => {
      prisma.supplierPerformanceMetric.create.mockResolvedValue({
        id: 'm-1',
        overallScore: 82,
      });

      await service.create(
        baseDto({ qualityScore: 90, costScore: 80, deliveryAccuracy: 70, fillRate: 90 }),
        testTenantId,
        userId,
      );

      const createArg = prisma.supplierPerformanceMetric.create.mock.calls[0][0];
      // 90*0.3 + 80*0.3 + 70*0.2 + 90*0.2 = 27 + 24 + 14 + 18 = 83
      expect(createArg.data.overallScore).toBe(83);
      expect(createArg.data.tenantId).toBe(testTenantId);
      expect(createArg.data.periodStart).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    });

    it('derives delivery accuracy from on-time deliveries when not supplied', async () => {
      prisma.supplierPerformanceMetric.create.mockResolvedValue({ id: 'm-1', overallScore: 0 });

      await service.create(
        baseDto({
          qualityScore: 0,
          costScore: 0,
          fillRate: 0,
          onTimeDeliveries: 9,
          totalOrders: 10,
        }),
        testTenantId,
        userId,
      );

      const createArg = prisma.supplierPerformanceMetric.create.mock.calls[0][0];
      // delivery = 90, weight 0.2 => 18
      expect(createArg.data.overallScore).toBe(18);
    });

    it('does not divide by zero when totalOrders is 0 and no deliveryAccuracy is given', async () => {
      prisma.supplierPerformanceMetric.create.mockResolvedValue({ id: 'm-1', overallScore: 0 });

      await service.create(
        baseDto({
          qualityScore: 50,
          costScore: 50,
          fillRate: 50,
          onTimeDeliveries: 0,
          totalOrders: 0,
        }),
        testTenantId,
        userId,
      );

      const createArg = prisma.supplierPerformanceMetric.create.mock.calls[0][0];
      expect(createArg.data.overallScore).not.toBeNaN();
      expect(Number.isFinite(createArg.data.overallScore)).toBe(true);
      // 50*0.3 + 50*0.3 + 0 + 50*0.2 = 15 + 15 + 0 + 10 = 40
      expect(createArg.data.overallScore).toBe(40);
    });

    it('connects supplier and supplierDetail when ids are provided', async () => {
      prisma.supplierPerformanceMetric.create.mockResolvedValue({ id: 'm-1', overallScore: 0 });

      await service.create(
        baseDto({ supplierId: 'sup-1', supplierDetailId: 'det-1' }),
        testTenantId,
        userId,
      );

      const createArg = prisma.supplierPerformanceMetric.create.mock.calls[0][0];
      expect(createArg.data.supplier).toEqual({ connect: { id: 'sup-1' } });
      expect(createArg.data.supplierDetail).toEqual({ connect: { id: 'det-1' } });
    });

    it('writes an audit log and invalidates the list cache', async () => {
      prisma.supplierPerformanceMetric.create.mockResolvedValue({ id: 'm-9', overallScore: 55 });

      await service.create(baseDto({ supplierId: 'sup-1' }), testTenantId, userId);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUPPLIER_PERFORMANCE_CREATED',
          resource: 'SupplierPerformanceMetric',
          resourceId: 'm-9',
          tenantId: testTenantId,
          userId,
        }),
      );
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'supplier-performance:*');
    });
  });

  describe('findAll', () => {
    it('returns the cached page without hitting the database', async () => {
      const cached = { data: [{ id: 'm-1' }], meta: { total: 1 } };
      cache.get.mockResolvedValue(cached);

      expect(await service.findAll(testTenantId, {} as QueryPerformanceDto)).toEqual(cached);
      expect(prisma.supplierPerformanceMetric.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query by tenant and applies pagination metadata', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([{ id: 'm-1' }]);
      prisma.supplierPerformanceMetric.count.mockResolvedValue(25);

      const result = await service.findAll(testTenantId, {
        page: 2,
        limit: 10,
      } as QueryPerformanceDto);

      const where = prisma.supplierPerformanceMetric.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ tenantId: testTenantId });
      expect(prisma.supplierPerformanceMetric.findMany.mock.calls[0][0].skip).toBe(10);
      expect(prisma.supplierPerformanceMetric.findMany.mock.calls[0][0].take).toBe(10);
      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });

    it('adds supplier filters when provided', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);
      prisma.supplierPerformanceMetric.count.mockResolvedValue(0);

      await service.findAll(testTenantId, {
        supplierId: 'sup-1',
        supplierDetailId: 'det-1',
      } as QueryPerformanceDto);

      const where = prisma.supplierPerformanceMetric.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        tenantId: testTenantId,
        supplierId: 'sup-1',
        supplierDetailId: 'det-1',
      });
    });

    it('caches the page for 120 seconds', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);
      prisma.supplierPerformanceMetric.count.mockResolvedValue(0);

      await service.findAll(testTenantId, {} as QueryPerformanceDto);

      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        expect.stringContaining('supplier-performance:list'),
        expect.any(Object),
        120,
      );
    });
  });

  describe('findOne', () => {
    it('scopes by tenant and throws when not found', async () => {
      prisma.supplierPerformanceMetric.findFirst.mockResolvedValue(null);

      await expect(service.findOne('m-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.supplierPerformanceMetric.findFirst).toHaveBeenCalledWith({
        where: { id: 'm-1', tenantId: testTenantId },
        include: { supplier: true, supplierDetail: true },
      });
    });

    it('returns the metric when found', async () => {
      const metric = { id: 'm-1', tenantId: testTenantId };
      prisma.supplierPerformanceMetric.findFirst.mockResolvedValue(metric);

      expect(await service.findOne('m-1', testTenantId)).toBe(metric);
    });
  });

  describe('findBySupplier', () => {
    it('scopes history by supplier and tenant, newest first', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);

      await service.findBySupplier('sup-1', testTenantId);

      expect(prisma.supplierPerformanceMetric.findMany).toHaveBeenCalledWith({
        where: { supplierId: 'sup-1', tenantId: testTenantId },
        orderBy: { periodStart: 'desc' },
        include: { supplier: true },
      });
    });
  });

  describe('getRanking', () => {
    it('numbers suppliers in descending overall-score order', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([
        {
          supplierId: 'a',
          overallScore: 95,
          qualityScore: 90,
          costScore: 80,
          totalOrders: 4,
          supplier: { name: 'A' },
          periodStart: new Date(),
          periodEnd: new Date(),
        },
        {
          supplierId: 'b',
          overallScore: 70,
          qualityScore: null,
          costScore: null,
          totalOrders: 2,
          supplier: null,
          periodStart: new Date(),
          periodEnd: new Date(),
        },
      ]);

      const result = await service.getRanking(testTenantId);

      expect(result[0]).toMatchObject({
        rank: 1,
        supplierId: 'a',
        supplierName: 'A',
        qualityScore: 90,
      });
      expect(result[1]).toMatchObject({
        rank: 2,
        supplierId: 'b',
        supplierName: 'Unknown',
        qualityScore: 0,
        costScore: 0,
      });
    });

    it('excludes metrics with a null overall score at the database level', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);

      await service.getRanking(testTenantId);

      expect(prisma.supplierPerformanceMetric.findMany.mock.calls[0][0].where).toEqual({
        tenantId: testTenantId,
        overallScore: { not: null },
      });
    });

    it('caches the ranking for 300 seconds', async () => {
      prisma.supplierPerformanceMetric.findMany.mockResolvedValue([]);

      await service.getRanking(testTenantId);

      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'supplier-performance:ranking', [], 300);
    });

    it('serves a cached ranking without querying', async () => {
      cache.get.mockResolvedValue([{ rank: 1 }]);

      expect(await service.getRanking(testTenantId)).toEqual([{ rank: 1 }]);
      expect(prisma.supplierPerformanceMetric.findMany).not.toHaveBeenCalled();
    });
  });
});
