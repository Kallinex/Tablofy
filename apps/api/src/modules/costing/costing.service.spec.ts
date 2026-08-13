import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ValuationMethod, Prisma } from '@prisma/client';
import { CostingService } from './costing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CacheService } from '../../common/services/cache.service';
import { createMockPrisma, MockPrisma } from '../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../test/mocks/cache.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../test/fixtures/auth.fixture';

describe('CostingService', () => {
  let service: CostingService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const baseItem = {
    id: 'item-1',
    tenantId: testTenantId,
    name: 'Tomato',
    sku: 'TOM-001',
    unitCost: 4,
    averageCost: 0,
    currentQuantity: 15,
    deletedAt: null,
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostingService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
      ],
    }).compile();

    service = module.get<CostingService>(CostingService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
  });

  beforeEach(() => {
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    jest.clearAllMocks();
    prisma.inventoryItem.findFirst.mockResolvedValue({ ...baseItem });
    prisma.inventoryValuation.create.mockResolvedValue({ id: 'valuation-1' });
  });

  describe('createValuation (WEIGHTED_AVERAGE)', () => {
    it('should use the stored averageCost when it is positive', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        ...baseItem,
        averageCost: 6.5,
        currentQuantity: 20,
      });

      const result = await service.createValuation(
        {
          inventoryItemId: 'item-1',
          valuationDate: '2026-01-01',
          method: ValuationMethod.WEIGHTED_AVERAGE,
        },
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryValuation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unitCost: 6.5, totalValue: 130 }),
      });
      expect(result).toEqual({ id: 'valuation-1' });
    });

    it('should weight each active batch by its quantity (Σ unitCost×qty / Σ qty)', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ ...baseItem, averageCost: 0 });
      prisma.inventoryBatch.findMany.mockResolvedValue([
        { quantity: new Prisma.Decimal('10'), unitCost: new Prisma.Decimal('5') },
        { quantity: new Prisma.Decimal('5'), unitCost: new Prisma.Decimal('8') },
      ]);

      await service.createValuation(
        {
          inventoryItemId: 'item-1',
          valuationDate: '2026-01-01',
          method: ValuationMethod.WEIGHTED_AVERAGE,
        },
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryValuation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unitCost: 6, totalValue: 90 }),
      });
    });

    it('should not treat the sum of per-unit costs as the total cost', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        ...baseItem,
        averageCost: 0,
        currentQuantity: 200,
      });
      prisma.inventoryBatch.findMany.mockResolvedValue([
        { quantity: new Prisma.Decimal('100'), unitCost: new Prisma.Decimal('9.5') },
        { quantity: new Prisma.Decimal('100'), unitCost: new Prisma.Decimal('0.5') },
      ]);

      await service.createValuation(
        {
          inventoryItemId: 'item-1',
          valuationDate: '2026-01-01',
          method: ValuationMethod.WEIGHTED_AVERAGE,
        },
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryValuation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unitCost: 5, totalValue: 1000 }),
      });
    });

    it('should compute exact weighted average for fractional quantities', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        ...baseItem,
        averageCost: 0,
        currentQuantity: 1.5,
      });
      prisma.inventoryBatch.findMany.mockResolvedValue([
        { quantity: new Prisma.Decimal('0.5'), unitCost: new Prisma.Decimal('3.3333') },
        { quantity: new Prisma.Decimal('1'), unitCost: new Prisma.Decimal('6.6667') },
      ]);

      const expected = new Prisma.Decimal('0.5')
        .times('3.3333')
        .plus(new Prisma.Decimal('1').times('6.6667'))
        .div('1.5')
        .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
        .toNumber();

      await service.createValuation(
        {
          inventoryItemId: 'item-1',
          valuationDate: '2026-01-01',
          method: ValuationMethod.WEIGHTED_AVERAGE,
        },
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryValuation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unitCost: expected }),
      });
    });

    it('should fall back to the item unitCost when no positive batches exist', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ ...baseItem, averageCost: 0 });
      prisma.inventoryBatch.findMany.mockResolvedValue([]);

      await service.createValuation(
        {
          inventoryItemId: 'item-1',
          valuationDate: '2026-01-01',
          method: ValuationMethod.WEIGHTED_AVERAGE,
        },
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryValuation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unitCost: 4 }),
      });
    });
  });

  describe('createValuation (FIFO)', () => {
    it('should use the oldest active positive batch cost', async () => {
      prisma.inventoryBatch.findMany.mockResolvedValue([{ unitCost: new Prisma.Decimal('3.25') }]);

      await service.createValuation(
        { inventoryItemId: 'item-1', valuationDate: '2026-01-01', method: ValuationMethod.FIFO },
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryValuation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unitCost: 3.25 }),
      });
    });
  });

  describe('createValuation (cross-cutting)', () => {
    it('should reject an item that does not belong to the tenant', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.createValuation(
          { inventoryItemId: 'item-1', valuationDate: '2026-01-01' },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should write an audit log and invalidate the valuation caches', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        ...baseItem,
        averageCost: 6.5,
        currentQuantity: 20,
      });

      await service.createValuation(
        { inventoryItemId: 'item-1', valuationDate: '2026-01-01' },
        testTenantId,
        testUserId,
      );

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'INVENTORY_VALUATION_CREATED',
          tenantId: testTenantId,
          userId: testUserId,
        }),
      );
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'valuations:*');
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'valuation:*');
    });
  });
});
