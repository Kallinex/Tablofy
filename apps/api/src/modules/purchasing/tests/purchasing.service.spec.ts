import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PurchasingService } from '../purchasing.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CacheService } from '../../../common/services/cache.service';
import { QueueService } from '../../queues/queue.service';
import { PurchasingGateway } from '../purchasing.gateway';
import { createMockPrisma, MockPrisma } from '../../../test/mocks/prisma.mock';
import { createMockAuditLogs, MockAuditLogs } from '../../../test/mocks/audit-log.mock';
import { createMockCache, MockCache } from '../../../test/mocks/cache.mock';
import { createMockQueue } from '../../../test/mocks/queue.mock';
import { createMockEventEmitter, MockEventEmitter } from '../../../test/mocks/event-emitter.mock';
import { testTenantId, testUserId } from '../../../test/fixtures/auth.fixture';

describe('PurchasingService', () => {
  let service: PurchasingService;
  let prisma: MockPrisma;
  let auditLogs: MockAuditLogs;
  let cache: MockCache;
  let eventEmitter: MockEventEmitter;

  const mockGateway = {
    broadcastPurchaseUpdate: jest.fn(),
    broadcastGoodsReceived: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasingService,
        { provide: PrismaService, useValue: createMockPrisma() },
        { provide: AuditLogsService, useValue: createMockAuditLogs() },
        { provide: CacheService, useValue: createMockCache() },
        { provide: QueueService, useValue: createMockQueue() },
        { provide: EventEmitter2, useValue: createMockEventEmitter() },
        { provide: PurchasingGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<PurchasingService>(PurchasingService);
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

    prisma.inventoryItem.findMany.mockImplementation(
      (args?: { where?: { id?: { in?: string[] } } }) =>
        Promise.resolve((args?.where?.id?.in ?? []).map((id) => ({ id }))),
    );
    prisma.supplierDetail.findFirst.mockResolvedValue({ id: 'sup-1' });
    prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });
  });

  describe('createPO', () => {
    const dto = {
      supplierDetailId: 'sup-1',
      branchId: 'branch-1',
      items: [
        { inventoryItemId: 'item-1', quantity: 1, unitPrice: 0.1 },
        { inventoryItemId: 'item-2', quantity: 1, unitPrice: 0.2 },
      ],
    };

    it('should compute the subtotal with exact 2dp decimal math (0.1 + 0.2 = 0.3)', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'po-1',
        tenantId: testTenantId,
        items: [],
        supplierDetail: null,
      });
      const created = {
        id: 'po-1',
        poNumber: 'PO-20260810-00001',
        tenantId: testTenantId,
        subtotal: 0.3,
        total: 0.3,
        status: 'DRAFT',
      };
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) => {
        const tx = prisma.$transaction as unknown as { getMockName(): string };
        void tx;
        return fn(prisma as unknown as MockPrisma);
      });
      prisma.purchaseOrder.create.mockResolvedValue(created);

      await service.createPO(dto, testTenantId, testUserId);

      const createCall = prisma.purchaseOrder.create.mock.calls[0][0];
      expect(createCall.data.subtotal).toBe(0.3);
      expect(createCall.data.total).toBe(0.3);
      const lineTotals = createCall.data.items.create.map(
        (item: { lineTotal: number }) => item.lineTotal,
      );
      expect(lineTotals).toEqual([0.1, 0.2]);
    });

    it('should retry PO number allocation on a unique-constraint conflict (P2002)', async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`tenantId`,`poNumber`,`deletedAt`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['tenantId', 'poNumber', 'deletedAt'] },
        },
      );

      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');

      prisma.purchaseOrder.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ poNumber: `PO-${datePart}-00001` })
        .mockResolvedValue({
          id: 'po-1',
          tenantId: testTenantId,
          items: [],
          supplierDetail: null,
        });

      const createdNumbers: string[] = [];
      let attempt = 0;
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) => {
        attempt += 1;
        return fn(prisma as unknown as MockPrisma);
      });
      prisma.purchaseOrder.create.mockImplementation(({ data }: { data: { poNumber: string } }) => {
        if (attempt === 1) {
          throw conflict;
        }
        createdNumbers.push(data.poNumber);
        return Promise.resolve({ id: 'po-1', poNumber: data.poNumber });
      });

      await service.createPO(dto, testTenantId, testUserId);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(createdNumbers).toEqual([`PO-${datePart}-00002`]);
    });

    it('should reject an inventory item that does not belong to the tenant', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-1' }]);

      await expect(service.createPO(dto, testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should reject a supplier that does not belong to the tenant', async () => {
      prisma.supplierDetail.findFirst.mockResolvedValue(null);

      await expect(service.createPO(dto, testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('should reject a branch that does not belong to the tenant', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);

      await expect(service.createPO(dto, testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });
  });

  describe('updatePO', () => {
    const dto = {
      items: [{ inventoryItemId: 'item-1', quantity: 2, unitPrice: 5 }],
    };

    it('should reject an item that does not belong to the tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
      });
      prisma.inventoryItem.findMany.mockResolvedValue([]);

      await expect(service.updatePO('po-1', dto, testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );

      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('should reject a supplier that does not belong to the tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
      });
      prisma.supplierDetail.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePO('po-1', { supplierDetailId: 'foreign-sup' }, testTenantId, testUserId),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('submitPO', () => {
    it('should transition status with an optimistic-lock version check', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
        version: 3,
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        status: 'PENDING_APPROVAL',
        version: 4,
      });

      await service.submitPO('po-1', testTenantId, testUserId);

      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-1', tenantId: testTenantId, version: 3 },
          data: expect.objectContaining({
            status: 'PENDING_APPROVAL',
            version: { increment: 1 },
          }),
        }),
      );
      expect(prisma.purchaseOrder.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'po-1' } }),
      );
    });

    it('should throw ConflictException when the version has changed concurrently', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'DRAFT',
        version: 3,
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.submitPO('po-1', testTenantId, testUserId)).rejects.toThrow(
        ConflictException,
      );

      expect(prisma.purchaseOrder.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('closePO', () => {
    it('should throw ConflictException when the version has changed concurrently', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: 'RECEIVED',
        version: 5,
      });
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.closePO('po-1', testTenantId, testUserId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('createGRN', () => {
    const po = {
      id: 'po-1',
      tenantId: testTenantId,
      branchId: 'branch-1',
      poNumber: 'PO-0001',
      status: 'ORDERED',
      deletedAt: null,
      items: [{ id: 'po-item-1', quantity: 5, receivedQuantity: 0 }],
    };

    it('should reject a GRN line referencing an item that does not belong to the PO', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(po);

      await expect(
        service.createGRN(
          {
            purchaseOrderId: 'po-1',
            items: [
              {
                purchaseOrderItemId: 'foreign-item',
                inventoryItemId: 'item-1',
                quantityReceived: 1,
              },
            ],
          },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.goodsReceipt.create).not.toHaveBeenCalled();
    });

    it('should reject a GRN line referencing an inventory item outside the tenant', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(po);
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-1' }]);

      await expect(
        service.createGRN(
          {
            purchaseOrderId: 'po-1',
            items: [
              {
                purchaseOrderItemId: 'po-item-1',
                inventoryItemId: 'foreign-item',
                quantityReceived: 1,
              },
            ],
          },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should compute stock movement totalCost with 4dp decimal math', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(po);
      prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'item-1' }]);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.update.mockResolvedValue({});
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        currentQuantity: 0,
        availableQuantity: 0,
        averageCost: 0,
        version: 0,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 2 },
      ]);
      prisma.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'po-item-1', quantity: 5 });
      prisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.update.mockResolvedValue({});
      prisma.goodsReceipt.findUnique.mockResolvedValue({
        id: 'grn-1',
        tenantId: testTenantId,
        items: [],
        purchaseOrder: { items: [] },
      });

      await service.createGRN(
        {
          purchaseOrderId: 'po-1',
          items: [
            {
              purchaseOrderItemId: 'po-item-1',
              inventoryItemId: 'item-1',
              quantityReceived: 3,
              unitPrice: 0.1,
            },
          ],
        },
        testTenantId,
        testUserId,
      );

      const stockMovementCall = prisma.stockMovement.create.mock.calls[0][0];
      expect(stockMovementCall.data.totalCost).toBeCloseTo(0.3, 10);
      expect(Number.isInteger(stockMovementCall.data.totalCost * 10000)).toBe(true);
      expect(stockMovementCall.data.unitCost).toBe(0.1);
      expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ averageCost: expect.any(Number) }),
        }),
      );
    });

    it('should reject an over-receipt beyond the remaining PO quantity (P1-04)', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(po);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'po-item-1', quantity: 5 });
      prisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.createGRN(
          {
            purchaseOrderId: 'po-1',
            items: [
              {
                purchaseOrderItemId: 'po-item-1',
                inventoryItemId: 'item-1',
                quantityReceived: 6,
              },
            ],
          },
          testTenantId,
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('should reject one of two concurrent receipts of the same PO line (P1-04)', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(po);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'po-item-1', quantity: 5 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        currentQuantity: 0,
        availableQuantity: 0,
        averageCost: 0,
        version: 0,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 5 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});
      prisma.goodsReceipt.findUnique.mockResolvedValue({
        id: 'grn-1',
        tenantId: testTenantId,
        items: [],
        purchaseOrder: { items: [] },
      });

      const release: Array<() => void> = [];
      const barrier = new Promise<void>((resolve) => {
        release.push(resolve);
        release.push(resolve);
      });
      let claims = 0;
      prisma.purchaseOrderItem.updateMany.mockImplementation(async () => {
        await barrier;
        return { count: ++claims === 1 ? 1 : 0 };
      });

      const dto = {
        purchaseOrderId: 'po-1',
        items: [
          {
            purchaseOrderItemId: 'po-item-1',
            inventoryItemId: 'item-1',
            quantityReceived: 5,
          },
        ],
      };
      const first = service.createGRN(dto, testTenantId, testUserId);
      const second = service.createGRN(dto, testTenantId, testUserId);
      release.forEach((r) => r());
      const results = await Promise.allSettled([first, second]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(claims).toBe(2);
    });

    it('should retry once when the GRN number collides concurrently (P1-04)', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(po);
      let attempts = 0;
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '6.19.3',
            meta: { target: ['goodsReceipt_grnNumber_key'] },
          });
        }
        return fn(prisma);
      });
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'po-item-1', quantity: 5 });
      prisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        currentQuantity: 0,
        availableQuantity: 0,
        averageCost: 0,
        version: 0,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 5 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});
      prisma.goodsReceipt.findUnique.mockResolvedValue({
        id: 'grn-1',
        tenantId: testTenantId,
        items: [],
        purchaseOrder: { items: [] },
      });

      const result = await service.createGRN(
        {
          purchaseOrderId: 'po-1',
          items: [
            {
              purchaseOrderItemId: 'po-item-1',
              inventoryItemId: 'item-1',
              quantityReceived: 5,
            },
          ],
        },
        testTenantId,
        testUserId,
      );
      expect(result).toBeDefined();
      expect(attempts).toBe(2);
    });
  });

  describe('cancelGRN', () => {
    it('should record a negative decimal totalCost for the reversal movement', async () => {
      const grn = {
        id: 'grn-1',
        tenantId: testTenantId,
        branchId: 'branch-1',
        grnNumber: 'GRN-0001',
        status: 'COMPLETED',
        deletedAt: null,
        items: [
          {
            id: 'grn-item-1',
            purchaseOrderItemId: 'po-item-1',
            inventoryItemId: 'item-1',
            quantityReceived: 3,
            unitPrice: 0.1,
          },
        ],
      };
      prisma.goodsReceipt.findFirst.mockResolvedValue(grn);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.update.mockResolvedValue({});
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrderItem.update.mockResolvedValue({});
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 0 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});

      await service.cancelGRN('grn-1', testTenantId, testUserId);

      const movement = prisma.stockMovement.create.mock.calls[0][0];
      expect(movement.data.totalCost).toBe(-0.3);
      expect(Number(movement.data.quantity)).toBe(-3);
      expect(movement.data.type).toBe('ADJUSTMENT');
    });

    it('should reject a concurrent second cancel when the status claim fails (P1-05)', async () => {
      const grn = {
        id: 'grn-1',
        tenantId: testTenantId,
        branchId: 'branch-1',
        grnNumber: 'GRN-0001',
        status: 'COMPLETED',
        deletedAt: null,
        items: [],
      };
      prisma.goodsReceipt.findFirst.mockResolvedValue(grn);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelGRN('grn-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });

    it('should reverse exactly the attributed batch with a CAS guard (P1-05)', async () => {
      const grn = {
        id: 'grn-1',
        tenantId: testTenantId,
        branchId: 'branch-1',
        grnNumber: 'GRN-0001',
        status: 'COMPLETED',
        deletedAt: null,
        items: [
          {
            id: 'grn-item-1',
            purchaseOrderItemId: 'po-item-1',
            inventoryItemId: 'item-1',
            quantityReceived: 3,
            unitPrice: 0.1,
            batchNumber: 'B1',
            lotNumber: null,
            expiryDate: null,
            inventoryBatchId: 'batch-1',
          },
        ],
      };
      prisma.goodsReceipt.findFirst.mockResolvedValue(grn);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrderItem.update.mockResolvedValue({});
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.inventoryBatch.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 0 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});

      await service.cancelGRN('grn-1', testTenantId, testUserId);

      expect(prisma.inventoryBatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'batch-1', isActive: true, quantity: { gte: 3 } },
        data: { quantity: { decrement: 3 } },
      });
      expect(prisma.inventoryBatch.findMany).not.toHaveBeenCalled();
      expect(prisma.inventoryBatch.update).not.toHaveBeenCalled();
    });

    it('should reject a cancellation when the batch stock was already consumed (P1-05)', async () => {
      const grn = {
        id: 'grn-1',
        tenantId: testTenantId,
        branchId: 'branch-1',
        grnNumber: 'GRN-0001',
        status: 'COMPLETED',
        deletedAt: null,
        items: [
          {
            id: 'grn-item-1',
            purchaseOrderItemId: 'po-item-1',
            inventoryItemId: 'item-1',
            quantityReceived: 3,
            unitPrice: 0.1,
            batchNumber: 'B1',
            lotNumber: null,
            expiryDate: null,
            inventoryBatchId: 'batch-1',
          },
        ],
      };
      prisma.goodsReceipt.findFirst.mockResolvedValue(grn);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrderItem.update.mockResolvedValue({});
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.inventoryBatch.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelGRN('grn-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(1);
    });

    it('should not reverse any batch for a legacy GRN line without attribution (P1-05)', async () => {
      const grn = {
        id: 'grn-1',
        tenantId: testTenantId,
        branchId: 'branch-1',
        grnNumber: 'GRN-0001',
        status: 'COMPLETED',
        deletedAt: null,
        items: [
          {
            id: 'grn-item-1',
            purchaseOrderItemId: 'po-item-1',
            inventoryItemId: 'item-1',
            quantityReceived: 3,
            unitPrice: 0.1,
            batchNumber: 'B1',
            lotNumber: null,
            expiryDate: null,
            inventoryBatchId: null,
          },
        ],
      };
      prisma.goodsReceipt.findFirst.mockResolvedValue(grn);
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrderItem.update.mockResolvedValue({});
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 0 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});

      await service.cancelGRN('grn-1', testTenantId, testUserId);

      expect(prisma.inventoryBatch.updateMany).not.toHaveBeenCalled();
      expect(prisma.inventoryBatch.findMany).not.toHaveBeenCalled();
    });
  });

  describe('P1-05 concurrency & attribution scenarios', () => {
    function batchGRN(overrides: Record<string, unknown> = {}) {
      return {
        id: 'grn-1',
        tenantId: testTenantId,
        branchId: 'branch-1',
        grnNumber: 'GRN-0001',
        status: 'COMPLETED',
        deletedAt: null,
        items: [
          {
            id: 'grn-item-1',
            purchaseOrderItemId: 'po-item-1',
            inventoryItemId: 'item-1',
            quantityReceived: 5,
            unitPrice: 1,
            batchNumber: 'B1',
            lotNumber: null,
            expiryDate: null,
            inventoryBatchId: 'batch-1',
          },
        ],
        ...overrides,
      };
    }

    function setupCancelFlow() {
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.purchaseOrderItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 10, receivedQuantity: 0 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});
    }

    it('cancelling GRN-A reverses only A quantity on a shared batch; B stock stays intact', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue(
        batchGRN({ id: 'grn-a', grnNumber: 'GRN-A' }),
      );
      setupCancelFlow();
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });

      const state = { itemQty: 8, batchQty: 8 };
      const batchDecrements: number[] = [];
      const touchedBatchIds: string[] = [];
      prisma.inventoryItem.updateMany.mockImplementation(
        async (args: { data: { currentQuantity: { decrement: number } } }) => {
          const qty = Number(args.data.currentQuantity.decrement);
          if (state.itemQty < qty) return { count: 0 };
          state.itemQty -= qty;
          return { count: 1 };
        },
      );
      prisma.inventoryBatch.updateMany.mockImplementation(
        async (args: { where: { id: string }; data: { quantity: { decrement: number } } }) => {
          touchedBatchIds.push(args.where.id);
          const qty = Number(args.data.quantity.decrement);
          if (state.batchQty < qty) return { count: 0 };
          state.batchQty -= qty;
          batchDecrements.push(qty);
          return { count: 1 };
        },
      );

      await service.cancelGRN('grn-a', testTenantId, testUserId);

      expect(batchDecrements).toEqual([5]);
      expect(touchedBatchIds).toEqual(['batch-1']);
      expect(state.batchQty).toBe(3);
      expect(state.itemQty).toBe(3);
    });

    it('a second sequential cancel of an already-cancelled GRN is idempotent', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue(batchGRN({ status: 'CANCELLED', items: [] }));
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryBatch.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockMovement.create.mockResolvedValue({});

      await expect(service.cancelGRN('grn-1', testTenantId, testUserId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
      expect(prisma.inventoryBatch.updateMany).not.toHaveBeenCalled();
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('concurrent cancels of the same GRN reverse exactly once (status claim + barrier)', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue(batchGRN({}));
      setupCancelFlow();

      const state = { itemQty: 5, batchQty: 5 };
      prisma.inventoryItem.updateMany.mockImplementation(
        async (args: { data: { currentQuantity: { decrement: number } } }) => {
          const qty = Number(args.data.currentQuantity.decrement);
          if (state.itemQty < qty) return { count: 0 };
          state.itemQty -= qty;
          return { count: 1 };
        },
      );
      prisma.inventoryBatch.updateMany.mockImplementation(
        async (args: { data: { quantity: { decrement: number } } }) => {
          const qty = Number(args.data.quantity.decrement);
          if (state.batchQty < qty) return { count: 0 };
          state.batchQty -= qty;
          return { count: 1 };
        },
      );

      let arrived = 0;
      const release: Array<() => void> = [];
      const gate = new Promise<void>((resolve) => {
        release.push(resolve);
      });
      let claims = 0;
      prisma.goodsReceipt.updateMany.mockImplementation(async () => {
        arrived += 1;
        if (arrived === 2) release[0]();
        await gate;
        return { count: ++claims === 1 ? 1 : 0 };
      });

      const results = await Promise.allSettled([
        service.cancelGRN('grn-1', testTenantId, testUserId),
        service.cancelGRN('grn-1', testTenantId, testUserId),
      ]);

      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(state.itemQty).toBe(0);
      expect(state.batchQty).toBe(0);
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(1);
      expect(prisma.purchaseOrderItem.update).toHaveBeenCalledTimes(1);
    });

    it('concurrent cancels of two GRNs sharing one batch drain it by the exact sum', async () => {
      const grnA = batchGRN({ id: 'grn-a', grnNumber: 'GRN-A' });
      const grnB = batchGRN({
        id: 'grn-b',
        grnNumber: 'GRN-B',
        items: [
          {
            id: 'grn-item-b',
            purchaseOrderItemId: 'po-item-b',
            inventoryItemId: 'item-1',
            quantityReceived: 3,
            unitPrice: 1,
            batchNumber: 'B1',
            lotNumber: null,
            expiryDate: null,
            inventoryBatchId: 'batch-1',
          },
        ],
      });
      prisma.goodsReceipt.findFirst.mockImplementation(async (args: { where: { id: string } }) =>
        args.where.id === 'grn-a' ? grnA : grnB,
      );
      setupCancelFlow();
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });

      const state = { itemQty: 8, batchQty: 8 };
      const batchDecrements: number[] = [];
      const release: Array<() => void> = [];
      const gate = new Promise<void>((resolve) => {
        release.push(resolve);
      });
      let batchOps = 0;
      prisma.inventoryItem.updateMany.mockImplementation(
        async (args: { data: { currentQuantity: { decrement: number } } }) => {
          const qty = Number(args.data.currentQuantity.decrement);
          if (state.itemQty < qty) return { count: 0 };
          state.itemQty -= qty;
          return { count: 1 };
        },
      );
      prisma.inventoryBatch.updateMany.mockImplementation(
        async (args: { data: { quantity: { decrement: number } } }) => {
          batchOps += 1;
          if (batchOps === 2) release[0]();
          await gate;
          const qty = Number(args.data.quantity.decrement);
          if (state.batchQty < qty) return { count: 0 };
          state.batchQty -= qty;
          batchDecrements.push(qty);
          return { count: 1 };
        },
      );

      const results = await Promise.allSettled([
        service.cancelGRN('grn-a', testTenantId, testUserId),
        service.cancelGRN('grn-b', testTenantId, testUserId),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(state.batchQty).toBe(0);
      expect(state.itemQty).toBe(0);
      expect(batchDecrements.sort()).toEqual([3, 5]);
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
    });

    it('createGRN records the exact batch id on the goods receipt line', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        tenantId: testTenantId,
        poNumber: 'PO-1',
        status: 'ORDERED',
        items: [{ id: 'po-item-1', quantity: 5, receivedQuantity: 0 }],
      });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'po-item-1', quantity: 5 });
      prisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        currentQuantity: 0,
        availableQuantity: 0,
        averageCost: 0,
        version: 0,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.inventoryBatch.findFirst.mockResolvedValue(null);
      prisma.inventoryBatch.create.mockResolvedValue({ id: 'batch-1' });
      prisma.goodsReceiptItem.create.mockResolvedValue({ id: 'grn-item-1' });
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 5 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});
      prisma.goodsReceipt.findUnique.mockResolvedValue({ id: 'grn-1', items: [] });

      await service.createGRN(
        {
          purchaseOrderId: 'po-1',
          items: [
            {
              purchaseOrderItemId: 'po-item-1',
              inventoryItemId: 'item-1',
              quantityReceived: 3,
              unitPrice: 1,
              batchNumber: 'B1',
            },
          ],
        },
        testTenantId,
        testUserId,
      );

      expect(prisma.goodsReceiptItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ inventoryBatchId: 'batch-1' }),
        }),
      );
      expect(prisma.inventoryBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          inventoryItemId: 'item-1',
          batchNumber: 'B1',
          quantity: 3,
        }),
        select: { id: true },
      });
    });

    it('createGRN reuses an existing batch row and increments it (no duplicate)', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        tenantId: testTenantId,
        poNumber: 'PO-1',
        status: 'ORDERED',
        items: [{ id: 'po-item-1', quantity: 5, receivedQuantity: 0 }],
      });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'po-item-1', quantity: 5 });
      prisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        currentQuantity: 0,
        availableQuantity: 0,
        averageCost: 0,
        version: 0,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.inventoryBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      prisma.inventoryBatch.update.mockResolvedValue({});
      prisma.goodsReceiptItem.create.mockResolvedValue({ id: 'grn-item-1' });
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 5 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});
      prisma.goodsReceipt.findUnique.mockResolvedValue({ id: 'grn-1', items: [] });

      await service.createGRN(
        {
          purchaseOrderId: 'po-1',
          items: [
            {
              purchaseOrderItemId: 'po-item-1',
              inventoryItemId: 'item-1',
              quantityReceived: 3,
              unitPrice: 1,
              batchNumber: 'B1',
            },
          ],
        },
        testTenantId,
        testUserId,
      );

      expect(prisma.inventoryBatch.create).not.toHaveBeenCalled();
      expect(prisma.inventoryBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { quantity: { increment: 3 } },
      });
      expect(prisma.goodsReceiptItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ inventoryBatchId: 'batch-1' }),
        }),
      );
    });

    it('concurrent same-batch receipts resolve on P2002 by reusing the winning row', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        tenantId: testTenantId,
        poNumber: 'PO-1',
        status: 'ORDERED',
        items: [{ id: 'po-item-1', quantity: 10, receivedQuantity: 0 }],
      });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'po-item-1', quantity: 10 });
      prisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        currentQuantity: 0,
        availableQuantity: 0,
        averageCost: 0,
        version: 0,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.inventoryBatch.update.mockResolvedValue({});
      prisma.goodsReceiptItem.create.mockResolvedValue({ id: 'grn-item-1' });
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 10, receivedQuantity: 6 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});
      prisma.goodsReceipt.findUnique.mockResolvedValue({ id: 'grn-1', items: [] });

      const release: Array<() => void> = [];
      const gate = new Promise<void>((resolve) => {
        release.push(resolve);
      });
      let createCalls = 0;
      let winnerRecorded = false;
      let loserHitP2002 = false;
      prisma.inventoryBatch.findFirst.mockImplementation(async () => {
        // Both readers initially see no batch; after the winner's create commits,
        // the P2002 fallback re-read finds the row.
        return winnerRecorded && loserHitP2002 ? { id: 'batch-1' } : null;
      });
      prisma.inventoryBatch.create.mockImplementation(async () => {
        createCalls += 1;
        const isWinner = createCalls === 1;
        if (createCalls === 2) release[0]();
        await gate;
        if (isWinner) {
          winnerRecorded = true;
          return { id: 'batch-1' };
        }
        loserHitP2002 = true;
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`inventoryItemId`,`tenantId`,`batchNumber`,`lotNumber`,`expiryDate`)',
          {
            code: 'P2002',
            clientVersion: '6.19.3',
            meta: {
              target: ['inventoryItemId', 'tenantId', 'batchNumber', 'lotNumber', 'expiryDate'],
            },
          },
        );
      });

      const dto = {
        purchaseOrderId: 'po-1',
        items: [
          {
            purchaseOrderItemId: 'po-item-1',
            inventoryItemId: 'item-1',
            quantityReceived: 3,
            unitPrice: 1,
            batchNumber: 'B1',
          },
        ],
      };
      const results = await Promise.allSettled([
        service.createGRN(dto, testTenantId, testUserId),
        service.createGRN(dto, testTenantId, testUserId),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(createCalls).toBe(2);
      const lines = prisma.goodsReceiptItem.create.mock.calls.map(
        (call) => call[0].data.inventoryBatchId,
      );
      expect(lines).toEqual(['batch-1', 'batch-1']);
      expect(prisma.inventoryBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { quantity: { increment: 3 } },
      });
    });

    it('a receipt without batch identity is not attributed to any batch row', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        tenantId: testTenantId,
        poNumber: 'PO-1',
        status: 'ORDERED',
        items: [{ id: 'po-item-1', quantity: 5, receivedQuantity: 0 }],
      });
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.findUnique.mockResolvedValue({ id: 'po-item-1', quantity: 5 });
      prisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        currentQuantity: 0,
        availableQuantity: 0,
        averageCost: 0,
        version: 0,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.goodsReceiptItem.create.mockResolvedValue({ id: 'grn-item-1' });
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 5 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});
      prisma.goodsReceipt.findUnique.mockResolvedValue({ id: 'grn-1', items: [] });

      await service.createGRN(
        {
          purchaseOrderId: 'po-1',
          items: [
            {
              purchaseOrderItemId: 'po-item-1',
              inventoryItemId: 'item-1',
              quantityReceived: 3,
            },
          ],
        },
        testTenantId,
        testUserId,
      );

      expect(prisma.goodsReceiptItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ inventoryBatchId: null }),
        }),
      );
      expect(prisma.inventoryBatch.findFirst).not.toHaveBeenCalled();
      expect(prisma.inventoryBatch.create).not.toHaveBeenCalled();
    });

    it('cancelling GRN-A never touches a different batch row belonging to GRN-B', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue(
        batchGRN({
          id: 'grn-a',
          grnNumber: 'GRN-A',
          items: [
            {
              id: 'grn-item-a',
              purchaseOrderItemId: 'po-item-a',
              inventoryItemId: 'item-1',
              quantityReceived: 3,
              unitPrice: 1,
              batchNumber: 'B-A',
              lotNumber: null,
              expiryDate: null,
              inventoryBatchId: 'batch-a',
            },
          ],
        }),
      );
      setupCancelFlow();
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });

      const state = { itemQty: 8, batchA: 3, batchB: 5 };
      const touchedBatchIds: string[] = [];
      prisma.inventoryItem.updateMany.mockImplementation(
        async (args: { data: { currentQuantity: { decrement: number } } }) => {
          const qty = Number(args.data.currentQuantity.decrement);
          if (state.itemQty < qty) return { count: 0 };
          state.itemQty -= qty;
          return { count: 1 };
        },
      );
      prisma.inventoryBatch.updateMany.mockImplementation(
        async (args: { where: { id: string }; data: { quantity: { decrement: number } } }) => {
          touchedBatchIds.push(args.where.id);
          const qty = Number(args.data.quantity.decrement);
          const target = args.where.id === 'batch-a' ? state.batchA : state.batchB;
          if (target < qty) return { count: 0 };
          if (args.where.id === 'batch-a') state.batchA -= qty;
          else state.batchB -= qty;
          return { count: 1 };
        },
      );

      await service.cancelGRN('grn-a', testTenantId, testUserId);

      expect(touchedBatchIds).toEqual(['batch-a']);
      expect(state.batchA).toBe(0);
      expect(state.batchB).toBe(5);
      expect(state.itemQty).toBe(5);
    });

    it('cancellation writes exactly one accurate ADJUSTMENT movement for the GRN', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue(
        batchGRN({
          grnNumber: 'GRN-MOV',
          items: [
            {
              id: 'grn-item-1',
              purchaseOrderItemId: 'po-item-1',
              inventoryItemId: 'item-1',
              quantityReceived: 3.4,
              unitPrice: 2,
              batchNumber: 'B1',
              lotNumber: null,
              expiryDate: null,
              inventoryBatchId: 'batch-1',
            },
          ],
        }),
      );
      setupCancelFlow();
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryBatch.updateMany.mockResolvedValue({ count: 1 });

      await service.cancelGRN('grn-1', testTenantId, testUserId);

      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(1);
      const movement = prisma.stockMovement.create.mock.calls[0][0];
      expect(movement.data).toEqual(
        expect.objectContaining({
          inventoryItemId: 'item-1',
          type: 'ADJUSTMENT',
          referenceType: 'GoodsReceipt',
          referenceId: 'grn-1',
          notes: 'GRN cancellation GRN-MOV',
        }),
      );
      expect(Number(movement.data.quantity)).toBe(-3.4);
      expect(movement.data.totalCost).toBe(-6.8);
    });
  });

  describe('P1-06 N1: createGRN averageCost concurrency & final invariant', () => {
    function poFixture(id: string, poItemId: string) {
      return {
        id,
        tenantId: testTenantId,
        poNumber: `PO-${id}`,
        status: 'ORDERED',
        deletedAt: null,
        items: [{ id: poItemId, quantity: 100, receivedQuantity: 0 }],
      };
    }

    function grnDto(
      purchaseOrderId: string,
      poItemId: string,
      quantityReceived: number,
      unitPrice: number,
    ) {
      return {
        purchaseOrderId,
        items: [
          {
            purchaseOrderItemId: poItemId,
            inventoryItemId: 'item-1',
            quantityReceived,
            unitPrice,
          },
        ],
      };
    }

    function setupBaseCreateGRN(
      pos: Array<{ id: string; poItemId: string }> = [{ id: 'po-1', poItemId: 'po-item-1' }],
    ) {
      prisma.purchaseOrder.findFirst.mockImplementation(
        async (args?: { where?: { id?: string } }) => {
          const po = pos.find((p) => p.id === args?.where?.id) ?? pos[0];
          return poFixture(po.id, po.poItemId);
        },
      );
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.goodsReceipt.create.mockResolvedValue({ id: 'grn-1' });
      prisma.purchaseOrderItem.findUnique.mockImplementation(
        async (args: { where: { id: string } }) => {
          return { id: args.where.id, quantity: 100, receivedQuantity: 0 };
        },
      );
      prisma.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.goodsReceiptItem.create.mockResolvedValue({ id: 'grn-item-1' });
      prisma.purchaseOrderItem.findMany.mockImplementation(
        async (args: { where: { purchaseOrderId: string } }) => {
          const po = pos.find((p) => p.id === args.where.purchaseOrderId) ?? pos[0];
          return [{ id: po.poItemId, quantity: 100, receivedQuantity: 100 }];
        },
      );
      prisma.purchaseOrder.update.mockResolvedValue({});
      prisma.goodsReceipt.findUnique.mockResolvedValue({
        id: 'grn-1',
        tenantId: testTenantId,
        items: [],
        purchaseOrder: { items: [] },
      });
    }

    function statefulItem(initialQty: number, initialAvg: number, onUpdate?: () => void) {
      const state = { qty: initialQty, avg: initialAvg };
      prisma.inventoryItem.findFirst.mockImplementation(async () => ({
        id: 'item-1',
        currentQuantity: state.qty,
        availableQuantity: state.qty,
        averageCost: state.avg,
        version: 1,
      }));
      prisma.inventoryItem.update.mockImplementation(
        async (args: { data: { currentQuantity: { increment: number }; averageCost: number } }) => {
          state.qty += Number(args.data.currentQuantity.increment);
          state.avg = args.data.averageCost;
          onUpdate?.();
          return {};
        },
      );
      return state;
    }

    it('1. sequential update writes the exact weighted-average cost (N1)', async () => {
      setupBaseCreateGRN();
      const state = statefulItem(10, 2);

      await service.createGRN(grnDto('po-1', 'po-item-1', 10, 4), testTenantId, testUserId);

      expect(state.qty).toBe(20);
      expect(state.avg).toBe(3);
      const updateCall = prisma.inventoryItem.update.mock.calls[0][0];
      expect(updateCall.data).toEqual(
        expect.objectContaining({
          averageCost: 3,
          currentQuantity: { increment: 10 },
          lastCost: 4,
          unitCost: 4,
          version: { increment: 1 },
        }),
      );
    });

    it('2. concurrent GRNs for the same item never lose an averageCost update (N1)', async () => {
      setupBaseCreateGRN([
        { id: 'po-1', poItemId: 'po-item-1' },
        { id: 'po-2', poItemId: 'po-item-2' },
      ]);
      let releaseSecond!: () => void;
      const secondCanProceed = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      const state = statefulItem(10, 2, () => releaseSecond());

      let lockHeld = false;
      prisma.$queryRaw.mockImplementation(async () => {
        if (lockHeld) {
          await secondCanProceed;
        } else {
          lockHeld = true;
        }
      });

      const results = await Promise.allSettled([
        service.createGRN(grnDto('po-1', 'po-item-1', 10, 4), testTenantId, testUserId),
        service.createGRN(grnDto('po-2', 'po-item-2', 10, 10), testTenantId, testUserId),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(state.qty).toBe(30);
      expect(state.avg).toBeCloseTo(160 / 30, 4); // 5.3333
      expect(state.avg).not.toBe(6); // a stale-writer value would be 6
    });

    it('3. the averageCost read happens only after the FOR UPDATE lock is taken (N1)', async () => {
      setupBaseCreateGRN();
      const seq: string[] = [];
      prisma.$queryRaw.mockImplementation(async () => {
        seq.push('lock');
        return [];
      });
      prisma.inventoryItem.findFirst.mockImplementation(async () => {
        seq.push('read');
        return { id: 'item-1', currentQuantity: 10, averageCost: 2 };
      });
      prisma.inventoryItem.update.mockResolvedValue({});

      await service.createGRN(grnDto('po-1', 'po-item-1', 5, 4), testTenantId, testUserId);

      expect(seq).toEqual(['lock', 'read']);
      const raw = prisma.$queryRaw.mock.calls[0][0] as unknown as string[];
      expect(raw.join(' ')).toContain('FOR UPDATE');
      expect(raw.join(' ')).toContain('inventory_items');
      expect(raw.join(' ')).toContain('tenantId');
    });

    it('4. the conflicting writer computes from the winner committed state, not a stale read (N1)', async () => {
      setupBaseCreateGRN([
        { id: 'po-1', poItemId: 'po-item-1' },
        { id: 'po-2', poItemId: 'po-item-2' },
      ]);
      let releaseSecond!: () => void;
      const secondCanProceed = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      const state = statefulItem(10, 2, () => releaseSecond());

      let lockHeld = false;
      prisma.$queryRaw.mockImplementation(async () => {
        if (lockHeld) {
          await secondCanProceed;
        } else {
          lockHeld = true;
        }
      });

      const results = await Promise.allSettled([
        service.createGRN(grnDto('po-1', 'po-item-1', 10, 4), testTenantId, testUserId),
        service.createGRN(grnDto('po-2', 'po-item-2', 10, 10), testTenantId, testUserId),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(prisma.inventoryItem.update).toHaveBeenCalledTimes(2);
      const loserAverageCost = prisma.inventoryItem.update.mock.calls[1][0].data.averageCost;
      expect(loserAverageCost).toBeCloseTo(160 / 30, 4); // fresh value 5.3333
      expect(loserAverageCost).not.toBe(6); // stale-read value would be 6
      expect(state.avg).toBe(loserAverageCost);
    });

    it('5. averageCost stays exact with fractional Decimal quantities and costs (N1)', async () => {
      setupBaseCreateGRN();
      const state = statefulItem(0.5, 1.1);

      await service.createGRN(grnDto('po-1', 'po-item-1', 0.3, 2.5), testTenantId, testUserId);

      // totalCost = 0.3 * 2.5 = 0.75; newAvg = (1.1*0.5 + 0.75) / 0.8 = 1.625
      expect(state.avg).toBe(1.625);
      expect(state.qty).toBe(0.8);
      const movement = prisma.stockMovement.create.mock.calls[0][0];
      expect(movement.data.totalCost).toBe(0.75);
    });

    it('6. a mid-transaction failure surfaces and the row lock is released for a clean re-run (N1)', async () => {
      setupBaseCreateGRN();
      const persisted = { qty: 10, avg: 2 };
      const working = { ...persisted };
      prisma.inventoryItem.findFirst.mockImplementation(async () => ({
        id: 'item-1',
        currentQuantity: working.qty,
        availableQuantity: working.qty,
        averageCost: working.avg,
        version: 1,
      }));
      prisma.inventoryItem.update.mockImplementation(
        async (args: { data: { currentQuantity: { increment: number }; averageCost: number } }) => {
          working.qty += Number(args.data.currentQuantity.increment);
          working.avg = args.data.averageCost;
          return {};
        },
      );
      prisma.stockMovement.create.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.createGRN(grnDto('po-1', 'po-item-1', 10, 4), testTenantId, testUserId),
      ).rejects.toThrow('db down');

      Object.assign(working, persisted); // model PostgreSQL rollback on tx abort
      prisma.stockMovement.create.mockResolvedValue({});

      await service.createGRN(grnDto('po-1', 'po-item-1', 10, 4), testTenantId, testUserId);

      expect(working.qty).toBe(20); // only one successful application
      expect(working.avg).toBe(3);
    });

    it('7. a GRN-number collision retries the whole transaction and applies exactly once (N1)', async () => {
      setupBaseCreateGRN();
      const state = statefulItem(10, 2);

      let attempts = 0;
      prisma.$transaction.mockImplementation(async (fn: (tx: MockPrisma) => Promise<unknown>) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '6.19.3',
            meta: { target: ['goodsReceipt_grnNumber_key'] },
          });
        }
        return fn(prisma);
      });

      await service.createGRN(grnDto('po-1', 'po-item-1', 10, 4), testTenantId, testUserId);

      expect(attempts).toBe(2);
      expect(prisma.inventoryItem.update).toHaveBeenCalledTimes(1);
      expect(state.qty).toBe(20);
      expect(state.avg).toBe(3);
      expect(prisma.$queryRaw).toHaveBeenCalled(); // lock re-issued on the retry
    });

    it('8. final database invariant across two sequential GRNs (N1)', async () => {
      setupBaseCreateGRN([
        { id: 'po-1', poItemId: 'po-item-1' },
        { id: 'po-2', poItemId: 'po-item-2' },
      ]);
      const state = statefulItem(10, 2);

      await service.createGRN(grnDto('po-1', 'po-item-1', 5, 2), testTenantId, testUserId);
      await service.createGRN(grnDto('po-2', 'po-item-2', 5, 6), testTenantId, testUserId);

      // After GRN-1: qty 15, avg (2*10 + 10)/15 = 2. After GRN-2: qty 20, avg (2*15 + 30)/20 = 3.
      expect(state.qty).toBe(20);
      expect(state.avg).toBe(3);
    });
  });
});
