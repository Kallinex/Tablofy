import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryService } from '../inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryGateway } from '../inventory.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { createMockMetrics } from '../../../test/mocks/metrics.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const mockGateway = {
    broadcastCategoryUpdate: jest.fn(),
    broadcastItemUpdate: jest.fn(),
    broadcastStockUpdate: jest.fn(),
    broadcastAdjustmentUpdate: jest.fn(),
    broadcastUnitUpdate: jest.fn(),
    broadcastCountUpdate: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: InventoryGateway, useValue: mockGateway },
        { provide: MetricsService, useValue: createMockMetrics() },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
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
  });

  describe('createCategory', () => {
    const dto = { name: 'Produce', description: 'Fresh produce items' };

    it('should create category in a transaction with audit', async () => {
      prisma.inventoryCategory.findFirst.mockResolvedValue(null);
      const fakeCategory = { id: 'cat-1', ...dto, tenantId: testTenantId };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          inventoryCategory: { create: jest.fn().mockResolvedValue(fakeCategory) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.createCategory(dto, testTenantId, testUserId);

      expect(result.id).toBe('cat-1');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockGateway.broadcastCategoryUpdate).toHaveBeenCalled();
    });

    it('should throw ConflictException for duplicate name', async () => {
      prisma.inventoryCategory.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.createCategory(dto, testTenantId, testUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('createUnit', () => {
    const dto = { name: 'Kilogram', abbreviation: 'kg', type: 'WEIGHT' };

    it('should create unit in a transaction with audit', async () => {
      prisma.inventoryUnit.findFirst.mockResolvedValue(null);
      const fakeUnit = { id: 'unit-1', ...dto, tenantId: testTenantId };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          inventoryUnit: { create: jest.fn().mockResolvedValue(fakeUnit) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.createUnit(dto, testTenantId, testUserId);

      expect(result.id).toBe('unit-1');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockGateway.broadcastUnitUpdate).toHaveBeenCalled();
    });

    it('should throw ConflictException for duplicate name', async () => {
      prisma.inventoryUnit.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.createUnit(dto, testTenantId, testUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('deleteItem', () => {
    it('should delete item in a transaction with audit', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        name: 'Tomato',
        sku: 'TOM-001',
        tenantId: testTenantId,
      });
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          inventoryItem: { update: jest.fn().mockResolvedValue({}) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      await service.deleteItem('item-1', testTenantId, testUserId);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'item:item-1');
      expect(mockGateway.broadcastItemUpdate).toHaveBeenCalledWith(testTenantId, 'item.deleted', {
        id: 'item-1',
      });
    });

    it('should throw NotFoundException when item does not exist', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.deleteItem('missing', testTenantId, testUserId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createCount', () => {
    const dto = {
      inventoryItemId: 'item-1',
      branchId: 'branch-1',
      countType: 'FULL',
      expectedQuantity: 10,
      actualQuantity: 8,
      notes: 'Short count',
    };

    it('should create count in a transaction with audit', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        tenantId: testTenantId,
        unitCost: 5,
      });
      const fakeCount = { id: 'count-1', tenantId: testTenantId, ...dto, variance: -2 };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          inventoryCount: { create: jest.fn().mockResolvedValue(fakeCount) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.createCount(dto, testTenantId, testUserId);

      expect(result.id).toBe('count-1');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(mockGateway.broadcastCountUpdate).toHaveBeenCalledWith(
        testTenantId,
        'count.created',
        fakeCount,
      );
    });

    it('should throw NotFoundException when item does not exist', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.createCount(dto, testTenantId, testUserId)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createItem', () => {
    const dto = {
      categoryId: 'cat-1',
      name: 'Tomato',
      sku: 'TOM-001',
      unitId: 'unit-1',
      currentQuantity: 100,
      reorderPoint: 20,
    };

    it('should create inventory item', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValueOnce(null);
      const fakeItem = { id: 'item-1', ...dto, tenantId: testTenantId };
      prisma.inventoryItem.create.mockResolvedValue(fakeItem);
      cache.get.mockResolvedValue(null);
      prisma.inventoryItem.findFirst.mockResolvedValueOnce({
        id: 'item-1',
        ...dto,
        tenantId: testTenantId,
      });

      const result = await service.createItem(dto, testTenantId, testUserId);

      expect(result).toBeDefined();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_ITEM_CREATED' }),
      );
    });

    it('should throw ConflictException for duplicate SKU', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'existing',
        tenantId: testTenantId,
        sku: 'TOM-001',
      });

      await expect(service.createItem(dto, testTenantId, testUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('createAdjustment', () => {
    const dto = {
      inventoryItemId: 'item-1',
      quantity: 10,
      reason: 'Restock',
    };

    it('should create INCREASE adjustment and stock movement', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        tenantId: testTenantId,
        currentQuantity: 50,
        reservedQuantity: 0,
        unitCost: 5,
      });
      const fakeTx = {
        stockAdjustment: { create: jest.fn().mockResolvedValue({ id: 'adj-1' }) },
        inventoryItem: {
          update: jest.fn().mockResolvedValue({ id: 'item-1', currentQuantity: 60 }),
        },
        stockMovement: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx));

      await service.createAdjustment(
        { ...dto, type: 'INCREASE' } as never,
        testTenantId,
        testUserId,
      );

      expect(fakeTx.stockAdjustment.create).toHaveBeenCalled();
      expect(fakeTx.stockMovement.create).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STOCK_ADJUSTMENT_CREATED' }),
      );
    });

    it('should throw NotFoundException for invalid item', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.createAdjustment(dto as never, testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listItems', () => {
    it('should return paginated items', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-1' }]);
      prisma.inventoryItem.count.mockResolvedValue(1);

      const result = await service.listItems(testTenantId, { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
    });

    it('should return cached result', async () => {
      const cached = { data: [{ id: 'item-1' }], meta: { total: 1, page: 1, limit: 20 } };
      cache.get.mockResolvedValue(cached);

      const result = await service.listItems(testTenantId, { page: 1, limit: 20 });

      expect(result).toEqual(cached);
      expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getLowStockItems', () => {
    beforeEach(() => {
      prisma.inventoryItem.fields = { minStock: 'MIN_STOCK', reorderLevel: 'REORDER_LEVEL' };
    });

    it('should push the minStock threshold into the SQL WHERE', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-1' }]);
      prisma.inventoryItem.count.mockResolvedValue(1);

      const result = await service.getLowStockItems(testTenantId, 1, 20);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: testTenantId,
            minStock: { not: null },
            currentQuantity: { lte: prisma.inventoryItem.fields.minStock },
          }),
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toEqual(expect.objectContaining({ data: [{ id: 'item-1' }] }));
    });

    it('should return the paginated envelope with meta', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-1' }]);
      prisma.inventoryItem.count.mockResolvedValue(25);

      const result = await service.getLowStockItems(testTenantId, 2, 20);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(result.meta).toEqual({
        total: 25,
        page: 2,
        limit: 20,
        totalPages: 2,
        hasNext: false,
        hasPrevious: true,
      });
    });
  });

  describe('getCriticalStockItems', () => {
    beforeEach(() => {
      prisma.inventoryItem.fields = { minStock: 'MIN_STOCK', reorderLevel: 'REORDER_LEVEL' };
    });

    it('should push the reorderLevel threshold into the SQL WHERE', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-2' }]);
      prisma.inventoryItem.count.mockResolvedValue(1);

      const result = await service.getCriticalStockItems(testTenantId);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: testTenantId,
            reorderLevel: { not: null },
            currentQuantity: { lte: prisma.inventoryItem.fields.reorderLevel },
          }),
        }),
      );
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getOutOfStockItems', () => {
    it('should filter currentQuantity lte 0 and return paginated envelope', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-3' }]);
      prisma.inventoryItem.count.mockResolvedValue(3);

      const result = await service.getOutOfStockItems(testTenantId, 1, 20);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: testTenantId,
            currentQuantity: { lte: 0 },
          }),
          skip: 0,
          take: 20,
        }),
      );
      expect(result.meta).toEqual({
        total: 3,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });
  });
});
