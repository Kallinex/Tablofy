import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryService } from '../inventory.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { InventoryGateway } from '../inventory.gateway';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { createMockMetrics } from '../../../test/mocks/metrics.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('InventoryService categories, restore and adjustment listing', () => {
  let service: InventoryService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;

  const gateway = {
    broadcastCategoryUpdate: jest.fn(),
    broadcastItemUpdate: jest.fn(),
    broadcastStockUpdate: jest.fn(),
    broadcastAdjustmentUpdate: jest.fn(),
    broadcastUnitUpdate: jest.fn(),
    broadcastCountUpdate: jest.fn(),
    broadcastWasteUpdate: jest.fn(),
  };

  const category = {
    id: 'cat-1',
    tenantId: testTenantId,
    name: 'Beverages',
    description: null,
    parentId: null,
    sortOrder: 1,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: InventoryGateway, useValue: gateway },
        { provide: MetricsService, useValue: createMockMetrics() },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;

    prisma.reset();
    auditLogs.reset();
    cache.reset();
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
  });

  describe('updateCategory', () => {
    it('updates the category and broadcasts the change', async () => {
      prisma.inventoryCategory.findFirst
        .mockResolvedValueOnce(category)
        .mockResolvedValueOnce(null);
      prisma.inventoryCategory.update.mockResolvedValue({ ...category, name: 'Cold Drinks' });

      const result = await service.updateCategory(
        'cat-1',
        { name: 'Cold Drinks', description: 'Chilled' },
        testTenantId,
        testUserId,
      );

      expect(result.name).toBe('Cold Drinks');
      expect(prisma.inventoryCategory.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: {
          name: 'Cold Drinks',
          description: 'Chilled',
          parentId: undefined,
          sortOrder: undefined,
        },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_CATEGORY_UPDATED' }),
      );
      expect(gateway.broadcastCategoryUpdate).toHaveBeenCalledWith(
        testTenantId,
        'category.updated',
        expect.objectContaining({ name: 'Cold Drinks' }),
      );
    });

    it('rejects renaming to a name another category already uses', async () => {
      prisma.inventoryCategory.findFirst
        .mockResolvedValueOnce(category)
        .mockResolvedValueOnce({ id: 'cat-2' });

      await expect(
        service.updateCategory('cat-1', { name: 'Cold Drinks' }, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.inventoryCategory.update).not.toHaveBeenCalled();
    });

    it('skips the duplicate check when the name is unchanged', async () => {
      prisma.inventoryCategory.findFirst.mockResolvedValueOnce(category);
      prisma.inventoryCategory.update.mockResolvedValue(category);

      await service.updateCategory(
        'cat-1',
        { name: 'Beverages', description: 'Updated copy' },
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryCategory.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.inventoryCategory.update).toHaveBeenCalled();
    });

    it('rejects updating a category from another tenant', async () => {
      prisma.inventoryCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCategory('cat-1', { name: 'X' }, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteCategory', () => {
    it('soft deletes the category and broadcasts the removal', async () => {
      prisma.inventoryCategory.findFirst.mockResolvedValue(category);

      await service.deleteCategory('cat-1', testTenantId, testUserId);

      expect(prisma.inventoryCategory.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'INVENTORY_CATEGORY_DELETED',
          oldValues: { name: 'Beverages' },
        }),
      );
      expect(gateway.broadcastCategoryUpdate).toHaveBeenCalledWith(
        testTenantId,
        'category.deleted',
        {
          id: 'cat-1',
        },
      );
    });

    it('rejects deleting a category from another tenant', async () => {
      prisma.inventoryCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteCategory('cat-1', testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getCategories', () => {
    it('returns the cached categories', async () => {
      cache.get.mockResolvedValue([{ id: 'cat-1' }]);

      await expect(service.getCategories(testTenantId)).resolves.toEqual([{ id: 'cat-1' }]);
      expect(prisma.inventoryCategory.findMany).not.toHaveBeenCalled();
    });

    it('lists live categories by sort order with children and item counts', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryCategory.findMany.mockResolvedValue([
        { ...category, _count: { items: 2 }, children: [] },
      ]);

      const result = await service.getCategories(testTenantId);

      expect(prisma.inventoryCategory.findMany).toHaveBeenCalledWith({
        where: { tenantId: testTenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        include: { children: true, _count: { select: { items: true } } },
      });
      expect(result).toHaveLength(1);
      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        'categories:list',
        result,
        expect.any(Number),
      );
    });
  });

  describe('restoreItem', () => {
    it('clears the soft delete and reactivates the item', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', deletedAt: new Date() });

      await service.restoreItem('item-1', testTenantId, testUserId);

      expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
        where: { id: 'item-1', tenantId: testTenantId, deletedAt: { not: null } },
      });
      expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { deletedAt: null, isActive: true },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_ITEM_RESTORED' }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'item:item-1');
      expect(gateway.broadcastItemUpdate).toHaveBeenCalledWith(testTenantId, 'item.restored', {
        id: 'item-1',
      });
    });

    it('rejects restoring an item that is not soft deleted', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.restoreItem('item-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });
  });

  describe('listAdjustments', () => {
    it('paginates newest first with no filters', async () => {
      prisma.stockAdjustment.findMany.mockResolvedValue([{ id: 'adj-1' }]);
      prisma.stockAdjustment.count.mockResolvedValue(1);

      const result = await service.listAdjustments(testTenantId, {});

      const [args] = prisma.stockAdjustment.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId, deletedAt: null });
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.include).toEqual({
        inventoryItem: { select: { id: true, name: true, sku: true } },
      });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('filters by status, type, item and branch', async () => {
      prisma.stockAdjustment.count.mockResolvedValue(0);

      await service.listAdjustments(testTenantId, {
        status: 'PENDING',
        type: 'INCREASE',
        inventoryItemId: 'item-1',
        branchId: 'branch-1',
      });

      const [args] = prisma.stockAdjustment.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: testTenantId,
        deletedAt: null,
        status: 'PENDING',
        type: 'INCREASE',
        inventoryItemId: 'item-1',
        branchId: 'branch-1',
      });
    });

    it.each([
      ['createdAt', { createdAt: 'asc' }],
      ['quantity', { quantity: 'asc' }],
    ])('sorts by %s with the requested order', async (sortBy, expected) => {
      await service.listAdjustments(testTenantId, { sortBy, sortOrder: 'asc' });

      const [args] = prisma.stockAdjustment.findMany.mock.calls[0];
      expect(args.orderBy).toEqual(expected);
    });

    it('falls back to newest first for an unknown sort column', async () => {
      await service.listAdjustments(testTenantId, { sortBy: 'nonsense' });

      const [args] = prisma.stockAdjustment.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('reports the next and previous page flags', async () => {
      prisma.stockAdjustment.count.mockResolvedValue(30);

      const result = await service.listAdjustments(testTenantId, { page: 2, limit: 10 });

      expect(result.meta).toEqual({
        total: 30,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });
  });
});
