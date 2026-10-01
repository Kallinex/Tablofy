import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchasingService } from '../purchasing.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { PurchasingGateway } from '../purchasing.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue, MockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('PurchasingService order lifecycle, listings and goods receipts', () => {
  let service: PurchasingService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let queue: MockQueue;
  let eventEmitter: MockEventEmitter;

  const gateway = {
    broadcastPurchaseUpdate: jest.fn(),
    broadcastGoodsReceived: jest.fn(),
  };

  const tx = {
    purchaseOrder: { updateMany: jest.fn(), findUnique: jest.fn() },
    purchaseOrderItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    purchaseOrderApproval: { upsert: jest.fn() },
  };

  function useTransaction() {
    prisma.$transaction.mockImplementation(async (cb: (client: unknown) => unknown) => cb(tx));
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasingService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: PurchasingGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<PurchasingService>(PurchasingService);
    prisma = module.get(PrismaService) as MockPrisma;
    auditLogs = module.get(AuditLogsService) as MockAuditLogs;
    cache = module.get(CacheService) as MockCache;
    queue = module.get(QueueService) as MockQueue;
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
    tx.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'APPROVED' });
    tx.purchaseOrderItem.deleteMany.mockResolvedValue({ count: 0 });
    tx.purchaseOrderItem.createMany.mockResolvedValue({ count: 1 });
    tx.purchaseOrderApproval.upsert.mockResolvedValue({});
    prisma.inventoryItem.findMany.mockImplementation(
      (args?: { where?: { id?: { in?: string[] } } }) =>
        Promise.resolve((args?.where?.id?.in ?? []).map((id) => ({ id }))),
    );
    prisma.supplierDetail.findFirst.mockResolvedValue({ id: 'sup-1' });
    prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });
    jest.clearAllMocks();
  });

  describe('listPOs', () => {
    it('returns the cached purchase order list', async () => {
      cache.get.mockResolvedValue({ data: [], meta: { total: 0 } });

      await expect(service.listPOs(testTenantId, {})).resolves.toEqual({
        data: [],
        meta: { total: 0 },
      });
      expect(prisma.purchaseOrder.findMany).not.toHaveBeenCalled();
    });

    it('lists newest first by default and caches the envelope', async () => {
      cache.get.mockResolvedValue(null);
      prisma.purchaseOrder.count.mockResolvedValue(1);

      const result = await service.listPOs(testTenantId, {});

      const [args] = prisma.purchaseOrder.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.include._count).toEqual({ select: { goodsReceipts: true } });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'po:list:{}', result, 120);
    });

    it('filters by status, supplier, branch and order date window', async () => {
      await service.listPOs(testTenantId, {
        status: 'APPROVED' as never,
        supplierDetailId: 'sup-1',
        branchId: 'branch-1',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        page: 2,
        limit: 10,
      });

      const [args] = prisma.purchaseOrder.findMany.mock.calls[0];
      expect(args.where.status).toBe('APPROVED');
      expect(args.where.supplierDetailId).toBe('sup-1');
      expect(args.where.branchId).toBe('branch-1');
      expect(args.where.orderDate.gte).toBeInstanceOf(Date);
      expect(args.where.orderDate.lte).toBeInstanceOf(Date);
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
    });

    it('searches across po number, supplier reference and notes', async () => {
      await service.listPOs(testTenantId, { search: 'chicken' });

      const [args] = prisma.purchaseOrder.findMany.mock.calls[0];
      expect(args.where.OR).toHaveLength(3);
      expect(args.where.OR[0]).toEqual({
        poNumber: { contains: 'chicken', mode: 'insensitive' },
      });
    });

    it.each([
      ['poNumber', { poNumber: 'asc' }],
      ['orderDate', { orderDate: 'desc' }],
      ['expectedDate', { expectedDate: 'desc' }],
      ['total', { total: 'desc' }],
      ['status', { status: 'asc' }],
    ])('sorts by %s', async (sortBy, expected) => {
      await service.listPOs(testTenantId, { sortBy: sortBy as never });

      const [args] = prisma.purchaseOrder.findMany.mock.calls[0];
      expect(args.orderBy).toEqual(expected);
    });

    it('honours an explicit sort order override', async () => {
      await service.listPOs(testTenantId, { sortBy: 'total' as never, sortOrder: 'asc' as never });

      const [args] = prisma.purchaseOrder.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ total: 'asc' });
    });
  });

  describe('updatePO', () => {
    it('replaces the lines and recomputes the subtotal', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
        version: 2,
      });
      useTransaction();

      await service.updatePO(
        'po-1',
        {
          items: [
            { inventoryItemId: 'item-1', quantity: 2, unitPrice: 0.1 },
            { inventoryItemId: 'item-2', quantity: 3, unitPrice: 0.2, sortOrder: 7 },
          ],
          expectedDate: '2026-02-01',
        } as never,
        testTenantId,
        testUserId,
      );

      expect(tx.purchaseOrderItem.deleteMany).toHaveBeenCalledWith({
        where: { purchaseOrderId: 'po-1' },
      });
      const [createManyArgs] = tx.purchaseOrderItem.createMany.mock.calls[0];
      expect(createManyArgs.data).toEqual([
        expect.objectContaining({ lineTotal: 0.2, sortOrder: 0, purchaseOrderId: 'po-1' }),
        expect.objectContaining({ lineTotal: 0.6, sortOrder: 7, purchaseOrderId: 'po-1' }),
      ]);
      const [updateArgs] = tx.purchaseOrder.updateMany.mock.calls[0];
      expect(updateArgs.where).toEqual({ id: 'po-1', tenantId: testTenantId, version: 2 });
      expect(updateArgs.data.subtotal).toBeCloseTo(0.8);
      expect(updateArgs.data.total).toBeCloseTo(0.8);
      expect(updateArgs.data.expectedDate).toBeInstanceOf(Date);
      expect(auditLogs.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PO_UPDATED' }));
      expect(gateway.broadcastPurchaseUpdate).toHaveBeenCalledWith(
        testTenantId,
        'purchase.updated',
        expect.objectContaining({ id: 'po-1' }),
      );
    });

    it('skips line insertion when the item list is empty', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
        version: 1,
      });
      useTransaction();

      await service.updatePO('po-1', { items: [] } as never, testTenantId, testUserId);

      expect(tx.purchaseOrderItem.createMany).not.toHaveBeenCalled();
    });

    it('rejects an update when the optimistic lock is lost', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
        version: 1,
      });
      useTransaction();
      tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updatePO(
          'po-1',
          { items: [{ inventoryItemId: 'item-1', quantity: 1, unitPrice: 1 }] } as never,
          testTenantId,
          testUserId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates header fields without touching the lines', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'PENDING_APPROVAL',
        version: 5,
      });
      useTransaction();

      await service.updatePO('po-1', { notes: 'Rush' } as never, testTenantId, testUserId);

      expect(tx.purchaseOrderItem.deleteMany).not.toHaveBeenCalled();
      const [updateArgs] = tx.purchaseOrder.updateMany.mock.calls[0];
      expect(updateArgs.data.notes).toBe('Rush');
      expect(updateArgs.data.version).toEqual({ increment: 1 });
    });

    it('rejects header updates when the optimistic lock is lost', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
        version: 5,
      });
      useTransaction();
      tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updatePO('po-1', { notes: 'Rush' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects updating a purchase order from another tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePO('po-1', { notes: 'x' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects updating an order that is no longer editable', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'CLOSED',
        version: 1,
      });

      await expect(
        service.updatePO('po-1', { notes: 'x' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a branch that does not belong to the tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
        version: 1,
      });
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePO('po-1', { branchId: 'foreign' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('deletePO', () => {
    it('soft deletes a draft order and clears the caches', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
        poNumber: 'PO-1',
      });

      await service.deletePO('po-1', testTenantId, testUserId);

      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PO_DELETED',
          oldValues: { poNumber: 'PO-1', status: 'DRAFT' },
        }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'po:po-1');
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'po:stats');
      expect(gateway.broadcastPurchaseUpdate).toHaveBeenCalledWith(
        testTenantId,
        'purchase.deleted',
        { id: 'po-1' },
      );
    });

    it('rejects deleting an order that is not a draft', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', status: 'ORDERED' });

      await expect(service.deletePO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects deleting a purchase order from another tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(service.deletePO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('approvePO', () => {
    it('approves a pending order and queues the notification', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-1',
        status: 'PENDING_APPROVAL',
        version: 2,
      });
      useTransaction();
      tx.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'APPROVED' });

      const result = await service.approvePO('po-1', testUserId, testTenantId, true, 'Looks good');

      expect(result.status).toBe('APPROVED');
      expect(tx.purchaseOrderApproval.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { purchaseOrderId: 'po-1' } }),
      );
      const [updateArgs] = tx.purchaseOrder.updateMany.mock.calls[0];
      expect(updateArgs.where).toEqual({ id: 'po-1', tenantId: testTenantId, version: 2 });
      expect(updateArgs.data.status).toBe('APPROVED');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PO_APPROVED' }),
      );
      expect(gateway.broadcastPurchaseUpdate).toHaveBeenCalledWith(
        testTenantId,
        'purchase.approved',
        expect.objectContaining({ id: 'po-1' }),
      );
      expect(queue.addJob).toHaveBeenCalledWith('purchase-notifications', 'po-approved', {
        tenantId: testTenantId,
        userId: testUserId,
        payload: { poId: 'po-1', poNumber: 'PO-1', approved: true },
      });
    });

    it('rejects a pending order back to draft', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-1',
        status: 'PENDING_APPROVAL',
        version: 2,
      });
      useTransaction();
      tx.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'DRAFT' });

      const result = await service.approvePO(
        'po-1',
        testUserId,
        testTenantId,
        false,
        'Out of stock',
      );

      expect(result.status).toBe('DRAFT');
      const [updateArgs] = tx.purchaseOrder.updateMany.mock.calls[0];
      expect(updateArgs.data.status).toBe('DRAFT');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PO_REJECTED' }),
      );
      expect(queue.addJob).toHaveBeenCalledWith(
        'purchase-notifications',
        'po-approved',
        expect.objectContaining({ payload: expect.objectContaining({ approved: false }) }),
      );
    });

    it('rejects an approval when the optimistic lock is lost', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-1',
        status: 'PENDING_APPROVAL',
        version: 2,
      });
      useTransaction();
      tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.approvePO('po-1', testUserId, testTenantId, true),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a rejection when the optimistic lock is lost', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-1',
        status: 'PENDING_APPROVAL',
        version: 2,
      });
      useTransaction();
      tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.approvePO('po-1', testUserId, testTenantId, false),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('fails when the transaction returns no order', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-1',
        status: 'PENDING_APPROVAL',
        version: 2,
      });
      useTransaction();
      tx.purchaseOrder.findUnique.mockResolvedValue(null);

      await expect(
        service.approvePO('po-1', testUserId, testTenantId, true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects approving an order that is not pending approval', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', status: 'DRAFT' });

      await expect(
        service.approvePO('po-1', testUserId, testTenantId, true),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects approving a purchase order from another tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.approvePO('po-1', testUserId, testTenantId, true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('orderPO, receivePO and cancelPO', () => {
    it('orders an approved purchase order', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'APPROVED',
        version: 3,
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'ORDERED' });

      const result = await service.orderPO('po-1', testTenantId, testUserId);

      expect(result.status).toBe('ORDERED');
      expect(auditLogs.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PO_ORDERED' }));
      expect(gateway.broadcastPurchaseUpdate).toHaveBeenCalledWith(
        testTenantId,
        'purchase.ordered',
        expect.objectContaining({ id: 'po-1' }),
      );
    });

    it('rejects ordering an order that is not approved', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', status: 'DRAFT' });

      await expect(service.orderPO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('marks a fully received order as received and stamps the delivery date', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'ORDERED',
        version: 4,
        items: [{ quantity: 5, receivedQuantity: 5 }],
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'RECEIVED' });

      const result = await service.receivePO('po-1', testTenantId, testUserId);

      expect(result.status).toBe('RECEIVED');
      const [updateArgs] = prisma.purchaseOrder.updateMany.mock.calls[0];
      expect(updateArgs.data.status).toBe('RECEIVED');
      expect(updateArgs.data.deliveredDate).toBeInstanceOf(Date);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PO_RECEIVED',
          newValues: { status: 'RECEIVED', allReceived: true },
        }),
      );
    });

    it('marks a partially received order without a delivery date', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'PARTIALLY_RECEIVED',
        version: 4,
        items: [{ quantity: 5, receivedQuantity: 2 }],
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        status: 'PARTIALLY_RECEIVED',
      });

      await service.receivePO('po-1', testTenantId, testUserId);

      const [updateArgs] = prisma.purchaseOrder.updateMany.mock.calls[0];
      expect(updateArgs.data.status).toBe('PARTIALLY_RECEIVED');
      expect(updateArgs.data.deliveredDate).toBeUndefined();
    });

    it('rejects receiving an order that is not ordered yet', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', status: 'DRAFT', items: [] });

      await expect(service.receivePO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects receiving a purchase order from another tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(service.receivePO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('cancels an order and queues the notification', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-1',
        status: 'APPROVED',
        version: 6,
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'CANCELLED' });

      const result = await service.cancelPO(
        'po-1',
        testTenantId,
        testUserId,
        'Supplier dropped it',
      );

      expect(result.status).toBe('CANCELLED');
      const [updateArgs] = prisma.purchaseOrder.updateMany.mock.calls[0];
      expect(updateArgs.data.cancelReason).toBe('Supplier dropped it');
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PO_CANCELLED' }),
      );
      expect(queue.addJob).toHaveBeenCalledWith('purchase-notifications', 'po-cancelled', {
        tenantId: testTenantId,
        userId: testUserId,
        payload: { poId: 'po-1', poNumber: 'PO-1', reason: 'Supplier dropped it' },
      });
    });

    it('cancels an order without a reason', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-1',
        status: 'DRAFT',
        version: 1,
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'CANCELLED' });

      await service.cancelPO('po-1', testTenantId, testUserId);

      const [updateArgs] = prisma.purchaseOrder.updateMany.mock.calls[0];
      expect(updateArgs.data.cancelReason).toBeNull();
    });

    it('rejects cancelling an already cancelled order', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', status: 'CANCELLED' });

      await expect(service.cancelPO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects cancelling a closed order', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', status: 'CLOSED' });

      await expect(service.cancelPO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects cancelling a purchase order from another tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(service.cancelPO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a cancel when the optimistic lock is lost', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-1',
        status: 'DRAFT',
        version: 1,
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelPO('po-1', testTenantId, testUserId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('getPOStats', () => {
    it('returns the cached statistics', async () => {
      cache.get.mockResolvedValue({ counts: {}, totalValue: 0 });

      await expect(service.getPOStats(testTenantId)).resolves.toEqual({
        counts: {},
        totalValue: 0,
      });
      expect(prisma.purchaseOrder.count).not.toHaveBeenCalled();
    });

    it('counts each status and aggregates the value of live orders', async () => {
      cache.get.mockResolvedValue(null);
      prisma.purchaseOrder.count.mockResolvedValue(2);
      prisma.purchaseOrder.aggregate.mockResolvedValue({
        _sum: { total: 100 },
        _avg: { total: 50 },
        _count: { id: 2 },
      });

      const result = await service.getPOStats(testTenantId);

      expect(Object.keys(result.counts).length).toBeGreaterThan(0);
      expect(result.totalValue).toBe(100);
      expect(result.averageValue).toBe(50);
      expect(result.totalOrders).toBe(2);
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'po:stats', result, 300);
    });

    it('falls back to zero when the aggregate is empty', async () => {
      cache.get.mockResolvedValue(null);
      prisma.purchaseOrder.aggregate.mockResolvedValue({});

      const result = await service.getPOStats(testTenantId);

      expect(result).toEqual(
        expect.objectContaining({ totalValue: 0, averageValue: 0, totalOrders: 0 }),
      );
    });
  });

  describe('getGRN', () => {
    it('returns the cached goods receipt', async () => {
      cache.get.mockResolvedValue({ id: 'grn-1' });

      await expect(service.getGRN('grn-1', testTenantId)).resolves.toEqual({ id: 'grn-1' });
      expect(prisma.goodsReceipt.findFirst).not.toHaveBeenCalled();
    });

    it('loads a goods receipt with its relations and caches it', async () => {
      cache.get.mockResolvedValue(null);
      prisma.goodsReceipt.findFirst.mockResolvedValue({ id: 'grn-1', grnNumber: 'GRN-1' });

      const result = await service.getGRN('grn-1', testTenantId);

      expect(result).toEqual({ id: 'grn-1', grnNumber: 'GRN-1' });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'grn:grn-1', result, 300);
    });

    it('does not cache a goods receipt from another tenant', async () => {
      cache.get.mockResolvedValue(null);
      prisma.goodsReceipt.findFirst.mockResolvedValue(null);

      await expect(service.getGRN('grn-1', testTenantId)).rejects.toBeInstanceOf(NotFoundException);
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('listGRNs', () => {
    it('returns the cached goods receipt list', async () => {
      cache.get.mockResolvedValue({ data: [], meta: { total: 0 } });

      await expect(service.listGRNs(testTenantId, {})).resolves.toEqual({
        data: [],
        meta: { total: 0 },
      });
      expect(prisma.goodsReceipt.findMany).not.toHaveBeenCalled();
    });

    it('lists newest first by default and caches the envelope', async () => {
      cache.get.mockResolvedValue(null);
      prisma.goodsReceipt.count.mockResolvedValue(3);

      const result = await service.listGRNs(testTenantId, {});

      const [args] = prisma.goodsReceipt.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(args.include.purchaseOrder).toEqual({ select: { poNumber: true } });
      expect(result.meta).toEqual({
        total: 3,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
      expect(cache.set).toHaveBeenCalledWith(testTenantId, 'grn:list:{}', result, 120);
    });

    it('filters by status, order, branch and received date window', async () => {
      await service.listGRNs(testTenantId, {
        status: 'COMPLETED' as never,
        purchaseOrderId: 'po-1',
        branchId: 'branch-1',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        page: 3,
        limit: 5,
      });

      const [args] = prisma.goodsReceipt.findMany.mock.calls[0];
      expect(args.where.status).toBe('COMPLETED');
      expect(args.where.purchaseOrderId).toBe('po-1');
      expect(args.where.branchId).toBe('branch-1');
      expect(args.where.receivedDate.gte).toBeInstanceOf(Date);
      expect(args.where.receivedDate.lte).toBeInstanceOf(Date);
      expect(args.skip).toBe(10);
      expect(args.take).toBe(5);
    });

    it('sorts by received date when requested', async () => {
      await service.listGRNs(testTenantId, { sortBy: 'receivedDate' as never });

      const [args] = prisma.goodsReceipt.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ receivedDate: 'desc' });
    });

    it('sorts by grn number when requested', async () => {
      await service.listGRNs(testTenantId, {
        sortBy: 'grnNumber' as never,
        sortOrder: 'desc' as never,
      });

      const [args] = prisma.goodsReceipt.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ grnNumber: 'desc' });
    });

    it('sorts by status when requested', async () => {
      await service.listGRNs(testTenantId, { sortBy: 'status' as never });

      const [args] = prisma.goodsReceipt.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ status: 'asc' });
    });
  });

  describe('updateGRN', () => {
    it('updates a pending goods receipt and clears its caches', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue({ id: 'grn-1', status: 'PENDING' });
      prisma.goodsReceipt.update.mockResolvedValue({ id: 'grn-1', notes: 'Recounted' });

      const result = await service.updateGRN(
        'grn-1',
        { notes: 'Recounted', receivedDate: '2026-03-01' } as never,
        testTenantId,
        testUserId,
      );

      expect(result.notes).toBe('Recounted');
      const [args] = prisma.goodsReceipt.update.mock.calls[0];
      expect(args.data.receivedDate).toBeInstanceOf(Date);
      expect(auditLogs.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GRN_UPDATED' }),
      );
      expect(cache.delete).toHaveBeenCalledWith(testTenantId, 'grn:grn-1');
      expect(gateway.broadcastGoodsReceived).toHaveBeenCalledWith(
        testTenantId,
        'goods.updated',
        expect.objectContaining({ id: 'grn-1' }),
      );
    });

    it('leaves the received date untouched when none is supplied', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue({ id: 'grn-1', status: 'PENDING' });
      prisma.goodsReceipt.update.mockResolvedValue({ id: 'grn-1' });

      await service.updateGRN('grn-1', { notes: 'Only notes' } as never, testTenantId, testUserId);

      const [args] = prisma.goodsReceipt.update.mock.calls[0];
      expect(args.data.receivedDate).toBeUndefined();
    });

    it('rejects updating a completed goods receipt', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue({ id: 'grn-1', status: 'COMPLETED' });

      await expect(
        service.updateGRN('grn-1', { notes: 'x' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects updating a goods receipt from another tenant', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue(null);

      await expect(
        service.updateGRN('grn-1', { notes: 'x' } as never, testTenantId, testUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
