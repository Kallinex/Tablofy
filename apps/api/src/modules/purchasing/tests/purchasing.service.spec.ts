import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
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
      prisma.purchaseOrderItem.update.mockResolvedValue({});
      prisma.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        currentQuantity: 3,
        availableQuantity: 3,
      });
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.stockMovement.create.mockResolvedValue({});
      prisma.inventoryBatch.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrderItem.findMany.mockResolvedValue([
        { id: 'po-item-1', quantity: 5, receivedQuantity: 0 },
      ]);
      prisma.purchaseOrder.update.mockResolvedValue({});

      await service.cancelGRN('grn-1', testTenantId, testUserId);

      const movement = prisma.stockMovement.create.mock.calls[0][0];
      expect(movement.data.totalCost).toBe(-0.3);
      expect(movement.data.quantity).toBe(-3);
      expect(movement.data.type).toBe('ADJUSTMENT');
    });
  });
});
