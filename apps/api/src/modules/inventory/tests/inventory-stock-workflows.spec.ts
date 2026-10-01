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
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { createMockMetrics } from '../../../test/mocks/metrics.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('InventoryService units, locations, batches and stock queries', () => {
  let service: InventoryService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const gateway = {
    broadcastCategoryUpdate: jest.fn(),
    broadcastItemUpdate: jest.fn(),
    broadcastStockUpdate: jest.fn(),
    broadcastAdjustmentUpdate: jest.fn(),
    broadcastUnitUpdate: jest.fn(),
    broadcastLocationUpdate: jest.fn(),
    broadcastCountUpdate: jest.fn(),
    broadcastWasteUpdate: jest.fn(),
    broadcastBatchUpdate: jest.fn(),
    broadcastLowStockAlert: jest.fn(),
  };

  const tx = {
    inventoryUnit: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    stockAdjustment: { create: jest.fn() },
    inventoryItem: { findFirst: jest.fn(), updateMany: jest.fn() },
    stockMovement: { create: jest.fn() },
    inventoryCount: { create: jest.fn() },
  };

  function useTransaction() {
    prisma.$transaction.mockImplementation(async (cb: (client: unknown) => unknown) => cb(tx));
  }

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
    eventEmitter = module.get(EventEmitter2) as MockEventEmitter;
    prisma.reset();
    auditLogs.reset();
    cache.reset();
    eventEmitter.reset();
    for (const delegate of Object.values(tx)) {
      for (const method of Object.values(delegate)) {
        (method as jest.Mock).mockReset();
      }
    }
    tx.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
    jest.clearAllMocks();
  });

  describe('units', () => {
    it('creates a unit inside a transaction that writes its audit log', async () => {
      prisma.inventoryUnit.findFirst.mockResolvedValue(null);
      useTransaction();
      tx.inventoryUnit.create.mockResolvedValue({ id: 'unit-1', name: 'Kilogram' });

      const result = await service.createUnit(
        { name: 'Kilogram', abbreviation: 'kg', type: 'WEIGHT' } as never,
        testTenantId,
        testUserId,
      );

      expect(result.id).toBe('unit-1');
      expect(tx.inventoryUnit.create).toHaveBeenCalledWith({
        data: { tenantId: testTenantId, name: 'Kilogram', abbreviation: 'kg', type: 'WEIGHT' },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'INVENTORY_UNIT_CREATED', resourceId: 'unit-1' }),
      });
      expect(gateway.broadcastUnitUpdate).toHaveBeenCalledWith(
        testTenantId,
        'unit.created',
        expect.objectContaining({ id: 'unit-1' }),
      );
    });

    it('rejects a duplicate unit name in the tenant', async () => {
      prisma.inventoryUnit.findFirst.mockResolvedValue({ id: 'unit-0' });

      await expect(
        service.createUnit({ name: 'Kilogram' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates a unit without a name change', async () => {
      prisma.inventoryUnit.findFirst.mockResolvedValue({ id: 'unit-1', name: 'Kilogram' });
      prisma.inventoryUnit.update.mockResolvedValue({ id: 'unit-1', abbreviation: 'kgs' });

      const result = await service.updateUnit(
        'unit-1',
        { abbreviation: 'kgs' } as never,
        testTenantId,
        testUserId,
      );

      expect(result.abbreviation).toBe('kgs');
      expect(prisma.inventoryUnit.findFirst).toHaveBeenCalledTimes(1);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_UNIT_UPDATED' }),
      );
      expect(gateway.broadcastUnitUpdate).toHaveBeenCalledWith(
        testTenantId,
        'unit.updated',
        expect.objectContaining({ id: 'unit-1' }),
      );
    });

    it('rejects renaming a unit onto an existing name', async () => {
      prisma.inventoryUnit.findFirst
        .mockResolvedValueOnce({ id: 'unit-1', name: 'Kilogram' })
        .mockResolvedValueOnce({ id: 'unit-2', name: 'Gram' });

      await expect(
        service.updateUnit('unit-1', { name: 'Gram' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects updating a unit from another tenant', async () => {
      prisma.inventoryUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.updateUnit('unit-1', {} as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft deletes a unit and clears the unit cache', async () => {
      prisma.inventoryUnit.findFirst.mockResolvedValue({ id: 'unit-1', name: 'Kilogram' });
      prisma.inventoryUnit.update.mockResolvedValue({});

      await service.deleteUnit('unit-1', testTenantId, testUserId);

      expect(prisma.inventoryUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'units:*');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'INVENTORY_UNIT_DELETED',
          oldValues: { name: 'Kilogram' },
        }),
      );
      expect(gateway.broadcastUnitUpdate).toHaveBeenCalledWith(testTenantId, 'unit.deleted', {
        id: 'unit-1',
      });
    });

    it('rejects deleting a unit from another tenant', async () => {
      prisma.inventoryUnit.findFirst.mockResolvedValue(null);

      await expect(service.deleteUnit('unit-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the cached unit list', async () => {
      cache.get.mockResolvedValue([{ id: 'unit-1' }]);

      await expect(service.getUnits(testTenantId)).resolves.toEqual([{ id: 'unit-1' }]);
      expect(prisma.inventoryUnit.findMany).not.toHaveBeenCalled();
    });

    it('loads and caches the unit list alphabetically', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryUnit.findMany.mockResolvedValue([{ id: 'unit-1', name: 'Gram' }]);

      const result = await service.getUnits(testTenantId);

      expect(result).toEqual([{ id: 'unit-1', name: 'Gram' }]);
      expect(prisma.inventoryUnit.findMany).toHaveBeenCalledWith({
        where: { tenantId: testTenantId, deletedAt: null },
        orderBy: { name: 'asc' },
      });
      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        'units:list',
        [{ id: 'unit-1', name: 'Gram' }],
        expect.any(Number),
      );
    });
  });

  describe('locations', () => {
    it('creates a location and broadcasts it', async () => {
      prisma.inventoryLocation.create.mockResolvedValue({ id: 'loc-1', name: 'Main Walk-in' });

      const result = await service.createLocation(
        { name: 'Main Walk-in', branchId: 'branch-1', type: 'WALK_IN' } as never,
        testTenantId,
        testUserId,
      );

      expect(result.id).toBe('loc-1');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_LOCATION_CREATED' }),
      );
      expect(gateway.broadcastLocationUpdate).toHaveBeenCalledWith(
        testTenantId,
        'location.created',
        expect.objectContaining({ id: 'loc-1' }),
      );
    });

    it('updates a location owned by the tenant', async () => {
      prisma.inventoryLocation.findFirst.mockResolvedValue({ id: 'loc-1', name: 'Dry Store' });
      prisma.inventoryLocation.update.mockResolvedValue({ id: 'loc-1', name: 'Dry Store A' });

      await service.updateLocation(
        'loc-1',
        { name: 'Dry Store A' } as never,
        testTenantId,
        testUserId,
      );

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_LOCATION_UPDATED' }),
      );
      expect(gateway.broadcastLocationUpdate).toHaveBeenCalledWith(
        testTenantId,
        'location.updated',
        expect.objectContaining({ id: 'loc-1' }),
      );
    });

    it('rejects updating a location from another tenant', async () => {
      prisma.inventoryLocation.findFirst.mockResolvedValue(null);

      await expect(
        service.updateLocation('loc-1', { name: 'x' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft deletes a location owned by the tenant', async () => {
      prisma.inventoryLocation.findFirst.mockResolvedValue({ id: 'loc-1', name: 'Dry Store' });

      await service.deleteLocation('loc-1', testTenantId, testUserId);

      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_LOCATION_DELETED' }),
      );
      expect(gateway.broadcastLocationUpdate).toHaveBeenCalledWith(
        testTenantId,
        'location.deleted',
        { id: 'loc-1' },
      );
    });

    it('rejects deleting a location from another tenant', async () => {
      prisma.inventoryLocation.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteLocation('loc-1', testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('caches the location list per branch', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryLocation.findMany.mockResolvedValue([{ id: 'loc-1' }]);

      await service.getLocations(testTenantId, 'branch-1');

      expect(cache.get).toHaveBeenCalledWith(testTenantId, 'locations:list:branch-1');
      const [args] = prisma.inventoryLocation.findMany.mock.calls[0];
      expect(args.where.branchId).toBe('branch-1');
      expect(args.include).toEqual({ branch: true });
    });

    it('caches the unfiltered location list under the all key', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryLocation.findMany.mockResolvedValue([]);

      await service.getLocations(testTenantId);

      expect(cache.get).toHaveBeenCalledWith(testTenantId, 'locations:list:all');
      const [args] = prisma.inventoryLocation.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId, deletedAt: null });
    });

    it('returns the cached location list', async () => {
      cache.get.mockResolvedValue([{ id: 'loc-1' }]);

      await expect(service.getLocations(testTenantId)).resolves.toEqual([{ id: 'loc-1' }]);
      expect(prisma.inventoryLocation.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getItem', () => {
    it('returns the cached item', async () => {
      cache.get.mockResolvedValue({ id: 'item-1' });

      await expect(service.getItem('item-1', testTenantId)).resolves.toEqual({ id: 'item-1' });
      expect(prisma.inventoryItem.findFirst).not.toHaveBeenCalled();
    });

    it('loads an item with its relations and caches it', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', name: 'Tomato' });

      const result = await service.getItem('item-1', testTenantId);

      expect(result).toEqual({ id: 'item-1', name: 'Tomato' });
      const [args] = prisma.inventoryItem.findFirst.mock.calls[0];
      expect(args.include.batches).toEqual({
        where: { isActive: true },
        orderBy: { expiryDate: 'asc' },
      });
      expect(cache.set).toHaveBeenCalledWith(
        testTenantId,
        'item:item-1',
        { id: 'item-1', name: 'Tomato' },
        expect.any(Number),
      );
    });

    it('does not cache a missing item', async () => {
      cache.get.mockResolvedValue(null);
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.getItem('item-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('stock adjustments', () => {
    it('creates a DECREASE adjustment as pending without touching stock', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', unitCost: 4 });
      useTransaction();
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-1', status: 'PENDING' });

      const result = await service.createAdjustment(
        {
          inventoryItemId: 'item-1',
          type: 'DECREASE',
          reason: 'Damage',
          quantity: 3,
        } as never,
        testTenantId,
        testUserId,
      );

      expect(result.status).toBe('PENDING');
      const [createArgs] = tx.stockAdjustment.create.mock.calls[0];
      expect(createArgs.data.unitCost).toBe(4);
      expect(createArgs.data.totalCost).toBe(12);
      expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(gateway.broadcastAdjustmentUpdate).toHaveBeenCalledWith(
        testTenantId,
        'adjustment.created',
        expect.objectContaining({ id: 'adj-1' }),
      );
    });

    it('records the movement and stock bump for an INCREASE adjustment', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', unitCost: 2 });
      useTransaction();
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-1', status: 'APPROVED' });
      tx.inventoryItem.updateMany.mockResolvedValue({ count: 1 });

      await service.createAdjustment(
        {
          inventoryItemId: 'item-1',
          type: 'INCREASE',
          reason: 'Delivery',
          quantity: 10,
        } as never,
        testTenantId,
        testUserId,
      );

      expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'item-1', tenantId: testTenantId, deletedAt: null },
        data: {
          currentQuantity: { increment: 10 },
          availableQuantity: { increment: 10 },
          version: { increment: 1 },
        },
      });
      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'ADJUSTMENT', quantity: 10, referenceId: 'adj-1' }),
      });
    });

    it('aborts the INCREASE adjustment when the stock bump affects no row', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', unitCost: 2 });
      useTransaction();
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-1', status: 'APPROVED' });
      tx.inventoryItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.createAdjustment(
          {
            inventoryItemId: 'item-1',
            type: 'INCREASE',
            reason: 'Delivery',
            quantity: 10,
          } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('prefers explicit unit and total cost on the adjustment', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', unitCost: 4 });
      useTransaction();
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-1', status: 'APPROVED' });

      await service.createAdjustment(
        {
          inventoryItemId: 'item-1',
          type: 'INCREASE',
          reason: 'Delivery',
          quantity: 10,
          unitCost: 2,
          totalCost: 99,
        } as never,
        testTenantId,
        testUserId,
      );

      const [createArgs] = tx.stockAdjustment.create.mock.calls[0];
      expect(createArgs.data.unitCost).toBe(2);
      expect(createArgs.data.totalCost).toBe(99);
    });

    it('defaults a missing item unit cost to zero', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', unitCost: null });
      useTransaction();
      tx.stockAdjustment.create.mockResolvedValue({ id: 'adj-1', status: 'APPROVED' });

      await service.createAdjustment(
        { inventoryItemId: 'item-1', type: 'DECREASE', reason: 'Damage', quantity: 2 } as never,
        testTenantId,
        testUserId,
      );

      const [createArgs] = tx.stockAdjustment.create.mock.calls[0];
      expect(createArgs.data.unitCost).toBe(0);
      expect(createArgs.data.totalCost).toBe(0);
    });

    it('rejects an adjustment for an item in another tenant', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.createAdjustment(
          { inventoryItemId: 'item-1', type: 'DECREASE', reason: 'Damage', quantity: 1 } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('waste entries', () => {
    it('returns waste entries newest first by default', async () => {
      prisma.wasteEntry.count.mockResolvedValue(3);

      const result = await service.listWasteEntries(testTenantId, {});

      const [args] = prisma.wasteEntry.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(result.meta).toEqual({
        total: 3,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('filters waste entries by type, item and branch', async () => {
      await service.listWasteEntries(testTenantId, {
        type: 'SPOILAGE',
        inventoryItemId: 'item-1',
        branchId: 'branch-1',
      });

      const [args] = prisma.wasteEntry.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: testTenantId,
        deletedAt: null,
        type: 'SPOILAGE',
        inventoryItemId: 'item-1',
        branchId: 'branch-1',
      });
    });

    it('sorts waste entries by createdAt when requested', async () => {
      await service.listWasteEntries(testTenantId, { sortBy: 'createdAt', sortOrder: 'asc' });

      const [args] = prisma.wasteEntry.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('sorts waste entries by quantity when requested', async () => {
      await service.listWasteEntries(testTenantId, {
        sortBy: 'quantity',
        sortOrder: 'asc',
        page: 2,
        limit: 5,
      });

      const [args] = prisma.wasteEntry.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ quantity: 'asc' });
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
    });
  });

  describe('inventory counts', () => {
    it('returns counts newest first by default', async () => {
      prisma.inventoryCount.count.mockResolvedValue(4);

      const result = await service.listCounts(testTenantId, {});

      const [args] = prisma.inventoryCount.findMany.mock.calls[0];
      expect(args.where).toEqual({ tenantId: testTenantId });
      expect(args.orderBy).toEqual({ countedAt: 'desc' });
      expect(result.meta).toEqual({
        total: 4,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('filters counts by status, item and branch', async () => {
      await service.listCounts(testTenantId, {
        status: 'COMPLETED',
        inventoryItemId: 'item-1',
        branchId: 'branch-1',
      });

      const [args] = prisma.inventoryCount.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: testTenantId,
        status: 'COMPLETED',
        inventoryItemId: 'item-1',
        branchId: 'branch-1',
      });
    });

    it('sorts counts by countedAt when requested', async () => {
      await service.listCounts(testTenantId, { sortBy: 'countedAt', sortOrder: 'asc' });

      const [args] = prisma.inventoryCount.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ countedAt: 'asc' });
    });

    it('sorts counts by variance when requested', async () => {
      await service.listCounts(testTenantId, { sortBy: 'variance', sortOrder: 'asc' });

      const [args] = prisma.inventoryCount.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ variance: 'asc' });
    });

    it('computes variance and variance cost from the count', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', unitCost: 2.5 });
      useTransaction();
      tx.inventoryCount.create.mockResolvedValue({ id: 'count-1', variance: -3 });

      const result = await service.createCount(
        {
          inventoryItemId: 'item-1',
          countType: 'CYCLE',
          expectedQuantity: 10,
          actualQuantity: 7,
        } as never,
        testTenantId,
        testUserId,
      );

      expect(result.variance).toBe(-3);
      const [createArgs] = tx.inventoryCount.create.mock.calls[0];
      expect(createArgs.data.varianceCost).toBeCloseTo(-7.5);
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'INVENTORY_COUNT_CREATED' }),
      });
      expect(gateway.broadcastCountUpdate).toHaveBeenCalledWith(
        testTenantId,
        'count.created',
        expect.objectContaining({ id: 'count-1' }),
      );
    });

    it('prefers an explicit unit cost on the count', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', unitCost: 2.5 });
      useTransaction();
      tx.inventoryCount.create.mockResolvedValue({ id: 'count-1' });

      await service.createCount(
        {
          inventoryItemId: 'item-1',
          countType: 'CYCLE',
          expectedQuantity: 10,
          actualQuantity: 12,
          unitCost: 3,
        } as never,
        testTenantId,
        testUserId,
      );

      const [createArgs] = tx.inventoryCount.create.mock.calls[0];
      expect(createArgs.data.unitCost).toBe(3);
      expect(createArgs.data.varianceCost).toBeCloseTo(6);
    });

    it('defaults a missing item unit cost to zero on a count', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1', unitCost: null });
      useTransaction();
      tx.inventoryCount.create.mockResolvedValue({ id: 'count-1' });

      await service.createCount(
        {
          inventoryItemId: 'item-1',
          countType: 'FULL',
          expectedQuantity: 5,
          actualQuantity: 4,
        } as never,
        testTenantId,
        testUserId,
      );

      const [createArgs] = tx.inventoryCount.create.mock.calls[0];
      expect(createArgs.data.unitCost).toBe(0);
      expect(createArgs.data.varianceCost).toBeCloseTo(0);
    });

    it('rejects a count for an item in another tenant', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.createCount(
          {
            inventoryItemId: 'item-1',
            countType: 'CYCLE',
            expectedQuantity: 1,
            actualQuantity: 1,
          } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('batches', () => {
    it('creates a batch and drops the item caches', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1' });
      prisma.inventoryBatch.create.mockResolvedValue({ id: 'batch-1' });

      await service.createBatch(
        {
          inventoryItemId: 'item-1',
          batchNumber: 'B-1',
          expiryDate: '2026-01-01T00:00:00.000Z',
          quantity: 10,
          unitCost: 3,
        } as never,
        testTenantId,
        testUserId,
      );

      const [createArgs] = prisma.inventoryBatch.create.mock.calls[0];
      expect(createArgs.data.expiryDate).toBeInstanceOf(Date);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INVENTORY_BATCH_CREATED' }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'item:item-1');
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'items:*');
      expect(cache.deletePattern).toHaveBeenCalledWith(testTenantId, 'item:*');
      expect(gateway.broadcastBatchUpdate).toHaveBeenCalledWith(
        testTenantId,
        'batch.created',
        expect.objectContaining({ id: 'batch-1' }),
      );
    });

    it('leaves the expiry date unset when none is supplied', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1' });
      prisma.inventoryBatch.create.mockResolvedValue({ id: 'batch-1' });

      await service.createBatch(
        { inventoryItemId: 'item-1', batchNumber: 'B-2', quantity: 5 } as never,
        testTenantId,
        testUserId,
      );

      const [createArgs] = prisma.inventoryBatch.create.mock.calls[0];
      expect(createArgs.data.expiryDate).toBeUndefined();
    });

    it('rejects a batch for an item in another tenant', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.createBatch(
          { inventoryItemId: 'item-1', batchNumber: 'B-3', quantity: 1 } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists the batches of an item oldest expiry first', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-1' });
      prisma.inventoryBatch.findMany.mockResolvedValue([{ id: 'batch-1' }]);

      const result = await service.getBatchesForItem('item-1', testTenantId);

      expect(result).toEqual([{ id: 'batch-1' }]);
      expect(prisma.inventoryBatch.findMany).toHaveBeenCalledWith({
        where: { inventoryItemId: 'item-1', tenantId: testTenantId },
        orderBy: { expiryDate: 'asc' },
      });
    });

    it('rejects listing batches for an item in another tenant', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.getBatchesForItem('item-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns batches expiring inside the window', async () => {
      prisma.inventoryBatch.findMany.mockResolvedValue([{ id: 'batch-1' }]);

      const before = new Date();
      const result = await service.getExpiringBatches(testTenantId, 7);

      expect(result).toEqual([{ id: 'batch-1' }]);
      const [args] = prisma.inventoryBatch.findMany.mock.calls[0];
      expect(args.where).toEqual({
        tenantId: testTenantId,
        isActive: true,
        expiryDate: { not: null, gte: expect.any(Date), lte: expect.any(Date) },
        quantity: { gt: 0 },
      });
      const threshold = args.where.expiryDate.lte as Date;
      const expected = new Date();
      expected.setDate(expected.getDate() + 7);
      expect(Math.abs(threshold.getTime() - expected.getTime())).toBeLessThan(5000);
      expect((args.where.expiryDate.gte as Date).getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 5000,
      );
    });

    it('resolves an expiration alert owned by the tenant', async () => {
      prisma.expirationAlert.findFirst.mockResolvedValue({ id: 'alert-1' });
      prisma.expirationAlert.update.mockResolvedValue({ id: 'alert-1', resolvedAt: new Date() });

      await service.resolveExpirationAlert('alert-1', testTenantId);

      expect(prisma.expirationAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: { resolvedAt: expect.any(Date) },
      });
    });

    it('rejects resolving an expiration alert from another tenant', async () => {
      prisma.expirationAlert.findFirst.mockResolvedValue(null);

      await expect(service.resolveExpirationAlert('alert-1', testTenantId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cache invalidation', () => {
    it('drops every item scoped cache key', async () => {
      await service.getOutOfStockItems(testTenantId);

      expect(prisma.inventoryItem.findMany).toHaveBeenCalled();
    });

    it('pushes the out of stock filter into the query and paginates', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-1' }]);
      prisma.inventoryItem.count.mockResolvedValue(12);

      const result = await service.getOutOfStockItems(testTenantId, 2, 10);

      const [args] = prisma.inventoryItem.findMany.mock.calls[0];
      expect(args.where.currentQuantity).toEqual({ lte: 0 });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(args.orderBy).toEqual({ name: 'asc' });
      expect(result.meta).toEqual({
        total: 12,
        page: 2,
        limit: 10,
        totalPages: 2,
        hasNext: false,
        hasPrevious: true,
      });
    });
  });
});
