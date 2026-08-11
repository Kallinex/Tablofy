import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
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
    broadcastWasteUpdate: jest.fn(),
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
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      expect(fakeTx.inventoryItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'item-1', tenantId: testTenantId }),
          data: expect.objectContaining({
            currentQuantity: { increment: 10 },
            availableQuantity: { increment: 10 },
          }),
        }),
      );
      expect(fakeTx.stockMovement.create).toHaveBeenCalled();
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STOCK_ADJUSTMENT_CREATED' }),
      );
    });

    it('should not lose stock when two concurrent INCREASE adjustments race (P1-06)', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        tenantId: testTenantId,
        currentQuantity: 50,
        reservedQuantity: 0,
        unitCost: 5,
      });
      const release: Array<() => void> = [];
      const barrier = new Promise<void>((resolve) => {
        release.push(resolve);
        release.push(resolve);
      });
      let claims = 0;
      const updateMany = jest.fn().mockImplementation(async () => {
        await barrier;
        claims += 1;
        return { count: 1 };
      });
      const fakeTx = {
        stockAdjustment: { create: jest.fn().mockResolvedValue({ id: 'adj-1' }) },
        inventoryItem: { updateMany },
        stockMovement: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx));

      const first = service.createAdjustment(
        { ...dto, type: 'INCREASE' } as never,
        testTenantId,
        testUserId,
      );
      const second = service.createAdjustment(
        { ...dto, type: 'INCREASE' } as never,
        testTenantId,
        testUserId,
      );
      release.forEach((r) => r());
      const results = await Promise.allSettled([first, second]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(claims).toBe(2);
      expect(updateMany).toHaveBeenCalledTimes(2);
      expect(fakeTx.stockMovement.create).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException for invalid item', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.createAdjustment(dto as never, testTenantId, testUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('approveAdjustment', () => {
    const adjustment = (type: 'INCREASE' | 'DECREASE') => ({
      id: 'adj-1',
      tenantId: testTenantId,
      inventoryItemId: 'item-1',
      branchId: 'branch-1',
      type,
      quantity: 10,
      unitCost: 5,
      totalCost: 50,
      reason: 'Stock check',
      status: 'PENDING',
      deletedAt: null,
    });

    it('should reject when the status claim fails because it is no longer PENDING (P1-06)', async () => {
      prisma.stockAdjustment.findFirst.mockResolvedValue(adjustment('DECREASE'));
      const fakeTx = {
        inventoryItem: { findFirst: jest.fn().mockResolvedValue({ id: 'item-1' }) },
        stockAdjustment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        stockMovement: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx));

      await expect(service.approveAdjustment('adj-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
      expect(fakeTx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('should reject a DECREASE when stock is insufficient (P1-06)', async () => {
      prisma.stockAdjustment.findFirst.mockResolvedValue(adjustment('DECREASE'));
      const fakeTx = {
        inventoryItem: {
          findFirst: jest.fn().mockResolvedValue({ id: 'item-1', currentQuantity: 5 }),
          updateMany: jest
            .fn()
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValueOnce({ count: 0 }),
        },
        stockAdjustment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        stockMovement: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx));

      await expect(service.approveAdjustment('adj-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
      expect(fakeTx.inventoryItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'item-1',
            currentQuantity: { gte: 10 },
          }),
          data: expect.objectContaining({ currentQuantity: { decrement: 10 } }),
        }),
      );
      expect(fakeTx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('should atomically increment on INCREASE approval (P1-06)', async () => {
      prisma.stockAdjustment.findFirst.mockResolvedValue(adjustment('INCREASE'));
      prisma.stockAdjustment.findUnique.mockResolvedValue({ id: 'adj-1', status: 'APPROVED' });
      const fakeTx = {
        inventoryItem: {
          findFirst: jest.fn().mockResolvedValue({ id: 'item-1', currentQuantity: 50 }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        stockAdjustment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        stockMovement: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx));

      const result = await service.approveAdjustment('adj-1', testTenantId, testUserId);

      expect(result.status).toBe('APPROVED');
      expect(fakeTx.inventoryItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentQuantity: { increment: 10 },
            availableQuantity: { increment: 10 },
          }),
        }),
      );
    });
  });

  describe('createWasteEntry', () => {
    const dto = {
      inventoryItemId: 'item-1',
      type: 'SPOILAGE',
      quantity: 30,
      reason: 'Spoiled',
    };

    it('should allow only one of two concurrent waste entries that overdraw stock (P1-06)', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        tenantId: testTenantId,
        currentQuantity: 50,
        availableQuantity: 50,
        unitCost: 5,
      });
      const release: Array<() => void> = [];
      const barrier = new Promise<void>((resolve) => {
        release.push(resolve);
        release.push(resolve);
      });
      let claims = 0;
      const fakeTx = {
        wasteEntry: { create: jest.fn().mockResolvedValue({ id: 'waste-1' }) },
        inventoryItem: {
          updateMany: jest.fn().mockImplementation(async ({ where }) => {
            if (where && where.currentQuantity) {
              await barrier;
              return { count: ++claims === 1 ? 1 : 0 };
            }
            return { count: 1 };
          }),
        },
        stockMovement: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx));

      const first = service.createWasteEntry(dto as never, testTenantId, testUserId);
      const second = service.createWasteEntry(dto as never, testTenantId, testUserId);
      release.forEach((r) => r());
      const results = await Promise.allSettled([first, second]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(claims).toBe(2);
      expect(fakeTx.stockMovement.create).toHaveBeenCalledTimes(1);
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

  describe('P1-06 concurrency & lost-update scenarios', () => {
    const item = (version = 3) => ({
      id: 'item-1',
      tenantId: testTenantId,
      sku: 'SKU-1',
      name: 'Flour',
      currentQuantity: 50,
      reservedQuantity: 0,
      availableQuantity: 50,
      version,
    });

    it('updateItem pushes the version into the WHERE and increments it on success', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(item(3));
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });

      await service.updateItem(
        'item-1',
        { currentQuantity: 100, reservedQuantity: 10 } as never,
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'item-1', tenantId: testTenantId, version: 3, deletedAt: null },
        data: expect.objectContaining({
          currentQuantity: 100,
          reservedQuantity: 10,
          availableQuantity: 90,
          version: { increment: 1 },
        }),
      });
    });

    it('updateItem throws ConflictException when a concurrent write already bumped the version', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(item(3));
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateItem('item-1', { currentQuantity: 100 } as never, testTenantId, testUserId),
      ).rejects.toThrow(ConflictException);
      expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ version: 3 }) }),
      );
    });

    it('concurrent updateItem calls serialize on the version â€” the stale caller gets ConflictException', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(item(3));

      let stateVersion = 3;
      let arrived = 0;
      const release: Array<() => void> = [];
      const gate = new Promise<void>((resolve) => {
        release.push(resolve);
      });
      prisma.inventoryItem.updateMany.mockImplementation(
        async (args: { where: { version: number } }) => {
          arrived += 1;
          if (arrived === 2) release[0]();
          await gate;
          if (args.where.version === stateVersion) {
            stateVersion += 1;
            return { count: 1 };
          }
          return { count: 0 };
        },
      );

      const results = await Promise.allSettled([
        service.updateItem('item-1', { currentQuantity: 100 } as never, testTenantId, testUserId),
        service.updateItem('item-1', { currentQuantity: 200 } as never, testTenantId, testUserId),
      ]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(stateVersion).toBe(4);
      expect(prisma.inventoryItem.updateMany).toHaveBeenCalledTimes(2);
    });

    it('concurrent approvals of the same DECREASE adjustment apply the stock change exactly once', async () => {
      const adjustment = {
        id: 'adj-1',
        tenantId: testTenantId,
        inventoryItemId: 'item-1',
        branchId: 'branch-1',
        type: 'DECREASE',
        quantity: 30,
        unitCost: 5,
        totalCost: 150,
        reason: 'Stock check',
        status: 'PENDING',
        deletedAt: null,
      };
      prisma.stockAdjustment.findFirst.mockResolvedValue(adjustment);

      let itemQty = 50;
      let claims = 0;
      let arrived = 0;
      const release: Array<() => void> = [];
      const gate = new Promise<void>((resolve) => {
        release.push(resolve);
      });
      const fakeTx = {
        inventoryItem: {
          findFirst: jest.fn().mockResolvedValue({ id: 'item-1', currentQuantity: itemQty }),
          updateMany: jest
            .fn()
            .mockImplementation(async (args: { where: { currentQuantity?: { gte: number } } }) => {
              if (args.where.currentQuantity) {
                itemQty -= Number(args.where.currentQuantity.gte);
              }
              return { count: 1 };
            }),
        },
        stockAdjustment: {
          updateMany: jest.fn().mockImplementation(async () => {
            arrived += 1;
            if (arrived === 2) release[0]();
            await gate;
            return { count: ++claims === 1 ? 1 : 0 };
          }),
        },
        stockMovement: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx));
      prisma.stockAdjustment.findUnique.mockResolvedValue({ id: 'adj-1', status: 'APPROVED' });

      const results = await Promise.allSettled([
        service.approveAdjustment('adj-1', testTenantId, testUserId),
        service.approveAdjustment('adj-1', testTenantId, testUserId),
      ]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(itemQty).toBe(20);
      expect(fakeTx.stockMovement.create).toHaveBeenCalledTimes(1);
    });

    it('two DECREASE approvals sharing one item cannot overdraw â€” the gte guard rejects the loser', async () => {
      prisma.stockAdjustment.findFirst.mockImplementation(
        async (args: { where: { id: string } }) => ({
          id: args.where.id,
          tenantId: testTenantId,
          inventoryItemId: 'item-1',
          branchId: 'branch-1',
          type: 'DECREASE',
          quantity: 30,
          unitCost: 5,
          totalCost: 150,
          reason: 'Stock check',
          status: 'PENDING',
          deletedAt: null,
        }),
      );

      let itemQty = 50;
      let arrived = 0;
      const release: Array<() => void> = [];
      const gate = new Promise<void>((resolve) => {
        release.push(resolve);
      });
      const fakeTx = {
        inventoryItem: {
          findFirst: jest.fn().mockResolvedValue({ id: 'item-1', currentQuantity: itemQty }),
          updateMany: jest
            .fn()
            .mockImplementation(
              async (args: {
                where: { currentQuantity?: { gte: number }; availableQuantity?: { gte: number } };
              }) => {
                if (args.where.currentQuantity) {
                  arrived += 1;
                  if (arrived === 2) release[0]();
                  await gate;
                  const qty = Number(args.where.currentQuantity.gte);
                  if (itemQty < qty) return { count: 0 };
                  itemQty -= qty;
                  return { count: 1 };
                }
                return { count: 1 };
              },
            ),
        },
        stockAdjustment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        stockMovement: { create: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx));

      const results = await Promise.allSettled([
        service.approveAdjustment('adj-a', testTenantId, testUserId),
        service.approveAdjustment('adj-b', testTenantId, testUserId),
      ]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(itemQty).toBe(20);
      expect(fakeTx.stockMovement.create).toHaveBeenCalledTimes(1);
    });
  });
});
