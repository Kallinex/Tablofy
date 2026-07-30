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

    it('should create category successfully', async () => {
      prisma.inventoryCategory.findFirst.mockResolvedValue(null);
      const fakeCategory = { id: 'cat-1', ...dto, tenantId: testTenantId };
      prisma.inventoryCategory.create.mockResolvedValue(fakeCategory);

      const result = await service.createCategory(dto, testTenantId, testUserId);

      expect(result.id).toBe('cat-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_CATEGORY_CREATED' }),
      );
      expect(mockGateway.broadcastCategoryUpdate).toHaveBeenCalled();
    });

    it('should throw ConflictException for duplicate name', async () => {
      prisma.inventoryCategory.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.createCategory(dto, testTenantId, testUserId)).rejects.toThrow(
        ConflictException,
      );
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
});
